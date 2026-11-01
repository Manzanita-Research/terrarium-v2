import { Story } from '@alchemy.run/domain/Story'
import { describe, it } from '@effect/vitest'

import { FootfallLive } from '../src/Market/Footfall.policy.ts'
import { Shoppers } from '../src/Market/Shoppers.external.ts'
import { NetWorth } from '../src/Score/NetWorth.view.ts'
import { Scorecard } from '../src/Score/Scorecard.view.ts'
import { NotTrading } from '../src/Shop/NotTrading.rejection.ts'
import { AlreadyOpen, OpenShop, ShopOpened } from '../src/Shop/OpenShop.command.ts'
import { InsufficientCash, OrderStock, StockOrdered } from '../src/Shop/OrderStock.command.ts'
import {
  DayOpened,
  FeeCharged,
  RecordSales,
  SalesRecorded,
  SeasonEnded,
  StockDelivered,
  WentBankrupt,
} from '../src/Shop/RecordSales.command.ts'
import { PriceSet, SetPrice } from '../src/Shop/SetPrice.command.ts'
import {
  MachineStocked,
  NotEnoughInStorage,
  StockMachine,
} from '../src/Shop/StockMachine.command.ts'
import { UnknownProduct } from '../src/Shop/UnknownProduct.rejection.ts'
import { DayClosed, WaitForNextDay } from '../src/Shop/WaitForNextDay.command.ts'
import { Vending } from '../src/Vending.model.ts'
import { opening, shop, shopId } from './fixtures.ts'

const story = Story.make(Vending, { layer: FootfallLive, externalSystems: [Shoppers] })

const opened = new ShopOpened(opening)

const sodaOrdered = new StockOrdered({
  orderId: 'order-1',
  product: 'soda',
  quantity: 10,
  unitCost: 150,
  cost: 1_500,
  cashAfter: 8_500,
  arrivesOn: 2,
})

const emptyOffers = [
  { product: 'chips', price: 400, defaultPrice: 400, inMachine: 0 },
  { product: 'soda', price: 300, defaultPrice: 300, inMachine: 0 },
]

const noSales = (day: number, cash: number) =>
  new SalesRecorded({
    day,
    lines: [
      { product: 'chips', price: 400, wanted: 0, sold: 0, revenue: 0 },
      { product: 'soda', price: 300, wanted: 0, sold: 0, revenue: 0 },
    ],
    revenue: 0,
    cashAfter: cash,
  })

/** Day 1 with a soda order that arrives overnight: the shop starts day 2 with 10 soda in storage. */
const sodaInStorage = [
  opened,
  sodaOrdered,
  new DayClosed({ day: 1, offers: emptyOffers }),
  noSales(1, 8_500),
  new FeeCharged({ day: 1, fee: 200, cashAfter: 8_300 }),
  new StockDelivered({ day: 2, orderId: 'order-1', product: 'soda', quantity: 10 }),
  new DayOpened({ day: 2 }),
] as const

describe('Opening the shop', () => {
  it.effect('starts day 1 with the cash and every price at its default', () =>
    story(
      Story.when(shop, new OpenShop(opening)),
      Story.then(shop, opened),
      Story.state(shop, state => {
        if (state._tag !== 'Trading') throw new Error(`expected Trading, got ${state._tag}`)
        if (state.books.day !== 1 || state.books.cash !== 10_000) throw new Error('wrong books')
        if (state.books.prices.soda !== 300 || state.books.prices.chips !== 400) {
          throw new Error(`wrong prices: ${JSON.stringify(state.books.prices)}`)
        }
      }),
    ),
  )

  it.effect('refuses to open a shop twice', () =>
    story(
      Story.given(shop, opened),
      Story.when(shop, new OpenShop(opening)),
      Story.rejected(new AlreadyOpen({ status: 'Trading', day: 1 })),
    ),
  )

  it.effect('takes no orders before it opens', () =>
    story(
      Story.when(shop, new OrderStock({ product: 'soda', quantity: 1 })),
      Story.rejected(new NotTrading({ status: 'Unopened', day: null })),
    ),
  )
})

