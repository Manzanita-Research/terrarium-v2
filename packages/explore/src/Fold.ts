import * as Cause from 'effect/Cause'
import type * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type * as Aggregate from '@alchemy.run/domain/Aggregate'
import type * as View from '@alchemy.run/domain/View'

import type { Invariant, Snapshot, Verdict } from './Invariant.ts'

/**
 * What exploring and replaying need from an aggregate: its name and its pure definition.
 * Every `Domain.Aggregate` class fits, and so does a hand-made variant of one (a planted bug).
 */
export interface Definable {
  readonly aggregateName: string
  readonly definition: Aggregate.AnyDefinition
}

/** Commands, events and rejections all carry a `_tag`. */
type Tagged = { readonly _tag: string }

export type IdOf<A extends Definable> = A['definition']['id']['Type']
export type StateOf<A extends Definable> = A['definition']['state']['Type']
export type CommandOf<A extends Definable> = Aggregate.Inst<A['definition']['commands'][number]> &
  Tagged
export type EventOf<A extends Definable> = Aggregate.Inst<A['definition']['events'][number]> &
  Tagged
export type RejectionOf<A extends Definable> = Aggregate.Inst<
  A['definition']['commands'][number]['rejects'][number]
> &
  Tagged

/**
 * A running fold over an aggregate's events, kept beside its state: a view's state, say.
 * `evolve` is a method so a fold of any state fits a record of folds.
 */
export interface Fold<E, S> {
  readonly initial: S
  evolve(state: S, event: E, envelope: Aggregate.Envelope): S
}

/** Named folds, carried through an exploration or a replay. */
export type Folds<E> = Readonly<Record<string, Fold<E, unknown>>>

/** The state of each fold in a record of folds. */
export type FoldStates<F> = {
  readonly [K in keyof F]: F[K] extends Fold<infer _E, infer S> ? S : never
}

type Handler = (...args: ReadonlyArray<unknown>) => unknown

/**
 * Fold a `Domain.View` over one aggregate's events, as the platform would for that
 * aggregate's key. Only views fed by that aggregate alone, keyed by it, and with one
 * handler per event (no routes, no deletes) fit; anything else throws here.
 */
export const viewOf = <A extends Definable, V extends View.Any>(
  aggregate: A,
  view: V,
): Fold<EventOf<A>, View.StateOf<V>> => {
  const def = view.definition
  const name = (source: unknown) =>
    typeof source === 'object' || typeof source === 'function'
      ? (source as { readonly aggregateName?: unknown }).aggregateName
      : undefined
  if (
    def.from.length !== 1 ||
    name(def.from[0]) !== aggregate.aggregateName ||
    name(def.key) !== aggregate.aggregateName ||
    def.keyOf !== undefined
  ) {
    throw new Error(`viewOf: a view must read and be keyed by ${aggregate.aggregateName} alone`)
  }
  const handlers = (def.evolve ?? {}) as Readonly<Record<string, unknown>>
  return {
    initial: def.initial as View.StateOf<V>,
    evolve(state, event, envelope) {
      const handler = handlers[event._tag] ?? handlers[aggregate.aggregateName]
      if (handler === undefined) return state
      if (typeof handler !== 'function') {
        throw new Error(`viewOf: ${event._tag} is routed, which a single-key fold can't follow`)
      }
      const ref = { id: envelope.id }
      const next = (handler as Handler)(state, event, {
        key: ref,
        source: ref,
        state: undefined,
        envelope,
        at: envelope.at,
      })
      if (next === null) throw new Error(`viewOf: ${event._tag} deleted the view`)
      return next as View.StateOf<V>
    },
  }
}

/** An invariant that failed, or a definition bug found while folding. */
export interface Failure {
  /** The invariant's name, or `decide`, `evolve` or `schema` for a broken definition. */
  readonly invariant: string
  readonly message: string
  /** The event being folded when it failed, if any. */
  readonly event?: string
}

/** What `decide` made of a command. */
export type Decision<E, R> =
  | { readonly _tag: 'Events'; readonly events: ReadonlyArray<E> }
  | { readonly _tag: 'Rejected'; readonly rejection: R }
  | { readonly _tag: 'Broken'; readonly failure: Failure }

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Run `decide` for one command, as the kernel does: an Effect decision runs
 * synchronously, and an event or rejection the command doesn't declare is a bug.
 */
