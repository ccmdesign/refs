import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appDir } from "./paths.ts";

export type InstallSkillOpts = {
  to?: string[];
  claude?: boolean;
  codex?: boolean;
  force?: boolean;
  homedir?: string;
};

export type InstallResult = {
  target: string;
  result: "installed" | "unchanged" | "exists" | "updated";
};

export function refsRepoRoot(): string {
  return resolve(appDir(), "..");
}

export function refsHomeEnvLine(): string {
  const root = refsRepoRoot();
  if (process.platform === "win32") {
    return `$env:REFS_HOME = "${root}"`;
  }
  return `export REFS_HOME="${root}"`;
}

function skillSourcePath(): string {
  return join(appDir(), "skills", "refs", "SKILL.md");
}

function resolveTargets(opts: InstallSkillOpts): string[] {
  const home = opts.homedir ?? osHomedir();
  const targets: string[] = [];
  if (opts.to) {
    for (const dir of opts.to) {
      targets.push(join(resolve(dir), "refs", "SKILL.md"));
    }
  }
  if (opts.claude) {
    targets.push(join(home, ".claude", "skills", "refs", "SKILL.md"));
  }
  if (opts.codex) {
    targets.push(join(home, ".codex", "skills", "refs", "SKILL.md"));
  }
  return targets;
}

export function installSkill(opts: InstallSkillOpts): InstallResult[] {
  const targets = resolveTargets(opts);
  if (targets.length === 0) {
    throw new Error(
      "refs skill install [--to <dir>] [--claude] [--codex] [--force]",
    );
  }

  const source = readFileSync(skillSourcePath(), "utf8");
  const results: InstallResult[] = [];

  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    let result: InstallResult["result"];
    if (!existsSync(target)) {
      writeFileSync(target, source, "utf8");
      result = "installed";
    } else {
      const existing = readFileSync(target, "utf8");
      if (existing === source) {
        result = "unchanged";
      } else if (opts.force) {
        writeFileSync(target, source, "utf8");
        result = "updated";
      } else {
        result = "exists";
      }
    }
    results.push({ target, result });
  }

  return results;
}
