import { describe, expect, it } from 'vitest'

import { draw, noise, priceEffect, wanted } from '../src/Market/demand.ts'

describe('demand', () => {
  it('draws more customers below the default price and fewer above, within limits', () => {
    expect(priceEffect(300, 300)).toBe(1)
    expect(priceEffect(300, 150)).toBe(2)
    expect(priceEffect(300, 600)).toBe(0.5)
    expect(priceEffect(300, 1)).toBe(2)
    expect(priceEffect(300, 10_000)).toBe(0.25)
  })

  it('keys each draw, so the same day and product always see the same customers', () => {
    expect(noise('seed', 4, 'soda')).toBe(noise('seed', 4, 'soda'))
    expect(noise('seed', 4, 'soda')).not.toBe(noise('seed', 5, 'soda'))
    expect(noise('seed', 4, 'soda')).not.toBe(noise('other', 4, 'soda'))
  })

  it('keeps noise between 0.75 and 1.25, spread across that range', () => {
    const draws = Array.from({ length: 2_000 }, (_, i) => draw(`k/${i}`))
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...draws)).toBeLessThan(1)
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
    for (let day = 1; day <= 100; day++) {
      const n = noise('seed', day, 'chips')
      expect(n).toBeGreaterThanOrEqual(0.75)
      expect(n).toBeLessThan(1.25)
    }
  })

  it('rounds to whole customers and never goes below zero', () => {
    expect(wanted({ baseDemand: 8, defaultPrice: 300, price: 300, noise: 1 })).toBe(8)
    expect(wanted({ baseDemand: 8, defaultPrice: 300, price: 600, noise: 0.8 })).toBe(3)
    expect(wanted({ baseDemand: 0, defaultPrice: 300, price: 300, noise: 1.2 })).toBe(0)
  })
})
