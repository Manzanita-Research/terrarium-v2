import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'

import * as InMemory from '@alchemy.run/domain/InMemory'
import { describe, expect, it } from '@effect/vitest'
import { replay } from '@terrarium/explore/replay'

import { FootfallLive } from '../src/Market/Footfall.policy.ts'
import { SeededShoppers } from '../src/Market/SeededShoppers.ts'
import { draw } from '../src/Market/demand.ts'
import { OperatorApi } from '../src/OperatorApi.api.ts'
import { productsOf } from '../src/Product.ts'
import { type Books, stockAtCost, unitsOf } from '../src/Shop/Books.ts'
import { OpenShop } from '../src/Shop/OpenShop.command.ts'
import { Shop } from '../src/Shop/Shop.aggregate.ts'
import { ShopId } from '../src/Shop/Shop.id.ts'
import { ShopInvariants, shopViews } from '../src/Shop/Shop.invariants.ts'
import { Vending } from '../src/Vending.model.ts'
import { baseDemand, opening } from '../src/VendingLite.ts'

const id = ShopId.make('shop-1')

/**
 * Deliver everything queued, and what that delivers in turn, until nothing is left
 * and no policy is mid-run. The same loop the story runner uses.
 */
const settle = (control: InMemory.Control) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1_000; i++) {
      yield* control.drain
      yield* Effect.yieldNow
      if (yield* control.idle) return
    }
    return yield* Effect.die(new Error('the world did not settle'))
  })

type Operator = Effect.Success<typeof OperatorApi.testClient>

/**
 * How an operator plays a day: what it does with the books it sees, through the
 * OperatorApi alone. `roll(key)` is a number in [0, 1) fixed by the season's seed and
 * the key, so a strategy that rolls dice still plays the same season every time.
 */
type Strategy = (
  operator: Operator,
  books: Books,
  roll: (key: string) => number,
) => Effect.Effect<void, unknown>

/** Keeps the machine full, reorders when stock runs low and never changes a price. */
const steady: Strategy = (operator, books) =>
  Effect.gen(function* () {
    for (const product of productsOf(books.catalog)) {
      const inStorage = unitsOf(books.storage, product)
      if (inStorage > 0) yield* operator.StockMachine({ target: id, product, quantity: inStorage })
      const onOrder = books.orders
        .filter(order => order.product === product)
        .reduce((sum, order) => sum + order.quantity, 0)
      const held = inStorage + unitsOf(books.machine, product) + onOrder
      if (held < 20 && books.day + books.leadDays <= books.lastDay) {
        yield* operator.OrderStock({ target: id, product, quantity: 30 })
      }
    }
  })

/** Spends every cent on day one and never stocks the machine, so it can't pay the fee. */
const spendthrift: Strategy = (operator, books) =>
  Effect.gen(function* () {
    if (books.day !== 1) return
    const product = 'chips'
    const quantity = Math.floor(books.cash / books.catalog[product]!.unitCost)
    yield* operator.OrderStock({ target: id, product, quantity })
  })

/**
 * Presses buttons at random, a few times a day: orders, stocking and prices of any size,
 * for real products and one that isn't sold. Most of what it tries is refused; the
 * refusals are the point, and are counted rather than failing the season.
 */
const monkey =
  (refusals: { count: number }): Strategy =>
  (operator, books, roll) =>
    Effect.gen(function* () {
      const products = [...productsOf(books.catalog), 'gum']
      const presses = Math.floor(roll(`${books.day}/presses`) * 5)
      for (let press = 0; press < presses; press++) {
        const at = (what: string) => roll(`${books.day}/${press}/${what}`)
        const product = products[Math.floor(at('product') * products.length)]!
        const quantity = 1 + Math.floor(at('quantity') * 40)
        const button = Math.floor(at('button') * 3)
        const pressed: Effect.Effect<unknown, unknown> =
          button === 0
            ? operator.OrderStock({ target: id, product, quantity })
            : button === 1
              ? operator.StockMachine({ target: id, product, quantity })
              : operator.SetPrice({
                  target: id,
                  product,
                  price: 50 + Math.floor(at('price') * 750),
                })
        const exit = yield* Effect.exit(pressed)
        if (Exit.isFailure(exit)) refusals.count++
      }
    })

/**
 * Play one vending-lite season the way an agent would: only through the OperatorApi.
 * Returns what the operator saw each morning, the views at the end, and the shop's whole
 * event log, as a client reads it.
 */
