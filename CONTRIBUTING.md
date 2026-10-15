# Contributing

Thanks for looking. This is a small project; issues and pull requests are welcome.

## Setup

```bash
cd app
pnpm install
pnpm dev        # the app, on http://localhost:3210
pnpm test       # unit tests
pnpm typecheck  # type-checks core/, bin/ and test/
```

Node 22.18 or newer is required: the CLI runs TypeScript files directly.

## How the code is laid out

- `app/core/`: the library itself. Plain TypeScript on Node APIs, no framework.
  Everything that reads or writes a library lives here, and has tests.
  First-run and health checks live in `core/config.ts`, `core/setup.ts`,
  `core/doctor.ts` and `core/skill.ts`. Tagging goes through
  `core/tagger/adapters/`.
- `app/bin/refs.ts`: the CLI, a thin wrapper over `core/`.
- `app/server/`: HTTP routes, thin wrappers over `core/`.
- `app/app/`: the Nuxt interface.

Two rules keep `core/` usable from the CLI without a build step: use only
erasable TypeScript (no enums, namespaces or parameter properties), and write
relative imports with the `.ts` extension.

CI runs on Linux, macOS and Windows. Tests must not assume symlinks or a POSIX
shell.

## Before opening a pull request

- Add or update a test for any change to `core/`.
- Run `pnpm test` and `pnpm typecheck`.
- Never commit a library. `library/` is ignored on purpose: references are
  other people's work.

## Interface

The interface is deliberately plain: black on white, Switzer, hairline rules,
no shadows, no rounded corners. Colours come from the variables at the top of
`app/app/assets/main.css`; please do not add new hard-coded colours.

## Licence

By contributing you agree that your code is released under the MIT licence and
your documentation under CC BY 4.0, as described in `LICENSE` and
`LICENSE-docs.md`.
