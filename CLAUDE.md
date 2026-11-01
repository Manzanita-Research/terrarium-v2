# Terrarium v2

Read [docs/design/NOTES.md](docs/design/NOTES.md) first: it is the design and the build plan.

- The stack is CAFE: Cloudflare, Alchemy, FoldKit, Effect. Worlds are `@alchemy.run/domain` models. The skill that ships with the package (`node_modules/@alchemy.run/domain/skills/alchemy-domain`) is the reference. Read the installed source over memory.
- There is one Effect for the whole workspace, pinned in `pnpm-workspace.yaml` overrides (4.1.1). Add every new `@effect/*` package there.
- Files are named by kind (`.aggregate.ts`, `.command.ts`, `.rejection.ts`, `.view.ts`, `.policy.ts`, `.external.ts`, `.api.ts`, `.model.ts`, `.id.ts`), and folders are subdomains. There are no barrel files.
- Tests are stories (`@alchemy.run/domain/Story`). Write the story first.
- A world must stay deterministic. Randomness comes from a seed and is keyed per draw, never from a shared sequence.
- `pnpm check` must pass before a PR.
