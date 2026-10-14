import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type TagModelInput = {
  prompt: string;
  jpegPath: string;
  model: string;
};

export type TagModelFn = (input: TagModelInput) => Promise<string>;

function readOmlxApiKey(): string | undefined {
  const fromEnv = process.env.OMLX_API_KEY;
  if (fromEnv) return fromEnv;
  try {
    const path = join(homedir(), ".omlx", "settings.json");
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      auth?: { api_key?: string };
    };
    const key = raw.auth?.api_key;
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

export async function callOmlxModel(input: TagModelInput): Promise<string> {
  const base = (process.env.OMLX_BASE_URL ?? "http://127.0.0.1:9999/v1").replace(/\/$/, "");
  const apiKey = readOmlxApiKey();
  const jpeg = await readFile(input.jpegPath);
  const b64 = jpeg.toString("base64");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.model,
      temperature: 0.2,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`oMLX request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | Array<{ type?: string; text?: string }> } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("\n");
  }
  throw new Error("oMLX response had no message content");
}

function spawnCollect(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
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

export async function callClaudeModel(input: TagModelInput): Promise<string> {
  const prompt = `${input.prompt}\n\nRead the image at this absolute path: ${input.jpegPath}`;
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return spawnCollect("claude", ["-p", prompt, "--allowedTools", "Read"], env);
}

export async function callCodexModel(input: TagModelInput): Promise<string> {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  return spawnCollect(
    "codex",
    ["exec", "--skip-git-repo-check", "-i", input.jpegPath, input.prompt],
    env,
  );
}

export function resolveTagModelFn(mode: string): TagModelFn {
  if (mode === "claude") return callClaudeModel;
  if (mode === "codex") return callCodexModel;
  return callOmlxModel;
}
