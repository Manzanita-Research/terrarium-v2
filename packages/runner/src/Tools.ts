/**
 * Tools for an LLM operator, made from a Domain Api's command schemas rather than written
 * out again. A tool's name is the command's tag. Its parameters are the command's input,
 * without `target`, which the runner fills in. Its description is the one thing written
 * here, since doc comments don't exist at runtime.
 *
 * The runner resolves calls itself, not through `Toolkit` handlers, so a call to a tool
 * that doesn't exist, bad arguments and a rejection all go back to the model as tool
 * results and are counted, instead of failing the turn.
 */
import * as Effect from 'effect/Effect'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import * as Tool from 'effect/ai/Tool'
import * as Toolkit from 'effect/ai/Toolkit'

import { isRejection } from './Telemetry.ts'

/** The parts of a Domain command class the runner reads. */
interface CommandEntry {
  readonly kind: 'Command'
  readonly tag: string
  readonly fields: Schema.Struct.Fields
}

const isCommand = (entry: unknown): entry is CommandEntry =>
  Predicate.hasProperty(entry, 'kind') && entry.kind === 'Command'

/** One command, as a tool the operator can call. */
export interface OperatorTool {
  readonly name: string
  readonly tool: Tool.Any
  readonly decode: (params: unknown) => Effect.Effect<object, Schema.SchemaError>
}

/**
 * A tool for every command in the Api. Every command needs a description; a missing one
 * is a bug in the runner, so it throws.
 */
export const toolsFor = (
  api: { readonly entries: ReadonlyArray<unknown> },
  descriptions: Readonly<Record<string, string>>,
): ReadonlyArray<OperatorTool> =>
  api.entries.filter(isCommand).map(command => {
    const description = descriptions[command.tag]
    if (description === undefined) throw new Error(`no tool description for ${command.tag}`)
    const { _tag, ...input } = command.fields
    const parameters = Schema.Struct(input)
    return {
      name: command.tag,
      tool: Tool.make(command.tag, { description, parameters }),
      // Command inputs are plain schemas with no services, which the field types can't show.
      decode: params =>
        Schema.decodeUnknownEffect(parameters)(params ?? {}) as Effect.Effect<
          object,
          Schema.SchemaError
        >,
    }
  })

export const toolkitOf = (tools: ReadonlyArray<OperatorTool>) =>
  Toolkit.make(...tools.map(({ tool }) => tool))

/** How a call went. Everything but `Done` counts as an invalid call. */
export type Outcome =
  | { readonly _tag: 'Done'; readonly result: unknown }
  | { readonly _tag: 'Rejected'; readonly rejection: string; readonly result: unknown }
  | { readonly _tag: 'BadArguments'; readonly result: unknown }
  | { readonly _tag: 'UnknownTool'; readonly result: unknown }

/** A command client: each command is a function from its payload to its reply. */
export type Send = (name: string, payload: object) => Effect.Effect<unknown, unknown> | undefined

/** A command's reply, from the receipt the Api client returns (`{ reply, stream, version }`). */
const replyOf = (receipt: unknown): object =>
  Predicate.hasProperty(receipt, 'reply') && Predicate.isObject(receipt.reply) ? receipt.reply : {}

/**
 * Validate a call against its tool and send it. Rejections come back as outcomes. Any
 * other failure is a fault in the world or the runner, not the model, so it stays a failure.
 */
export const resolve = (
  tools: ReadonlyArray<OperatorTool>,
  send: Send,
  target: string,
  call: { readonly name: string; readonly params: unknown },
): Effect.Effect<Outcome, unknown> => {
  const tool = tools.find(({ name }) => name === call.name)
  if (tool === undefined)
    return Effect.succeed({
      _tag: 'UnknownTool',
      result: {
        error: 'UnknownTool',
        message: `There is no tool called ${call.name}.`,
        tools: tools.map(({ name }) => name),
      },
    })
  return tool.decode(call.params).pipe(
    Effect.matchEffect({
      onFailure: error =>
        Effect.succeed<Outcome>({
          _tag: 'BadArguments',
          result: { error: 'BadArguments', message: error.message },
        }),
      onSuccess: input => {
        const sent = send(tool.name, { ...input, target })
        if (sent === undefined) return Effect.die(new Error(`no client for ${tool.name}`))
        return sent.pipe(
          Effect.map((receipt): Outcome => ({
            _tag: 'Done',
            result: { ok: true, ...replyOf(receipt) },
          })),
          Effect.catchIf(isRejection, rejection =>
            Effect.succeed<Outcome>({
              _tag: 'Rejected',
              rejection: (rejection as { readonly _tag: string })._tag,
              result: { rejected: rejection },
            }),
          ),
        )
      },
    }),
  )
}
