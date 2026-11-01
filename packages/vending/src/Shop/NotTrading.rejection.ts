import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

/**
 * The shop can't take that request right now. `Unopened`: the season hasn't started.
 * `Closing`: the day is over and customers are still shopping; try again once the next day opens.
 * `Ended`: the season is over, or the shop went bankrupt.
 */
export class NotTrading extends Domain.Rejection('NotTrading', {
  status: Schema.Literals(['Unopened', 'Closing', 'Ended']),
  day: Schema.NullOr(Schema.Int),
}) {}
