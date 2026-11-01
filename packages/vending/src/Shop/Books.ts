import * as Schema from 'effect/Schema'

import { Cents, NonNegativeCents, PositiveUnits, Units } from '../Money.ts'
import { Catalog, Product, productsOf } from '../Product.ts'

/** Stock that has been paid for and is on its way. */
export const Order = Schema.Struct({
  orderId: Schema.String,
  product: Product,
  quantity: PositiveUnits,
  cost: Cents,
  /** The morning it arrives in the storeroom. */
  arrivesOn: Schema.Int,
})
export type Order = typeof Order.Type

/** Everything an open shop keeps track of. */
export const Books = Schema.Struct({
  /** The current day, from 1. */
  day: Schema.Int,
  /** The last day of the season. */
  lastDay: Schema.Int,
  cash: Cents,
  dailyFee: NonNegativeCents,
  /** Days between ordering stock and its arrival. */
  leadDays: Schema.Int,
  catalog: Catalog,
  prices: Schema.Record(Schema.String, Cents),
  /** Units in the storeroom, by product. Customers can't buy these. */
  storage: Schema.Record(Schema.String, Units),
  /** Units in the vending machine, by product. Customers buy these. */
  machine: Schema.Record(Schema.String, Units),
  /** Orders paid for and not yet delivered, oldest first. */
  orders: Schema.Array(Order),
  /** How many orders the shop has ever placed; numbers the next one. */
  ordersPlaced: Schema.Int,
})
export type Books = typeof Books.Type

export const unitsOf = (counts: Readonly<Record<string, number>>, product: string): number =>
  counts[product] ?? 0

/** Every unit the shop owns (storeroom, machine and on order), valued at what it cost. */
export const stockAtCost = (books: Books): number =>
  productsOf(books.catalog).reduce((sum, product) => {
    const held = unitsOf(books.storage, product) + unitsOf(books.machine, product)
    return sum + held * books.catalog[product]!.unitCost
  }, 0) + books.orders.reduce((sum, order) => sum + order.cost, 0)

/** Cash plus stock at cost: the sim's score. */
export const netWorth = (books: Books): number => books.cash + stockAtCost(books)

/** The fields of one `SaleLine`, as `decide` builds them. */
export interface SaleLineInput {
  readonly product: string
  readonly price: number
  readonly wanted: number
  readonly sold: number
  readonly revenue: number
}
