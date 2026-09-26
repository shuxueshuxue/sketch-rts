import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, UNIT_DEFS, requiredSupplyCap } from "../../../shared/catalog";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import type { GameCommand, UnitKind } from "../../../shared/types";
import { createAiPolicyMemory } from "../../memory";
import { planV6Economy, rankV6Goals } from "./economy";

const V6 = { version: "v2", requestedVersion: "v6" } as const;

type Base = { gold: number; buildings?: ("barracks" | "stables" | "sanctum")[]; army?: UnitKind[]; creep?: boolean; farms?: number; enemyAtBase?: number; enemyArchers?: number; enemyFootmen?: number; natural?: boolean; mainGold?: number; naturalHall?: boolean; thirdMine?: boolean };

function base(name: string, options: Base & { phase?: number }) {
  let scene = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v6", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v5", { team: "south", race: "grove" })
    .playerState("v6", { gold: options.gold })
    .townHall("v6", 600, 600, { id: "v6-hall" })
    .goldMine("v6-mine", 600, 800, options.mainGold ?? 6_000)
    .townHall("v3", 3_400, 3_300)
    .townHall("v5", 3_400, 2_150);
  (options.buildings ?? []).forEach((kind, index) => (scene = scene.building("v6", kind, 820, 460 + index * 110, { id: `v6-${kind}` })));
  for (let index = 0; index < (options.farms ?? 3); index += 1) scene = scene.building("v6", "farm", 420 + index * 70, 420);
  for (let index = 0; index < 6; index += 1) scene = scene.worker("v6", 560 + index * 20, 700, { id: `worker-${index}` });
  (options.army ?? []).forEach((kind, index) => (scene = scene.unit("v6", kind, 900 + index * 30, 900)));
  for (let index = 0; index < (options.enemyAtBase ?? 0); index += 1) scene = scene.unit("v3", "footman", 950 + index * 30, 1_150);
  for (let index = 0; index < (options.enemyArchers ?? 0); index += 1) scene = scene.unit("v5", "archer", 3_200 + index * 30, 2_300);
  for (let index = 0; index < (options.enemyFootmen ?? 0); index += 1) scene = scene.unit("v3", "footman", 3_200 + index * 30, 3_150);
  if (options.natural) scene = scene.goldMine("v6-natural", 700, 1_350, 6_000);
  if (options.naturalHall) scene = scene.townHall("v6", 700, 1_550, { id: "v6-natural-hall" });
  if (options.thirdMine) scene = scene.goldMine("v6-third", 1_500, 900, 6_000);
  if (options.creep) scene = scene.unit("neutral", "wildling", 900, 1_050, { id: "near-creep" });
  const game = scene.build().createGame();
  const memory = createAiPolicyMemory();
  memory.v6 = { doctrine: { profileId: "steady", strategyId: "grove-spirit-host", decidedTick: 0 }, ...(options.phase !== undefined ? { phase: options.phase } : {}) };
  return { game, memory, plan: () => planV6Economy(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory }) };
}

// Farms beside the one hall that leave the cap one farm short of the summoners' bar.
const ONE_FARM_SHORT = Math.ceil((requiredSupplyCap("summoner") - BUILDING_DEFS.townHall.supplyProvided) / BUILDING_DEFS.farm.supplyProvided) - 1;

function of<T extends GameCommand["type"]>(commands: GameCommand[], type: T) {
  return commands.filter((command): command is Extract<GameCommand, { type: T }> => command.type === type);
}

