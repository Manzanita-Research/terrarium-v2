/**
 * How many customers want a product on a day. Ported from Terrarium v1's vending-lite:
 * demand is the product's base demand, scaled by how its price compares with the default
 * and by a day's noise, then rounded.
 */

/** Pricing below the default draws more customers, above it fewer: at most double, at least a quarter. */
export const priceEffect = (defaultPrice: number, price: number): number =>
  Math.min(2, Math.max(0.25, defaultPrice / price))

/**
 * A number in [0, 1) fixed by its key. v1 drew from one random sequence, so changing
 * anything early shifted every later draw. Keying each draw by (seed, day, product)
 * means two forks of a run see the same customers until their prices or stock differ.
 */
export const draw = (key: string): number => {
  // FNV-1a, then a murmur3-style finalizer to spread the bits.
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 0x1_0000_0000
}

/** A day's swing in demand for one product: between 0.75 and 1.25. */
export const noise = (seed: string, day: number, product: string): number =>
  0.75 + draw(`${seed}/${day}/${product}`) * 0.5

/** Units customers want. Never negative; stock doesn't change it, only what they can buy. */
export const wanted = (input: {
  readonly baseDemand: number
  readonly defaultPrice: number
  readonly price: number
  readonly noise: number
}): number =>
  Math.max(
    0,
    Math.round(input.baseDemand * priceEffect(input.defaultPrice, input.price) * input.noise),
  )
