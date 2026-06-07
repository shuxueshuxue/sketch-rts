import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame } from "../sim";
import { CommandFrameRuntime } from "./command-frame-runtime";

describe("command frame runtime boundary", () => {
  it("keeps local and hosted adapters from re-owning frame validation application or stepping", () => {
    const adapterFiles = ["src/client/net/local-adapter.ts", "src/server/room-host.ts"];
    const forbidden = ["commandValidationError", "commandWithCurrentIssuers", "applyCommandFrame", "stepGame", "planPresetAiRuntimeCommands"];
    const offenders = adapterFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps deployment runtimes from owning raw gameplay frame application", () => {
    const deploymentFiles = ["src/client/deployment/static-runtime.ts", "src/client/deployment/server-runtime.ts"];
    const forbidden = ["new CommandFrameRuntime", "applyCommandFrame", "stepGame", "issuePlayerCommand", "commandValidationError"];
    const offenders = deploymentFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps hosted room tick entry points behind one hosted frame tick primitive", () => {
    const source = readFileSync("src/server/room-host.ts", "utf8");
    const directRuntimeTicks = source.match(/frameRuntime\.tick\(/g) ?? [];

    expect(directRuntimeTicks).toHaveLength(1);
    expect(source).toContain("advanceHostedRoomTick");
  });

  it("keeps offline SDK command frames on the shared runtime instead of a second apply path", () => {
    const source = readFileSync("src/sdk/commands/frame.ts", "utf8");
    const forbidden = ["commandValidationError", "applyCommandFrame"];
    const offenders = forbidden.filter((needle) => source.includes(needle));

    expect(offenders).toEqual([]);
    expect(source).toContain("CommandFrameRuntime");
  });

  it("keeps command collision normalization owned by the shared frame runtime", () => {
    const runtimeSource = readFileSync("src/shared/sim/command-frame-runtime.ts", "utf8");
    const sdkSource = readFileSync("src/sdk/commands/frame.ts", "utf8");
    const aiSource = readFileSync("src/ai/runtime.ts", "utf8");
    const forbiddenOutsideRuntime = ["selectIssueableCommandEntries", "hiredCampIds", "pickedItemIds"];
    const offenders = [
      ...forbiddenOutsideRuntime.filter((needle) => sdkSource.includes(needle)).map((needle) => `src/sdk/commands/frame.ts: ${needle}`),
      ...forbiddenOutsideRuntime.filter((needle) => aiSource.includes(needle)).map((needle) => `src/ai/runtime.ts: ${needle}`),
    ];

    expect(runtimeSource).toContain("normalizeCommandFrameEntries");
    expect(sdkSource).toContain("normalizeCommandFrameEntries");
    expect(aiSource).toContain("normalizeCommandFrameEntries");
    expect(offenders).toEqual([]);
  });

  it("keeps offline SDK and AI diagnostic runners from owning raw apply or step loops", () => {
    const runnerFiles = ["src/sdk/game-runner.ts", "src/sdk/playtest.ts", "src/ai/playtest.ts", "src/ai/ab-test.ts", "scripts/ai-matrix.ts"];
    const forbidden = ["stepGame", "issuePlayerCommand", "applyCommandFrame", "runPresetAiRuntime"];
    const offenders = runnerFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps debug replay on the shared command-frame cadence primitive", () => {
    const source = readFileSync("src/shared/replay.ts", "utf8");
    const forbidden = ["applyCommandFrame", "stepGame"];
    const offenders = forbidden.filter((needle) => source.includes(needle));

    expect(offenders).toEqual([]);
    expect(source).toContain("advanceCommandFrameTick");
  });

  it("keeps lockstep rendering on the engine frame-advance primitive", () => {
    const source = readFileSync("src/client/net/lockstep-client.ts", "utf8");
    const forbidden = ["engine.applyFrame", "engine.step"];
    const offenders = forbidden.filter((needle) => source.includes(needle));

    expect(offenders).toEqual([]);
    expect(source).toContain("engine.advanceFrame");
  });

  it("keeps gameplay command legality out of the frame apply layer", () => {
    const source = readFileSync("src/shared/sim/frame.ts", "utf8");
    const forbidden = ["../catalog", "../build-placement", "canSpendGold", "canSupply", "hasFriendlyUnitAtCamp", "RACE_DEFS", "BUILDING_DEFS", "UNIT_DEFS", "UPGRADE_DEFS"];
    const offenders = forbidden.filter((needle) => source.includes(needle));

    expect(offenders).toEqual([]);
  });

  it("keeps live-issuer normalization from re-owning gameplay legality", () => {
    const source = readFileSync("src/shared/sim/command-validation.ts", "utf8");
    const start = source.indexOf("export function narrowFrameCommandToLiveOperands");
    const end = source.indexOf("function missingUnitError");
    const normalizer = start >= 0 && end > start ? source.slice(start, end) : source;
    const forbidden = ["buildingPlacementBlocker", "canSpendGold", "canSupply", "hasFriendlyUnitAtCamp", "maxUpgradeLevel", "BUILDING_DEFS", "RACE_DEFS", "UNIT_DEFS", "UPGRADE_DEFS"];
    const offenders = forbidden.filter((needle) => normalizer.includes(needle));

    expect(start).toBeGreaterThanOrEqual(0);
    expect(offenders).toEqual([]);
  });

  it("rejects illegal live commands through shared runtime admission", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(worker).toBeDefined();
    expect(townHall).toBeDefined();
    const runtime = new CommandFrameRuntime({ game, roomId: "runtime-admission", rejectionLabel: "Runtime command rejected" });

    expect(() => runtime.admit([{ playerId: "player", command: { type: "build", unitId: worker!.id, buildingKind: "farm", x: townHall!.x + 10, y: townHall!.y } }])).toThrow(/Runtime command rejected: farm placement is too close to townHall/);
  });

  it("treats stale issuers as shared runtime no-ops instead of boundary errors", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const runtime = new CommandFrameRuntime({ game, roomId: "runtime-stale", rejectionLabel: "Runtime command rejected" });

    expect(() => runtime.completeAndApply([{ playerId: "player", command: { type: "move", unitIds: ["unit-player-already-gone"], x: 900, y: 900 } }], { includeAi: false })).not.toThrow();
    expect(game.tick).toBe(0);
  });

  it("normalizes collisions across player commands and AI planner commands before framing", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    game.mercenaryCamps = [{ id: "mixed-source-camp", x: worker!.x, y: worker!.y, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 90, cooldownRemaining: 0 }];
    const runtime = new CommandFrameRuntime({
      game,
      roomId: "runtime-mixed-source",
      rejectionLabel: "Runtime command rejected",
      aiPlanner: {
        checkpoint: () => undefined,
        restore: () => {},
        plan: () => [{ playerId: "player", command: { type: "hire", campId: "mixed-source-camp" } }],
      },
    });

    const frame = runtime.completeAndApply([{ playerId: "player", command: { type: "hire", campId: "mixed-source-camp" } }]);

    expect(frame?.commands).toEqual([{ playerId: "player", command: { type: "hire", campId: "mixed-source-camp" } }]);
    expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "mercenary")).toHaveLength(1);
  });
});
