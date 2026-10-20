---
name: refs
description: Use a _refs design reference library. Read a board of visual references (images, notes, tags, briefs) before starting a design, or add new references to a board. Use when asked to "use the refs", "check the branding refs", "pull references for X", "add this to the refs", "save this as a reference", or when starting visual design work that has a board.
---

# _refs: the design reference library

A local library of design references. People curate it in a web app; agents read boards from it and add to it through a CLI.

- Repository: `$REFS_HOME` (the folder holding `app/` and `library/`). If the variable is not set, ask the user where their _refs checkout is.
- Library: `$REFS_LIBRARY` if set, otherwise `$REFS_HOME/library`.
- CLI: `node "$REFS_HOME/app/bin/refs.ts" <command>`, called `refs` below. It works whether or not the app is running.

A **ref** is one image, one video or one link, with a general note and tags. A **board** is a named collection of refs with a brief; boards nest (`acme-rebrand/editorial-grid`). One ref can sit on several boards, with a separate note on each.

## Reading a board

1. List boards: `refs boards`.
2. Get the board's folder: `refs path <board>`. It contains the images and one `refs.yaml`.
3. Read `refs.yaml` first, in this order:
   - `parent_briefs`: constraints from the boards above this one. They apply.
   - `brief`: what this board is for, what to take from it and what to ignore.
   - `refs`: key refs come first (`key: true`). These matter most.
4. Look at the images themselves, starting with the key refs. Each ref has:
   - `note`: what is true of this ref in general.
   - `board_note`: what to take from it for this board. This outranks `note`.
   - `tags` (set by a person) and `machine_tags` plus `description` (set by a model; treat as hints).
   - `source` or `url`: where it came from.
   - `type: video` on a video ref. Its `file` is the video; `poster` is one frame of it as a JPEG, and `duration` is in seconds. If you cannot watch video, look at the poster and read the notes; say so rather than guessing at the motion.

Treat notes as direction. A ref is there for the reason its note gives, not as something to copy whole. If a board note says "grid only, ignore colour", ignore the colour.

Refs are other people's work. Use them to understand a direction; do not reproduce one.

Refs on sub-boards and parent boards are not included in a board's folder. Read those boards too if you need them.

To work somewhere that cannot follow links into the library (a sandbox, another repo), copy the board out: `refs export <board> --to <dir>`.

## Adding refs

```
refs add <file|url>... --board <board> [--note <text>] [--board-note <text>] [--key] [--tags a,b] [--source <url>] [--title <text>]
```

- Always give `--source` when the image came from a web page: the page URL, not the image URL.
- Write a `--board-note` saying what is worth taking from the ref for this board. A ref with no note is of little use to the next agent.
- Videos (`.mp4`, `.webm`, `.mov`, `.m4v`, up to 200 MB) are added the same way as images.
- Adding a file that is already in the library puts the existing ref on the board; nothing is stored twice.
- A URL that is not an image becomes a link-only ref.
- Machine tags are added in the background after the add. Do not wait for them.
- Use `--key` sparingly. Do not mark refs as key unless asked to.

Other commands: `refs board create <board>`, `refs board brief <board> <text>`, `refs move <id> --from <board> --to <board>`, `refs rm <id> --board <board>` (off one board), `refs show <board>` (print the board's `refs.yaml`). Add `--json` for machine output.

## Rules

- Never edit files in the library by hand. Use the CLI. Folders under `out/` are generated and are overwritten.
- Do not delete refs or boards (`refs delete`, `refs board rm`) unless the user asks for that specific deletion.
- Create new boards only when asked, or when the user names a board that does not exist yet.
