/**
 * Workers AI as the operator's model, called from Node through its OpenAI-compatible REST
 * endpoint. This is the only file that knows a provider exists: swap the Layer to change
 * models.
 *
 * Needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_WORKERS_AI_TOKEN` (a token with Workers AI
 * permissions) in the environment. The token is read as a `Redacted` value. Effect's HTTP
 * client records no headers on spans by default and redacts `authorization` when it does,
 * so the token never reaches a trace.
 */
import * as Config from 'effect/Config'
import * as Layer from 'effect/Layer'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'

import * as OpenAiClient from '@effect/ai-openai-compat/OpenAiClient'
import * as OpenAiLanguageModel from '@effect/ai-openai-compat/OpenAiLanguageModel'

export const defaultModel = '@cf/moonshotai/kimi-k2.6'

export const client = OpenAiClient.layerConfig({
  apiKey: Config.Redacted('CLOUDFLARE_WORKERS_AI_TOKEN'),
  apiUrl: Config.NonEmptyString('CLOUDFLARE_ACCOUNT_ID').pipe(
    Config.map(account => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`),
  ),
}).pipe(Layer.provide(FetchHttpClient.layer))

/** A Workers AI model as the `LanguageModel`. */
export const model = (name: string) =>
  OpenAiLanguageModel.layer({ model: name }).pipe(Layer.provide(client))

/**
 * Dollars per million tokens, from https://developers.cloudflare.com/workers-ai/platform/pricing/
 * (read 2026-11-01). Workers AI doesn't return a cost, so the runner estimates one. Cached
 * input is cheaper, so this is an upper bound.
 */
export const prices: Readonly<Record<string, { readonly input: number; readonly output: number }>> =
  {
    '@cf/moonshotai/kimi-k2.6': { input: 0.95, output: 4 },
    '@cf/moonshotai/kimi-k2.5': { input: 0.6, output: 3 },
    '@cf/zai-org/glm-4.7-flash': { input: 0.06, output: 0.4 },
    '@cf/openai/gpt-oss-120b': { input: 0.35, output: 0.75 },
    '@cf/qwen/qwen3-30b-a3b-fp8': { input: 0.051, output: 0.335 },
  }

/** The estimated cost of a run in dollars, or undefined for a model not in the table. */
export const costOf = (
  name: string,
  tokens: { readonly input: number; readonly output: number },
): number | undefined => {
  const price = prices[name]
  if (price === undefined) return undefined
  return (tokens.input * price.input + tokens.output * price.output) / 1_000_000
}
