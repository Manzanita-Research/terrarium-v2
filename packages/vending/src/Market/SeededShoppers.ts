import * as Effect from 'effect/Effect'

import { Shoppers } from './Shoppers.external.ts'
import { noise, wanted } from './demand.ts'

export interface SeededShoppersOptions {
  /** Fixes every day's noise. The same seed and the same offers give the same customers. */
  readonly seed: string
  /** Units a product sells on an average day at its default price. Unlisted products sell none. */
  readonly baseDemand: Readonly<Record<string, number>>
}

/** A deterministic crowd of customers, following v1's vending-lite demand rules. */
export const SeededShoppers = (options: SeededShoppersOptions) =>
  Shoppers.toLayer(
    Effect.succeed({
      visit: ({ day, offers }) =>
        Effect.succeed({
          wanted: Object.fromEntries(
            offers.map(offer => [
              offer.product,
              wanted({
                baseDemand: options.baseDemand[offer.product] ?? 0,
                defaultPrice: offer.defaultPrice,
                price: offer.price,
                noise: noise(options.seed, day, offer.product),
              }),
            ]),
          ),
        }),
    }),
  )
