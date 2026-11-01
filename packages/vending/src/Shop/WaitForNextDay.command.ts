import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { Offer } from '../Market/Offer.ts'
import { NotTrading } from './NotTrading.rejection.ts'
import { ShopId } from './Shop.id.ts'

/** The operator is done for the day. Customers now shop at these offers. */
export class DayClosed extends Domain.Event('DayClosed', {
  day: Schema.Int,
  offers: Schema.Array(Offer),
}) {}

/**
 * End the operator's day. Customers visit the machine, the daily fee is charged,
 * deliveries due tomorrow arrive, and the next day opens (or the season ends).
 * This is the only way time moves.
 */
export class WaitForNextDay extends Domain.Command('WaitForNextDay', {
  target: ShopId,
  events: [DayClosed],
  rejects: [NotTrading],
}) {}
