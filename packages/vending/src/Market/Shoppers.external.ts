import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { Units } from '../Money.ts'
import { ShopId } from '../Shop/Shop.id.ts'
import { Offer } from './Offer.ts'

/**
 * The customers who walk past the machine. Shown a day's offers, they say how many of
 * each product they want. The shop sells what it has; the rest are lost sales.
 * `SeededShoppers` is a deterministic crowd; a crowd could also be an LLM or a person.
 */
export class Shoppers extends Domain.ExternalSystem('Shoppers', {
  visit: {
    args: { shop: ShopId, day: Schema.Int, offers: Schema.Array(Offer) },
    success: { wanted: Schema.Record(Schema.String, Units) },
  },
}) {}
