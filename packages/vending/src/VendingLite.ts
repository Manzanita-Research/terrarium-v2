import type { SeededShoppersOptions } from './Market/SeededShoppers.ts'
import type { Catalog } from './Product.ts'

/**
 * Terrarium v1's vending-lite scenario, in cents: three products, $500, thirty days.
 * v1 had no daily fee or delivery time; v2 adds a $2 fee and two-day deliveries,
 * so waiting costs something and running out takes planning to fix.
 */
export const catalog = {
  candy: { unitCost: 100, defaultPrice: 250 },
  chips: { unitCost: 200, defaultPrice: 400 },
  soda: { unitCost: 150, defaultPrice: 300 },
} satisfies Catalog

export const opening = {
  lastDay: 30,
  cash: 50_000,
  dailyFee: 200,
  leadDays: 2,
  catalog,
}

export const baseDemand = {
  candy: 5,
  chips: 6,
  soda: 8,
} satisfies SeededShoppersOptions['baseDemand']
