import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("room tick failure isolation", () => {
  it.each(["auto", "connected", "api"])("keeps the process and healthy room running after a worker failure (%s)", async mode => {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", "src/server/fixtures/room-tick-failure.ts", mode], {
      cwd: process.cwd(), timeout: 20_000,
    });
    expect(JSON.parse(stdout.trim())).toMatchObject({ mode, healthyTick: 20, resetTick: 1 });
    // Full original worker stack and the client rethrow site, once only; not just a generic timer error.
    expect(stderr).toContain("Room broken failed at tick");
    expect(stderr).toContain("at injectedPlanner (fixture:1:1)");
    expect(stderr).toContain("think-worker/client.ts");
    expect(stderr.match(/Room broken failed at tick/g)).toHaveLength(1);
  }, 25_000);
});
