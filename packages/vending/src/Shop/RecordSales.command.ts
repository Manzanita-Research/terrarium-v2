import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { Cents, NonNegativeCents, PositiveCents, PositiveUnits, Units } from '../Money.ts'
import { Product } from '../Product.ts'
import { ShopId } from './Shop.id.ts'

/** One product's sales for a day. `wanted` above `sold` means the machine ran out. */
export const SaleLine = Schema.Struct({
  product: Product,
  price: PositiveCents,
  wanted: Units,
  sold: Units,
  revenue: Cents,
})
export type SaleLine = typeof SaleLine.Type

/** Customers bought from the machine. */
export class SalesRecorded extends Domain.Event('SalesRecorded', {
  day: Schema.Int,
  lines: Schema.Array(SaleLine),
  revenue: Cents,
  cashAfter: Cents,
}) {}

/** The daily fee was paid. */
export class FeeCharged extends Domain.Event('FeeCharged', {
  day: Schema.Int,
  fee: NonNegativeCents,
  cashAfter: Cents,
}) {}

/** The shop couldn't pay the daily fee, so the season ends here. */
export class WentBankrupt extends Domain.Event('WentBankrupt', {
  day: Schema.Int,
  cash: Cents,
  fee: NonNegativeCents,
}) {}

/** An order arrived in the storeroom. */
export class StockDelivered extends Domain.Event('StockDelivered', {
  day: Schema.Int,
  orderId: Schema.String,
  product: Product,
  quantity: PositiveUnits,
}) {}

/** A new day started. */
export class DayOpened extends Domain.Event('DayOpened', { day: Schema.Int }) {}

/** The last day ended with the shop still solvent. */
export class SeasonEnded extends Domain.Event('SeasonEnded', {
  day: Schema.Int,
  cash: Cents,
}) {}

/**
 * Report what customers wanted on a closed day. The market sends this, never the agent.
 * It reports a fact, so it never rejects: a report for a day that isn't closing records nothing,
 * which makes a repeated delivery harmless.
 */
export class RecordSales extends Domain.Command('RecordSales', {
  target: ShopId,
  input: { day: Schema.Int, wanted: Schema.Record(Schema.String, Units) },
  events: [SalesRecorded, FeeCharged, WentBankrupt, StockDelivered, DayOpened, SeasonEnded],
}) {}