export const decide = <A extends Definable>(
  aggregate: A,
  state: StateOf<A>,
  command: CommandOf<A>,
  ctx: { readonly id: IdOf<A>; readonly now: DateTime.Utc },
): Decision<EventOf<A>, RejectionOf<A>> => {
  const def = aggregate.definition
  const broken = (message: string) =>
    ({ _tag: 'Broken', failure: { invariant: 'decide', message } }) as const
  const declared = def.commands.find(c => c.tag === command._tag)
  const handler = def.decide[command._tag] as Handler | undefined
  if (declared === undefined || handler === undefined) {
    return broken(`${aggregate.aggregateName} does not handle ${command._tag}`)
  }
  let decision: unknown
  try {
    decision = handler(state, command, ctx)
  } catch (error) {
    return broken(`decide.${command._tag} threw: ${describe(error)}`)
  }
  if (Effect.isEffect(decision)) {
    const exit = Effect.runSyncExit(decision as Effect.Effect<unknown, unknown>)
    if (Exit.isSuccess(exit)) {
      decision = exit.value
    } else {
      const error = Cause.findErrorOption(exit.cause)
      if (Option.isNone(error))
        return broken(`decide.${command._tag} died: ${Cause.pretty(exit.cause)}`)
      decision = error.value
    }
  }
  if (Array.isArray(decision)) {
    const events = decision as ReadonlyArray<EventOf<A>>
    const stray = events.find(event => !declared.events.some(e => e.tag === event._tag))
    if (stray !== undefined) {
      return broken(`decide.${command._tag} recorded ${stray._tag}, which it doesn't declare`)
    }
    return { _tag: 'Events', events }
  }
  const rejection = decision as RejectionOf<A>
  if (!declared.rejects.some(r => r.tag === rejection?._tag)) {
    return broken(
      `decide.${command._tag} rejected with ${rejection?._tag}, which it doesn't declare`,
    )
  }
  return { _tag: 'Rejected', rejection }
}

/** A state and the folds beside it, plus the stream position it was reached at. */
export interface Position<S, V> extends Snapshot<S, V> {
  readonly version: number
}

/**
 * Fold events onto a position: `evolve` the state and every fold, one event at a time,
 * and check each invariant after each event. Stops at the first broken `evolve`, or after a
 * state its own schema rejects (once its invariants have had their say), since nothing
 * after that means anything.
 */
export const apply = <A extends Definable, F extends Folds<EventOf<A>>>(
  aggregate: A,
  folds: F,
  invariants: ReadonlyArray<Invariant<StateOf<A>, EventOf<A>, FoldStates<F>>>,
  from: Position<StateOf<A>, FoldStates<F>>,
  events: ReadonlyArray<EventOf<A>>,
  envelope: (seq: number) => Aggregate.Envelope,
): {
  readonly to: Position<StateOf<A>, FoldStates<F>> | undefined
  readonly failures: Array<Failure>
} => {
  const def = aggregate.definition
  const isState = Schema.is(def.state as Schema.Top)
  const failures: Array<Failure> = []
  let before = from
  for (const event of events) {
    const handler = def.evolve[event._tag] as Handler | undefined
    const at = envelope(before.version + 1)
    let after: Position<StateOf<A>, FoldStates<F>>
    try {
      if (handler === undefined) throw new Error(`no evolve handler for ${event._tag}`)
      const views: Record<string, unknown> = {}
      for (const [name, fold] of Object.entries(folds)) {
        views[name] = fold.evolve(before.views[name as keyof F], event, at)
      }
      after = {
        state: handler(before.state, event, at) as StateOf<A>,
        views: views as FoldStates<F>,
        version: before.version + 1,
      }
    } catch (error) {
      failures.push({ invariant: 'evolve', message: describe(error), event: event._tag })
      return { to: undefined, failures }
    }
    for (const invariant of invariants) {
      let verdict: Verdict
      try {
        verdict =
          invariant._tag === 'State'
            ? invariant.check(after)
            : invariant.check({ before, event, after })
      } catch (error) {
        verdict = `the check threw: ${describe(error)}`
      }
      if (typeof verdict === 'string') {
        failures.push({ invariant: invariant.name, message: verdict, event: event._tag })
      }
    }
    if (!isState(after.state)) {
      failures.push({
        invariant: 'schema',
        message: `${event._tag} left a state its schema rejects: ${canonical(after.state)}`,
        event: event._tag,
      })
      return { to: undefined, failures }
    }
    before = after
  }
  return { to: before, failures }
}

/** Check the state invariants on a position that no event led to: the start. */
export const checkStart = <S, E, V>(
  invariants: ReadonlyArray<Invariant<S, E, V>>,
  start: Snapshot<S, V>,
): Array<Failure> =>
  invariants.flatMap(invariant => {
    if (invariant._tag !== 'State') return []
    let verdict: Verdict
    try {
      verdict = invariant.check(start)
    } catch (error) {
      verdict = `the check threw: ${describe(error)}`
    }
    return typeof verdict === 'string' ? [{ invariant: invariant.name, message: verdict }] : []
  })

/** The folds' starting states. */
export const initialViews = <F extends Folds<never>>(folds: F): FoldStates<F> =>
  Object.fromEntries(
    Object.entries(folds).map(([name, fold]) => [name, fold.initial]),
  ) as FoldStates<F>

/** JSON with object keys sorted, so equal data always prints the same. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, field: unknown) =>
    field !== null && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : field,
  )

/** The envelope a fold sees for event `seq`: one stream, one clock, no real commands. */
export const envelopeFor =
  (aggregate: Definable, id: string, now: DateTime.Utc, commandId: string) =>
  (seq: number): Aggregate.Envelope => ({
    id,
    stream: `${aggregate.aggregateName}/${id}`,
    seq,
    at: now,
    commandId,
    correlationId: commandId,
  })
