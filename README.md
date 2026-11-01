# Terrarium

Small, deterministic simulated worlds for evaluating agents, in the spirit of Vending-Bench. Each world is an [`alchemy/Domain`](https://main.alchemy.run/domain/) model, so a run is an event log: it replays exactly, it can be forked at any event, and every refusal comes back with the evidence an agent (or a person) needs to understand it.

This is v2. v1 (a hand-rolled world/tool framework) lives on, archived, at `Manzanita-Research/terrarium-v1`.

## Status

Early. The design notes and build plan are in [docs/design/NOTES.md](docs/handoff/HANDOFF.md), and the run-explorer mockup is in [docs/design/mockup/](docs/design/mockup/).

![Mockup of the fork explorer, dark mode](docs/design/mockup/screenshot-dark-728.png)

## License

MIT
