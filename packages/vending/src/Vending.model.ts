import * as Domain from '@alchemy.run/domain'

import { Footfall } from './Market/Footfall.policy.ts'
import { NetWorth } from './Score/NetWorth.view.ts'
import { Scorecard } from './Score/Scorecard.view.ts'
import { Shop } from './Shop/Shop.aggregate.ts'

/** The vending world: one shop, the customers who visit it, and its score. */
export class Vending extends Domain.Model('Vending', {
  aggregates: [Shop],
  views: [NetWorth, Scorecard],
  policies: [Footfall],
}) {}
