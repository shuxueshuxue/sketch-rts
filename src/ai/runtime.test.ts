import { describe, expect, it } from "vitest";
import { createBuilding } from "../shared/map";
import { createGame, snapshotGame, stepGame } from "../shared/sim";
import { DEFAULT_AI_THINK_INTERVAL, createAiRuntime, issueAiCommandFrame, planPresetAiRuntimeCommands, runPresetAiRuntime } from "./runtime";
import type { AiPolicyMemory, AiScript } from "./policy";
import { sketchScene } from "../sdk/scene";

describe("shared AI runtime", () => {
  it("uses one shared fast-enough default think interval for every runtime caller", () => {
    const runtime = createAiRuntime(["player", "enemy"]);

    expect(DEFAULT_AI_THINK_INTERVAL).toBe(15);
    expect(runtime.thinkInterval).toBe(DEFAULT_AI_THINK_INTERVAL);
  });

  it("keeps simulation ticks free of AI decisions", () => {
    const game = createGame("bareDuel", { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } });

    for (let i = 0; i < 180; i += 1) stepGame(game);

    expect(game.match.stats.goldSpent.player).toBe(0);
    expect(game.match.stats.goldSpent.enemy).toBe(0);
    expect(game.units.every((unit) => unit.order.type === "idle")).toBe(true);
    expect(game.buildings).toHaveLength(2);
  });

  it("drives the old AI capabilities through reusable policy commands above the sim", () => {
    const game = createGame("bareDuel", { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } });
    const runtime = createAiRuntime(["player", "enemy"]);
    let issuedCommands = 0;

    for (let i = 0; i < 1200; i += 1) {
      issuedCommands += runPresetAiRuntime(game, runtime).commands.length;
      stepGame(game);
    }

    const snapshot = snapshotGame(game);
    expect(issuedCommands).toBeGreaterThan(20);
    expect(snapshot.match.stats.goldSpent.player).toBeGreaterThan(0);
    expect(snapshot.match.stats.goldSpent.enemy).toBeGreaterThan(0);
    expect(snapshot.buildings.some((building) => building.owner === "player" && building.kind === "barracks")).toBe(true);
    expect(snapshot.buildings.some((building) => building.owner === "enemy" && building.kind === "barracks")).toBe(true);
    expect(snapshot.units.some((unit) => unit.owner === "player" && unit.kind !== "worker")).toBe(true);
    expect(snapshot.units.some((unit) => unit.owner === "enemy" && unit.kind !== "worker")).toBe(true);
  });

  it("lets one runtime select AI script versions per controlled player", () => {
    const game = createGame("bareDuel", { aiPlayers: ["player", "enemy"] });
    const runtime = createAiRuntime(["player", "enemy"], { versions: { player: "v2", enemy: "v1" } });

    const result = runPresetAiRuntime(game, runtime);

    expect(runtime.versions.player).toBe("v2");
    expect(runtime.versions.enemy).toBe("v1");
    expect(result.commands.some((entry) => entry.playerId === "player" && entry.command.type === "mine")).toBe(true);
    expect(result.commands.some((entry) => entry.playerId === "enemy" && entry.command.type === "mine")).toBe(true);
  });

  it("lets one runtime select AI script ids per controlled player", () => {
    const game = sketchScene("runtime-per-player-script-ids")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north", race: "grove" })
      .player("enemy", { team: "south", race: "grove" })
      .townHall("player", 500, 500)
      .worker("player", 450, 500)
      .unit("player", "footman", 760, 520)
      .unit("player", "footman", 790, 550)
      .unit("player", "lancer", 820, 580)
      .unit("player", "archer", 850, 610)
      .unit("player", "archer", 880, 640)
      .townHall("enemy", 1350, 520)
      .worker("enemy", 1300, 520)
      .goldMine("player-main", 420, 520, 3000)
      .goldMine("enemy-main", 1260, 520, 3000)
      .build()
      .createGame();
    const runtime = createAiRuntime(["player", "enemy"], {
      thinkInterval: 1,
      versions: { player: "v2", enemy: "v1" },
      scriptIdsByPlayer: { player: ["attackWave"], enemy: ["economy"] },
    } as never);

    const result = runPresetAiRuntime(game, runtime);

    expect(result.commands.find((entry) => entry.playerId === "player")?.scriptId).toBe("attackWave");
    expect(result.commands.some((entry) => entry.playerId === "player" && entry.command.type === "mine")).toBe(false);
    expect(result.commands.find((entry) => entry.playerId === "enemy")).toMatchObject({ scriptId: "economy", command: { type: "mine" } });
  });

  it("passes disabled behaviors per controlled player", () => {
    const game = createGame("bareDuel", { aiPlayers: [], players: ["player", "enemy"] });
    const scripts: AiScript[] = [
      {
        id: "disabled-behavior-probe",
        phase: "economy",
        run(snapshot, owner, options) {
          if (options.disabledBehaviors?.includes("workerHarassment")) return undefined;
          const worker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
          return worker ? { type: "mine", unitIds: [worker.id], resourceId: `gold-${owner}-main` } : undefined;
        },
      },
    ];
    const runtime = createAiRuntime(["player", "enemy"], {
      scripts,
      disabledBehaviorsByPlayer: { player: ["workerHarassment"] },
    });

    const result = runPresetAiRuntime(game, runtime);

    expect(result.commands.map((entry) => entry.playerId)).toEqual(["enemy"]);
    expect(result.commands[0]).toMatchObject({ scriptId: "disabled-behavior-probe", command: { type: "mine" } });
  });

  it("can plan due runtime commands without mutating the simulation", () => {
    const game = createGame("bareDuel", { aiPlayers: ["player"], races: { player: "grove", enemy: "ember" } });
    const runtime = createAiRuntime(["player"]);
    const before = snapshotGame(game);

    const result = planPresetAiRuntimeCommands(game, runtime);

    expect(result.commands.length).toBeGreaterThan(0);
    expect(snapshotGame(game)).toEqual(before);
  });

  it("plans every controlled player from the same frame before applying commands", () => {
    const game = createGame("bareDuel", { aiPlayers: ["player", "enemy"] });
    game.players.player.gold = 5000;

    const scripts: AiScript[] = [
      {
        id: "shared-frame-probe",
        phase: "economy",
        run(snapshot, owner) {
          if (owner === "player") {
            const worker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
            if (!worker) return undefined;
            return { type: "build", unitId: worker.id, buildingKind: "farm", x: worker.x + 80, y: worker.y };
          }

          const enemyWorker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
          const sawFarmBuiltThisThink = snapshot.buildings.some((building) => building.owner === "player" && building.kind === "farm" && !building.complete);
          return enemyWorker && sawFarmBuiltThisThink ? { type: "move", unitIds: [enemyWorker.id], x: 1234, y: 1234 } : undefined;
        },
      },
    ];
    const runtime = createAiRuntime(["player", "enemy"], { scripts });

    const result = runPresetAiRuntime(game, runtime);

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]?.playerId).toBe("player");
    expect(game.buildings.some((building) => building.owner === "player" && building.kind === "farm" && !building.complete)).toBe(true);
    expect(game.units.filter((unit) => unit.owner === "enemy").every((unit) => unit.order.type === "idle")).toBe(true);
  });

  it("issues a reusable mixed-source command frame from one snapshot", () => {
    const game = createGame("bareDuel", { aiPlayers: [], players: ["player", "enemy"], teams: { player: "north", enemy: "south" } });
    game.players.player.gold = 5000;

    const scripts: AiScript[] = [
      {
        id: "mixed-source-frame-probe",
        phase: "economy",
        run(snapshot, owner) {
          if (owner === "player") {
            const worker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
            return worker ? { type: "build", unitId: worker.id, buildingKind: "farm", x: worker.x + 80, y: worker.y } : undefined;
          }
          const worker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
          const sawPlayerFarm = snapshot.buildings.some((building) => building.owner === "player" && building.kind === "farm" && !building.complete);
          return worker && sawPlayerFarm ? { type: "move", unitIds: [worker.id], x: 1800, y: 1800 } : undefined;
        },
      },
    ];

    const result = issueAiCommandFrame(game, [
      { playerId: "player", source: "external-agent", version: "v2", scripts },
      { playerId: "enemy", source: "internal-ai", version: "v1", scripts },
    ]);

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({ playerId: "player", source: "external-agent", scriptId: "mixed-source-frame-probe" });
    expect(game.buildings.some((building) => building.owner === "player" && building.kind === "farm" && !building.complete)).toBe(true);
    expect(game.units.filter((unit) => unit.owner === "enemy").every((unit) => unit.order.type === "idle")).toBe(true);
  });

  it("lets SDK observers inspect each command before and after it is issued", () => {
    const game = createGame("bareDuel", { aiPlayers: [], players: ["player", "enemy"] });
    game.players.player.gold = 5000;
    const scripts: AiScript[] = [
      {
        id: "hook-probe",
        phase: "economy",
        run(snapshot, owner) {
          const worker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
          return worker ? { type: "build", unitId: worker.id, buildingKind: "farm", x: worker.x + 80, y: worker.y } : undefined;
        },
      },
    ];
    const observations: string[] = [];

    issueAiCommandFrame(
      game,
      [{ playerId: "player", source: "external-agent", version: "v2", scripts }],
      {},
      {
        beforeIssue() {
          observations.push(game.buildings.some((building) => building.owner === "player" && building.kind === "farm") ? "before-built" : "before-clear");
        },
        afterIssue() {
          observations.push(game.buildings.some((building) => building.owner === "player" && building.kind === "farm") ? "after-built" : "after-clear");
        },
      },
    );

    expect(observations).toEqual(["before-clear", "after-built"]);
  });

  it("normalizes a missing external memory pointer into writable policy memory", () => {
    const game = createGame("bareDuel", { aiPlayers: [], players: ["player", "enemy"] });
    const stored = new Map<string, AiPolicyMemory>();
    const scripts: AiScript[] = [
      {
        id: "memory-normalization-probe",
        phase: "economy",
        run(snapshot, owner, options) {
          options.memory.jobs.push({ id: "probe-job", kind: "probe", createdTick: snapshot.tick, updatedTick: snapshot.tick });
          const worker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
          return worker ? { type: "move", unitIds: [worker.id], x: worker.x + 20, y: worker.y + 20 } : undefined;
        },
      },
    ];

    const result = issueAiCommandFrame(
      game,
      [{ playerId: "player", source: "external-agent", version: "v2", scripts }],
      {
        memoryProvider: {
          get: () => undefined,
          set: (owner, memory) => stored.set(owner, memory),
        },
      },
    );

    expect(result.commands).toHaveLength(1);
    expect(stored.get("player")?.jobs).toEqual([{ id: "probe-job", kind: "probe", createdTick: 0, updatedTick: 0 }]);
  });

  it("accepts an explicitly supplied frame memory for direct SDK command frames", () => {
    const game = createGame("bareDuel", { aiPlayers: [], players: ["player", "enemy"] });
    const memory: AiPolicyMemory = { jobs: [], unitClaims: {} };
    const scripts: AiScript[] = [
      {
        id: "direct-memory-probe",
        phase: "economy",
        run(snapshot, _owner, options) {
          options.memory.jobs.push({ id: "direct-frame", kind: "probe", createdTick: snapshot.tick, updatedTick: snapshot.tick });
          return undefined;
        },
      },
    ];

    issueAiCommandFrame(game, [{ playerId: "player", version: "v2", scripts }], { memory });

    expect(memory.jobs).toEqual([{ id: "direct-frame", kind: "probe", createdTick: 0, updatedTick: 0 }]);
  });

  it("keeps default runtime memory attached across think frames", () => {
    const game = createGame("bareDuel", { aiPlayers: [], players: ["player", "enemy"] });
    const seen: AiPolicyMemory[] = [];
    const scripts: AiScript[] = [
      {
        id: "memory-growth-probe",
        phase: "economy",
        run(snapshot, _owner, options) {
          seen.push(options.memory);
          options.memory.jobs.push({ id: `tick-${snapshot.tick}`, kind: "probe", createdTick: snapshot.tick, updatedTick: snapshot.tick });
          return undefined;
        },
      },
    ];
    const runtime = createAiRuntime(["player"], { scripts, thinkInterval: 1 });

    runPresetAiRuntime(game, runtime);
    stepGame(game);
    runPresetAiRuntime(game, runtime);

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]?.jobs.map((job) => job.id)).toEqual(["tick-0", "tick-1"]);
  });

  it("keeps the preset policy condition-driven and recovers when prior buildings are destroyed", () => {
    const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const runtime = createAiRuntime(["enemy"]);
    game.players.enemy.gold = 5000;

    for (let i = 0; i < 900; i += 1) {
      runPresetAiRuntime(game, runtime);
      stepGame(game);
    }

    const firstBarracks = game.buildings.find((building) => building.owner === "enemy" && building.kind === "barracks" && building.complete);
    expect(firstBarracks).toBeDefined();
    game.buildings = game.buildings.filter((building) => building.id !== firstBarracks!.id);
    game.buildings.push(createBuilding("building-enemy-forced-extra-farm", "enemy", "farm", firstBarracks!.x, firstBarracks!.y, true));

    for (let i = 0; i < 500; i += 1) {
      runPresetAiRuntime(game, runtime);
      stepGame(game);
    }

    expect(game.buildings.some((building) => building.owner === "enemy" && building.kind === "barracks" && building.id !== firstBarracks!.id)).toBe(true);
    expect(game.buildings.filter((building) => building.owner === "enemy" && building.kind === "farm" && !building.complete).length).toBeLessThanOrEqual(1);
  });
});
