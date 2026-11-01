import * as Domain from '@alchemy.run/domain'

import { PositiveUnits, Units } from '../Money.ts'
import { Product } from '../Product.ts'
import { NotTrading } from './NotTrading.rejection.ts'
import { ShopId } from './Shop.id.ts'
import { UnknownProduct } from './UnknownProduct.rejection.ts'

/** Units moved from the storeroom into the machine, where customers can buy them. */
export class MachineStocked extends Domain.Event('MachineStocked', {
  product: Product,
  quantity: PositiveUnits,
  inStorage: Units,
  inMachine: Units,
}) {}

/** The storeroom has fewer units than the move asked for. */
export class NotEnoughInStorage extends Domain.Rejection('NotEnoughInStorage', {
  product: Product,
  inStorage: Units,
  requested: PositiveUnits,
}) {}

/** Move units from the storeroom into the vending machine. */
export class StockMachine extends Domain.Command('StockMachine', {
  target: ShopId,
  input: { product: Product, quantity: PositiveUnits },
  events: [MachineStocked],
  rejects: [NotTrading, UnknownProduct, NotEnoughInStorage],
}) {}
