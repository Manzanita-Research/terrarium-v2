import * as Domain from '@alchemy.run/domain'

import { Cents, PositiveCents } from '../Money.ts'
import { Product } from '../Product.ts'
import { NotTrading } from './NotTrading.rejection.ts'
import { ShopId } from './Shop.id.ts'
import { UnknownProduct } from './UnknownProduct.rejection.ts'

/** A product's price in the machine changed. */
export class PriceSet extends Domain.Event('PriceSet', {
  product: Product,
  price: PositiveCents,
  was: Cents,
}) {}

/** Set what the machine charges for a product. Setting the current price records nothing. */
export class SetPrice extends Domain.Command('SetPrice', {
  target: ShopId,
  input: { product: Product, price: PositiveCents },
  events: [PriceSet],
  rejects: [NotTrading, UnknownProduct],
}) {}
