import * as Schema from 'effect/Schema'

/** One shop: a vending machine, its storeroom and its till. One run of the sim has one shop. */
export const ShopId = Schema.String.pipe(Schema.brand('ShopId'))
export type ShopId = typeof ShopId.Type
