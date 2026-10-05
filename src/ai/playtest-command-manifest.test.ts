import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AI_PLAYTEST_COMMAND_MANIFEST, commandFromPlaytestArgs } from "./playtest-command-manifest";

describe("AI playtest command manifest", () => {
  it("is importable as the same command contract printed by the CLI", () => {
    const cliManifest = JSON.parse(execFileSync("npx", ["tsx", "scripts/ai-playtest.ts", "commands"], { encoding: "utf8" }));
    const importableManifest = AI_PLAYTEST_COMMAND_MANIFEST.map(({ buildCommand: _buildCommand, ...command }) => command);

    expect(cliManifest).toEqual({ version: 1, commands: importableManifest });
  });

  it("builds tactical playtest commands without importing the executable script", () => {
    expect(commandFromPlaytestArgs("focus-near", ["--file", "ignored.json", "--units", "combat", "--target", "enemy-footman", "--join-range", "95"])).toEqual({
      type: "focusFireNear",
      unitIds: "combat",
      targetId: "enemy-footman",
      joinRange: 95,
    });
    expect(commandFromPlaytestArgs("retreat-wounded", ["--file", "ignored.json", "--units", "u1,u2", "--hp-ratio", "0.42", "--x", "500", "--y", "600"])).toEqual({
      type: "retreatWounded",
      unitIds: ["u1", "u2"],
      hpRatio: 0.42,
      x: 500,
      y: 600,
    });
  });
});
