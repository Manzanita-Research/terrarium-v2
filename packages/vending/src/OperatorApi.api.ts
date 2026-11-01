import * as Domain from '@alchemy.run/domain'

import { NetWorth } from './Score/NetWorth.view.ts'
import { Scorecard } from './Score/Scorecard.view.ts'
import { OrderStock } from './Shop/OrderStock.command.ts'
import { SetPrice } from './Shop/SetPrice.command.ts'
import { Shop } from './Shop/Shop.aggregate.ts'
import { StockMachine } from './Shop/StockMachine.command.ts'
import { WaitForNextDay } from './Shop/WaitForNextDay.command.ts'

/**
 * Everything the operator may do and see. An agent's tools are generated from this.
 * Opening the shop belongs to the scenario and recording sales to the market,
 * so neither is here: the operator can't start a second season or invent customers.
 */
export class OperatorApi extends Domain.Api(
  'OperatorApi',
  OrderStock,
  StockMachine,
  SetPrice,
  WaitForNextDay,
  Shop,
  NetWorth,
  Scorecard,
) {}
