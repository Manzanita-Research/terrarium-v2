import * as Schema from 'effect/Schema'

/** Money in whole cents, so every sum is exact. */
export const Cents = Schema.Int
export type Cents = typeof Cents.Type

/** Money that must be more than zero: a price, a unit cost. */
export const PositiveCents = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))

/** Money that may be zero but never negative: a balance, a fee. */
export const NonNegativeCents = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))

/** A count of units, never negative. */
export const Units = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))

/** A count of units that must be at least one: an order, a move. */
export const PositiveUnits = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))
