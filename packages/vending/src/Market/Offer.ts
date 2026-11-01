import * as Schema from 'effect/Schema'

import { PositiveCents, Units } from '../Money.ts'
import { Product } from '../Product.ts'

/** What a customer walking up to the machine sees for one product. */
export const Offer = Schema.Struct({
  product: Product,
  price: PositiveCents,
  /** The price the market expects; demand falls off above it and rises below it. */
  defaultPrice: PositiveCents,
  inMachine: Units,
})
export type Offer = typeof Offer.Type