const playSeason = (seed: string, strategy: Strategy = steady) => {
  const platform = InMemory.make({ manual: true, now: () => Date.parse('2026-01-01T00:00:00Z') })
  const world = Vending.layer(FootfallLive).pipe(
    Layer.provide(SeededShoppers({ seed, baseDemand })),
    Layer.provideMerge(platform.layer),
  )
  const roll = (key: string) => draw(`${seed}/operator/${key}`)
  return Effect.gen(function* () {
    const shops = yield* Shop
    yield* shops.send(Shop.ref(id), new OpenShop(opening))
    const operator = yield* OperatorApi.testClient

    const states = []
    for (;;) {
      const state = yield* operator.Shop.get(id)
      states.push(state)
      if (state._tag !== 'Trading') break
      yield* strategy(operator, state.books, roll)
      yield* operator.WaitForNextDay({ target: id })
      // Let the customers visit and the day roll over before the operator looks again.
      yield* settle(platform.control)
    }

    const scorecard = yield* operator.Scorecard.get(id)
    const netWorth = yield* operator.NetWorth.get(id)
    const recorded = yield* operator.Shop.events(id).pipe(
      Stream.takeUntil(
        ({ event }) => event._tag === 'SeasonEnded' || event._tag === 'WentBankrupt',
      ),
      Stream.runCollect,
    )
    const events = recorded.map(({ event }) => event)
    return { states, scorecard, netWorth, events, failures: platform.control.failures }
  }).pipe(Effect.provide(world), Effect.scoped)
}

describe('A vending-lite season, played through the OperatorApi', () => {
  it.effect('runs all thirty days and keeps the books straight', () =>
    Effect.gen(function* () {
      const { states, scorecard, netWorth, failures } = yield* playSeason('season-1')
      expect(failures).toEqual([])

      const last = states.at(-1)!
      expect(last._tag).toBe('Ended')
      expect(scorecard?.outcome).toBe('SeasonOver')
      expect(scorecard?.daysCompleted).toBe(30)
      expect(scorecard?.feesPaid).toBe(30 * opening.dailyFee)
      expect(scorecard?.unitsSold).toBeGreaterThan(0)

      // Invariants on every day the operator saw.
      for (const state of states) {
        if (state._tag === 'Unopened') continue
        const books = state.books
        expect(books.cash).toBeGreaterThanOrEqual(0)
        for (const product of productsOf(books.catalog)) {
          expect(unitsOf(books.storage, product)).toBeGreaterThanOrEqual(0)
          expect(unitsOf(books.machine, product)).toBeGreaterThanOrEqual(0)
        }
      }

      // The NetWorth view, folded from events alone, agrees with the shop's own books.
      if (last._tag === 'Unopened') throw new Error('the shop never opened')
      expect(netWorth?.cash).toBe(last.books.cash)
      expect(netWorth?.stock).toBe(stockAtCost(last.books))
      expect(netWorth?.days).toHaveLength(31)
      expect(scorecard?.finalCash).toBe(last.books.cash)
    }),
  )

  it.effect(
    'plays the same season twice from the same seed, and a different one from another',
    () =>
      Effect.gen(function* () {
        const first = yield* playSeason('season-1')
        const again = yield* playSeason('season-1')
        const other = yield* playSeason('season-2')
        expect(again.netWorth).toEqual(first.netWorth)
        expect(again.scorecard).toEqual(first.scorecard)
        expect(other.netWorth?.days).not.toEqual(first.netWorth?.days)
      }),
  )

  describe('keeps every invariant on every event of the season', () => {
    const refusals = { count: 0 }
    const strategies = { steady, spendthrift, monkey: monkey(refusals) }
    const seeds = ['season-1', 'season-2', 'season-3']

    for (const [name, strategy] of Object.entries(strategies)) {
      for (const seed of seeds) {
        it.effect(`${name}, ${seed}`, () =>
          Effect.gen(function* () {
            const { states, netWorth, events, failures } = yield* playSeason(seed, strategy)
            expect(failures).toEqual([])

            // Fold the log the client read through the shop's own evolve and the NetWorth
            // view, checking every invariant after every event.
            const replayed = replay(Shop, events, {
              id,
              views: shopViews,
              invariants: ShopInvariants,
            })
            expect(replayed.violations).toEqual([])
            expect(replayed.applied).toBe(events.length)
            expect(replayed.state).toEqual(states.at(-1))
            expect(replayed.views.netWorth).toEqual(netWorth)
            expect(replayed.state._tag).toBe('Ended')
            if (name === 'spendthrift') expect(events.at(-1)?._tag).toBe('WentBankrupt')
          }),
        )
      }
    }

    it('and the monkey really did try things the shop refused', () => {
      expect(refusals.count).toBeGreaterThan(0)
    })
  })
})
