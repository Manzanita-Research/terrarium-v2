/** An aggregate's state and the folds (views) kept beside it. */
export interface Snapshot<S, V> {
  readonly state: S
  readonly views: V
}

/** One event folded: the snapshot before it, the event, and the snapshot after. */
export interface Step<S, E, V> {
  readonly before: Snapshot<S, V>
  readonly event: E
  readonly after: Snapshot<S, V>
}

/** What a check returns: nothing when the rule holds, or a message saying how it broke. */
export type Verdict = string | undefined

/**
 * A rule that must hold however the world got here. A `State` invariant looks at every
 * snapshot; a `Step` invariant looks at every event with the snapshots either side, for
 * rules about change ("cash moves only when an event says so").
 */
export type Invariant<S, E, V> =
  | {
      readonly _tag: 'State'
      readonly name: string
      readonly check: (snapshot: Snapshot<S, V>) => Verdict
    }
  | {
      readonly _tag: 'Step'
      readonly name: string
      readonly check: (step: Step<S, E, V>) => Verdict
    }

/**
 * Invariant constructors for one world's state, events and views, so each check is typed
 * without spelling the types out every time.
 *
 * ```ts
 * const shop = Invariant.of<ShopState, ShopEvent, ShopViews>()
 * const cashNeverNegative = shop.state('cash never goes negative', ({ state }) => ...)
 * ```
 */
export const of = <S, E, V = object>() => ({
  state: (name: string, check: (snapshot: Snapshot<S, V>) => Verdict): Invariant<S, E, V> => ({
    _tag: 'State',
    name,
    check,
  }),
  step: (name: string, check: (step: Step<S, E, V>) => Verdict): Invariant<S, E, V> => ({
    _tag: 'Step',
    name,
    check,
  }),
})
