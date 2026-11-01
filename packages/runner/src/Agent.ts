/**
 * The agent loop: an LLM operator plays one vending season through `OperatorApi`.
 *
 * Each morning the operator gets the rules and a report, then takes turns calling tools
 * until it calls WaitForNextDay (or runs out of turns, and the runner ends the day for
 * it). Every reply is recorded on the tape, so the season replays with no model calls.
 *
 * The loop only knows `LanguageModel`. Which model plays is a Layer chosen at the edge:
 * a provider for live runs, `Tape.scripted` for stories, `Tape.replay` for replays.
 */
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import * as Stream from 'effect/Stream'
import * as LanguageModel from 'effect/ai/LanguageModel'
import * as Prompt from 'effect/ai/Prompt'

import * as InMemory from '@alchemy.run/domain/InMemory'
import { FootfallLive } from '@terrarium/vending/Market/Footfall.policy'
import { SeededShoppers } from '@terrarium/vending/Market/SeededShoppers'
import { OperatorApi } from '@terrarium/vending/OperatorApi.api'
import { type Books, netWorth } from '@terrarium/vending/Shop/Books'
import { OpenShop } from '@terrarium/vending/Shop/OpenShop.command'
import { Shop } from '@terrarium/vending/Shop/Shop.aggregate'
import { ShopId } from '@terrarium/vending/Shop/Shop.id'
import { Vending } from '@terrarium/vending/Vending.model'

import { type Overnight, morning, nudge, quiet, rules } from './Briefing.ts'
import type { Scorecard, Setup } from './Run.ts'
import { type Reply, type Turn, fromResponse, promptHash } from './Tape.ts'
import { type Outcome, type Send, resolve, toolkitOf, toolsFor } from './Tools.ts'

/** What each tool is for. The parameters come from the command schemas. */
export const descriptions: Readonly<Record<string, string>> = {
  OrderStock:
    'Buy stock from the supplier at its unit cost. It is paid for now and arrives in the storeroom after the lead time.',
  StockMachine: 'Move units of a product from the storeroom into the vending machine.',
  SetPrice: "Set a product's price in cents. It applies from the next customers on.",
  WaitForNextDay:
    'End the day. Customers visit the machine, the daily fee is charged, deliveries due tomorrow arrive, and the next day opens. This is the only way time moves.',
}

export const defaultMaxTurnsPerDay = 6

export interface Season {
  readonly scorecard: Scorecard
  readonly tape: ReadonlyArray<Turn>
  readonly events: ReadonlyArray<unknown>
}

type Operator = Effect.Success<typeof OperatorApi.testClient>
type Logged = Stream.Success<ReturnType<Operator['Shop']['events']>>
type ShopEvent = Logged['event']

/**
 * Deliver everything queued, and what that delivers in turn, until nothing is left and no
 * policy is mid-run.
 */
const settle = (control: InMemory.Control) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1_000; i++) {
      yield* control.drain
      yield* Effect.yieldNow
      if (yield* control.idle) return
    }
    return yield* Effect.die(new Error('the world did not settle'))
  })

/** The event log so far, from a stream that runs alongside the season. */
const follow = <E>(stream: Stream.Stream<Logged, E>) =>
  Effect.gen(function* () {
    const log: Array<ShopEvent> = []
    yield* stream.pipe(
      Stream.runForEach(entry => Effect.sync(() => log.push(entry.event))),
      Effect.forkScoped,
    )
    /** Wait until an event matching `done` is logged at or after `from`, and return its index. */
    const until = (from: number, done: (event: ShopEvent) => boolean) =>
      Effect.gen(function* () {
        for (let i = 0; i < 1_000; i++) {
          const found = log.findIndex((event, index) => index >= from && done(event))
          if (found >= 0) return found
          yield* Effect.yieldNow
        }
        return yield* Effect.die(new Error('the event log stopped'))
      })
    return { log, until }
  })

/** Night ends when the next day opens or the season does. */
const endsNight = (event: ShopEvent) =>
  event._tag === 'DayOpened' || event._tag === 'SeasonEnded' || event._tag === 'WentBankrupt'

const overnightFrom = (events: ReadonlyArray<ShopEvent>): Overnight => {
  const sales: Array<Overnight['sales'][number]> = []
  const deliveries: Array<Overnight['deliveries'][number]> = []
  let fee: number | undefined
  for (const event of events) {
    if (event._tag === 'SalesRecorded') sales.push(...event.lines)
    if (event._tag === 'FeeCharged') fee = event.fee
    if (event._tag === 'StockDelivered')
      deliveries.push({ product: event.product, quantity: event.quantity })
  }
  return { sales, fee, deliveries }
}

