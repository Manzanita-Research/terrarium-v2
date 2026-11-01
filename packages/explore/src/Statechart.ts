import type { CommandOf, Definable, EventOf, RejectionOf, StateOf } from './Fold.ts'
import type { Exploration } from './explore.ts'

type Tag<T> = T extends { readonly _tag: infer K extends string } ? K : never

/**
 * A coarse statechart of an aggregate: a handful of named states, and what each command
 * does in each. The numbers inside a state are left to invariants; the chart is about
 * which moves exist at all. `check` holds it to what `explore` actually finds.
 */
export interface Statechart<A extends Definable, L extends string> {
  readonly aggregate: string
  /** Each chart state, with a line saying what it means. */
  readonly states: { readonly [K in L]: string }
  /** The chart state a concrete state belongs to. */
  readonly label: (state: StateOf<A>) => L
  readonly initial: L
  /** States no command leaves. */
  readonly final: ReadonlyArray<L>
  /** Commands that record events, and every event each may record. */
  readonly transitions: ReadonlyArray<{
    readonly from: L
    readonly command: Tag<CommandOf<A>>
    readonly to: L
    readonly events: ReadonlyArray<Tag<EventOf<A>>>
  }>
  /** Commands refused in a state, and every rejection they may give there. */
  readonly refusals: ReadonlyArray<{
    readonly in: L
    readonly command: Tag<CommandOf<A>>
    readonly rejections: ReadonlyArray<Tag<RejectionOf<A>>>
  }>
  /** Commands accepted with no events in a state. */
  readonly noops: ReadonlyArray<{ readonly in: L; readonly command: Tag<CommandOf<A>> }>
}

/** Declare an aggregate's statechart. The state names come from `states`. */
export const make = <A extends Definable, const L extends string>(
  aggregate: A,
  chart: {
    readonly states: { readonly [K in L]: string }
    readonly label: (state: StateOf<A>) => NoInfer<L>
    readonly initial: NoInfer<L>
    readonly final: ReadonlyArray<NoInfer<L>>
    readonly transitions: Statechart<A, NoInfer<L>>['transitions']
    readonly refusals: Statechart<A, NoInfer<L>>['refusals']
    readonly noops: Statechart<A, NoInfer<L>>['noops']
  },
): Statechart<A, L> => ({ aggregate: aggregate.aggregateName, ...chart })

const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const list = (values: Iterable<string>) => sorted(values).join(', ')

/** The chart an exploration implies, in the same shape as a declared one. */
export const summarize = <A extends Definable, L extends string>(
  exploration: Exploration<A, unknown>,
  label: (state: StateOf<A>) => L,
) => {
  const labelOf = (key: string) => {
    const node = exploration.states.get(key)
    if (node === undefined) throw new Error(`summarize: ${key} was never kept; explore further`)
    return label(node.state)
  }
  const transitions = new Map<string, Set<string>>()
  for (const t of exploration.transitions) {
    const edge = `${labelOf(t.from)} ${t.command._tag} ${labelOf(t.to)}`
    const events = transitions.get(edge) ?? new Set<string>()
    for (const event of t.events) events.add(event._tag)
    transitions.set(edge, events)
  }
  const refusals = new Map<string, Set<string>>()
  for (const r of exploration.refusals) {
    const at = `${labelOf(r.from)} ${r.command._tag}`
    refusals.set(at, (refusals.get(at) ?? new Set<string>()).add(r.rejection._tag))
  }
  const noops = new Set(exploration.noops.map(n => `${labelOf(n.from)} ${n.command._tag}`))
  const reached = new Set([...exploration.states.keys()].map(labelOf))
  const left = new Set(exploration.transitions.map(t => labelOf(t.from)))
  return {
    initial: labelOf(exploration.start),
    reached: sorted(reached),
    final: sorted([...reached].filter(state => !left.has(state))),
    transitions: new Map([...transitions].map(([edge, events]) => [edge, list(events)])),
    refusals: new Map([...refusals].map(([at, rejections]) => [at, list(rejections)])),
    noops: sorted(noops),
  }
}

/**
 * Every way a declared chart and an exploration disagree, one line each. Empty means
 * the chart is exactly what the walk found: no move it lacks, none it invents, and the
 * same events and rejections on each. Only as strong as the exploration: check that it
 * wasn't truncated, and that its commands reach every state.
 */
export const check = <A extends Definable, L extends string>(
  chart: Statechart<A, L>,
  exploration: Exploration<A, unknown>,
): ReadonlyArray<string> => {
  const found = summarize(exploration, chart.label)
  const problems: Array<string> = []
  const compare = (
    what: string,
    declared: ReadonlyMap<string, string>,
    actual: ReadonlyMap<string, string>,
  ) => {
    for (const [at, values] of declared) {
      const seen = actual.get(at)
      if (seen === undefined) problems.push(`${what} never seen: ${at} [${values}]`)
      else if (seen !== values)
        problems.push(`${what} ${at}: chart says [${values}], found [${seen}]`)
    }
    for (const [at, values] of actual) {
      if (!declared.has(at)) problems.push(`${what} not in the chart: ${at} [${values}]`)
    }
  }
  compare(
    'transition',
    new Map(chart.transitions.map(t => [`${t.from} ${t.command} ${t.to}`, list(t.events)])),
    found.transitions,
  )
  compare(
    'refusal',
    new Map(chart.refusals.map(r => [`${r.in} ${r.command}`, list(r.rejections)])),
    found.refusals,
  )
  compare(
    'no-op',
    new Map(chart.noops.map(n => [`${n.in} ${n.command}`, ''])),
    new Map(found.noops.map(at => [at, ''])),
  )
  if (found.initial !== chart.initial) {
    problems.push(`initial: chart says ${chart.initial}, found ${found.initial}`)
  }
  for (const state of Object.keys(chart.states)) {
    if (!found.reached.includes(state)) problems.push(`state never reached: ${state}`)
  }
  if (list(chart.final) !== list(found.final)) {
    problems.push(`final: chart says [${list(chart.final)}], found [${list(found.final)}]`)
  }
  return problems
}

/** The chart as a Mermaid state diagram. Refusals and no-ops become notes on each state. */
export const toMermaid = <A extends Definable, L extends string>(
  chart: Statechart<A, L>,
): string => {
  const states = Object.keys(chart.states) as Array<L>
  const lines = [`%% ${chart.aggregate}: generated from its Statechart; do not edit by hand.`]
  lines.push('stateDiagram-v2')
  for (const state of states) lines.push(`  ${state} : ${chart.states[state]}`)
  lines.push(`  [*] --> ${chart.initial}`)
  for (const t of chart.transitions) {
    lines.push(`  ${t.from} --> ${t.to} : ${t.command} / ${t.events.join(', ')}`)
  }
  for (const state of chart.final) lines.push(`  ${state} --> [*]`)
  for (const state of states) {
    const refused = chart.refusals
      .filter(r => r.in === state)
      .map(r => `${r.command} refused (${r.rejections.join(', ')})`)
    const ignored = chart.noops.filter(n => n.in === state).map(n => `${n.command} does nothing`)
    if (refused.length + ignored.length === 0) continue
    lines.push(`  note right of ${state}`)
    for (const line of [...refused, ...ignored]) lines.push(`    ${line}`)
    lines.push('  end note')
  }
  return `${lines.join('\n')}\n`
}
