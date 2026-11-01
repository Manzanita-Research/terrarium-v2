# Terrarium v2: design notes

These notes come from the planning session that started v2 (2026-11-01). They explain how agent sims work, how a sim maps onto `alchemy/Domain`, what v1 had, the UI ideas, and the build plan. The API details were read from the docs and still need checking against the source; where the code disagrees, the code wins.

## 1. What this is

Terrarium v2 is a set of small, deterministic simulated worlds for evaluating agents (Vending-Bench style), modelled as `alchemy/Domain` domains, plus a run-explorer UI for replaying and forking agent runs. The aims:

1. Explore `alchemy/Domain` in a real scenario.
2. Make a framework and UI that a research lab can use to poke at agent behaviour: forking runs, proving the sim is sound with `explore()`, and giving agents and people the same Api.

## 2. Status

- v1 was renamed to `Manzanita-Research/terrarium-v1` and archived. This repo is v2.
- The mockup of the "git for runs" view is in [`mockup/`](mockup/). Its data is invented.

## 3. Background: how agent evals and sims work

Every agent eval is the same loop. The harness sends the model the conversation plus tool schemas. The model replies with tool calls. The harness runs the matching function and appends the result as text. When the loop ends, a grader scores the final state. The agent's whole "world" is the strings that come back from tool calls.

Sims differ in what sits behind the tool functions:

| Kind | What a tool call does | Examples |
|---|---|---|
| Hand-written fake | Code edits a dict or database | τ-bench, AgentDojo, AppWorld, Vending-Bench's demand model |
| LLM as the world | Another model invents the result | ToolEmu, Petri, Vending-Bench's suppliers |
| Real software in a box | Real programs in Docker or a VM, usually offline | SWE-bench, Terminal-Bench/Harbor, WebArena, CyberGym |
| Real computer | Real OS, often with live web | OSWorld |

Grading styles: compare the final state (τ-bench), run hidden tests (SWE-bench), a number (Vending-Bench net worth), or an LLM judge (Petri).

Vending-Bench (Andon Labs) in brief: the agent runs a vending business over a long horizon. It emails suppliers (LLM-played), orders and stocks inventory, and sets prices. Customer demand is a formula. A daily fee is charged. Time advances only when the agent waits. The score is net worth. Long runs exceed the context window, so the harness trims context and gives the agent memory tools. That's where the famous "meltdowns" come from: the agent's beliefs drift from reality. **These details are from memory of the paper, not its code. Verify them.**

A list of agent sims and environments: https://am-i-in-a-sim.therustyclaw.com/

## 4. Mapping sims onto `alchemy/Domain`

| Sim concept | Domain block |
|---|---|
| World state (cash, stock, prices) | Aggregate, e.g. `Machine` |
| A tool the agent can call | Command (`SetPrice`, `OrderStock`, `WaitForNextDay`) |
| Tool schemas for the LLM | `Schema.toJsonSchemaDocument(Command)` |
| Rules | `decide`, which returns events or a Rejection |
| Error message the agent sees | Rejection fields, e.g. `InsufficientCash { cash, cost }` |
| History | Events (this *is* the trace) |
| Tool menu given to the agent | an `Api` listing those commands |
| Delayed things (deliveries) | `schedule(cmd, { after })`. Only never-rejecting commands can be scheduled |
| LLM-played supplier | Policy calls an ExternalSystem (the LLM), records the reply as an event |
| Score | a View folding events into net worth |
| Sim test cases | `Story` given/when/then (stories are data, so they can double as eval cases) |

The harness and agent loop sit **outside** the Domain and call the Api client. The CAFE skill says not to make an eval harness itself a Domain. The world is the Domain.

**What this buys you**
- **Exact replay.** House rule: model judgments are recorded, never recomputed. If supplier replies are events, a whole run replays with no model calls.
- **Forking.** Replay events up to N in a fresh `Domain.InMemory`, change one command, and let the agent continue.
- **A sound sim.** `explore()` walks reachable states through the real `decide`/`evolve`, and invariants are checked on each step. Agents find and farm sim bugs, so this matters.
- **Explainable refusals,** and a rejected command records nothing.
- **Same Api for people and agents.** MCP tools for the agent, a FoldKit UI for a human, so humans can play the benchmark as a baseline.

