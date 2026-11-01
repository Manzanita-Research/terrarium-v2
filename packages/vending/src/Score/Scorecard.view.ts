import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { Cents, Units } from '../Money.ts'
import { Shop } from '../Shop/Shop.aggregate.ts'

/**
 * The season's totals, as v1 reported them: revenue, units, stockouts and how it ended.
 * A stockout is one product, one day, with customers who wanted more than the machine held.
 */
export class Scorecard extends Domain.View('Scorecard', {
  from: [Shop],
  key: Shop,
  state: Schema.Struct({
    outcome: Schema.Literals(['Trading', 'SeasonOver', 'Bankrupt']),
    daysCompleted: Schema.Int,
    revenue: Cents,
    unitsSold: Units,
    /** Units customers wanted that the machine didn't have. */
    lostSales: Units,
    stockouts: Schema.Int,
    feesPaid: Cents,
    ordersPlaced: Schema.Int,
    finalCash: Schema.NullOr(Cents),
  }),
  initial: {
    outcome: 'Trading',
    daysCompleted: 0,
    revenue: 0,
    unitsSold: 0,
    lostSales: 0,
    stockouts: 0,
    feesPaid: 0,
    ordersPlaced: 0,
    finalCash: null,
  },
  evolve: {
    StockOrdered: view => ({ ...view, ordersPlaced: view.ordersPlaced + 1 }),
    SalesRecorded: (view, { lines, revenue }) => ({
      ...view,
      revenue: view.revenue + revenue,
      unitsSold: view.unitsSold + lines.reduce((sum, line) => sum + line.sold, 0),
      lostSales: view.lostSales + lines.reduce((sum, line) => sum + line.wanted - line.sold, 0),
      stockouts: view.stockouts + lines.filter(line => line.wanted > line.sold).length,
    }),
    FeeCharged: (view, { day, fee }) => ({
      ...view,
      daysCompleted: day,
      feesPaid: view.feesPaid + fee,
    }),
    WentBankrupt: (view, { cash }) => ({ ...view, outcome: 'Bankrupt' as const, finalCash: cash }),
    SeasonEnded: (view, { cash }) => ({ ...view, outcome: 'SeasonOver' as const, finalCash: cash }),
  },
}) {}
