import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { Cents, PositiveCents, PositiveUnits } from '../Money.ts'
import { Product } from '../Product.ts'
import { NotTrading } from './NotTrading.rejection.ts'
import { ShopId } from './Shop.id.ts'
import { UnknownProduct } from './UnknownProduct.rejection.ts'

/** The shop paid for stock. It arrives in the storeroom on the morning of `arrivesOn`. */
export class StockOrdered extends Domain.Event('StockOrdered', {
  orderId: Schema.String,
  product: Product,
  quantity: PositiveUnits,
  unitCost: PositiveCents,
  cost: Cents,
  cashAfter: Cents,
  arrivesOn: Schema.Int,
}) {}

/** The order costs more than the cash in the till. */
export class InsufficientCash extends Domain.Rejection('InsufficientCash', {
  cash: Cents,
  cost: Cents,
}) {}

/** Buy stock from the supplier at its unit cost. It's paid for now and arrives after the lead time. */
export class OrderStock extends Domain.Command('OrderStock', {
  target: ShopId,
  input: { product: Product, quantity: PositiveUnits },
  events: [StockOrdered],
  rejects: [NotTrading, UnknownProduct, InsufficientCash],
  reply: { orderId: Schema.String, arrivesOn: Schema.Int },
}) {}
