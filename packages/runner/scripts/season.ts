import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import type * as LanguageModel from 'effect/ai/LanguageModel'
/**
 * Play the vending world with an LLM operator, or replay a recorded run.
 *
 *   pnpm --filter @terrarium/runner season ping [model]          a one-day season: one tool-calling round trip
 *   pnpm --filter @terrarium/runner season live [seed] [model]   a 30-day season, recorded under runs/
 *   pnpm --filter @terrarium/runner season replay <run.json>     a recorded season again, with no model calls
 *
 * `ping` and `live` call Workers AI (see src/WorkersAi.ts for the variables they need).
 * `replay` calls nothing. Telemetry goes to Maple when MAPLE_ENDPOINT is set; inside a
 * proxied sandbox, run with NODE_USE_ENV_PROXY=1.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { baseDemand, opening } from '@terrarium/vending/VendingLite'

import { type Season, defaultMaxTurnsPerDay, playSeason } from '../src/Agent.ts'
import { type RunFile, RunFileJson, type Setup } from '../src/Run.ts'
import * as Tape from '../src/Tape.ts'
import { TelemetryLive, checkExport } from '../src/Telemetry.ts'
import * as WorkersAi from '../src/WorkersAi.ts'

const runs = new URL('../../../runs/', import.meta.url)

const usage = () => {
  console.error(
    'usage: season ping [model] | season live [seed] [model] | season replay <run.json>',
  )
  process.exit(2)
}

const traced = <A, E>(
  effect: Effect.Effect<A, E, LanguageModel.LanguageModel>,
  model: Layer.Layer<LanguageModel.LanguageModel, unknown>,
  attributes: Record<string, string>,
) =>
  effect.pipe(
    Effect.withSpan('terrarium.run', { attributes }),
    Effect.provide(model),
    Effect.provide(TelemetryLive),
  )

const report = (model: string, season: Season) => {
  const cost = WorkersAi.costOf(model, season.scorecard.tokens)
  return {
    ...season.scorecard,
    ...(cost === undefined ? {} : { estimatedCostUsd: Number(cost.toFixed(4)) }),
  }
}

const [mode, ...args] = process.argv.slice(2)
const needs = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_WORKERS_AI_TOKEN']
const missing = needs.filter(name => !process.env[name])
if ((mode === 'ping' || mode === 'live') && missing.length > 0) {
  console.error(
    `${mode} calls Workers AI and needs ${missing.join(' and ')} in .env (see src/WorkersAi.ts).`,
  )
  process.exit(2)
}
await Effect.runPromise(checkExport)

if (mode === 'ping') {
  const model = args[0] ?? WorkersAi.defaultModel
  const setup: Setup = {
    world: 'vending-lite',
    seed: 'ping',
    opening: { ...opening, lastDay: 1 },
    baseDemand,
    maxTurnsPerDay: 2,
  }
  const season = await Effect.runPromise(
    traced(playSeason(setup), WorkersAi.model(model), {
      'terrarium.mode': 'ping',
      'terrarium.model': model,
    }),
  )
  console.log(
    JSON.stringify({ model, tape: season.tape, scorecard: report(model, season) }, null, 2),
  )
} else if (mode === 'live') {
  const seed = args[0] ?? 'season-1'
  const model = args[1] ?? WorkersAi.defaultModel
  const runId = `${new Date().toISOString().slice(0, 10)}-${seed}-${Date.now().toString(36)}`
  const setup: Setup = {
    world: 'vending-lite',
    seed,
    opening,
    baseDemand,
    maxTurnsPerDay: defaultMaxTurnsPerDay,
  }
  const season = await Effect.runPromise(
    traced(playSeason(setup), WorkersAi.model(model), {
      'terrarium.mode': 'live',
      'terrarium.model': model,
      'terrarium.run': runId,
    }),
  )
  const run: RunFile = {
    runId,
    model: `workers-ai/${model}`,
    setup,
    scorecard: season.scorecard,
    tape: season.tape,
    events: season.events,
  }
  const dir = new URL(`${runId}/`, runs)
  await mkdir(dir, { recursive: true })
  await writeFile(new URL('run.json', dir), Schema.encodeSync(RunFileJson)(run))
  const scorecard = { runId, model: run.model, seed, ...report(model, season) }
  await writeFile(new URL('scorecard.json', dir), JSON.stringify(scorecard, null, 2) + '\n')
  console.log(JSON.stringify(scorecard, null, 2))
  console.log(`recorded to ${new URL('run.json', dir).pathname}`)
} else if (mode === 'replay') {
  const path = args[0]
  if (path === undefined) usage()
  const run = Schema.decodeSync(RunFileJson)(await readFile(path!, 'utf8'))
  const season = await Effect.runPromise(
    traced(playSeason(run.setup), Tape.replay(run.tape), {
      'terrarium.mode': 'replay',
      'terrarium.model': run.model,
      'terrarium.run': run.runId,
    }),
  )
  const same = JSON.stringify(season.scorecard) === JSON.stringify(run.scorecard)
  console.log(JSON.stringify({ runId: run.runId, same, scorecard: season.scorecard }, null, 2))
  if (!same) process.exit(1)
} else usage()
