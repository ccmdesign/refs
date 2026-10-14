# Refs: spec, first version

Status: the design the first version was built from (2026-10-13). The README describes what exists today; where the two differ, the README is right.

## Purpose

A local system to collect and organise design references. People curate refs in a grid; agents working on a new design consume a board as a folder of images and notes.

## Model

**Ref.** One image or one link. It holds what is true wherever the ref is used: source, human tags, machine tags, a description and a general note. An image is stored once and identified by a hash of its content.

**Board.** A named collection of refs with a brief. Boards nest to any depth, for example `branding-refs` or `acme-rebrand/editorial-grid`. A board lists its refs, and for each one may hold a note that applies only on that board and a `key` flag marking the few that matter most.

Rules:

- A ref can be on any number of boards. Nothing is copied.
- Moving a ref means taking it off one board and putting it on another. No files move.
- Removing takes a ref off one board. Deleting takes it out of the library and moves it to a trash folder that is emptied by hand.
- A ref on no board appears in an Unsorted view.
- Adding an image that is already in the library adds the existing ref to the current board.
- Refs on a board are ordered by date added. Key refs are listed first in agent output.

## Library layout

This folder holds two siblings: `app/` for the code and `library/` for the content. The app reads the library path from `REFS_LIBRARY`, which defaults to `../library`.

```
refs/
  app/        Nuxt app, CLI, skill
  library/    refs, boards, files
  docs/       this spec
```

```
library/
  files/3f/3fa9c1d2e4b7.jpg          originals, named by content hash
  refs/3fa9c1d2e4b7.yaml             one file per ref
  boards/branding-refs.yaml          one file per board
  boards/acme-rebrand.yaml
  boards/acme-rebrand/editorial-grid.yaml
  vocabulary.yaml                    preferred tags for the tagger
  out/                               generated folders for agents (not edited by hand)
  .trash/                            deleted refs
  .cache/                            thumbnails
```

Ref file:

```yaml
id: 3fa9c1d2e4b7
file: files/3f/3fa9c1d2e4b7.jpg      # or `url:` for a link-only ref
title: vignelli-poster
source: https://example.com/poster
note: Strong six-column rhythm.
tags: [poster, grid]
auto:
  tags: [typographic, two-colour, asymmetric]
  description: Poster with a six-column grid and oversized numerals.
  model: Qwen3.8-27B-8bit
  at: 2026-10-13
width: 1600
height: 2263
added: 2026-10-13
```

Board file:

```yaml
brief: |
  Grid and type hierarchy only. Ignore colour.
refs:
  - id: 3fa9c1d2e4b7
    note: Take the column rhythm, not the red.
    key: true
    added: 2026-10-13
```

## Output for agents

For every board the app generates `out/<board path>/`, rebuilt whenever the board or one of its refs changes:

- Links to the board's image files, named by title and short id.
- One `refs.yaml` with the board's brief, the briefs of its parent boards, and per ref: file name, key flag, general note, board note, tags, machine tags, description and source. Link-only refs appear with their URL.

A sub-board's folder includes its parents' briefs but not its parents' refs.

`refs export <board> --to <dir>` writes the same folder with real copies of the images, for sandboxes or for a project repo that should carry its refs.

## Intake

1. **App**: drop or paste an image or a URL onto the current board.
2. **Agent**: `refs add <file|url> --board <board> [--note] [--board-note] [--key] [--tags]`.
3. **Chrome extension**: after the first version.

A URL that points to an image is downloaded and stored. Any other URL becomes a link-only ref.

## Tagging

- Runs once per ref, in the background after the add. Results go under `auto` and never overwrite human tags.
- The tagger is told to prefer tags from `vocabulary.yaml` and to add a new tag only when none fits.
- Backends sit behind one contract (image and vocabulary in, tags and description out): local oMLX, `claude -p`, `codex exec`. No paid route is used by default.
- Default is the local Qwen model in oMLX. The first build step is a ten-image comparison between `Qwen3.8-27B-8bit` and `gemma-4-26B-A4B-it-MLX-8bit` to confirm the choice.
- A ref can be re-tagged on demand.

## App

Nuxt, running locally.

- **Board tree** on the left, plus All refs and Unsorted. Create, rename and nest boards.
- **Grid** of the current board with a zoom control, a toggle to include sub-boards, and tag filters.
- **Brief editor** at the top of each board.
- **Ref view**: large image, general note, board note, key flag, tags, machine tags and description, source, the boards it is on, add to board, remove from board, delete.
- **Style**: Swiss and minimal. Black on white, Switzer, hairline rules, no shadows or rounded corners.

## Agent skill

One `refs` skill, kept in the app repo and shared by Claude, Codex and Muse. It covers how to find a board's generated folder, how to read `refs.yaml` (briefs first, key refs next, notes as direction), and how to add refs through the CLI. Agents never edit library files directly.

## Not in the first version

Chrome extension, video and PDF refs, hand ordering, a contact-sheet image per board, any hosted or multi-user mode, Paperclip integration.

## Build order

1. Library code and the `refs` CLI, with tests.
2. Tagger comparison, then the tagging backends.
3. Generated folders and export.
4. The Nuxt app.
5. The skill.

## Choices made in this draft

Items 1 and 2 are confirmed.

1. **The CLI works without the app running.** With one file per ref there is little to collide on, so the CLI and the app share the same library code and take a short lock when editing a board file. The alternative is a CLI that only talks to the running app.
2. **Ref ids are the content hash** (first 12 characters; for links, a hash of the URL). This is what makes duplicate detection automatic.
3. **Git.** Not chosen: one repo for the whole folder, or separate repos for `app/` and `library/`.
4. **Existing scaffold.** The files at the top level of this folder from the aborted first build are ignored. They will be cleared when the build starts, on your say-so.
