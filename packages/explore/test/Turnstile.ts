import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

/**
 * A coin turnstile, small enough to explore by hand. A coin unlocks it, a push locks it
 * again, and its cash box jams after three coins. Seven states in all.
 */
export const TurnstileId = Schema.String.pipe(Schema.brand('TurnstileId'))

export class CoinInserted extends Domain.Event('CoinInserted', {}) {}
export class Passed extends Domain.Event('Passed', {}) {}

export class Jammed extends Domain.Rejection('Jammed', { coins: Schema.Int }) {}
export class StillLocked extends Domain.Rejection('StillLocked', {}) {}

export class InsertCoin extends Domain.Command('InsertCoin', {
  target: TurnstileId,
  events: [CoinInserted],
  rejects: [Jammed],
}) {}

export class Push extends Domain.Command('Push', {
  target: TurnstileId,
  events: [Passed],
  rejects: [StillLocked],
}) {}

const Coins = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
const Locked = Schema.TaggedStruct('Locked', { coins: Coins })
const Unlocked = Schema.TaggedStruct('Unlocked', { coins: Coins })
export const TurnstileState = Schema.Union([Locked, Unlocked])
export type TurnstileState = typeof TurnstileState.Type

const locked = (coins: number): TurnstileState => ({ _tag: 'Locked', coins })
const unlocked = (coins: number): TurnstileState => ({ _tag: 'Unlocked', coins })

export class Turnstile extends Domain.Aggregate('Turnstile', {
  id: TurnstileId,
  state: TurnstileState,
  initial: { _tag: 'Locked', coins: 0 },
  commands: [InsertCoin, Push],
  decide: {
    // A coin in an unlocked turnstile drops straight back out: accepted, nothing recorded.
    InsertCoin: state =>
      state._tag === 'Unlocked'
        ? []
        : state.coins >= 3
          ? new Jammed({ coins: state.coins })
          : [new CoinInserted()],
    Push: state => (state._tag === 'Unlocked' ? [new Passed()] : new StillLocked()),
  },
  evolve: {
    CoinInserted: state => unlocked(state.coins + 1),
    Passed: state => locked(state.coins),
  },
}) {}

export const turnstileId = TurnstileId.make('t-1')
