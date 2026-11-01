import * as DateTime from 'effect/DateTime'

import {
  type CommandOf,
  type Definable,
  type EventOf,
  type Failure,
  type FoldStates,
  type Folds,
  type IdOf,
  type RejectionOf,
  type StateOf,
  apply,
  canonical,
  checkStart,
  decide,
  envelopeFor,
  initialViews,
} from './Fold.ts'
import type { Invariant } from './Invariant.ts'

export interface Options<A extends Definable, F extends Folds<EventOf<A>>> {
  /** The id `decide` sees. */
  readonly id: IdOf<A>
  /**
   * The commands to try in every state, in order. A function picks them per state, for
   * commands whose input depends on it (a report for the day that's closing).
   */
  readonly commands:
    | ReadonlyArray<CommandOf<A>>
    | ((state: StateOf<A>) => ReadonlyArray<CommandOf<A>>)
  /** Where to start. Defaults to the aggregate's initial state. */
  readonly from?: StateOf<A>
  /** Folds (views) to carry beside the state, for invariants to compare against. */
  readonly views?: F
  /** Checked after every event of every transition, and on the start. */
  readonly invariants?: ReadonlyArray<Invariant<StateOf<A>, EventOf<A>, FoldStates<NoInfer<F>>>>
  /** Which states count as the same. Defaults to the state's canonical JSON. */
  readonly key?: (state: StateOf<A>) => string
  /** The most commands on any path. States this deep are kept but not expanded. Default 50. */
  readonly maxDepth?: number
  /** The most distinct states to keep. Default 10,000. */
  readonly maxStates?: number
  /** The time `decide` sees. Defaults to the story clock's start, 2026-01-01. */
  readonly now?: DateTime.Utc
}

/** A distinct state found, and the shortest way there. */
export interface Node<A extends Definable, F> {
  readonly key: string
  readonly state: StateOf<A>
  /** The folds as they stood on the first (shortest) path here. */
  readonly views: FoldStates<F>
  /** How many commands the shortest path takes. */
  readonly depth: number
  /** Events on the shortest path. */
  readonly version: number
  /** The state before the last command of the shortest path, and that command. */
  readonly parent: { readonly key: string; readonly command: CommandOf<A> } | undefined
}

/** A command that recorded events, from one state to another (possibly the same). */
export interface Transition<A extends Definable> {
  readonly from: string
  readonly command: CommandOf<A>
  readonly events: ReadonlyArray<EventOf<A>>
  readonly to: string
}

/** A command `decide` refused, and why. */
export interface Refusal<A extends Definable> {
  readonly from: string
  readonly command: CommandOf<A>
  readonly rejection: RejectionOf<A>
}

/** A command `decide` accepted with no events. */
export interface NoOp<A extends Definable> {
  readonly from: string
  readonly command: CommandOf<A>
}

/** A broken invariant or definition, and the commands that lead to it from the start. */
export interface Violation<A extends Definable> extends Failure {
  /** The state the failing command was sent to. */
  readonly from: string
  readonly path: ReadonlyArray<CommandOf<A>>
}

export interface Exploration<A extends Definable, F> {
  readonly aggregate: string
  /** The key of the starting state. */
  readonly start: string
  /** Every distinct state found, in the order found (breadth first). */
  readonly states: ReadonlyMap<string, Node<A, F>>
  readonly transitions: ReadonlyArray<Transition<A>>
  readonly refusals: ReadonlyArray<Refusal<A>>
  readonly noops: ReadonlyArray<NoOp<A>>
  readonly violations: ReadonlyArray<Violation<A>>
  /**
   * States found but never expanded: `depth` ones sat at `maxDepth`, `states` ones were
   * still queued when `maxStates` was reached. Both empty means the walk was exhaustive
   * for these commands: every reachable state, every command tried in each.
   */
  readonly truncated: {
    readonly depth: ReadonlyArray<string>
    readonly states: ReadonlyArray<string>
  }
  /** The shortest list of commands from the start to a state. */
  readonly pathTo: (key: string) => ReadonlyArray<CommandOf<A>>
}

