import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { UNIT_DEFS } from "../../shared/catalog";
import { createGame, snapshotGame } from "../../shared/sim";
import type { BenchmarkMatchInput } from "../../sdk/benchmark/core";
import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { arenaMatch, captureArenaScenario, scoreArena } from "./v5-arena";

describe("scenario player seeds", () => {
  it("applies gold and upgrades before seeded units are made, and scales seeded health to the upgraded maximum", () => {
    const game = sketchScene("arena-seeds")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .playerState("v5", { gold: 0, upgrades: { weaponTraining: 2 } })
      .unit("v5", "footman", 500, 500, { id: "veteran", hpRatio: 0.5 })
      .build()
      .createGame();
    const footman = game.units.find((unit) => unit.id === "veteran")!;
    expect(game.players.v5!.gold).toBe(0);
    expect(game.players.v5!.upgrades.weaponTraining).toBe(2);
    expect(footman.attackDamage).toBeGreaterThan(UNIT_DEFS.footman.attackDamage);
    expect(footman.hp).toBe(Math.round(footman.maxHp * 0.5));
  });
});

describe("v5 arena", () => {
  function sourceMatch(): { match: BenchmarkMatchInput<AiGameAgent>; snapshot: ReturnType<typeof snapshotGame> } {
    const setup = sketchScene("arena-source")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .playerState("v3", { upgrades: { weaponTraining: 1 } })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v3", 3_300, 3_300, { id: "v3-main" })
      .townHall("v4-tr", 3_300, 3_800, { id: "v4-main" })
      .worker("v5", 520, 540, { id: "v5-worker" })
      .unit("v5", "footman", 700, 700, { id: "v5-footman", hpRatio: 0.5 })
      .unit("v3", "footman", 900, 900, { id: "v3-footman" })
      .unit("v4-tr", "mercenary", 950, 900, { id: "v4-mercenary" })
      .item("carried-scroll", "guardianScroll", 0, 0, { carrierId: "v5-footman" })
      .toGameSetup();
    const match: BenchmarkMatchInput<AiGameAgent> = {
      name: "arena source",
      mapId: "openClaims",
      options: setup,
      agents: {
        v5: { controller: "external-agent", team: "north", race: "grove", version: "v5", versionLabel: "v5" },
        v3: { controller: "external-agent", team: "south", race: "grove", version: "v3", versionLabel: "v3" },
        "v4-tr": { controller: "external-agent", team: "south", race: "grove", version: "v4-tr", versionLabel: "v4-tr" },
      },
      commandPlanner: createAiGameCommandPlanner(),
      maxTicks: 100,
      thinkInterval: 15,
    };
    return { match, snapshot: snapshotGame(createGame("openClaims", setup)) };
  }

  it("keeps the fighters, buildings, upgrades and carried items of a moment and drops the workers", () => {
    const { match, snapshot } = sourceMatch();
    const scenario = captureArenaScenario({ id: "moment", source: { seed: "s", match: match.name, second: 0, outcome: "loss" }, match, snapshot });
    expect(scenario.units.map((unit) => unit.id).sort()).toEqual(["v3-footman", "v4-mercenary", "v5-footman"]);
    expect(scenario.units.find((unit) => unit.id === "v5-footman")!.hpRatio).toBeCloseTo(0.5, 2);
    expect(scenario.buildings.map((building) => building.id).sort()).toEqual(["v3-main", "v4-main", "v5-main"]);
    expect(scenario.players.v3!.upgrades.weaponTraining).toBe(1);
    expect(scenario.items).toEqual([{ id: "carried-scroll", kind: "guardianScroll", carrierId: "v5-footman" }]);
  });

  it("rebuilds the moment broke, with the same upgrades, and scores the value each side lost", () => {
    const { match, snapshot } = sourceMatch();
    const scenario = captureArenaScenario({ id: "moment", source: { seed: "s", match: match.name, second: 0, outcome: "loss" }, match, snapshot });
    const game = createGame("openClaims", arenaMatch(scenario, { thinkInterval: 15 }).options!);
    expect(game.players.v5!.gold).toBe(0);
    expect(game.players.v3!.upgrades.weaponTraining).toBe(1);
    expect(game.units.find((unit) => unit.id === "v5-footman")!.hp).toBe(Math.round(game.units.find((unit) => unit.id === "v5-footman")!.maxHp * 0.5));
    expect(game.items.some((item) => item.carrierId === "v5-footman" && item.kind === "guardianScroll")).toBe(true);

    game.units = game.units.filter((unit) => unit.id !== "v4-mercenary");
    const result = scoreArena(scenario, snapshotGame(game));
    expect(result).toMatchObject({ subjectStart: UNIT_DEFS.footman.cost, enemyStart: UNIT_DEFS.footman.cost + UNIT_DEFS.mercenary.cost, subjectLost: 0, enemyLost: UNIT_DEFS.mercenary.cost, outcome: "loss" });
  });
});
