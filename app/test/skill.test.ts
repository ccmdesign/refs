import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appDir } from "../core/paths.ts";
import { installSkill } from "../core/skill.ts";

describe("skill install", () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const t of temps) {
      rmSync(t, { recursive: true, force: true });
    }
    temps.length = 0;
  });

  function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "refs-skill-home-"));
    temps.push(dir);
    return dir;
  }

  it("installs into a temp dir", () => {
    const dest = mkdtempSync(join(tmpdir(), "refs-skill-to-"));
    temps.push(dest);
    const [r] = installSkill({ to: [dest] });
    expect(r.result).toBe("installed");
    const path = join(dest, "refs", "SKILL.md");
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(join(appDir(), "skills", "refs", "SKILL.md"), "utf8");
    expect(readFileSync(path, "utf8")).toBe(source);
  });

  it("reports unchanged, exists, then updated with force", () => {
    const dest = mkdtempSync(join(tmpdir(), "refs-skill-cycle-"));
    temps.push(dest);
    const first = installSkill({ to: [dest] });
    expect(first[0]?.result).toBe("installed");
    const second = installSkill({ to: [dest] });
    expect(second[0]?.result).toBe("unchanged");
    const path = join(dest, "refs", "SKILL.md");
    writeFileSync(path, "different\n", "utf8");
    const third = installSkill({ to: [dest] });
    expect(third[0]?.result).toBe("exists");
    const fourth = installSkill({ to: [dest], force: true });
    expect(fourth[0]?.result).toBe("updated");
    const source = readFileSync(join(appDir(), "skills", "refs", "SKILL.md"), "utf8");
    expect(readFileSync(path, "utf8")).toBe(source);
  });

  it("writes under .claude/skills/refs with home override", () => {
    const home = tempHome();
    const [r] = installSkill({ claude: true, homedir: home });
    expect(r.result).toBe("installed");
    expect(existsSync(join(home, ".claude", "skills", "refs", "SKILL.md"))).toBe(true);
  });
});