/** The assistant message a reply becomes in the day's conversation. */
const spoken = (reply: Reply): Prompt.MessageEncoded => {
  const content: Array<Prompt.AssistantMessagePartEncoded> = [
    ...(reply.reasoning === undefined
      ? []
      : [{ type: 'reasoning' as const, text: reply.reasoning }]),
    ...(reply.text === '' ? [] : [{ type: 'text' as const, text: reply.text }]),
    ...reply.toolCalls.map(call => ({
      type: 'tool-call' as const,
      id: call.id,
      name: call.name,
      params: call.params,
      providerExecuted: false,
    })),
  ]
  return {
    role: 'assistant',
    content: content.length === 0 ? [{ type: 'text', text: '(no reply)' }] : content,
  }
}

class Tally {
  toolCalls = 0
  unknownTool = 0
  badArguments = 0
  rejected = 0
  rejections: Record<string, number> = {}
  modelCalls = 0
  idleTurns = 0
  forcedWaits = 0
  inputTokens = 0
  outputTokens = 0

  count(outcome: Outcome) {
    this.toolCalls++
    if (outcome._tag === 'UnknownTool') this.unknownTool++
    if (outcome._tag === 'BadArguments') this.badArguments++
    if (outcome._tag === 'Rejected') {
      this.rejected++
      this.rejections[outcome.rejection] = (this.rejections[outcome.rejection] ?? 0) + 1
    }
  }
}

/**
 * Play one season with whichever `LanguageModel` is provided. The world is built here,
 * in memory, from the setup, so a season is a pure function of the setup and the model's
 * replies.
 */
