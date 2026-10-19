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

## Video refs (added 2026-10-19)

Requested by Claudio: "create the spec and implement a quick feature to allow videos as refs". Kept small.

**What counts.** `.mp4`, `.webm`, `.mov` and `.m4v` files, up to 200 MB each (`REFS_MAX_VIDEO_MB` changes the cap). Anything larger is refused with a message giving both sizes. YouTube or Vimeo pages stay link refs; audio and PDF are out of scope.

**Intake.** The same three ways in as images: drop or paste in the app, `refs add <file|url>`, or an agent using the CLI. A URL whose content type is `video/*` is downloaded and stored. Videos are stored once, named by content hash, so adding the same file twice adds the existing ref to the board.

**Ref file.** A video ref is an image ref with three extra fields:

```yaml
id: 9c2e4f1a7b30
kind: video                          # absent on images and links
file: files/9c/9c2e4f1a7b30.mp4
poster: files/9c/9c2e4f1a7b30.poster.jpg   # one frame, when ffmpeg is available
duration: 12.4                       # seconds
width: 1920
height: 1080
```

**Poster frame.** ffmpeg and ffprobe are optional. When they are on the PATH (or named by `REFS_FFMPEG` and `REFS_FFPROBE`), intake reads the size and duration and saves one frame, about a second in, as a JPEG next to the video. Without them the video is still stored and plays; the grid shows its first frame through the browser, and it is not tagged. A poster that is missing is made the next time it is asked for, so installing ffmpeg later fixes old refs. `refs doctor` reports ffmpeg as a warning, never a failure.

**Grid and popover.** A video tile shows the poster with a small duration badge. On hover it plays muted and looped, unless the visitor prefers reduced motion. The popover plays the video with controls. The file route answers HTTP range requests so the browser can seek.

**Tagging.** The tagger is given the poster frame and told it is a frame from a video. No new model calls: one frame per video, through whatever tagger is configured, and none when tagging is off or there is no poster.

**Output for agents.** The board folder gets the video file and, beside it, its poster (`<name>.poster.jpg`). `refs.yaml` marks the entry so an agent knows what it is reading:

```yaml
  - id: 9c2e4f1a7b30
    type: video
    file: hover-study-9c2e4f.mp4
    poster: hover-study-9c2e4f.poster.jpg
    duration: 12.4
```

Agents that cannot watch video read the poster, the notes and the description.

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

Chrome extension, PDF refs, hand ordering, a contact-sheet image per board, any hosted or multi-user mode, Paperclip integration.

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