describe('Ordering stock', () => {
  it.effect('pays now, and tells the operator when the stock arrives', () =>
    story(
      Story.given(shop, opened),
      Story.when(shop, new OrderStock({ product: 'soda', quantity: 10 })),
      Story.then(shop, sodaOrdered),
      Story.replied({ orderId: 'order-1', arrivesOn: 2 }),
    ),
  )

  it.effect('numbers orders in the order they were placed', () =>
    story(
      Story.given(shop, opened, sodaOrdered),
      Story.when(shop, new OrderStock({ product: 'chips', quantity: 5 })),
      Story.then(
        shop,
        new StockOrdered({
          orderId: 'order-2',
          product: 'chips',
          quantity: 5,
          unitCost: 200,
          cost: 1_000,
          cashAfter: 7_500,
          arrivesOn: 2,
        }),
      ),
    ),
  )

  it.effect('refuses an order the till cannot pay for, showing both amounts', () =>
    story(
      Story.given(shop, opened),
      Story.when(shop, new OrderStock({ product: 'chips', quantity: 51 })),
      Story.rejected(new InsufficientCash({ cash: 10_000, cost: 10_200 })),
    ),
  )

  it.effect('refuses a product the shop does not sell, listing the ones it does', () =>
    story(
      Story.given(shop, opened),
      Story.when(shop, new OrderStock({ product: 'gum', quantity: 1 })),
      Story.rejected(new UnknownProduct({ product: 'gum', known: ['chips', 'soda'] })),
    ),
  )
})

describe('Stocking the machine', () => {
  it.effect('moves units from the storeroom into the machine', () =>
    story(
      Story.given(shop, ...sodaInStorage),
      Story.when(shop, new StockMachine({ product: 'soda', quantity: 6 })),
      Story.then(
        shop,
        new MachineStocked({ product: 'soda', quantity: 6, inStorage: 4, inMachine: 6 }),
      ),
    ),
  )

  it.effect('cannot move stock that has not arrived', () =>
    story(
      Story.given(shop, opened, sodaOrdered),
      Story.when(shop, new StockMachine({ product: 'soda', quantity: 1 })),
      Story.rejected(new NotEnoughInStorage({ product: 'soda', inStorage: 0, requested: 1 })),
    ),
  )
})

describe('Pricing', () => {
  it.effect('records the old price alongside the new one', () =>
    story(
      Story.given(shop, opened),
      Story.when(shop, new SetPrice({ product: 'soda', price: 350 })),
      Story.then(shop, new PriceSet({ product: 'soda', price: 350, was: 300 })),
    ),
  )

  it.effect('records nothing when the price does not change', () =>
    story(
      Story.given(shop, opened),
      Story.when(shop, new SetPrice({ product: 'soda', price: 300 })),
      Story.then(shop),
    ),
  )
})

