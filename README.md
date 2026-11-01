# Terrarium

Small, deterministic simulated worlds for evaluating agents, in the spirit of Vending-Bench. Each world is an [`@alchemy.run/domain`](https://www.npmjs.com/package/@alchemy.run/domain) model, so a run is an event log: it replays exactly, it can be forked at any event, and every refusal comes back with the evidence an agent (or a person) needs to understand it.

This is v2. v1 (a hand-rolled world/tool framework) lives on, archived, at `Manzanita-Research/terrarium-v1`.

## Status

Early. The design notes and build plan are in [docs/design/NOTES.md](docs/design/NOTES.md), and the run-explorer mockup is in [docs/design/mockup/](docs/design/mockup/).

![Mockup of the fork explorer, dark mode](docs/design/mockup/screenshot-dark-728.png)

## The vending world

[`packages/vending`](packages/vending/) is the first world: v1's vending-lite, played from the operator's side. The operator starts with $500 and thirty days. Each day they may order stock (paid now, delivered after two days), move it from the storeroom into the machine, and set prices. Then they wait. Customers visit, the shop pays a $2 daily fee, deliveries arrive and the next day opens. A shop that can't pay its fee is bankrupt. The score is net worth: cash plus stock at cost.

- `src/Shop/`: the `Shop` aggregate and its commands. Each rejection carries its evidence (`InsufficientCash` has the cash and the cost).
- `src/Market/`: the `Shoppers` external system and the `Footfall` policy that sends them to the machine when a day closes. `SeededShoppers` is a deterministic crowd. Its demand rules are ported from v1, and each draw is keyed by seed, day and product, so forks of a run see the same customers.
- `src/Score/`: the `NetWorth` and `Scorecard` views.
- `src/OperatorApi.api.ts`: everything an operator may do and see. It's the agent's whole interface. Opening the shop and recording sales aren't in it.
- `test/`: stories for every command and rejection, and a full season played through the `OperatorApi`.

## Run it

Node 22.18 or later and pnpm 12.

```sh
pnpm install
pnpm check   # format, lint, typecheck, test
```

## License

MIT