describe("v6 economy", () => {
  it("opens on the basic line while its casters are locked: a barracks for footmen and a farm toward the bar, no sanctum or tower", () => {
    const { plan } = base("v6-econ-opening", { gold: 450, farms: ONE_FARM_SHORT - 1 });
    expect(of(plan(), "build").map((command) => command.buildingKind).sort()).toEqual(["barracks", "farm"]);
  });

  it("puts the sanctum up once one more farm reaches the casters' bar, and trains footmen in the summoners' place until then", () => {
    const { plan } = base("v6-econ-sanctum-timing", { gold: 1_000, buildings: ["barracks"], farms: ONE_FARM_SHORT });
    const commands = plan();
    expect(of(commands, "build").map((command) => command.buildingKind)).toContain("sanctum");
    expect(of(commands, "train").map((command) => command.unitKind)).toContain("footman");
    const early = base("v6-econ-sanctum-early", { gold: 1_000, buildings: ["barracks"], farms: ONE_FARM_SHORT - 1 }).plan();
    expect(of(early, "build").map((command) => command.buildingKind)).not.toContain("sanctum");
  });

  it("moves to the second phase once most of its summoners stand, and asks for a second sanctum", () => {
    const { plan, memory } = base("v6-econ-phase-two", { gold: 600, buildings: ["sanctum"], army: ["summoner", "summoner", "summoner", "summoner", "summoner", "summoner"] });
    expect(of(plan(), "build").map((command) => command.buildingKind)).toContain("sanctum");
    expect(memory.v6?.phase).toBe(1);
    expect(memory.v6?.plays?.["phase:2"]).toBe(1);
  });

  it("still takes the natural in the second phase, ahead of more summoners", () => {
    // Gold covers one hall and the worker trained ahead of it: before the natural was restated in phase two, a summoner
    // (56) took the gold ahead of the third-base want (40) every time.
    const army: UnitKind[] = ["summoner", "summoner", "summoner", "summoner", "summoner", "summoner", "summoner"];
    const { plan } = base("v6-econ-natural", { gold: BUILDING_DEFS.townHall.cost + UNIT_DEFS.worker.cost, buildings: ["sanctum"], army, farms: 6, natural: true, phase: 1 });
    expect(of(plan(), "build").map((command) => command.buildingKind)).toContain("townHall");
  });

  it("takes another base when its main's mine runs dry, though the dry hall still stands", () => {
    // Two halls meet the opening's two bases only while both still have gold: counting the dry main left eleven workers
    // idle when V6's main ran out.
    const twoHalls = { gold: 1_000, buildings: ["sanctum" as const], army: ["summoner", "summoner", "summoner"] as UnitKind[], farms: 5, natural: true, naturalHall: true, thirdMine: true };
    const { plan: dry } = base("v6-econ-dry-main", { ...twoHalls, mainGold: 0 });
    expect(of(dry(), "build").map((command) => command.buildingKind)).toContain("townHall");
    const { plan: rich } = base("v6-econ-rich-main", twoHalls);
    expect(of(rich(), "build").map((command) => command.buildingKind)).not.toContain("townHall");
  });

  it("puts a tower up at a base under attack ahead of everything but farms, and never where it reaches a standing camp", () => {
    const { plan, memory } = base("v6-econ-under-fire", { gold: 600, buildings: ["barracks"], enemyAtBase: 3, creep: true });
    const [tower] = of(plan(), "build").filter((command) => command.buildingKind === "defenseTower");
    expect(tower).toBeDefined();
    expect(Math.hypot(tower!.x - 900, tower!.y - 1_050)).toBeGreaterThan(480);
    expect(memory.v6?.plays?.["tower:underFire"]).toBe(1);
  });

  it("trains the next base's workers ahead of its hall, but no faster than the army grows", () => {
    const { plan } = base("v6-econ-workers", { gold: 500, buildings: ["sanctum"], army: ["summoner", "summoner", "summoner"], farms: ONE_FARM_SHORT + 1 });
    expect(of(plan(), "train").map((command) => command.unitKind)).toContain("worker");
    const { plan: bare } = base("v6-econ-workers-bare", { gold: 500, buildings: ["sanctum"], farms: ONE_FARM_SHORT + 1 });
    expect(of(bare(), "train").map((command) => command.unitKind)).not.toContain("worker");
  });

  it("keeps training workers without an army while the phase's units still wait on their tier", () => {
    const { plan } = base("v6-econ-workers-tier", { gold: 500, buildings: ["sanctum"], farms: ONE_FARM_SHORT - 1 });
    expect(of(plan(), "train").map((command) => command.unitKind)).toContain("worker");
  });

  it("builds a farm first when supply runs short", () => {
    const { plan } = base("v6-econ-farm", { gold: 400, buildings: ["barracks"], army: ["footman", "footman", "footman", "footman", "footman", "footman", "footman"], farms: 0 });
    expect(of(plan(), "build")[0]).toMatchObject({ buildingKind: "farm" });
  });

  it("raises a goal's priority the longer it waits, and keeps the wait through a moment's absence", () => {
    const { game, memory } = base("v6-econ-ageing", { gold: 0 });
    const options = () => ({ ...V6, teams: game.teams, memory });
    const priority = (id: string) => rankV6Goals(snapshotGame(game), "v6", options()).find((candidate) => candidate.id === id)?.priority;
    const waitSeconds = (seconds: number) => {
      for (let second = 0; second < seconds; second += 1) {
        game.tick += 20;
        priority("farm:tier");
      }
    };
    const start = priority("farm:tier")!;
    waitSeconds(60);
    expect(priority("farm:tier")).toBe(start + 10);
    // Unseen for three seconds it keeps its wait; unseen for twelve it starts over.
    game.tick += 3 * 20;
    expect(priority("farm:tier")).toBe(start + 10);
    game.tick += 12 * 20;
    expect(priority("farm:tier")).toBe(start);
  });
});
