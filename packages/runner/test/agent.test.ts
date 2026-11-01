import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Schema from 'effect/Schema'
import type * as Prompt from 'effect/ai/Prompt'
import * as Tool from 'effect/ai/Tool'

import { describe, expect, it } from '@effect/vitest'
import { OperatorApi } from '@terrarium/vending/OperatorApi.api'

import { descriptions, playSeason } from '../src/Agent.ts'
import { RunFileJson, type Setup } from '../src/Run.ts'
import * as Tape from '../src/Tape.ts'
import { toolsFor } from '../src/Tools.ts'

/** A small season: two products, $100, a $2 fee, next-day delivery, three days. */
const setup: Setup = {
  world: 'vending-test',
  seed: 'story',
  opening: {
    lastDay: 3,
    cash: 10_000,
    dailyFee: 200,
    leadDays: 1,
    catalog: {
      chips: { unitCost: 200, defaultPrice: 400 },
      soda: { unitCost: 150, defaultPrice: 300 },
    },
  },
  baseDemand: { chips: 6, soda: 8 },
  maxTurnsPerDay: 4,
}

const { call } = Tape

/** Orders on day one, stocks the machine on day two, then waits out the season. */
const steady = Tape.scripted(({ index }) => {
  switch (index) {
    case 0:
      return {
        text: 'Ordering for tomorrow.',
        toolCalls: [
          call('OrderStock', { product: 'chips', quantity: 20 }),
          call('OrderStock', { product: 'soda', quantity: 20 }),
          call('WaitForNextDay'),
        ],
      }
    case 1:
      return {
        toolCalls: [
          call('StockMachine', { product: 'chips', quantity: 20 }),
          call('StockMachine', { product: 'soda', quantity: 20 }),
        ],
      }
    default:
      return { toolCalls: [call('WaitForNextDay')] }
  }
})

const lastMessage = (prompt: Prompt.Prompt) => prompt.content[prompt.content.length - 1]!

