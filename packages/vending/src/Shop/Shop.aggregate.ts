import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { productsOf } from '../Product.ts'
import { Books, type SaleLineInput, unitsOf } from './Books.ts'
import { NotTrading } from './NotTrading.rejection.ts'
import { AlreadyOpen, OpenShop, ShopOpened } from './OpenShop.command.ts'
import { InsufficientCash, OrderStock, StockOrdered } from './OrderStock.command.ts'
import {
  DayOpened,
  FeeCharged,
  RecordSales,
  SalesRecorded,
  SeasonEnded,
  StockDelivered,
  WentBankrupt,
} from './RecordSales.command.ts'
import { PriceSet, SetPrice } from './SetPrice.command.ts'
import { ShopId } from './Shop.id.ts'
import { MachineStocked, NotEnoughInStorage, StockMachine } from './StockMachine.command.ts'
import { UnknownProduct } from './UnknownProduct.rejection.ts'
import { DayClosed, WaitForNextDay } from './WaitForNextDay.command.ts'

/** Before the season starts. */
const Unopened = Schema.TaggedStruct('Unopened', {})
/** The operator's turn: they may order, stock, price, or wait for the next day. */
const Trading = Schema.TaggedStruct('Trading', { books: Books })
/** The operator has waited; customers are shopping and the day hasn't rolled over yet. */
const Closing = Schema.TaggedStruct('Closing', { books: Books })
/** The season is over: it ran its course, or the shop couldn't pay its fee. */
const Ended = Schema.TaggedStruct('Ended', {
  reason: Schema.Literals(['SeasonOver', 'Bankrupt']),
  books: Books,
})

export const ShopState = Schema.Union([Unopened, Trading, Closing, Ended])
export type ShopState = typeof ShopState.Type

const asTrading = (books: Books): ShopState => ({ _tag: 'Trading', books })
const asClosing = (books: Books): ShopState => ({ _tag: 'Closing', books })
const asEnded = (reason: 'SeasonOver' | 'Bankrupt', books: Books): ShopState => ({
  _tag: 'Ended',
  reason,
  books,
})

const zeroes = (products: ReadonlyArray<string>) =>
  Object.fromEntries(products.map(product => [product, 0]))

/** The books of a shop that's trading, or why it isn't. */
const trading = (state: ShopState): Books | NotTrading =>
  state._tag === 'Trading'
    ? state.books
    : new NotTrading({
        status: state._tag,
        day: state._tag === 'Unopened' ? null : state.books.day,
      })

/** The books of a shop in a given status. Folding an event onto any other is a bug. */
const booksWhen = <T extends ShopState['_tag']>(
  state: ShopState,
  status: T,
  event: string,
): Books => {
  if (state._tag !== status || state._tag === 'Unopened') {
    throw new Error(`${event} can't apply to a shop that is ${state._tag}`)
  }
  return state.books
}

const unknownProduct = (books: Books, product: string) =>
  new UnknownProduct({ product, known: productsOf(books.catalog) })

/**
 * One vending machine business: its till, storeroom, machine and supplier orders,
 * over one season. The operator (an agent, a script or a person) orders stock,
 * moves it into the machine, sets prices and waits for the next day.
 */