/**
 * Walk every state an aggregate can reach from a start, breadth first, through its real
 * `decide` and `evolve`, trying each command in each state. Records what each command
 * did (transition, refusal or no-op), checks invariants after every event, and flags
 * definition bugs: an `evolve` that throws, an undeclared event or rejection, a state
 * its own schema rejects. Pure and deterministic: the same inputs walk the same way.
 *
 * Numeric state makes the space huge, so keep the commands few and the start small,
 * and let invariants check the numbers.
 */
export const explore = <A extends Definable, F extends Folds<EventOf<A>> = Record<string, never>>(
  aggregate: A,
  options: Options<A, F>,
): Exploration<A, F> => {
  const def = aggregate.definition
  const folds = (options.views ?? {}) as F
  const invariants = options.invariants ?? []
  const keyOf = options.key ?? canonical
  const maxDepth = options.maxDepth ?? 50
  const maxStates = options.maxStates ?? 10_000
  const now = options.now ?? DateTime.makeUnsafe('2026-01-01T00:00:00Z')
  const id = options.id
  const commandsFor =
    typeof options.commands === 'function'
      ? options.commands
      : () => options.commands as ReadonlyArray<CommandOf<A>>

  const states = new Map<string, Node<A, F>>()
  const transitions: Array<Transition<A>> = []
  const refusals: Array<Refusal<A>> = []
  const noops: Array<NoOp<A>> = []
  const violations: Array<Violation<A>> = []
  const truncatedByDepth: Array<string> = []
  // States found after `maxStates` was reached: recorded as destinations, never kept.
  const dropped = new Set<string>()
  let commits = 0

  const pathTo = (key: string): ReadonlyArray<CommandOf<A>> => {
    const path: Array<CommandOf<A>> = []
    for (
      let node = states.get(key);
      node?.parent !== undefined;
      node = states.get(node.parent.key)
    ) {
      path.unshift(node.parent.command)
    }
    return path
  }

  const startState = (options.from ?? def.initial) as StateOf<A>
  const start: Node<A, F> = {
    key: keyOf(startState),
    state: startState,
    views: initialViews(folds),
    depth: 0,
    version: 0,
    parent: undefined,
  }
  states.set(start.key, start)
  for (const failure of checkStart(invariants, start)) {
    violations.push({ ...failure, from: start.key, path: [] })
  }

  const queue: Array<Node<A, F>> = [start]
  let head = 0
  while (head < queue.length) {
    const node = queue[head++]!
    if (node.depth >= maxDepth) {
      truncatedByDepth.push(node.key)
      continue
    }
    for (const command of commandsFor(node.state)) {
      const decision = decide(aggregate, node.state, command, { id, now })
      if (decision._tag === 'Broken') {
        violations.push({
          ...decision.failure,
          from: node.key,
          path: [...pathTo(node.key), command],
        })
        continue
      }
      if (decision._tag === 'Rejected') {
        refusals.push({ from: node.key, command, rejection: decision.rejection })
        continue
      }
      if (decision.events.length === 0) {
        noops.push({ from: node.key, command })
        continue
      }
      const commandId = `explore-${++commits}`
      const { to, failures } = apply(
        aggregate,
        folds,
        invariants,
        node,
        decision.events,
        envelopeFor(aggregate, String(id), now, commandId),
      )
      for (const failure of failures) {
        violations.push({ ...failure, from: node.key, path: [...pathTo(node.key), command] })
      }
      if (to === undefined) continue
      const key = keyOf(to.state)
      transitions.push({ from: node.key, command, events: decision.events, to: key })
      if (states.has(key)) continue
      if (states.size >= maxStates) {
        dropped.add(key)
        continue
      }
      const next: Node<A, F> = {
        key,
        state: to.state,
        views: to.views,
        depth: node.depth + 1,
        version: to.version,
        parent: { key: node.key, command },
      }
      states.set(key, next)
      queue.push(next)
    }
  }

  return {
    aggregate: aggregate.aggregateName,
    start: start.key,
    states,
    transitions,
    refusals,
    noops,
    violations,
    truncated: {
      depth: truncatedByDepth,
      states: [...queue.slice(head).map(node => node.key), ...dropped],
    },
    pathTo,
  }
}
