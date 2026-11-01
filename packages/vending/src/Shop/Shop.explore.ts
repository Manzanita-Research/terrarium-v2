import { explore } from '@terrarium/explore/explore'

import { OpenShop } from './OpenShop.command.ts'
import { OrderStock } from './OrderStock.command.ts'
import { RecordSales } from './RecordSales.command.ts'
import { SetPrice } from './SetPrice.command.ts'
import { Shop, type ShopState } from './Shop.aggregate.ts'
import { ShopId } from './Shop.id.ts'
import { ShopInvariants, shopViews } from './Shop.invariants.ts'
import { StockMachine } from './StockMachine.command.ts'
import { WaitForNextDay } from './WaitForNextDay.command.ts'

/**
 * A season small enough to walk every state of: one product, two days, $6 and a $2 fee,
 * next-day delivery. Small, but every ending is in reach: four sodas empty the till, and
 * a till that can't pay the fee goes bankrupt.
 */
export const tinyOpening = {
  lastDay: 2,
  cash: 600,
  dailyFee: 200,
  leadDays: 1,
  catalog: { soda: { unitCost: 150, defaultPrice: 300 } },
}

/** Commands to try in every state, chosen to hit each outcome at least once. */
const everywhere = [
  new OpenShop(tinyOpening),
  new OrderStock({ product: 'soda', quantity: 1 }),
  // More than the till ever holds.
  new OrderStock({ product: 'soda', quantity: 9 }),
  new OrderStock({ product: 'gum', quantity: 1 }),
  new StockMachine({ product: 'soda', quantity: 1 }),
  new StockMachine({ product: 'gum', quantity: 1 }),
  new SetPrice({ product: 'soda', price: 450 }),
  new SetPrice({ product: 'soda', price: 300 }),
  new SetPrice({ product: 'gum', price: 100 }),
  new WaitForNextDay(),
  // A stale report, which every state ignores.
  new RecordSales({ day: 0, wanted: { soda: 1 } }),
]

/** The market's reports for the day that's closing: nobody came, or two customers did. */
const reports = (state: ShopState) =>
  state._tag === 'Closing'
    ? [
        new RecordSales({ day: state.books.day, wanted: { soda: 0 } }),
        new RecordSales({ day: state.books.day, wanted: { soda: 2 } }),
      ]
    : []

export const shopCommands = (state: ShopState) => [...everywhere, ...reports(state)]

/**
 * Walk every state the tiny season can reach, checking the shop's invariants after every
 * event. `Shop.chart.ts` is checked against what this finds.
 */
export const exploreShop = () =>
  explore(Shop, {
    id: ShopId.make('explore'),
    commands: shopCommands,
    views: shopViews,
    invariants: ShopInvariants,
  })
