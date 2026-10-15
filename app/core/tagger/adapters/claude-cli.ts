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

export function createClaudeCliAdapter(cfg: TaggerConfig): TaggerAdapter {
  return {
    id: "claude-cli",
    async check() {
      try {
        const text = await spawnCollect("claude", ["--version"], process.env);
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
      const prompt = `${input.prompt}\n\nRead the image at this absolute path: ${input.imagePath}`;
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      const args = ["-p", prompt, "--allowedTools", "Read"];
      const model = input.model ?? cfg.model;
      if (model) args.push("--model", model);
      return spawnCollect("claude", args, env);
    },
  };
}
