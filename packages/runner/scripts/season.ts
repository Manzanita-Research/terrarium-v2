/**
 * Play one vending-lite season with a scripted operator and send its telemetry to Maple.
 *
 *   pnpm --filter @terrarium/runner season [seed]
 *
 * A stand-in for the agent loop (NOTES §8 step 5): the operator keeps the machine full,
 * reorders when stock runs low, and once asks for a product the shop doesn't sell,
 * so a rejection shows up in the trace.
 */
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import * as InMemory from '@alchemy.run/domain/InMemory'
import { FootfallLive } from '@terrarium/vending/Market/Footfall.policy'
import { SeededShoppers } from '@terrarium/vending/Market/SeededShoppers'
import { OperatorApi } from '@terrarium/vending/OperatorApi.api'
import { productsOf } from '@terrarium/vending/Product'
import { unitsOf } from '@terrarium/vending/Shop/Books'
import { OpenShop } from '@terrarium/vending/Shop/OpenShop.command'
import { Shop } from '@terrarium/vending/Shop/Shop.aggregate'
import { ShopId } from '@terrarium/vending/Shop/Shop.id'
import { Vending } from '@terrarium/vending/Vending.model'
import { baseDemand, opening } from '@terrarium/vending/VendingLite'

import { TelemetryLive, checkExport } from '../src/Telemetry.ts'

const seed = process.argv[2] ?? 'season-1'
const runId = `run-${seed}-${Date.now().toString(36)}`
const id = ShopId.make('shop-1')

const settle = (control: InMemory.Control) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1_000; i++) {
      yield* control.drain
      yield* Effect.yieldNow
      if (yield* control.idle) return
    }
    return yield* Effect.die(new Error('the world did not settle'))
  })

const platform = InMemory.make({ manual: true, now: () => Date.parse('2026-01-01T00:00:00Z') })
const world = Vending.layer(FootfallLive).pipe(
  Layer.provide(SeededShoppers({ seed, baseDemand })),
  Layer.provideMerge(platform.layer),
)

const season = Effect.gen(function* () {
  const shops = yield* Shop
  yield* shops.send(Shop.ref(id), new OpenShop(opening))
  const operator = yield* OperatorApi.testClient

  const mistake = yield* operator
    .OrderStock({ target: id, product: 'gum', quantity: 10 })
    .pipe(Effect.flip, Effect.option)
  yield* Effect.logInfo('asked for gum', { rejection: mistake })

  for (;;) {
    const state = yield* operator.Shop.get(id)
    if (state._tag !== 'Trading') break
    const books = state.books
    yield* Effect.gen(function* () {
      for (const product of productsOf(books.catalog)) {
        const inStorage = unitsOf(books.storage, product)
        if (inStorage > 0)
          yield* operator.StockMachine({ target: id, product, quantity: inStorage })
        const onOrder = books.orders
          .filter(order => order.product === product)
          .reduce((sum, order) => sum + order.quantity, 0)
        const held = inStorage + unitsOf(books.machine, product) + onOrder
        if (held < 20 && books.day + books.leadDays <= books.lastDay)
          yield* operator.OrderStock({ target: id, product, quantity: 30 })
      }
      yield* operator.WaitForNextDay({ target: id })
      yield* settle(platform.control)
    }).pipe(
      Effect.withSpan('terrarium.day', {
        attributes: { 'terrarium.day': books.day, 'terrarium.cash': books.cash },
      }),
    )
  }

  const scorecard = yield* operator.Scorecard.get(id)
  yield* Effect.annotateCurrentSpan({
    'terrarium.outcome': scorecard?.outcome ?? 'unknown',
    'terrarium.final_cash': scorecard?.finalCash ?? -1,
    'terrarium.units_sold': scorecard?.unitsSold ?? -1,
  })
  yield* Effect.logInfo('season over', { scorecard })
  return scorecard
}).pipe(
  Effect.withSpan('terrarium.season', {
    attributes: {
      'terrarium.world': 'vending-lite',
      'terrarium.seed': seed,
      'terrarium.run': runId,
    },
  }),
  Effect.provide(world),
  Effect.scoped,
  Effect.provide(TelemetryLive),
)

await Effect.runPromise(checkExport)
const scorecard = await Effect.runPromise(season)
console.log(JSON.stringify({ runId, seed, scorecard }, null, 2))
