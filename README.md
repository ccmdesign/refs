# _refs

A local library for design references, built for two readers: the person who curates it, and the agent who designs from it.

You collect images and links onto boards in a plain web interface. Each board is also written out as a folder of images plus one `refs.yaml` holding the brief and the notes, so an agent starting a design can be pointed at a single path and read everything it needs.

Everything is plain files on your own machine. There is no account, no database and no server to rent.

## What it does

- **Boards that nest.** `acme-rebrand/editorial-grid` is a board inside a board. Each has a brief: what the board is for, what to take from it, what to ignore.
- **One ref, many boards.** An image is stored once, named by a hash of its content, and can sit on any number of boards with a separate note on each. Dropping the same image twice never duplicates it.
- **A grid for looking.** Three, four or six columns, tag filters, light and dark, a popover for notes.
- **Machine tags.** A vision model tags and describes each image in the background. Its tags are kept apart from yours and never overwrite them.
- **Agent output.** Every board is generated into `library/out/<board>/`, with key refs first and parent briefs included.
- **Hand-off button.** "Agent" on a board or a ref copies a ready-made prompt, with the right paths in it, to paste into your agent.
- **Three ways in.** Drop or paste into the app, use the CLI, or let an agent use the CLI.

## Quick start

Requires Node 22.18 or newer and pnpm.

```bash
cd app
pnpm install
pnpm dev
```

Open http://localhost:3210. The library is created at `library/`, next to `app/`, the first time you add something.

From the command line:

```bash
cd app
pnpm refs board create branding
pnpm refs add ~/Downloads/poster.jpg --board branding --board-note "Take the grid, ignore the colour"
pnpm refs show branding
```

## How it is stored

```
library/
  files/3f/3fa9c1d2e4b7.jpg     originals, named by content hash
  refs/3fa9c1d2e4b7.yaml        one file per ref: source, note, tags, machine tags
  boards/branding.yaml          one file per board: brief and its list of refs
  boards/branding/posters.yaml  a sub-board
  vocabulary.yaml               optional: tags the tagger should prefer
  out/                          generated folders for agents; never edit by hand
  .trash/                       deleted refs, kept until you empty it
```

Set `REFS_LIBRARY` to keep the library somewhere else.

## For agents

Point an agent at a board's generated folder:

```bash
pnpm refs path branding/posters
```

It contains links to the images and a `refs.yaml`:

```yaml
board: branding/posters
brief: Grid and type hierarchy only. Ignore colour.
parent_briefs:
  - board: branding
    brief: The client is a bank. Sober.
refs:
  - id: 3fa9c1d2e4b7
    file: vignelli-poster-3fa9c1.jpg
    key: true
    note: Strong six-column rhythm.
    board_note: Take the column rhythm, not the red.
    tags: [poster, grid]
    machine_tags: [typographic, two-colour, asymmetric]
    description: Poster with a six-column grid and oversized numerals.
    source: https://example.com/poster
```

For a sandbox or another repository that cannot follow links into the library, `pnpm refs export <board> --to <dir>` writes the same folder with real copies.

`app/skills/refs/SKILL.md` is a ready-made skill that teaches an agent this convention. Copy it into your agent's skills folder and set `REFS_HOME` to this repository's path.

## CLI

```
refs add <file|url>... [--board <board>] [--note <text>] [--board-note <text>]
                       [--key] [--tags a,b] [--source <url>] [--title <text>]
refs boards
refs show <board>
refs path <board>
refs board create|rename|rm|brief ...
refs move <id> --from <board> --to <board>
refs rm <id> --board <board>        take a ref off one board
refs delete <id>                    move a ref to the trash
refs export <board> --to <dir>
refs rebuild                        regenerate every folder under out/
refs tag <id> | --board <board> | --untagged
```

Add `--json` for machine-readable output. The CLI works whether or not the app is running. It cannot yet edit the note or tags of an existing ref; use the app for that.

## Tagging

Tagging is optional and runs after an add, in the background.

| Variable | Meaning |
|---|---|
| `REFS_TAGGER` | `omlx` (default), `claude`, `codex`, or `none` to switch tagging off |
| `REFS_TAGGER_MODEL` | Model name to use instead of the backend's default |
| `OMLX_BASE_URL` | OpenAI-compatible endpoint, default `http://127.0.0.1:9999/v1` |
| `OMLX_API_KEY` | Key for that endpoint, if it needs one |

The `omlx` backend talks to any local OpenAI-compatible server that accepts images. The `claude` and `codex` backends shell out to those command-line tools; they are written but have not been exercised yet.

If you do not run a local model, set `REFS_TAGGER=none`.

## Good to know

- **Local only.** The app has no login and will fetch any URL you give it. Run it on your own machine and do not expose its port to a network.
- **Your library is not part of this repository.** `library/` is ignored by git on purpose. References are other people's work; keep them private unless you have the right to share them.
- **Type.** The interface uses [Switzer](https://www.fontshare.com/fonts/switzer) from Fontshare, fetched at build time and not redistributed here.

## Development

```bash
cd app
pnpm test        # unit tests for the library and the tagger
pnpm typecheck   # core/, bin/ and test/
pnpm build       # production build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the code is laid out. [docs/spec.md](docs/spec.md) records the design the first version was built from.

## Not there yet

- A browser extension for saving images from a page.
- Video and PDF references.
- Ordering refs by hand.
- Any hosted or multi-user mode.

## Licence

Code is released under the [MIT licence](LICENSE). Documentation and the interface design are released under [CC BY 4.0](LICENSE-docs.md).

© 2026 ccmlabs