export class Shop extends Domain.Aggregate('Shop', {
  id: ShopId,
  state: ShopState,
  initial: { _tag: 'Unopened' },
  commands: [OpenShop, OrderStock, StockMachine, SetPrice, WaitForNextDay, RecordSales],
  decide: {
    OpenShop: (state, { lastDay, cash, dailyFee, leadDays, catalog }) =>
      state._tag === 'Unopened'
        ? [new ShopOpened({ lastDay, cash, dailyFee, leadDays, catalog })]
        : new AlreadyOpen({ status: state._tag, day: state.books.day }),

    OrderStock: (state, { product, quantity }) => {
      const books = trading(state)
      if (books instanceof NotTrading) return books
      const item = books.catalog[product]
      if (item === undefined) return unknownProduct(books, product)
      const cost = item.unitCost * quantity
      if (cost > books.cash) return new InsufficientCash({ cash: books.cash, cost })
      return [
        new StockOrdered({
          orderId: `order-${books.ordersPlaced + 1}`,
          product,
          quantity,
          unitCost: item.unitCost,
          cost,
          cashAfter: books.cash - cost,
          arrivesOn: books.day + books.leadDays,
        }),
      ]
    },

    StockMachine: (state, { product, quantity }) => {
      const books = trading(state)
      if (books instanceof NotTrading) return books
      if (books.catalog[product] === undefined) return unknownProduct(books, product)
      const inStorage = unitsOf(books.storage, product)
      if (inStorage < quantity) {
        return new NotEnoughInStorage({ product, inStorage, requested: quantity })
      }
      return [
        new MachineStocked({
          product,
          quantity,
          inStorage: inStorage - quantity,
          inMachine: unitsOf(books.machine, product) + quantity,
        }),
      ]
    },

    SetPrice: (state, { product, price }) => {
      const books = trading(state)
      if (books instanceof NotTrading) return books
      if (books.catalog[product] === undefined) return unknownProduct(books, product)
      const was = books.prices[product] ?? books.catalog[product].defaultPrice
      return price === was ? [] : [new PriceSet({ product, price, was })]
    },

    WaitForNextDay: state => {
      const books = trading(state)
      if (books instanceof NotTrading) return books
      return [
        new DayClosed({
          day: books.day,
          offers: productsOf(books.catalog).map(product => ({
            product,
            price: books.prices[product]!,
            defaultPrice: books.catalog[product]!.defaultPrice,
            inMachine: unitsOf(books.machine, product),
          })),
        }),
      ]
    },

    // A report of what happened, so it never rejects. Only the report for the day that is
    // closing counts; any other (a repeat, a late one) records nothing.
    RecordSales: (state, { day, wanted }) => {
      if (state._tag !== 'Closing' || state.books.day !== day) return []
      const books = state.books
      const lines: Array<SaleLineInput> = productsOf(books.catalog).map(product => {
        const want = Math.max(0, wanted[product] ?? 0)
        const sold = Math.min(want, unitsOf(books.machine, product))
        const price = books.prices[product]!
        return { product, price, wanted: want, sold, revenue: sold * price }
      })
      const revenue = lines.reduce((sum, line) => sum + line.revenue, 0)
      const cash = books.cash + revenue
      const sales = new SalesRecorded({ day, lines, revenue, cashAfter: cash })
      if (cash < books.dailyFee) {
        return [sales, new WentBankrupt({ day, cash, fee: books.dailyFee })]
      }
      const cashAfter = cash - books.dailyFee
      const fee = new FeeCharged({ day, fee: books.dailyFee, cashAfter })
      if (day >= books.lastDay) return [sales, fee, new SeasonEnded({ day, cash: cashAfter })]
      const deliveries = books.orders
        .filter(order => order.arrivesOn === day + 1)
        .map(
          ({ orderId, product, quantity }) =>
            new StockDelivered({ day: day + 1, orderId, product, quantity }),
        )
      return [sales, fee, ...deliveries, new DayOpened({ day: day + 1 })]
    },
  },
  evolve: {
    ShopOpened: (state, { lastDay, cash, dailyFee, leadDays, catalog }) => {
      if (state._tag !== 'Unopened')
        throw new Error(`ShopOpened can't apply to a ${state._tag} shop`)
      const products = productsOf(catalog)
      return asTrading({
        day: 1,
        lastDay,
        cash,
        dailyFee,
        leadDays,
        catalog,
        prices: Object.fromEntries(products.map(p => [p, catalog[p]!.defaultPrice])),
        storage: zeroes(products),
        machine: zeroes(products),
        orders: [],
        ordersPlaced: 0,
      })
    },
    StockOrdered: (state, { orderId, product, quantity, cost, cashAfter, arrivesOn }) => {
      const books = booksWhen(state, 'Trading', 'StockOrdered')
      return asTrading({
        ...books,
        cash: cashAfter,
        orders: [...books.orders, { orderId, product, quantity, cost, arrivesOn }],
        ordersPlaced: books.ordersPlaced + 1,
      })
    },
    MachineStocked: (state, { product, inStorage, inMachine }) => {
      const books = booksWhen(state, 'Trading', 'MachineStocked')
      return asTrading({
        ...books,
        storage: { ...books.storage, [product]: inStorage },
        machine: { ...books.machine, [product]: inMachine },
      })
    },
    PriceSet: (state, { product, price }) => {
      const books = booksWhen(state, 'Trading', 'PriceSet')
      return asTrading({ ...books, prices: { ...books.prices, [product]: price } })
    },
    DayClosed: state => asClosing(booksWhen(state, 'Trading', 'DayClosed')),
    SalesRecorded: (state, { lines, cashAfter }) => {
      const books = booksWhen(state, 'Closing', 'SalesRecorded')
      const machine = { ...books.machine }
      for (const line of lines) machine[line.product] = unitsOf(machine, line.product) - line.sold
      return asClosing({ ...books, machine, cash: cashAfter })
    },
    FeeCharged: (state, { cashAfter }) => {
      const books = booksWhen(state, 'Closing', 'FeeCharged')
      return asClosing({ ...books, cash: cashAfter })
    },
    WentBankrupt: state => asEnded('Bankrupt', booksWhen(state, 'Closing', 'WentBankrupt')),
    StockDelivered: (state, { orderId, product, quantity }) => {
      const books = booksWhen(state, 'Closing', 'StockDelivered')
      return asClosing({
        ...books,
        storage: { ...books.storage, [product]: unitsOf(books.storage, product) + quantity },
        orders: books.orders.filter(order => order.orderId !== orderId),
      })
    },
    DayOpened: (state, { day }) => asTrading({ ...booksWhen(state, 'Closing', 'DayOpened'), day }),
    SeasonEnded: state => asEnded('SeasonOver', booksWhen(state, 'Closing', 'SeasonEnded')),
  },
  reply: {
    OrderStock: (_state, events) => {
      const ordered = events.find(event => event._tag === 'StockOrdered')
      if (ordered === undefined) throw new Error('OrderStock replied without a StockOrdered')
      return { orderId: ordered.orderId, arrivesOn: ordered.arrivesOn }
    },
  },
  // The whole shop is the operator's to see. Nothing here is private, and each run
  // hosts its own model, so there is no one else's shop to read.
  read: {},
}) {}
