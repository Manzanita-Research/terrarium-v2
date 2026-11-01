import { type EventOf, type FoldStates, viewOf } from '@terrarium/explore/Fold'
import * as Invariant from '@terrarium/explore/Invariant'

import { NetWorth } from '../Score/NetWorth.view.ts'
import { type Books, stockAtCost, unitsOf } from './Books.ts'
import { Shop, type ShopState } from './Shop.aggregate.ts'

/** The views the invariants compare against the shop's own books. */
export const shopViews = { netWorth: viewOf(Shop, NetWorth) }
export type ShopViews = FoldStates<typeof shopViews>
export type ShopEvent = EventOf<typeof Shop>

const shop = Invariant.of<ShopState, ShopEvent, ShopViews>()

const booksOf = (state: ShopState): Books | undefined =>
  state._tag === 'Unopened' ? undefined : state.books

/** Every unit the shop owns or has paid for: storeroom, machine and on order. */
const unitsOwned = (books: Books): number =>
  Object.values(books.storage).reduce((sum, units) => sum + units, 0) +
  Object.values(books.machine).reduce((sum, units) => sum + units, 0) +
  books.orders.reduce((sum, order) => sum + order.quantity, 0)

export const cashNeverNegative = shop.state('cash never goes negative', ({ state }) => {
  const books = booksOf(state)
  return books !== undefined && books.cash < 0 ? `cash is ${books.cash}` : undefined
})

export const stockNeverNegative = shop.state('stock never goes negative', ({ state }) => {
  const books = booksOf(state)
  if (books === undefined) return undefined
  for (const [where, counts] of [
    ['storage', books.storage],
    ['machine', books.machine],
  ] as const) {
    for (const [product, units] of Object.entries(counts)) {
      if (units < 0) return `${where} holds ${units} ${product}`
    }
  }
  return undefined
})

/**
 * Cash moves only when an event says where it ends up. Every event that touches the till
 * carries `cashAfter` (or, opening the shop, `cash`), and the books must land exactly there;
 * any other event must leave the till alone.
 */
export const cashOnlyThroughEvents = shop.step(
  'cash changes only through events',
  ({ before, event, after }) => {
    const was = booksOf(before.state)?.cash
    const now = booksOf(after.state)?.cash
    const said =
      event._tag === 'ShopOpened' ? event.cash : 'cashAfter' in event ? event.cashAfter : undefined
    if (said !== undefined) {
      return now === said ? undefined : `${event._tag} says cash is ${said}, books say ${now}`
    }
    return now === was ? undefined : `${event._tag} moved cash from ${was} to ${now}`
  },
)

/**
 * Units appear only when ordered and leave only when sold. Moving stock into the machine
 * or a delivery into the storeroom shifts units around without changing the total.
 */
export const unitsAccountedFor = shop.step(
  'every unit is accounted for',
  ({ before, event, after }) => {
    const was = booksOf(before.state)
    const now = booksOf(after.state)
    if (was === undefined || now === undefined) return undefined
    const change =
      event._tag === 'StockOrdered'
        ? event.quantity
        : event._tag === 'SalesRecorded'
          ? -event.lines.reduce((sum, line) => sum + line.sold, 0)
          : 0
    const expected = unitsOwned(was) + change
    const actual = unitsOwned(now)
    return actual === expected
      ? undefined
      : `${event._tag} should leave ${expected} units owned, books say ${actual}`
  },
)

/** A sale needs stock in the machine, at the machine's price, and a customer who wanted it. */
export const noSaleWithoutStock = shop.step('no sale without stock', ({ before, event }) => {
  if (event._tag !== 'SalesRecorded') return undefined
  const books = booksOf(before.state)
  if (books === undefined) return 'sales recorded before the shop opened'
  for (const line of event.lines) {
    const inMachine = unitsOf(books.machine, line.product)
    if (line.sold > inMachine) return `sold ${line.sold} ${line.product}, machine held ${inMachine}`
    if (line.sold > line.wanted) return `sold ${line.sold} ${line.product}, ${line.wanted} wanted`
    if (line.price !== books.prices[line.product]) {
      return `sold ${line.product} at ${line.price}, machine charged ${books.prices[line.product]}`
    }
    if (line.revenue !== line.sold * line.price) {
      return `${line.product} took ${line.revenue} for ${line.sold} at ${line.price}`
    }
  }
  const revenue = event.lines.reduce((sum, line) => sum + line.revenue, 0)
  return revenue === event.revenue
    ? undefined
    : `lines add to ${revenue}, sale says ${event.revenue}`
})

/** Each order arrives the morning it was due: an open day never has a late order. */
export const noOverdueOrders = shop.state('no order is overdue', ({ state }) => {
  if (state._tag !== 'Trading') return undefined
  const late = state.books.orders.find(order => order.arrivesOn <= state.books.day)
  return late === undefined
    ? undefined
    : `${late.orderId} was due on day ${late.arrivesOn}, it's day ${state.books.day}`
})

/** The day only counts up from 1 and never runs past the season. */
export const dayWithinSeason = shop.state('the day stays within the season', ({ state }) => {
  const books = booksOf(state)
  if (books === undefined) return undefined
  return books.day >= 1 && books.day <= books.lastDay
    ? undefined
    : `day ${books.day} of ${books.lastDay}`
})

/**
 * The NetWorth view, folded from events alone, agrees with the shop's own books after
 * every event, and has one entry per finished day (day 0 is the opening balance).
 */
export const netWorthMatchesBooks = shop.state(
  'the NetWorth view matches the books',
  ({ state, views: { netWorth } }) => {
    const books = booksOf(state)
    if (books === undefined) return undefined
    if (netWorth.cash !== books.cash) return `view cash ${netWorth.cash}, books ${books.cash}`
    const stock = stockAtCost(books)
    if (netWorth.stock !== stock) return `view stock ${netWorth.stock}, books ${stock}`
    const finished =
      state._tag === 'Trading' ? books.day : state._tag === 'Ended' ? books.day + 1 : undefined
    if (finished !== undefined && netWorth.days.length !== finished) {
      return `${netWorth.days.length} day entries on day ${books.day} (${state._tag})`
    }
    return undefined
  },
)

/** Everything that must hold in every vending world, however it got there. */
export const ShopInvariants = [
  cashNeverNegative,
  stockNeverNegative,
  cashOnlyThroughEvents,
  unitsAccountedFor,
  noSaleWithoutStock,
  noOverdueOrders,
  dayWithinSeason,
  netWorthMatchesBooks,
]
