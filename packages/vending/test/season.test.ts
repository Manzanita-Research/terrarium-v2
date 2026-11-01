import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import * as InMemory from '@alchemy.run/domain/InMemory'
import { describe, expect, it } from '@effect/vitest'

import { FootfallLive } from '../src/Market/Footfall.policy.ts'
import { SeededShoppers } from '../src/Market/SeededShoppers.ts'
import { OperatorApi } from '../src/OperatorApi.api.ts'
import { productsOf } from '../src/Product.ts'
import { stockAtCost, unitsOf } from '../src/Shop/Books.ts'
import { OpenShop } from '../src/Shop/OpenShop.command.ts'
import { Shop } from '../src/Shop/Shop.aggregate.ts'
import { ShopId } from '../src/Shop/Shop.id.ts'
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

/**
 * Play one vending-lite season the way an agent would: only through the OperatorApi.
 * The operator keeps the machine full, reorders when stock runs low and never changes a price.
 */
const playSeason = (seed: string) => {
  const platform = InMemory.make({ manual: true, now: () => Date.parse('2026-01-01T00:00:00Z') })
  const world = Vending.layer(FootfallLive).pipe(
    Layer.provide(SeededShoppers({ seed, baseDemand })),
    Layer.provideMerge(platform.layer),
  )
  return Effect.gen(function* () {
    const shops = yield* Shop
    yield* shops.send(Shop.ref(id), new OpenShop(opening))
    const operator = yield* OperatorApi.testClient

    const states = []
    for (;;) {
      const state = yield* operator.Shop.get(id)
      states.push(state)
      if (state._tag !== 'Trading') break
      const books = state.books
      for (const product of productsOf(books.catalog)) {
        const inStorage = unitsOf(books.storage, product)
        if (inStorage > 0)
          yield* operator.StockMachine({ target: id, product, quantity: inStorage })
        const onOrder = books.orders
          .filter(order => order.product === product)
          .reduce((sum, order) => sum + order.quantity, 0)
        const held = inStorage + unitsOf(books.machine, product) + onOrder
        if (held < 20 && books.day + books.leadDays <= books.lastDay) {
          yield* operator.OrderStock({ target: id, product, quantity: 30 })
        }
      }
      yield* operator.WaitForNextDay({ target: id })
      // Let the customers visit and the day roll over before the operator looks again.
      yield* settle(platform.control)
    }

    const scorecard = yield* operator.Scorecard.get(id)
    const netWorth = yield* operator.NetWorth.get(id)
    return { states, scorecard, netWorth, failures: platform.control.failures }
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
})
