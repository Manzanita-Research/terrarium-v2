import { describe, expect, it } from 'vitest'

import type { Fold } from '../src/Fold.ts'
import * as Invariant from '../src/Invariant.ts'
import { explore } from '../src/explore.ts'
import { replay } from '../src/replay.ts'
import {
  CoinInserted,
  InsertCoin,
  Passed,
  Push,
  Turnstile,
  type TurnstileState,
  turnstileId,
} from './Turnstile.ts'

type TurnstileEvent = CoinInserted | Passed

const commands = [new InsertCoin(), new Push()]
const show = (key: string) => {
  const state = JSON.parse(key) as TurnstileState
  return `${state._tag}${state.coins}`
}

/** A fold beside the state: how many people have gone through. */
const passes: Fold<TurnstileEvent, number> = {
  initial: 0,
  evolve: (count, event) => (event._tag === 'Passed' ? count + 1 : count),
}

/** Invariants that read the state alone, and ones that also read the passes fold. */
const plain = Invariant.of<TurnstileState, TurnstileEvent>()
const turnstile = Invariant.of<TurnstileState, TurnstileEvent, { readonly passes: number }>()

describe('explore', () => {
  it('finds every reachable state, and what each command does in each', () => {
    const walk = explore(Turnstile, { id: turnstileId, commands })

    expect([...walk.states.keys()].map(show)).toEqual([
      'Locked0',
      'Unlocked1',
      'Locked1',
      'Unlocked2',
      'Locked2',
      'Unlocked3',
      'Locked3',
    ])
    expect(walk.transitions.map(t => `${show(t.from)} ${t.command._tag} ${show(t.to)}`)).toEqual([
      'Locked0 InsertCoin Unlocked1',
      'Unlocked1 Push Locked1',
      'Locked1 InsertCoin Unlocked2',
      'Unlocked2 Push Locked2',
      'Locked2 InsertCoin Unlocked3',
      'Unlocked3 Push Locked3',
    ])
    expect(walk.refusals.map(r => `${show(r.from)} ${r.command._tag} ${r.rejection._tag}`)).toEqual(
      [
        'Locked0 Push StillLocked',
        'Locked1 Push StillLocked',
        'Locked2 Push StillLocked',
        'Locked3 InsertCoin Jammed',
        'Locked3 Push StillLocked',
      ],
    )
    expect(walk.noops.map(n => `${show(n.from)} ${n.command._tag}`)).toEqual([
      'Unlocked1 InsertCoin',
      'Unlocked2 InsertCoin',
      'Unlocked3 InsertCoin',
    ])
    expect(walk.truncated).toEqual({ depth: [], states: [] })
    expect(walk.violations).toEqual([])
  })

  it('keeps the shortest path to every state', () => {
    const walk = explore(Turnstile, { id: turnstileId, commands })
    const last = [...walk.states.values()].at(-1)!
    expect(walk.pathTo(last.key).map(c => c._tag)).toEqual([
      'InsertCoin',
      'Push',
      'InsertCoin',
      'Push',
      'InsertCoin',
      'Push',
    ])
    expect(last.depth).toBe(6)
    expect(last.version).toBe(6)
  })

  it('says where it stopped when a bound cuts the walk short', () => {
    const shallow = explore(Turnstile, { id: turnstileId, commands, maxDepth: 2 })
    expect([...shallow.states.keys()].map(show)).toEqual(['Locked0', 'Unlocked1', 'Locked1'])
    expect(shallow.truncated.depth.map(show)).toEqual(['Locked1'])

    const small = explore(Turnstile, { id: turnstileId, commands, maxStates: 3 })
    expect(small.states.size).toBe(3)
    expect(small.truncated.states.map(show)).toEqual(['Unlocked2'])
  })

  it('reports a broken invariant with the shortest commands that break it', () => {
    const walk = explore(Turnstile, {
      id: turnstileId,
      commands,
      invariants: [
        plain.state('the cash box holds at most two coins', ({ state }) =>
          state.coins > 2 ? `${state.coins} coins` : undefined,
        ),
      ],
    })
    // Unlocked3 breaks it, and so does Locked3, one push later.
    expect(walk.violations.map(v => v.event)).toEqual(['CoinInserted', 'Passed'])
    const [violation] = walk.violations
    expect(violation).toMatchObject({
      invariant: 'the cash box holds at most two coins',
      message: '3 coins',
      event: 'CoinInserted',
    })
    expect(violation!.path.map(c => c._tag)).toEqual([
      'InsertCoin',
      'Push',
      'InsertCoin',
      'Push',
      'InsertCoin',
    ])
  })

  it('checks steps against the folds carried beside the state', () => {
    const walk = explore(Turnstile, {
      id: turnstileId,
      commands,
      views: { passes },
      invariants: [
        turnstile.state('nobody passes without paying', ({ state, views }) =>
          views.passes > state.coins ? `${views.passes} passes, ${state.coins} coins` : undefined,
        ),
        turnstile.step('a push takes no money', ({ before, event, after }) =>
          event._tag === 'Passed' && after.state.coins !== before.state.coins
            ? 'coins changed'
            : undefined,
        ),
      ],
    })
    expect(walk.violations).toEqual([])
    expect([...walk.states.values()].map(node => node.views.passes)).toEqual([0, 0, 1, 1, 2, 2, 3])
  })

  it('flags a definition that breaks its own rules', () => {
    const broken = {
      aggregateName: Turnstile.aggregateName,
      definition: {
        ...Turnstile.definition,
        decide: {
          ...Turnstile.definition.decide,
          // Records an event Push doesn't declare.
          Push: (state: TurnstileState) =>
            state._tag === 'Unlocked' ? [new CoinInserted()] : [new Passed()],
        },
        evolve: {
          ...Turnstile.definition.evolve,
          // Takes a coin back out: the state's schema forbids a negative count.
          Passed: (state: TurnstileState): TurnstileState => ({
            _tag: 'Locked',
            coins: state.coins - 1,
          }),
        },
      },
    }
    const walk = explore(broken, { id: turnstileId, commands })
    expect(walk.violations.map(v => `${v.invariant}: ${v.message}`)).toEqual([
      'schema: Passed left a state its schema rejects: {"_tag":"Locked","coins":-1}',
      "decide: decide.Push recorded CoinInserted, which it doesn't declare",
    ])
  })

  it('walks the same way every time', () => {
    const one = explore(Turnstile, { id: turnstileId, commands })
    const two = explore(Turnstile, { id: turnstileId, commands })
    expect([...two.states.keys()]).toEqual([...one.states.keys()])
    expect(two.transitions).toEqual(one.transitions)
  })
})

describe('replay', () => {
  it('folds a recorded log and checks every event of it', () => {
    const log = [new CoinInserted(), new Passed(), new CoinInserted(), new Passed()]
    const result = replay(Turnstile, log, {
      id: turnstileId,
      views: { passes },
      invariants: [
        plain.state('at most one coin', ({ state }) =>
          state.coins > 1 ? `${state.coins} coins` : undefined,
        ),
      ],
    })
    expect(result.state).toEqual({ _tag: 'Locked', coins: 2 })
    expect(result.views).toEqual({ passes: 2 })
    expect(result.applied).toBe(4)
    expect(result.violations).toEqual([
      { invariant: 'at most one coin', message: '2 coins', event: 'CoinInserted', index: 2 },
      { invariant: 'at most one coin', message: '2 coins', event: 'Passed', index: 3 },
    ])
  })
})
