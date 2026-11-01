import * as Schema from 'effect/Schema'

import { PositiveCents } from './Money.ts'

/** A product's name, such as `cola`. */
export const Product = Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
export type Product = typeof Product.Type

/** What the supplier charges for a product, and the price the market expects. */
export const CatalogItem = Schema.Struct({
  unitCost: PositiveCents,
  defaultPrice: PositiveCents,
})
export type CatalogItem = typeof CatalogItem.Type

/** Every product the shop may sell, by name. */
export const Catalog = Schema.Record(Schema.String, CatalogItem).pipe(
  Schema.check(Schema.isMinProperties(1)),
)
export type Catalog = typeof Catalog.Type

/** Product names in a stable order, so every walk over them is deterministic. */
export const productsOf = (catalog: Catalog): ReadonlyArray<Product> => Object.keys(catalog).sort()
