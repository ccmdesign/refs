# Plan: make _refs run on any computer

Status: built 2026-10-15 (commits d31d8e8 to the AGENTS.md commit).

Decisions:
- Tagging is off until set up; `refs setup` detects and suggests, it never turns a tagger on by itself.
- Clone and run only; no npm package yet.
- Adapters are the built-ins plus a local file path; no npm plugins.
- Built step by step with Cursor, each step reviewed, tested and committed separately.

## Goal

Someone clones the repository on macOS, Linux or Windows, runs one install and one setup command (or asks their coding agent to), and has a working library in the browser. Tagging with a vision model is optional and plugs in through an adapter; nothing in the code assumes a particular server, model or machine.

## What stands in the way today

| Problem | Where | Effect on a fresh machine |
|---|---|---|
| Tagging defaults to oMLX at `127.0.0.1:9999` with the model `Qwen3.8-27B-8bit`, and reads `~/.omlx/settings.json` | `app/core/tagger.ts`, `app/core/tagger/backends.ts` | Every add starts a background worker that fails, and the app shows refs stuck in "tagging" |
| Backends are a hard-coded `if` chain (omlx, claude, codex) | `resolveTagModelFn` | Adding Ollama, LM Studio or a hosted API means editing core code |
| Configuration only through environment variables | `REFS_*`, `OMLX_*` | No place to see or change settings; agents have to edit shell profiles |
| Board folders under `out/` are symlinks | `app/core/output.ts` | Fails on Windows without Developer Mode or admin rights |
| No first-run or health check | — | When something is missing, the only signal is a failure somewhere else |
| Agent skill installed by copying a file by hand | `app/skills/refs/SKILL.md` | Every user does it differently |
| CI runs only on Linux | `.github/workflows/ci.yml` | macOS and Windows breakage goes unnoticed |

Things that are already portable and stay as they are: Node 22.18+ with native TypeScript, `sharp` (it ships prebuilt binaries for all three systems), the library format, and the content-hash storage.

## Proposal

### 1. Tagger adapters

One small interface, and every backend implements it:

```ts
type TaggerAdapter = {
  id: string;                         // "openai-compatible", "claude-cli", ...
  check(): Promise<{ ok: boolean; detail: string }>;   // reachable? model present?
  describe(input: { prompt: string; image: Buffer; mime: string }): Promise<string>;
};
```

Built-in adapters:

- **`none`**: the default when nothing is configured. Adds never start a worker.
- **`openai-compatible`**: any server that speaks `/v1/chat/completions` with images. This covers oMLX, Ollama, LM Studio, llama.cpp, vLLM, OpenRouter and OpenAI. Settings: `base_url`, `model`, `api_key_env` (the *name* of an environment variable, never the key itself). It ships with presets, so a config can say `preset: ollama` instead of a URL.
- **`claude-cli`** and **`codex-cli`**: the existing command-line backends, moved behind the interface. They clear API-key variables so the user's subscription is used.

Third-party adapters: `adapter: ./path/to/my-adapter.ts` loads a local module that exports a `TaggerAdapter`. No package registry, no plugin discovery. That keeps the surface small until someone actually needs more.

The prompt, the JSON parsing and the vocabulary stay in core, so every adapter returns the same tags.

### 2. One config file, in the library

`library/config.yaml`, created by setup:

```yaml
tagger:
  adapter: openai-compatible
  preset: ollama            # or base_url: http://127.0.0.1:9999/v1
  model: qwen2.5vl:7b
  api_key_env: OLLAMA_API_KEY   # optional
output:
  mode: auto                # links | copies | auto
server:
  port: 3210
```

Environment variables still override the file (`REFS_TAGGER`, `REFS_TAGGER_MODEL`, `REFS_LIBRARY`, `REFS_PORT`), so current setups keep working. Keys never go in the file.

The config lives in the library, not the repo, because it describes that library and should survive a fresh clone of the code.

### 3. Output that works on Windows

`output.mode`:

- **`links`**: today's behaviour, relative symlinks.
- **`copies`**: real files, like `refs export`.
- **`auto`** (the default): try a symlink, then a hard link, then a copy, and remember what worked. Hard links need no special rights on Windows as long as the library is on one drive.

### 4. `refs setup` and `refs doctor`

Both run without prompts, so an agent can drive them, and both accept `--json`.

- **`refs setup`** creates the library and `config.yaml` if missing, then looks for a tagger without changing anything:
  - it probes the usual local ports (Ollama 11434, LM Studio 1234, oMLX 9999) and lists models that accept images;
  - it checks whether `claude` or `codex` are on the PATH.

  It writes `adapter: none` and prints what it found and the line to enable each option. With `--tagger <preset> --model <name>` it writes that choice instead.
- **`refs doctor`** checks:
  - the Node version;
  - that `sharp` loads;
  - that the library is writable;
  - that the output mode works;
  - that the configured tagger answers;
  - that the port is free.

  Each check is reported as ok, warn or fail, with the fix for each failure.

### 5. Made for coding agents

- **`AGENTS.md`** at the repo root gives the exact setup steps an agent should run:
  1. check Node;
  2. `pnpm install`;
  3. `pnpm refs setup`;
  4. `pnpm refs doctor`;
  5. `pnpm dev`.

  It also says what to ask the user (which tagger, if any) and what never to do (put keys in files).
- **`refs skill install [--to <dir>]`** copies the agent skill into a skills folder. `--claude` and `--codex` use the standard locations.
- The README's quick start becomes three commands. A "Set it up with your agent" section gives the one sentence to paste.

### 6. Prove it on all three systems

The CI matrix grows to Ubuntu, macOS and Windows on Node 22 and 24. One new end-to-end test runs `setup`, `add`, `doctor` and `rebuild` on a temporary library with `adapter: none`. The adapter contract gets tests against a fake OpenAI-compatible server.

## Order of work

1. Adapter interface, the `none` and `openai-compatible` adapters, the CLI adapters moved over, and `none` as the default. *Fixes the fresh-machine failure on its own.*
2. `config.yaml` with environment-variable overrides.
3. Output modes with the `auto` fallback.
4. `refs setup`, `refs doctor`, `refs skill install`.
5. `AGENTS.md`, the README rewrite, the CI matrix and the end-to-end test.

Each step is a separate commit and leaves the app working. Your own setup keeps working throughout: step 2 reads your existing environment variables, and `setup` will detect your oMLX server.

## Not in this plan

- Publishing to npm (`npx @ccmdesign/refs`). It is possible later; clone-and-run comes first.
- A hosted or multi-user mode.
- Adapters for anything other than tagging (storage, intake). The Chrome extension will be a client of the existing HTTP API, not an adapter.
