import { Shop } from '../src/Shop/Shop.aggregate.ts'
import { ShopId } from '../src/Shop/Shop.id.ts'

/** A small shop for stories: two products, $100, a $2 fee, next-day delivery, three days. */
export const opening = {
  lastDay: 3,
  cash: 10_000,
  dailyFee: 200,
  leadDays: 1,
  catalog: {
    chips: { unitCost: 200, defaultPrice: 400 },
    soda: { unitCost: 150, defaultPrice: 300 },
  },
}

export const shopId = ShopId.make('shop-1')
export const shop = Shop.ref(shopId)
