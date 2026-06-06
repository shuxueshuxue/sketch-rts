import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("simulation command contract", () => {
  it("keeps map lifecycle commands out of gameplay command surfaces", () => {
    const lifecycleCommand = "start" + "Map";
    const commandSurfaceFiles = [
      "src/shared/types.ts",
      "src/shared/sim.ts",
      "src/shared/sim/frame.ts",
      "src/shared/sim/command-validation.ts",
      "src/server/index.ts",
      "src/sdk/client.test.ts",
      "scripts/sdk-smoke.ts",
    ];

    const offenders = commandSurfaceFiles.filter((file) => readFileSync(file, "utf8").includes(lifecycleCommand));

    expect(offenders).toEqual([]);
  });
});
