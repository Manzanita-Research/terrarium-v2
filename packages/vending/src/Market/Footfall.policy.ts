import * as Effect from 'effect/Effect'

import * as Domain from '@alchemy.run/domain'

import { RecordSales } from '../Shop/RecordSales.command.ts'
import { Shop } from '../Shop/Shop.aggregate.ts'
import { DayClosed } from '../Shop/WaitForNextDay.command.ts'
import { Shoppers } from './Shoppers.external.ts'

/** When the operator closes a day, customers visit the machine and the shop records the sales. */
export class Footfall extends Domain.Policy('Footfall', {
  from: Shop,
  on: [DayClosed],
}) {}

export const FootfallLive = Footfall.toLayer(
  Effect.gen(function* () {
    const shoppers = yield* Shoppers
    const shops = yield* Shop
    return Effect.fn(function* ({ source, event }) {
      const { wanted } = yield* shoppers.visit({
        shop: source.id,
        day: event.day,
        offers: event.offers,
      })
      // Policies run at least once. A repeat carries the same command id, and the shop
      // ignores a report for a day that isn't closing, so a second run records nothing.
      yield* shops.send(source, new RecordSales({ day: event.day, wanted }), {
        commandId: `${source.id}/RecordSales/${event.day}`,
      })
    })
  }),
)
