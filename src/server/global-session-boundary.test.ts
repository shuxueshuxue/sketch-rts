import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("server global session boundary", () => {
  it("does not expose a second global gameplay session beside room lockstep", () => {
    const source = readFileSync("src/server/index.ts", "utf8");
    const forbidden = [
      "sessionWss",
      "sessionAutoTick",
      "sessionFrameSequence",
      "runSessionCommand",
      "broadcastSnapshot",
      '"/api/snapshot"',
      '"/api/reset"',
      '"/api/command"',
      '"/api/tick"',
      "runPresetAiRuntime(game",
    ];

    const offenders = forbidden.filter((needle) => source.includes(needle));

    expect(offenders).toEqual([]);
  });

  it("fails unknown API routes before the Vite SPA middleware can serve them", () => {
    const source = readFileSync("src/server/index.ts", "utf8");
    const apiBoundary = source.indexOf('app.use("/api"');
    const productionFallback = source.indexOf('app.get("*"');
    const viteMiddleware = source.indexOf("app.use(vite.middlewares)");

    expect(apiBoundary).toBeGreaterThan(0);
    expect(source).toContain("Unknown API route");
    expect(productionFallback).toBeGreaterThan(apiBoundary);
    expect(viteMiddleware).toBeGreaterThan(apiBoundary);
  });

  it("keeps save and debug replay payload validation owned by the shared savegame schema", () => {
    const source = readFileSync("src/server/index.ts", "utf8");

    expect(source).toContain('import { parseSaveGameInput } from "../shared/savegame"');
    expect(source).not.toContain("function parseSaveInput");
  });
});
