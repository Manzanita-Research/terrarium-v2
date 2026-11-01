import * as Schema from 'effect/Schema'

import * as Domain from '@alchemy.run/domain'

/** The shop doesn't sell that product. `known` lists the ones it does. */
export class UnknownProduct extends Domain.Rejection('UnknownProduct', {
  product: Schema.String,
  known: Schema.Array(Schema.String),
}) {}
