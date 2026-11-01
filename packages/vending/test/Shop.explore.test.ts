import { describe, expect, it } from 'vitest'

import type { Fold } from '@terrarium/explore/Fold'
import * as Statechart from '@terrarium/explore/Statechart'
import { explore } from '@terrarium/explore/explore'

import { Shop, type ShopState } from '../src/Shop/Shop.aggregate.ts'
import { ShopChart } from '../src/Shop/Shop.chart.ts'
import { exploreShop, shopCommands } from '../src/Shop/Shop.explore.ts'
import { ShopId } from '../src/Shop/Shop.id.ts'
import {
  type ShopEvent,
  ShopInvariants,
  cashOnlyThroughEvents,
  netWorthMatchesBooks,
  noSaleWithoutStock,
  shopViews,
  unitsAccountedFor,
} from '../src/Shop/Shop.invariants.ts'

const walk = exploreShop()

describe('Every state the tiny season can reach', () => {
  it('is walked to the end, and keeps every invariant', () => {
    expect(walk.truncated).toEqual({ depth: [], states: [] })
    expect(walk.violations).toEqual([])
    // Enough to show the walk went somewhere: both endings, many paths to each.
    expect(walk.states.size).toBeGreaterThan(50)
  })

  it('matches the statechart, both ways', () => {
    expect(Statechart.check(ShopChart, walk)).toEqual([])
  })

  it('draws the chart in Shop.chart.mmd', async () => {
    await expect(Statechart.toMermaid(ShopChart)).toMatchFileSnapshot('../src/Shop/Shop.chart.mmd')
  })
})

/**
 * The invariants are only worth their checks if they catch a bug. Each test here plants
 * one in the aggregate (or its view), walks the same space, and expects the invariant
 * written for that bug to name it.
 */
describe('A planted bug', () => {
  const definition = Shop.definition
  type Closing = Extract<ShopState, { readonly _tag: 'Closing' }>
  const planted = (patch: {
    readonly decide?: Partial<typeof definition.decide>
    readonly evolve?: Partial<typeof definition.evolve>
  }) => ({
    aggregateName: Shop.aggregateName,
    definition: {
      ...definition,
      decide: { ...definition.decide, ...patch.decide },
      evolve: { ...definition.evolve, ...patch.evolve },
    },
  })
  const caught = (aggregate: ReturnType<typeof planted>, views = shopViews) =>
    new Set(
      explore(aggregate, {
        id: ShopId.make('explore'),
        commands: shopCommands,
        views,
        invariants: ShopInvariants,
      }).violations.map(violation => violation.invariant),
    )

  it('sells stock the machine never held', () => {
    // Decides as if the machine were full, so sales aren't capped at what it holds.
    const bug = planted({
      decide: {
        RecordSales: (state, command, ctx) => {
          if (state._tag !== 'Closing') return definition.decide.RecordSales(state, command, ctx)
          const full: Closing = {
            ...state,
            books: { ...state.books, machine: { soda: 99 } },
          }
          return definition.decide.RecordSales(full, command, ctx)
        },
      },
    })
    expect(caught(bug)).toContain(noSaleWithoutStock.name)
  })

  it('charges a fee without moving the cash', () => {
    const bug = planted({ evolve: { FeeCharged: state => state } })
    expect(caught(bug)).toContain(cashOnlyThroughEvents.name)
  })

  it('delivers an order but keeps it on order', () => {
    const bug = planted({
      evolve: {
        StockDelivered: (state, event, envelope) => {
          const delivered = definition.evolve.StockDelivered(state, event, envelope)
          return state._tag === 'Closing' && delivered._tag === 'Closing'
            ? { ...delivered, books: { ...delivered.books, orders: state.books.orders } }
            : delivered
        },
      },
    })
    expect(caught(bug)).toContain(unitsAccountedFor.name)
  })

  it('leaves the fee out of net worth', () => {
    const view = shopViews.netWorth
    const forgetful: Fold<ShopEvent, typeof view.initial> = {
      initial: view.initial,
      evolve: (state, event, envelope) =>
        event._tag === 'FeeCharged' ? state : view.evolve(state, event, envelope),
    }
    expect(caught(planted({}), { netWorth: forgetful })).toContain(netWorthMatchesBooks.name)
  })

  it('and the real shop has none of them', () => {
    expect(caught(planted({}))).toEqual(new Set())
  })
})
