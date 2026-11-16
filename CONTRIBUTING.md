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

The interface has the house look of
[ccm-labs-design-system](https://github.com/claudioccm/ccm-labs-design-system),
a git dependency pinned to a release tag: ink on paper and its dark twin,
Switzer for text and Montagu Slab for titles, square corners, solid ink rules,
dotted grey lines between things, no shadows. Its `llms.txt` lists every class
and token.

`app/app/assets/main.css` imports the system and holds only what is _refs's
own: its layout and its own widgets (the masonry, the tiles, the ref overlay,
the board grid). It never restyles the system's look; if the look should
change, it changes in the design system. In practice:

- Read tokens instead of writing values: `--fg`, `--bg`, `--muted`, `--rule`,
  `--space-*`, `--text-*`. Please do not add hard-coded colours or sizes.
- Use the system's classes where one fits: `titlebar`, `disclosure`, `display`,
  `button`, `chip`, `cluster`, `stack`, `tone-muted`, `tabular`.
- A grey line is `background: var(--dots-below)` (or `-above`, `-start`), not a
  border.
- State goes in an attribute the browser or a screen reader already knows
  (`aria-pressed`, `aria-current`), not a class.

## Licence

By contributing you agree that your code is released under the MIT licence and
your documentation under CC BY 4.0, as described in `LICENSE` and
`LICENSE-docs.md`.
