import { spawn } from "node:child_process";
import type { TaggerConfig } from "../../config.ts";
import type { TaggerAdapter } from "./types.ts";

function spawnCollect(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function createCodexCliAdapter(cfg: TaggerConfig): TaggerAdapter {
  return {
    id: "codex-cli",
    async check() {
      try {
        const text = await spawnCollect("codex", ["--version"], process.env);
        return { ok: true, detail: text.trim() };
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (code === "ENOENT") {
          return { ok: false, detail: "not found on PATH" };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, detail: msg };
      }
    },
    async describe(input) {
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      const args = ["exec", "--skip-git-repo-check", "-i", input.imagePath, input.prompt];
      const model = input.model ?? cfg.model;
      if (model) args.push("--model", model);
      return spawnCollect("codex", args, env);
    },
  };
}
