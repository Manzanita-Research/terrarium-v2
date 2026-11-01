/**
 * A run on disk: the season's setup, the model's tape and the scorecard. The setup and
 * the tape are enough to play the season again exactly, with no model calls.
 */
import * as Schema from 'effect/Schema'

import { Tape } from './Tape.ts'

/** v1's metrics, plus the counts that show how the operator used its tools. */
export const Scorecard = Schema.Struct({
  outcome: Schema.Literals(['Trading', 'SeasonOver', 'Bankrupt']),
  /** Cash when the season ended. The score. */
  finalCash: Schema.Int,
  /** Cash plus stock at cost, on order included. */
  finalNetWorth: Schema.Int,
  daysSurvived: Schema.Int,
  revenue: Schema.Int,
  unitsSold: Schema.Int,
  stockouts: Schema.Int,
  lostSales: Schema.Int,
  ordersPlaced: Schema.Int,
  /** Orders placed too late to arrive before the season ended (TER-7). */
  lateOrders: Schema.Int,
  toolCalls: Schema.Int,
  /** Calls to tools that don't exist, calls with bad arguments, and rejected commands. */
  invalidToolCalls: Schema.Int,
  invalid: Schema.Struct({
    unknownTool: Schema.Int,
    badArguments: Schema.Int,
    rejected: Schema.Int,
  }),
  /** Rejections by name. */
  rejections: Schema.Record(Schema.String, Schema.Int),
  modelCalls: Schema.Int,
  /** Replies with no tool call. */
  idleTurns: Schema.Int,
  /** Days the runner ended because the model used up its turns without calling WaitForNextDay. */
  forcedWaits: Schema.Int,
  tokens: Schema.Struct({ input: Schema.Int, output: Schema.Int }),
})
export type Scorecard = typeof Scorecard.Type

/** Everything needed to play the season again. */
export const Setup = Schema.Struct({
  world: Schema.String,
  seed: Schema.String,
  opening: Schema.Struct({
    lastDay: Schema.Int,
    cash: Schema.Int,
    dailyFee: Schema.Int,
    leadDays: Schema.Int,
    catalog: Schema.Record(
      Schema.String,
      Schema.Struct({ unitCost: Schema.Int, defaultPrice: Schema.Int }),
    ),
  }),
  baseDemand: Schema.Record(Schema.String, Schema.Number),
  maxTurnsPerDay: Schema.Int,
})
export type Setup = typeof Setup.Type

export const RunFile = Schema.Struct({
  runId: Schema.String,
  /** Which model played, as `provider/model`. */
  model: Schema.String,
  setup: Setup,
  scorecard: Scorecard,
  tape: Tape,
  /** The world's event log, for reading. Replay rebuilds it from the setup and the tape. */
  events: Schema.Array(Schema.Unknown),
})
export type RunFile = typeof RunFile.Type

/** A run file as JSON, and back. */
export const RunFileJson = Schema.fromJsonString(RunFile)