describe('the agent loop', () => {
  it('makes one tool per OperatorApi command, from its schema, without the target', () => {
    const tools = toolsFor(OperatorApi, descriptions)
    expect(tools.map(({ name }) => name)).toEqual([
      'OrderStock',
      'StockMachine',
      'SetPrice',
      'WaitForNextDay',
    ])
    const orderStock = Tool.getJsonSchema(tools[0]!.tool) as {
      properties: Record<string, unknown>
      required: Array<string>
    }
    expect(Object.keys(orderStock.properties)).toEqual(['product', 'quantity'])
    expect(orderStock.required).toEqual(['product', 'quantity'])
  })

  it.effect('plays a whole season with a scripted model', () =>
    Effect.gen(function* () {
      const season = yield* playSeason(setup).pipe(Effect.provide(steady))
      expect(season.scorecard).toMatchObject({
        outcome: 'SeasonOver',
        daysSurvived: 3,
        ordersPlaced: 2,
        toolCalls: 7,
        invalidToolCalls: 0,
        modelCalls: 4,
        forcedWaits: 0,
      })
      expect(season.scorecard.revenue).toBeGreaterThan(0)
      expect(season.scorecard.finalCash).toBe(
        setup.opening.cash - 20 * 200 - 20 * 150 + season.scorecard.revenue - 3 * 200,
      )
      expect(season.tape.map(({ day, turn }) => [day, turn])).toEqual([
        [1, 1],
        [2, 1],
        [2, 2],
        [3, 1],
      ])
    }),
  )

  it.effect('tells the model what sold overnight and what arrived', () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt.Prompt> = []
      const watching = Tape.scripted(line => {
        prompts.push(line.prompt)
        return line.index === 0
          ? {
              toolCalls: [
                call('OrderStock', { product: 'chips', quantity: 5 }),
                call('WaitForNextDay'),
              ],
            }
          : { toolCalls: [call('WaitForNextDay')] }
      })
      yield* playSeason(setup).pipe(Effect.provide(watching))
      const report = JSON.stringify(prompts[1]!.content[1])
      expect(report).toContain('Day 2 of 3')
      expect(report).toContain('fee 200')
      expect(report).toContain('Delivered to the storeroom this morning: 5 chips')
    }),
  )

  it.effect('sends invalid calls back to the model as tool results, and counts them', () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt.Prompt> = []
      const clumsy = Tape.scripted(({ index, prompt }) => {
        prompts.push(prompt)
        return index === 0
          ? {
              toolCalls: [
                call('FlyToTheMoon'),
                call('OrderStock', { product: 'chips', quantity: 'ten' }),
                call('OrderStock', { product: 'gum', quantity: 5 }),
                call('OrderStock', { product: 'chips', quantity: 1_000 }),
              ],
            }
          : { toolCalls: [call('WaitForNextDay')] }
      })
      const season = yield* playSeason(setup).pipe(Effect.provide(clumsy))
      expect(season.scorecard).toMatchObject({
        outcome: 'SeasonOver',
        toolCalls: 7,
        invalidToolCalls: 4,
        invalid: { unknownTool: 1, badArguments: 1, rejected: 2 },
        rejections: { UnknownProduct: 1, InsufficientCash: 1 },
        ordersPlaced: 0,
      })

      const results = lastMessage(prompts[1]!)
      expect(results.role).toBe('tool')
      const parts = results.content as ReadonlyArray<Prompt.ToolResultPart>
      expect(parts.map(part => [part.name, part.isFailure])).toEqual([
        ['FlyToTheMoon', true],
        ['OrderStock', true],
        ['OrderStock', true],
        ['OrderStock', true],
      ])
      expect(parts[0]!.result).toMatchObject({ error: 'UnknownTool' })
      expect(parts[1]!.result).toMatchObject({ error: 'BadArguments' })
      expect(parts[2]!.result).toMatchObject({ rejected: { _tag: 'UnknownProduct' } })
      expect(parts[3]!.result).toMatchObject({
        rejected: { _tag: 'InsufficientCash', cash: 10_000, cost: 200_000 },
      })
    }),
  )

  it.effect('ends the day for a model that never calls WaitForNextDay', () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt.Prompt> = []
      const chatty = Tape.scripted(({ prompt }) => {
        prompts.push(prompt)
        return { text: 'Let me think about that.' }
      })
      const season = yield* playSeason(setup).pipe(Effect.provide(chatty))
      expect(season.scorecard).toMatchObject({
        outcome: 'SeasonOver',
        daysSurvived: 3,
        modelCalls: 12,
        idleTurns: 12,
        forcedWaits: 3,
        toolCalls: 0,
      })
      expect(JSON.stringify(lastMessage(prompts[1]!))).toContain('call WaitForNextDay')
    }),
  )

  it.effect('a recorded season replays exactly, with no model', () =>
    Effect.gen(function* () {
      const recorded = yield* playSeason(setup).pipe(Effect.provide(steady))
      const file = Schema.encodeSync(RunFileJson)({
        runId: 'story',
        model: 'scripted/steady',
        setup,
        scorecard: recorded.scorecard,
        tape: recorded.tape,
        events: recorded.events,
      })
      const loaded = Schema.decodeSync(RunFileJson)(file)

      const replayed = yield* playSeason(loaded.setup).pipe(
        Effect.provide(Tape.replay(loaded.tape)),
      )
      expect(replayed.scorecard).toEqual(recorded.scorecard)
      expect(replayed.tape).toEqual(recorded.tape)
      expect(JSON.stringify(replayed.events)).toEqual(JSON.stringify(recorded.events))
    }),
  )

  it.effect('a replay that drifts from its recording stops', () =>
    Effect.gen(function* () {
      const recorded = yield* playSeason(setup).pipe(Effect.provide(steady))
      const exit = yield* playSeason({ ...setup, seed: 'another' }).pipe(
        Effect.provide(Tape.replay(recorded.tape)),
        Effect.exit,
      )
      expect(Exit.isFailure(exit)).toBe(true)
      const diverged = Exit.isFailure(exit)
        ? Cause.prettyErrors(exit.cause).map(error => error.message)
        : []
      expect(diverged).toEqual([
        'replay diverged at model call 1 (day 2): the prompt is not the recorded one',
      ])
    }),
  )
})