**Catches**
- `decide` must be pure, so randomness and demand can't live there. Have a policy roll the dice and record `CustomersArrived { sales }`, which then replays too. The other option, a seed passed as evidence on the command, is worse.
- Ordering is guaranteed only within one key. A multi-agent market needs a `Market` aggregate or a tick saga.
- Run evals on `Domain.InMemory`. Durable Objects are for live or multiplayer.
- `explore()` blows up on numeric state. Chart the coarse states (`Open → Stocked → SoldOut → Bankrupt`) and check the numbers with invariants.
- Domain doesn't fit the Docker/VM kinds of eval. There it could only do bookkeeping.

**Domain API, as read from https://alchemy.run/domain/ (verify against source; the CAFE skill says the code wins over the docs)**
- `Domain.Model(name, { aggregates, views, policies })`
- `Domain.Command(name, { target, input, events, rejects, reply })`
- `Domain.Event`, `Domain.Rejection`
- `Domain.Aggregate(name, { id, state, initial, commands, evolve, reply, read? })`, where `decide(state, cmd, { id, now })`
- `Domain.View`, Projection, Stream
- `Domain.Policy(name, { from, on, key?, keyOf? })`, implemented with `toLayer`
- Saga
- `Domain.ExternalSystem`
- `Domain.Api(name, ...entries)`, with `Api.client`, `Domain.protocolHttp` and `Domain.protocolWebSocket`
- Platforms: `Domain.InMemory` and `DomainCloudflare.DurableObjects` (one DO per key)
- Time: `ctx.now`, `schedule`, `Story.clock(...)` (the story clock starts at `2026-01-01T00:00:00Z`)
- Tests: `Story.given/when/then/rejected/expectCall/resolve` under `@effect/vitest`
- Introspection (from the lab's CAFE notes): `Model.definitions`, `Aggregate.definition.decide/evolve` for pure replay, `alchemy/Domain/InMemory` `make({ manual: true, now })` for a step debugger, and wrapping `Domain.Platform` to record every decision
- Known gaps: policy edges aren't declared, there's no global event log or instance list, views aren't backfilled, events can't be upcast

## 5. Existing repos (checked 2026-11-01 with `gh`)

**`Manzanita-Research/manzanita-research`.** Archived (pushed 2026-10-19).
- `packages/vending/` is a *customer-side* vending machine. Commands: `InsertCoin`, `SelectProduct`, `RequestRefund`/`RefundCredit` (Jev judgment), `StockSlot`, `Restock`, `NoteRestockOrdered`. Views: `Inventory`, `LowStock`, `SalesSummary`. Plus a `Restocking` policy, a `Supplier` external system, `Vending.explore.ts`, and generated diagrams (`generated/states.mmd`, eventmodeling, flowchart, graph.json, trace.json, tldraw).
- **Verdict:** keep the tooling patterns (explore, generated charts, recorded-judgment fixtures). Redo the domain: it's the wrong side of the counter (in Vending-Bench the agent is the operator), and it was written against pre-release Domain. The plan is to rethink it rather than port it.
- `apps/devtools/src/domains/vending.ts` also exists. Not read.

**`Manzanita-Research/terrarium`** (v1). Public, last pushed 2026-09-30.
- TS framework. `packages/core` has `defineWorld`, `defineEval`, a seeded `rng`, `replay`, and in-memory stores.
- `World = { state(), observe(), tools(), handleTool(call), tick?(step), done() }`. Plus `EvalSpec { horizon, world, scenarios, metrics, flue }` and `ScenarioSpec { id, seed, params, tags }`.
- `packages/cli`: `terrarium run | replay | inspect`, with JSONL traces.
- Live runs use **Flue** (each world action bound as a Flue tool) on Cloudflare Workers AI (default `@cf/moonshotai/kimi-k2.6`). There's also a Worker target.
- `evals/vending-lite`: the agent is the operator. Tools: `buy_inventory`, `stock_machine`, `set_price`, and more. Products: chips, soda, candy. $500 start, 30 days, a `priceEffect` demand model.
- Docs worth reading before v2: `docs/architecture.md`, `authoring-evals.md`, `scoring.md`, `traces.md`, `world-backed-tools.md`, `flue.md`. Also `DESIGN.md`, `PRODUCT.md`, `PRD-ChatGPT.md`, `app/DESIGN.md`. None of these were read in this session.
- README: "no UI, hosted run service, D1/R2 persistence, Durable Object coordinator…" in the MVP.

**How v1 maps to v2**

| v1 | v2 |
|---|---|
| `handleTool` | Commands plus `decide` |
| tool JSON | generated from Schemas |
| `tick` | `WaitForNextDay` plus scheduled commands |
| JSONL trace | event log |
| `replay` | fold the events |
| `rng` | randomness recorded as events |

Keep scenarios and seeds, metrics and scorecards, and the Flue agent loop and Workers AI target. New in v2: the explorer UI and forking.

## 6. UI and viz ideas

Almost all of these are just folds over the event log.

1. **Git for runs.** A fork tree plus net-worth curves per branch. "Branch here" on any event, edit one command, let the agent continue. *(mocked up)*
2. **Where it went wrong.** Line up a good and a bad run and highlight the first divergent event.
3. **Time scrubber.** State rebuilt by folding events up to day N. *(in the mockup)*
4. **Live statechart.** The `explore()` Mermaid chart lights up the agent's path. Over many runs it becomes a transition heatmap. States no agent reaches are untested parts of the sim.
5. **Rejection heatmap.** Clusters point to confusing tools. Repeats show an agent stuck in a loop.
6. **What the agent believes vs. what's true.** The agent's notes and memory beside the real state. This shows the meltdown gap growing. *(in the mockup)*
7. **You vs. the agent.** A human plays the same Api through FoldKit as a baseline.
8. **Many runs at once.** Trajectory "river", days-until-bankrupt survival curve, flags on suspicious score jumps (likely exploits).

FoldKit wiring: a Subscription turns a view's `watch` into Messages. "Branch" is a Command that replays the log to event N in a fresh `Domain.InMemory`.

Why these matter: forking is a counterfactual intervention on an agent's path, and believed-vs-true is a behavioural window into its world model. Both are safety- and interp-adjacent, and very visual.

## 7. The mockup ([`mockup/`](mockup/))

- `terrarium-forks.html`: the full page with the Manzanita brand (Fraunces, Source Serif 4, IBM Plex Mono standing in for Commit Mono, cream and warm-black, film grain). Light and dark via `prefers-color-scheme`. Responsive under 900px.
- `terrarium-forks.inline.html`: a variant without the page background, padding or title, for embedding.
- `screenshot-dark-728.png`: a dark-mode render at 728px.
- **The data is invented.** A main run goes bankrupt on day 54 after setting cola to $4.50 on day 38 and writing a false note on day 41. `fork/cola-3` forks at event #412 ($3.00) and `fork/chips-80` at #231 (chips ×80).
- Interactions: hover crosshair and tooltip, click or slider to scrub, branch select via legend or tree, event log with "⑂ branch here" (a toast only), a table view for accessibility.
- Branch colours were checked with the dataviz skill's validator, `--pairs all`. Light `#C25A2C, #0A7C9E, #9A58C8` on `#FAF9F6`. Dark `#D0662F, #1A8EAE, #9A72D8` on `#23211E`. Both pass except CVD, which is in the WARN band (about 6), so lines also carry dash patterns and direct labels. Terracotta with sage failed CVD badly, so don't use that pair for series.

## 8. Suggested plan for v2

1. ~~Rename and archive v1, create the v2 repo.~~ Done 2026-11-01.
2. Read the CAFE skill (`~/.claude/skills/cafe/SKILL.md` and its `references/`: `setup.md`, `domain.md`, `foldkit.md`, `serving.md`, `system-one.md`) and the `alchemy-domain` skill. House rules worth knowing:
   - Effect everywhere.
   - One pinned Effect version per workspace.
   - Alchemy owns infra.
   - Pleat for styling. A model picks styles, never writes CSS.
   - Tests are stories.
   - Demos run on the Mini and are shared with `bb connect expose <port>`.
   - Deploy only when asked.
   - Read the source, not memory.
   - Domain rules: one block per kind-suffixed file, folders are subdomains, rejections carry evidence, `decide`/`evolve` are pure.
3. Domain first: write `Operator/`, `Supplier/`, `Market/` events, commands and rejections for an operator-side vending sim (port vending-lite's rules), with stories before `decide`/`evolve`.
4. ~~Add `explore()`, a `.chart.ts` file and invariants (stock ≥ 0, cash only changes through events, no sale without stock).~~ Done 2026-11-01: `packages/explore`, `Shop.chart.ts` and `Shop.invariants.ts`.
5. Write the agent loop: generate tools from the Api's Command schemas, drive the Api client, reuse v1's Flue/Workers AI binding, and record LLM supplier replies as events.
6. Add a runs store, fork and replay, then the FoldKit explorer, starting with the mockup's view.
7. Later: a second world to prove the framework is generic, then multi-run views and a human-play mode.
