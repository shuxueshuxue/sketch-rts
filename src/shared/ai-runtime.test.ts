import { describe, expect, it } from "vitest";
import { createBuilding } from "./map";
import { createGame, snapshotGame, stepGame } from "./sim";
import { createAiRuntime, runPresetAiRuntime } from "./ai-runtime";
import type { AiScript } from "./ai-policy";

describe("shared AI runtime", () => {
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

    runPresetAiRuntime(game, runtime);

    expect(runtime.versions.player).toBe("v2");
    expect(runtime.versions.enemy).toBe("v1");
    expect(game.units.some((unit) => unit.owner === "player" && unit.order.type === "mine")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "enemy" && unit.order.type === "mine")).toBe(true);
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
    expect(game.buildings.filter((building) => building.owner === "enemy" && building.kind === "farm" && !building.complete)).toHaveLength(0);
  });
});
