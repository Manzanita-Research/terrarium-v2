import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { Cents } from '../Money.ts'
import { Shop } from '../Shop/Shop.aggregate.ts'

/** Where the shop stood at the end of a day. Day 0 is the opening balance. */
export const DayEnd = Schema.Struct({
  day: Schema.Int,
  cash: Cents,
  /** Stock in the storeroom, the machine and on order, at what it cost. */
  stock: Cents,
  netWorth: Cents,
})
export type DayEnd = typeof DayEnd.Type

/**
 * The shop's net worth (cash plus stock at cost) at the end of every day: the sim's score,
 * as a series to chart. Buying stock moves value from cash to stock; selling turns stock
 * back into cash at a markup; the daily fee is the only steady drain.
 */
export class NetWorth extends Domain.View('NetWorth', {
  from: [Shop],
  key: Shop,
  state: Schema.Struct({
    unitCosts: Schema.Record(Schema.String, Cents),
    cash: Cents,
    stock: Cents,
    days: Schema.Array(DayEnd),
  }),
  initial: { unitCosts: {}, cash: 0, stock: 0, days: [] },
  evolve: {
    ShopOpened: (_view, { cash, catalog }) => ({
      unitCosts: Object.fromEntries(Object.entries(catalog).map(([p, item]) => [p, item.unitCost])),
      cash,
      stock: 0,
      days: [{ day: 0, cash, stock: 0, netWorth: cash }],
    }),
    StockOrdered: (view, { cost, cashAfter }) => ({
      ...view,
      cash: cashAfter,
      stock: view.stock + cost,
    }),
    SalesRecorded: (view, { lines, cashAfter }) => ({
      ...view,
      cash: cashAfter,
      stock:
        view.stock -
        lines.reduce((sum, line) => sum + line.sold * (view.unitCosts[line.product] ?? 0), 0),
    }),
    FeeCharged: (view, { day, cashAfter }) => ({
      ...view,
      cash: cashAfter,
      days: [
        ...view.days,
        { day, cash: cashAfter, stock: view.stock, netWorth: cashAfter + view.stock },
      ],
    }),
    WentBankrupt: (view, { day }) => ({
      ...view,
      days: [
        ...view.days,
        { day, cash: view.cash, stock: view.stock, netWorth: view.cash + view.stock },
      ],
    }),
  },
}) {}
