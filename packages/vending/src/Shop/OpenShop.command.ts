import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

import { NonNegativeCents } from '../Money.ts'
import { Catalog } from '../Product.ts'
import { ShopId } from './Shop.id.ts'

const Days = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))

/** The season started: day 1, with this much cash, these rules and this catalog. */
export class ShopOpened extends Domain.Event('ShopOpened', {
  lastDay: Days,
  cash: NonNegativeCents,
  dailyFee: NonNegativeCents,
  leadDays: Days,
  catalog: Catalog,
}) {}

/** The shop is already open (or its season is over). */
export class AlreadyOpen extends Domain.Rejection('AlreadyOpen', {
  status: Schema.Literals(['Trading', 'Closing', 'Ended']),
  day: Schema.Int,
}) {}

/**
 * Start a season. A scenario sends this, not the agent: it sets the starting cash,
 * the length of the season, the daily fee, how long deliveries take and what's for sale.
 * Every price starts at the catalog's default.
 */
export class OpenShop extends Domain.Command('OpenShop', {
  target: ShopId,
  input: {
    lastDay: Days,
    cash: NonNegativeCents,
    dailyFee: NonNegativeCents,
    leadDays: Days,
    catalog: Catalog,
  },
  events: [ShopOpened],
  rejects: [AlreadyOpen],
}) {}
