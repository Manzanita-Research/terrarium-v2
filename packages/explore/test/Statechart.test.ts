import { describe, expect, it } from 'vitest'

import * as Statechart from '../src/Statechart.ts'
import { explore } from '../src/explore.ts'
import { InsertCoin, Push, Turnstile, turnstileId } from './Turnstile.ts'

const walk = explore(Turnstile, { id: turnstileId, commands: [new InsertCoin(), new Push()] })

const chart = Statechart.make(Turnstile, {
  states: {
    Locked: 'waiting for a coin',
    Unlocked: 'paid; waiting for a push',
    Full: 'the cash box is full',
  },
  label: state => (state._tag === 'Locked' && state.coins >= 3 ? 'Full' : state._tag),
  initial: 'Locked',
  final: ['Full'],
  transitions: [
    { from: 'Locked', command: 'InsertCoin', to: 'Unlocked', events: ['CoinInserted'] },
    { from: 'Unlocked', command: 'Push', to: 'Locked', events: ['Passed'] },
    { from: 'Unlocked', command: 'Push', to: 'Full', events: ['Passed'] },
  ],
  refusals: [
    { in: 'Locked', command: 'Push', rejections: ['StillLocked'] },
    { in: 'Full', command: 'Push', rejections: ['StillLocked'] },
    { in: 'Full', command: 'InsertCoin', rejections: ['Jammed'] },
  ],
  noops: [{ in: 'Unlocked', command: 'InsertCoin' }],
})

describe('Statechart', () => {
  it('agrees with an exploration that matches it', () => {
    expect(Statechart.check(chart, walk)).toEqual([])
  })

  it('lists every way a chart and an exploration disagree', () => {
    const wrong = Statechart.make(Turnstile, {
      ...chart,
      final: [],
      transitions: [
        { from: 'Locked', command: 'InsertCoin', to: 'Unlocked', events: ['CoinInserted'] },
        { from: 'Unlocked', command: 'Push', to: 'Locked', events: ['Passed'] },
        { from: 'Locked', command: 'Push', to: 'Unlocked', events: ['Passed'] },
      ],
      refusals: [
        { in: 'Locked', command: 'Push', rejections: ['StillLocked', 'Jammed'] },
        { in: 'Full', command: 'Push', rejections: ['StillLocked'] },
        { in: 'Full', command: 'InsertCoin', rejections: ['Jammed'] },
      ],
      noops: [],
    })
    expect(Statechart.check(wrong, walk)).toEqual([
      'transition never seen: Locked Push Unlocked [Passed]',
      'transition not in the chart: Unlocked Push Full [Passed]',
      'refusal Locked Push: chart says [Jammed, StillLocked], found [StillLocked]',
      'no-op not in the chart: Unlocked InsertCoin []',
      'final: chart says [], found [Full]',
    ])
  })

  it('draws the chart as a Mermaid state diagram', () => {
    expect(Statechart.toMermaid(chart)).toBe(
      [
        '%% Turnstile: generated from its Statechart; do not edit by hand.',
        'stateDiagram-v2',
        '  Locked : waiting for a coin',
        '  Unlocked : paid; waiting for a push',
        '  Full : the cash box is full',
        '  [*] --> Locked',
        '  Locked --> Unlocked : InsertCoin / CoinInserted',
        '  Unlocked --> Locked : Push / Passed',
        '  Unlocked --> Full : Push / Passed',
        '  Full --> [*]',
        '  note right of Locked',
        '    Push refused (StillLocked)',
        '  end note',
        '  note right of Unlocked',
        '    InsertCoin does nothing',
        '  end note',
        '  note right of Full',
        '    Push refused (StillLocked)',
        '    InsertCoin refused (Jammed)',
        '  end note',
        '',
      ].join('\n'),
    )
  })
})
