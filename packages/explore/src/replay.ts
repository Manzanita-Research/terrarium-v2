import * as DateTime from 'effect/DateTime'

import {
  type Definable,
  type EventOf,
  type Failure,
  type FoldStates,
  type Folds,
  type IdOf,
  type StateOf,
  apply,
  checkStart,
  envelopeFor,
  initialViews,
} from './Fold.ts'
import type { Invariant } from './Invariant.ts'

export interface ReplayOptions<A extends Definable, F extends Folds<EventOf<A>>> {
  /** The id the envelopes carry. */
  readonly id: IdOf<A>
  /** Where to start. Defaults to the aggregate's initial state. */
  readonly from?: StateOf<A>
  /** Folds (views) to carry beside the state. */
  readonly views?: F
  /** Checked after every event, and on the start. */
  readonly invariants?: ReadonlyArray<Invariant<StateOf<A>, EventOf<A>, FoldStates<NoInfer<F>>>>
  /** The time every envelope carries. Defaults to 2026-01-01. */
  readonly now?: DateTime.Utc
}

export interface Replay<A extends Definable, F> {
  /** The state after the last event that folded cleanly. */
  readonly state: StateOf<A>
  readonly views: FoldStates<F>
  /** How many events folded cleanly. Less than the log's length when one broke. */
  readonly applied: number
  /** Every failure, with the index of the event it happened on (-1 for the start). */
  readonly violations: ReadonlyArray<Failure & { readonly index: number }>
}

/**
 * Fold a recorded event log through the aggregate's own `evolve`, checking every
 * invariant after every event: the same checks `explore` runs, on a real run's history.
 */
export const replay = <A extends Definable, F extends Folds<EventOf<A>> = Record<string, never>>(
  aggregate: A,
  events: ReadonlyArray<EventOf<A>>,
  options: ReplayOptions<A, F>,
): Replay<A, F> => {
  const folds = (options.views ?? {}) as F
  const invariants = options.invariants ?? []
  const now = options.now ?? DateTime.makeUnsafe('2026-01-01T00:00:00Z')
  const envelope = envelopeFor(aggregate, String(options.id), now, 'replay')
  let position = {
    state: (options.from ?? aggregate.definition.initial) as StateOf<A>,
    views: initialViews(folds),
    version: 0,
  }
  const violations: Array<Failure & { readonly index: number }> = checkStart(
    invariants,
    position,
  ).map(failure => ({ ...failure, index: -1 }))
  for (const [index, event] of events.entries()) {
    const { to, failures } = apply(aggregate, folds, invariants, position, [event], envelope)
    violations.push(...failures.map(failure => ({ ...failure, index })))
    if (to === undefined) break
    position = to
  }
  return {
    state: position.state,
    views: position.views,
    applied: position.version,
    violations,
  }
}
