# Set up _refs

Run these steps from the repository root unless noted.

1. Check Node is 22.18 or newer: `node -v`. If it is older, stop and tell the user to install a current Node from [nodejs.org](https://nodejs.org). Do not install Node yourself.

2. Run `corepack enable` so the pnpm version pinned in `app/package.json` is used. If corepack is missing or not permitted, the fallback is `npm install -g pnpm` — only with the user's agreement.

3. `cd app && pnpm install`

4. `pnpm refs setup --json`. Read `detected` in the output. Ask the user one question: which tagger, if any. Offer every reachable option from `detected` plus **no tagging**. Tagging is optional and runs a vision model on images. Never choose a hosted, paid option (OpenRouter, OpenAI, and similar) unless the user explicitly asks for it.

5. If they picked a tagger: `pnpm refs setup --tagger <name> --model <model>`. For hosted APIs, add `--api-key-env <NAME>` and tell the user to export that variable in their own shell. Never write an API key into a file, and never ask the user to paste a key into the chat.

6. `pnpm refs doctor --json`. Fix every check with status `fail` using its `fix` text, then run doctor again. Report every `warn` to the user.

7. `pnpm dev`, then open `http://localhost:3210` (or the port in `REFS_PORT`).

8. Optional — ask first: `pnpm refs skill install --claude` (or `--codex`, or `--to <dir>`). Give the user the `REFS_HOME` line the command printed.

## Working on the code

- Layout and conventions: [CONTRIBUTING.md](CONTRIBUTING.md)
- Before claiming done: `pnpm typecheck && pnpm test` (from `app/`)
- Never commit `library/`
- Keep `core/` free of Nuxt imports

## Using a library

See [app/skills/refs/SKILL.md](app/skills/refs/SKILL.md) for how agents read a board folder.
