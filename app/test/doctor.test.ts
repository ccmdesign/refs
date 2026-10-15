import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath } from "../core/config.ts";
import { doctorFailed, runDoctor } from "../core/doctor.ts";
import { runSetup } from "../core/setup.ts";
import { cleanupLibrary, tempLibrary, writeLibraryConfig } from "./helpers.ts";

describe("doctor", () => {
  let lib: string;

  beforeEach(() => {
    lib = tempLibrary();
  });

  afterEach(() => {
    cleanupLibrary(lib);
  });

  it("passes core checks after setup with tagger off", async () => {
    await runSetup(lib);
    const checks = await runDoctor(lib);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId.node?.status).toBe("ok");
    expect(byId.sharp?.status).toBe("ok");
    expect(byId.library?.status).toBe("ok");
    expect(byId.config?.status).toBe("ok");
    expect(byId.output?.status).toBe("ok");
    expect(byId.tagger?.status).toBe("ok");
    expect(byId.tagger?.detail).toBe("off");
    expect(doctorFailed(checks)).toBe(false);
  });

  it("fails config on broken config.yaml", async () => {
    await runSetup(lib);
    writeFileSync(configPath(lib), "tagger: [\n", "utf8");
    const checks = await runDoctor(lib);
    const config = checks.find((c) => c.id === "config");
    expect(config?.status).toBe("fail");
    expect(doctorFailed(checks)).toBe(true);
  });

  it("fails output when links mode cannot symlink", async () => {
    await runSetup(lib);
    writeLibraryConfig(lib, { output: { mode: "links" } });
    const checks = await runDoctor(lib, {
      probeOutputMethod: () => "copy",
    });
    const output = checks.find((c) => c.id === "output");
    expect(output?.status).toBe("fail");
    expect(output?.fix).toContain("output.mode: auto");
  });

  it("warns when port is held by a non-refs server", async () => {
    await runSetup(lib);
    let server: Server | undefined;
    await new Promise<void>((resolve) => {
      server = createServer((_req, res) => {
        res.writeHead(200);
        res.end("not refs");
      });
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const checks = await runDoctor(lib, { port });
    server?.close();
    const portCheck = checks.find((c) => c.id === "port");
    expect(portCheck?.status).toBe("warn");
    expect(portCheck?.detail).toContain(String(port));
  });

  it("ok when port is held by refs api", async () => {
    await runSetup(lib);
    let server: Server | undefined;
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === "/api/boards") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ tree: [] }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server!.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const checks = await runDoctor(lib, { port });
    server?.close();
    const portCheck = checks.find((c) => c.id === "port");
    expect(portCheck?.status).toBe("ok");
    expect(portCheck?.detail).toContain("already running");
  });
});