describe('A day passing', () => {
  it.effect('customers want soda the machine does not have; the order arrives overnight', () =>
    story(
      Story.given(shop, opened, sodaOrdered),
      Story.when(shop, new WaitForNextDay()),
      Story.then(shop, new DayClosed({ day: 1, offers: emptyOffers })),
      Story.expectCall(Shoppers.visit, { shop: shopId, day: 1 }),
      Story.resolve(Shoppers.visit, { wanted: { soda: 3 } }),
      Story.then(
        shop,
        new SalesRecorded({
          day: 1,
          lines: [
            { product: 'chips', price: 400, wanted: 0, sold: 0, revenue: 0 },
            { product: 'soda', price: 300, wanted: 3, sold: 0, revenue: 0 },
          ],
          revenue: 0,
          cashAfter: 8_500,
        }),
        new FeeCharged({ day: 1, fee: 200, cashAfter: 8_300 }),
        new StockDelivered({ day: 2, orderId: 'order-1', product: 'soda', quantity: 10 }),
        new DayOpened({ day: 2 }),
      ),
      Story.view(Scorecard, shop, { stockouts: 1, lostSales: 3, unitsSold: 0, feesPaid: 200 }),
    ),
  )

  it.effect('sells what the machine holds at its price, and scores the day', () =>
    story(
      Story.given(
        shop,
        ...sodaInStorage,
        new MachineStocked({ product: 'soda', quantity: 10, inStorage: 0, inMachine: 10 }),
        new PriceSet({ product: 'soda', price: 350, was: 300 }),
      ),
      Story.when(shop, new WaitForNextDay()),
      Story.then(
        shop,
        new DayClosed({
          day: 2,
          offers: [
            { product: 'chips', price: 400, defaultPrice: 400, inMachine: 0 },
            { product: 'soda', price: 350, defaultPrice: 300, inMachine: 10 },
          ],
        }),
      ),
      Story.resolve(Shoppers.visit, { wanted: { soda: 4, chips: 2 } }),
      Story.then(
        shop,
        new SalesRecorded({
          day: 2,
          lines: [
            { product: 'chips', price: 400, wanted: 2, sold: 0, revenue: 0 },
            { product: 'soda', price: 350, wanted: 4, sold: 4, revenue: 1_400 },
          ],
          revenue: 1_400,
          cashAfter: 9_700,
        }),
        new FeeCharged({ day: 2, fee: 200, cashAfter: 9_500 }),
        new DayOpened({ day: 3 }),
      ),
      // Six soda left at $1.50 each: $95 cash + $9 stock.
      Story.view(NetWorth, shop, {
        cash: 9_500,
        stock: 900,
        days: [
          { day: 0, cash: 10_000, stock: 0, netWorth: 10_000 },
          { day: 1, cash: 8_300, stock: 1_500, netWorth: 9_800 },
          { day: 2, cash: 9_500, stock: 900, netWorth: 10_400 },
        ],
      }),
      Story.view(Scorecard, shop, {
        outcome: 'Trading',
        daysCompleted: 2,
        revenue: 1_400,
        unitsSold: 4,
        lostSales: 2,
        stockouts: 1,
        feesPaid: 400,
        ordersPlaced: 1,
      }),
    ),
  )

  it.effect('takes no requests while customers are shopping', () =>
    story(
      Story.given(shop, opened, new DayClosed({ day: 1, offers: emptyOffers })),
      Story.when(shop, new SetPrice({ product: 'soda', price: 250 })),
      Story.rejected(new NotTrading({ status: 'Closing', day: 1 })),
    ),
  )

  it.effect('ignores a second report of the same day', () =>
    story(
      Story.given(
        shop,
        opened,
        new DayClosed({ day: 1, offers: emptyOffers }),
        noSales(1, 10_000),
        new FeeCharged({ day: 1, fee: 200, cashAfter: 9_800 }),
        new DayOpened({ day: 2 }),
      ),
      Story.when(shop, new RecordSales({ day: 1, wanted: { soda: 5 } })),
      Story.then(shop),
    ),
  )

  it.effect('ignores a report for a day that has not closed', () =>
    story(
      Story.given(shop, opened),
      Story.when(shop, new RecordSales({ day: 1, wanted: { soda: 5 } })),
      Story.then(shop),
    ),
  )
})

describe('The end of a season', () => {
  it.effect('goes bankrupt when the till cannot pay the daily fee', () =>
    story(
      Story.given(shop, new ShopOpened({ ...opening, cash: 100 })),
      Story.when(shop, new WaitForNextDay()),
      Story.then(shop, new DayClosed({ day: 1, offers: emptyOffers })),
      Story.resolve(Shoppers.visit, { wanted: {} }),
      Story.then(shop, noSales(1, 100), new WentBankrupt({ day: 1, cash: 100, fee: 200 })),
      Story.view(Scorecard, shop, { outcome: 'Bankrupt', finalCash: 100 }),
      Story.when(shop, new OrderStock({ product: 'soda', quantity: 1 })),
      Story.rejected(new NotTrading({ status: 'Ended', day: 1 })),
    ),
  )

  it.effect('ends after the last day, and nothing more arrives', () =>
    story(
      Story.given(shop, new ShopOpened({ ...opening, lastDay: 1 }), sodaOrdered),
      Story.when(shop, new WaitForNextDay()),
      Story.then(shop, new DayClosed({ day: 1, offers: emptyOffers })),
      Story.resolve(Shoppers.visit, { wanted: {} }),
      Story.then(
        shop,
        noSales(1, 8_500),
        new FeeCharged({ day: 1, fee: 200, cashAfter: 8_300 }),
        new SeasonEnded({ day: 1, cash: 8_300 }),
      ),
      Story.view(Scorecard, shop, { outcome: 'SeasonOver', finalCash: 8_300, daysCompleted: 1 }),
      Story.when(shop, new WaitForNextDay()),
      Story.rejected(new NotTrading({ status: 'Ended', day: 1 })),
    ),
  )
})
