import * as Statechart from '@terrarium/explore/Statechart'

import { Shop } from './Shop.aggregate.ts'

/** Every command `trading` refuses with `NotTrading` when the shop isn't trading. */
const notTrading = (state: 'Unopened' | 'Closing' | 'SeasonOver' | 'Bankrupt') =>
  (['OrderStock', 'StockMachine', 'SetPrice', 'WaitForNextDay'] as const).map(command => ({
    in: state,
    command,
    rejections: ['NotTrading' as const],
  }))

/** Every state after the shop opened refuses to open it again. */
const alreadyOpen = (state: 'Trading' | 'Closing' | 'SeasonOver' | 'Bankrupt') => ({
  in: state,
  command: 'OpenShop' as const,
  rejections: ['AlreadyOpen' as const],
})

/**
 * The shop's lifecycle: Unopened → Trading ⇄ Closing → Ended, with Ended split by how the
 * season ended. `test/Shop.explore.test.ts` holds this to what `explore()` finds, both ways,
 * and `Shop.chart.mmd` is drawn from it.
 */
export const ShopChart = Statechart.make(Shop, {
  states: {
    Unopened: 'before the season starts',
    Trading: "the operator's turn",
    Closing: 'customers are shopping',
    SeasonOver: 'ended: the season ran its course',
    Bankrupt: "ended: the till couldn't pay the fee",
  },
  label: state => (state._tag === 'Ended' ? state.reason : state._tag),
  initial: 'Unopened',
  final: ['SeasonOver', 'Bankrupt'],
  transitions: [
    { from: 'Unopened', command: 'OpenShop', to: 'Trading', events: ['ShopOpened'] },
    { from: 'Trading', command: 'OrderStock', to: 'Trading', events: ['StockOrdered'] },
    { from: 'Trading', command: 'StockMachine', to: 'Trading', events: ['MachineStocked'] },
    { from: 'Trading', command: 'SetPrice', to: 'Trading', events: ['PriceSet'] },
    { from: 'Trading', command: 'WaitForNextDay', to: 'Closing', events: ['DayClosed'] },
    {
      from: 'Closing',
      command: 'RecordSales',
      to: 'Trading',
      events: ['SalesRecorded', 'FeeCharged', 'StockDelivered', 'DayOpened'],
    },
    {
      from: 'Closing',
      command: 'RecordSales',
      to: 'SeasonOver',
      events: ['SalesRecorded', 'FeeCharged', 'SeasonEnded'],
    },
    {
      from: 'Closing',
      command: 'RecordSales',
      to: 'Bankrupt',
      events: ['SalesRecorded', 'WentBankrupt'],
    },
  ],
  refusals: [
    ...notTrading('Unopened'),
    alreadyOpen('Trading'),
    { in: 'Trading', command: 'OrderStock', rejections: ['UnknownProduct', 'InsufficientCash'] },
    {
      in: 'Trading',
      command: 'StockMachine',
      rejections: ['UnknownProduct', 'NotEnoughInStorage'],
    },
    { in: 'Trading', command: 'SetPrice', rejections: ['UnknownProduct'] },
    alreadyOpen('Closing'),
    ...notTrading('Closing'),
    alreadyOpen('SeasonOver'),
    ...notTrading('SeasonOver'),
    alreadyOpen('Bankrupt'),
    ...notTrading('Bankrupt'),
  ],
  noops: [
    // A report for a day that isn't closing records nothing, wherever it lands.
    { in: 'Unopened', command: 'RecordSales' },
    { in: 'Trading', command: 'RecordSales' },
    { in: 'Closing', command: 'RecordSales' },
    { in: 'SeasonOver', command: 'RecordSales' },
    { in: 'Bankrupt', command: 'RecordSales' },
    // Setting the price it already has.
    { in: 'Trading', command: 'SetPrice' },
  ],
})
