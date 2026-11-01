import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as LanguageModel from 'effect/ai/LanguageModel'
import * as Prompt from 'effect/ai/Prompt'
import * as Response from 'effect/ai/Response'
/**
 * The model's side of a season. The world's event log already replays the world. The tape
 * holds what the model said on every turn, so a whole season replays with no model calls
 * (NOTES §4: model judgments are recorded, never recomputed).
 *
 * The scripted model that stories use and the replay model are the same thing: a
 * `LanguageModel` that plays replies from a list instead of asking a provider.
 */
import { createHash } from 'node:crypto'

/** A tool call as the model sent it. `params` is unchecked: the runner validates it. */
export const ToolCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  params: Schema.Unknown,
})
export type ToolCall = typeof ToolCall.Type

/** One model reply: everything in it that can change the world or the next prompt. */
export const Reply = Schema.Struct({
  reasoning: Schema.optional(Schema.String),
  text: Schema.String,
  toolCalls: Schema.Array(ToolCall),
  finishReason: Response.FinishReason,
  usage: Schema.Struct({ inputTokens: Schema.Int, outputTokens: Schema.Int }),
})
export type Reply = typeof Reply.Type

/** One model call: where it happened, a fingerprint of the prompt it saw, and the reply. */
export const Turn = Schema.Struct({
  day: Schema.Int,
  turn: Schema.Int,
  promptHash: Schema.String,
  reply: Reply,
})
export type Turn = typeof Turn.Type

export const Tape = Schema.Array(Turn)
export type Tape = typeof Tape.Type

/** A prompt's fingerprint. Replay compares it to the recorded one to catch a season that drifted. */
export const promptHash = (prompt: Prompt.Prompt): string =>
  createHash('sha256')
    .update(JSON.stringify(Schema.encodeSync(Prompt.Prompt)(prompt)))
    .digest('hex')
    .slice(0, 16)

/** The parts of a `GenerateTextResponse` a reply keeps. */
export interface Generated {
  readonly text: string
  readonly reasoningText: string | undefined
  readonly toolCalls: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly params: unknown
  }>
  readonly finishReason: Response.FinishReason
  readonly usage: Response.Usage
}

/** Read a reply out of a provider's response. */
export const fromResponse = (response: Generated): Reply => {
  const reasoning = response.reasoningText
  return {
    ...(reasoning === undefined || reasoning === '' ? {} : { reasoning }),
    text: response.text,
    toolCalls: response.toolCalls.map(call => ({
      id: call.id,
      name: call.name,
      params: call.params,
    })),
    finishReason: response.finishReason,
    usage: {
      inputTokens: response.usage.inputTokens.total ?? 0,
      outputTokens: response.usage.outputTokens.total ?? 0,
    },
  }
}

/** The encoded parts a provider would have returned for a reply. */
export const toParts = (reply: Reply): Array<Response.PartEncoded> => [
  ...(reply.reasoning === undefined ? [] : [{ type: 'reasoning' as const, text: reply.reasoning }]),
  ...(reply.text === '' ? [] : [{ type: 'text' as const, text: reply.text }]),
  ...reply.toolCalls.map(call => ({
    type: 'tool-call' as const,
    id: call.id,
    name: call.name,
    params: call.params,
  })),
  {
    type: 'finish' as const,
    reason: reply.finishReason,
    usage: {
      inputTokens: { total: reply.usage.inputTokens },
      outputTokens: { total: reply.usage.outputTokens },
    },
  },
]

/** What a scripted model sees on each call. */
export interface Call {
  /** Counts calls from 0 across the whole season. */
  readonly index: number
  readonly prompt: Prompt.Prompt
}

/** The parts of a reply a script writes. Ids, usage and the finish reason are filled in. */
export interface Line {
  readonly text?: string
  readonly toolCalls?: ReadonlyArray<{ readonly name: string; readonly params: unknown }>
}

/** A tool call for a script. */
export const call = (name: string, params: unknown = {}) => ({ name, params })

const fromLine = (index: number, line: Line): Reply => {
  const toolCalls = (line.toolCalls ?? []).map((toolCall, n) => ({
    id: `call-${index}-${n}`,
    ...toolCall,
  }))
  return {
    text: line.text ?? '',
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
    usage: { inputTokens: 0, outputTokens: 0 },
  }
}

const playing = (next: (call: Call) => Effect.Effect<Reply>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      return yield* LanguageModel.make({
        generateText: options =>
          Ref.getAndUpdate(calls, n => n + 1).pipe(
            Effect.flatMap(index => next({ index, prompt: options.prompt })),
            Effect.map(toParts),
          ),
        streamText: () => Stream.die(new Error('the runner never streams')),
      })
    }),
  )

/**
 * A model that answers from a script, for stories and smoke runs. It never calls a provider.
 * The script sees each prompt, so it can read the day's briefing if it wants to.
 */
export const scripted = (script: (call: Call) => Line) =>
  playing(call => Effect.sync(() => fromLine(call.index, script(call))))

/** The tape ran out, or a prompt didn't match the one recorded: the season is not the same one. */
export class TapeDiverged extends Schema.TaggedError<TapeDiverged>()('TapeDiverged', {
  index: Schema.Int,
  day: Schema.NullOr(Schema.Int),
  reason: Schema.String,
}) {
  override get message() {
    return `replay diverged at model call ${this.index}${this.day === null ? '' : ` (day ${this.day})`}: ${this.reason}`
  }
}

/**
 * A model that plays a recorded tape back, checking that each prompt is the one the
 * recording saw. A season replayed with it makes no model calls.
 */
export const replay = (tape: Tape) =>
  playing(({ index, prompt }) => {
    const turn = tape[index]
    if (turn === undefined)
      return Effect.die(new TapeDiverged({ index, day: null, reason: 'the tape ran out' }))
    if (turn.promptHash !== promptHash(prompt))
      return Effect.die(
        new TapeDiverged({ index, day: turn.day, reason: 'the prompt is not the recorded one' }),
      )
    return Effect.succeed(turn.reply)
  })