export const playSeason = (setup: Setup) => {
  const id = ShopId.make('shop-1')
  const platform = InMemory.make({ manual: true, now: () => Date.parse('2026-01-01T00:00:00Z') })
  const world = Vending.layer(FootfallLive).pipe(
    Layer.provide(SeededShoppers({ seed: setup.seed, baseDemand: setup.baseDemand })),
    Layer.provideMerge(platform.layer),
  )
  const tools = toolsFor(OperatorApi, descriptions)
  const toolkit = toolkitOf(tools)

  return Effect.gen(function* () {
    const shops = yield* Shop
    const operator = yield* OperatorApi.testClient
    const send: Send = (name, payload) => {
      const command = (operator as unknown as Record<string, unknown>)[name]
      return typeof command === 'function'
        ? (command as (payload: object) => Effect.Effect<unknown, unknown>)(payload)
        : undefined
    }
    const events = yield* follow(operator.Shop.events(id))

    yield* shops.send(Shop.ref(id), new OpenShop(setup.opening))
    yield* settle(platform.control)
    let read = (yield* events.until(0, event => event._tag === 'ShopOpened')) + 1

    const tape: Array<Turn> = []
    const tally = new Tally()

    /** One model call, recorded. */
    const ask = (day: number, turn: number, messages: ReadonlyArray<Prompt.MessageEncoded>) =>
      Effect.gen(function* () {
        const prompt = Prompt.make(messages)
        const promptSeen = promptHash(prompt)
        const response = yield* LanguageModel.generateText({
          prompt,
          toolkit,
          disableToolCallResolution: true,
          toolCallValidation: 'deferred',
        }).pipe(
          Effect.retry({
            times: 2,
            schedule: Schedule.exponential('1 second'),
          }),
        )
        const reply = fromResponse(response)
        tape.push({ day, turn, promptHash: promptSeen, reply })
        tally.modelCalls++
        tally.inputTokens += reply.usage.inputTokens
        tally.outputTokens += reply.usage.outputTokens
        yield* Effect.annotateCurrentSpan({
          'terrarium.tool_calls': reply.toolCalls.length,
          'terrarium.finish_reason': reply.finishReason,
          'gen_ai.usage.input_tokens': reply.usage.inputTokens,
          'gen_ai.usage.output_tokens': reply.usage.outputTokens,
        })
        return reply
      }).pipe(
        Effect.withSpan('terrarium.turn', {
          attributes: { 'terrarium.day': day, 'terrarium.turn': turn },
        }),
      )

    /** One tool call, resolved against the world. */
    const act = (call: Reply['toolCalls'][number]) =>
      resolve(tools, send, id, call).pipe(
        Effect.tap(outcome =>
          Effect.annotateCurrentSpan({
            'terrarium.tool.outcome': outcome._tag,
            ...(outcome._tag === 'Rejected'
              ? { 'terrarium.tool.rejection': outcome.rejection }
              : {}),
          }),
        ),
        Effect.withSpan('terrarium.tool', { attributes: { 'terrarium.tool': call.name } }),
      )

    /** One day: the morning report, then turns until the operator ends the day. */
    const day = (books: Books, overnight: Overnight) =>
      Effect.gen(function* () {
        const messages: Array<Prompt.MessageEncoded> = [
          { role: 'system', content: rules(books) },
          { role: 'user', content: [{ type: 'text', text: morning(books, overnight) }] },
        ]
        let ended = false
        for (let turn = 1; turn <= setup.maxTurnsPerDay && !ended; turn++) {
          const reply = yield* ask(books.day, turn, messages)
          messages.push(spoken(reply))
          if (reply.toolCalls.length === 0) {
            tally.idleTurns++
            messages.push({ role: 'user', content: [{ type: 'text', text: nudge }] })
            continue
          }
          const results: Array<Prompt.ToolMessagePartEncoded> = []
          for (const call of reply.toolCalls) {
            if (ended) {
              results.push({
                type: 'tool-result',
                id: call.id,
                name: call.name,
                isFailure: true,
                result: { error: 'NotRun', message: 'The day ended before this call.' },
              })
              continue
            }
            const outcome = yield* act(call)
            tally.count(outcome)
            if (outcome._tag === 'Done' && call.name === 'WaitForNextDay') ended = true
            results.push({
              type: 'tool-result',
              id: call.id,
              name: call.name,
              isFailure: outcome._tag !== 'Done',
              result: outcome.result,
            })
          }
          messages.push({ role: 'tool', content: results })
        }
        if (!ended) {
          tally.forcedWaits++
          yield* operator.WaitForNextDay({ target: id })
        }
      }).pipe(
        Effect.withSpan('terrarium.day', {
          attributes: { 'terrarium.day': books.day, 'terrarium.cash': books.cash },
        }),
      )

    let overnight = quiet
    for (;;) {
      const state = yield* operator.Shop.get(id)
      if (state._tag !== 'Trading') break
      yield* day(state.books, overnight)
      yield* settle(platform.control)
      const night = yield* events.until(read, endsNight)
      overnight = overnightFrom(events.log.slice(read, night + 1))
      read = night + 1
    }

    const state = yield* operator.Shop.get(id)
    const books = state._tag === 'Unopened' ? undefined : state.books
    const totals = yield* operator.Scorecard.get(id)
    if (totals === null) return yield* Effect.die(new Error('the season left no scorecard'))
    const lastDay = setup.opening.lastDay
    const scorecard: Scorecard = {
      outcome: totals.outcome,
      finalCash: totals.finalCash ?? books?.cash ?? 0,
      finalNetWorth: books === undefined ? 0 : netWorth(books),
      daysSurvived: totals.daysCompleted,
      revenue: totals.revenue,
      unitsSold: totals.unitsSold,
      stockouts: totals.stockouts,
      lostSales: totals.lostSales,
      ordersPlaced: totals.ordersPlaced,
      lateOrders: events.log.filter(
        event => event._tag === 'StockOrdered' && event.arrivesOn > lastDay,
      ).length,
      toolCalls: tally.toolCalls,
      invalidToolCalls: tally.unknownTool + tally.badArguments + tally.rejected,
      invalid: {
        unknownTool: tally.unknownTool,
        badArguments: tally.badArguments,
        rejected: tally.rejected,
      },
      rejections: tally.rejections,
      modelCalls: tally.modelCalls,
      idleTurns: tally.idleTurns,
      forcedWaits: tally.forcedWaits,
      tokens: { input: tally.inputTokens, output: tally.outputTokens },
    }
    yield* Effect.annotateCurrentSpan({
      'terrarium.outcome': scorecard.outcome,
      'terrarium.final_cash': scorecard.finalCash,
      'terrarium.invalid_tool_calls': scorecard.invalidToolCalls,
    })
    const season: Season = { scorecard, tape, events: [...events.log] }
    return season
  }).pipe(
    Effect.withSpan('terrarium.season', {
      attributes: {
        'terrarium.world': setup.world,
        'terrarium.seed': setup.seed,
      },
    }),
    Effect.scoped,
    Effect.provide(world),
  )
}
