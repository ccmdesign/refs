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

Node 22.18 or newer; pnpm through `corepack enable`.

```bash
cd app && pnpm install
pnpm refs setup
pnpm dev
```

If something is off, run `pnpm refs doctor`.

Open http://localhost:3210. `pnpm refs setup` creates the library at `library/`, next to `app/`; set `REFS_LIBRARY` to keep it elsewhere.

### Set it up with your coding agent

Paste: *Clone https://github.com/ccmdesign/refs and set it up by following AGENTS.md.* The agent will ask whether you want image tagging.

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

Board images under `out/` follow `output.mode` in `config.yaml` (or `REFS_OUTPUT`): `links` (relative symlinks), `copies` (real files), or `auto` (symlink, then hard link, then copy—default, and what you want on Windows).

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

`app/skills/refs/SKILL.md` is a ready-made skill that teaches an agent this convention. Install it with `pnpm refs skill install` and set `REFS_HOME` to this repository's path.

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
refs setup [--tagger <name>] [--model <name>] ...
refs doctor
refs skill install [--claude | --codex | --to <dir>]
refs tag <id> | --board <board> | --untagged
refs tag --check
```

Add `--json` for machine-readable output. The CLI works whether or not the app is running. It cannot yet edit the note or tags of an existing ref; use the app for that.

## Tagging

Tagging is **off by default**. When enabled, it runs after an add in the background. Configure it in `library/config.yaml` (create the file if it is not there) or with environment variables.

**Ollama example** (`library/config.yaml`):

```yaml
tagger:
  adapter: openai-compatible
  preset: ollama
  model: qwen2.5vl:7b
output:
  mode: auto
```

**oMLX example**:

```yaml
tagger:
  adapter: openai-compatible
  preset: omlx
  model: your-vision-model
  api_key_env: OMLX_API_KEY
output:
  mode: auto
```

| Adapter | Preset / notes |
|---|---|
| `none` | Tagging disabled (default) |
| `openai-compatible` | Any `/v1/chat/completions` server with images |
| | `omlx` → `http://127.0.0.1:9999/v1` (`OMLX_BASE_URL` overrides) |
| | `ollama` → `http://127.0.0.1:11434/v1` |
| | `lmstudio` → `http://127.0.0.1:1234/v1` |
| | `openrouter` → OpenRouter (`OPENROUTER_API_KEY`) |
| | `openai` → OpenAI (`OPENAI_API_KEY`) |
| | Or set `base_url` instead of `preset` |
| `claude-cli` | `claude` on your PATH (subscription auth) |
| `codex-cli` | `codex` on your PATH |
| module path | `./my-adapter.ts` — see [docs/adapters.md](docs/adapters.md) |

**Environment overrides** (applied after the file):

| Variable | Sets |
|---|---|
| `REFS_TAGGER` | Adapter (`none`, legacy `omlx`/`ollama`/…, `claude`, `codex`, or a module path) |
| `REFS_TAGGER_MODEL` | `tagger.model` |
| `REFS_TAGGER_BASE_URL` | `tagger.base_url` |
| `REFS_TAGGER_API_KEY_ENV` | Name of the env var that holds the API key |
| `REFS_OUTPUT` | `output.mode` (`links`, `copies`, `auto`) |

Never put API keys in `config.yaml`. Name an environment variable with `api_key_env` and export the key in your shell.

Check that the configured tagger is reachable:

```bash
pnpm refs tag --check
pnpm refs tag --check --json
```

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
