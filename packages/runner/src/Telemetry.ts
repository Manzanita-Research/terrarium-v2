import * as Effect from 'effect/Effect'

import { Maple } from '@maple-dev/effect-sdk/server'

/**
 * A Domain rejection is an answer the agent is meant to read, not a fault in the world,
 * so it exports as `Ok`. Rejection classes carry `kind: 'Rejection'` on the constructor.
 */
export const isRejection = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error.constructor as { readonly kind?: unknown }).kind === 'Rejection'

/**
 * Traces, logs and metrics to Maple: Domain's own spans (decide, policy, view, read)
 * and metrics (`domain.commands`, `domain.command.duration`, ...), plus the runner's.
 * Where they go comes from `MAPLE_ENDPOINT` and `MAPLE_INGEST_KEY`; see `.env`.
 */
export const TelemetryLive = Maple.layer({
  serviceName: 'terrarium-runner',
  serviceNamespace: 'terrarium',
  isAnticipatedError: isRejection,
})

/**
 * The exporter drops failed batches without a word, so a run that can't reach Maple
 * looks just like one that did. Post an empty batch first and warn if it doesn't land.
 * Inside a proxied sandbox, Node's `fetch` needs `NODE_USE_ENV_PROXY=1`.
 */
export const checkExport: Effect.Effect<void> = Effect.gen(function* () {
  const endpoint = process.env['MAPLE_ENDPOINT'] ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
  if (endpoint === undefined) return
  const key = process.env['MAPLE_INGEST_KEY']
  const status = yield* Effect.tryPromise(() =>
    fetch(new URL('/v1/traces', endpoint), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify({ resourceSpans: [] }),
    }).then(response => response.status),
  ).pipe(
    Effect.catch(error =>
      Effect.succeed(String((error.cause as { cause?: { code?: string } })?.cause?.code ?? error)),
    ),
  )
  if (status !== 200)
    console.warn(
      `telemetry: couldn't export to ${endpoint} (${status}), so this run's traces won't arrive.` +
        (key === undefined ? ' MAPLE_INGEST_KEY is not set.' : '') +
        ' In a proxied sandbox, run with NODE_USE_ENV_PROXY=1.',
    )
})
