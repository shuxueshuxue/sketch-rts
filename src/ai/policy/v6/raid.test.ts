import { describe, expect, it } from "vitest";
import { createBuilding } from "../../../shared/map";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import type { GameCommand } from "../../../shared/types";
import { createAiPolicyMemory, type AiPolicyMemory } from "../../memory";
import { planV6Closeout } from "./closeout";
import { planV6Raid } from "./raid";

const V6 = { version: "v2", requestedVersion: "v6" } as const;

// A raiding strategy and an eager personality, so every open window launches.
function raiding(): AiPolicyMemory {
  const memory = createAiPolicyMemory();
  memory.v6 = { doctrine: { profileId: "trickster", strategyId: "grove-raider-host", decidedTick: 0 } };
  return memory;
}

// V6 north-west, V3 south-west, V5 east. V3's army is out at a creep camp in the middle; its mining line sits alone.
function board(name: string, options: { v3ArmyAtCamp: boolean; v3Army?: number; v3Workers?: number; v3Buildings?: boolean; v5Workers?: number }) {
  let scene = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v6", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v5", { team: "south", race: "grove" })
    .townHall("v6", 500, 500, { id: "v6-hall" })
    .townHall("v3", 600, 3_400, { id: "v3-hall" })
    .townHall("v5", 3_500, 2_000, { id: "v5-hall" });
  if (options.v3Buildings) scene = scene.building("v3", "farm", 760, 3_300, { id: "v3-farm" });
  for (let index = 0; index < (options.v5Workers ?? 0); index += 1) scene = scene.worker("v5", 3_420 + index * 30, 2_100);
  for (let index = 0; index < 4; index += 1) scene = scene.unit("v6", "raider", 700 + index * 30, 900, { id: `raider-${index}` });
  for (let index = 0; index < 4; index += 1) scene = scene.unit("v6", "footman", 700 + index * 30, 1_000, { id: `footman-${index}` });
  for (let index = 0; index < (options.v3Workers ?? 5); index += 1) scene = scene.worker("v3", 640 + index * 30, 3_300, { id: `v3-worker-${index}` });
  const camp = { x: 2_300, y: 2_600 };
  for (let index = 0; index < (options.v3Army ?? 5); index += 1) {
    const at = options.v3ArmyAtCamp ? { x: camp.x + index * 30, y: camp.y } : { x: 700 + index * 30, y: 3_150 };
    scene = scene.unit("v3", "footman", at.x, at.y, { id: `v3-footman-${index}` });
  }
  if (options.v3ArmyAtCamp) scene = scene.unit("neutral", "wildling", camp.x + 60, camp.y + 120).unit("neutral", "wildling", camp.x + 120, camp.y + 60);
  const game = scene.build().createGame();
  game.tick = 360 * 20;
  return { game, snapshot: snapshotGame(game) };
}

describe("v6 raid", () => {
  it("sends its fast units at the mining line of an opponent whose army is busy at a creep camp", () => {
    const { game, snapshot } = board("v6-raid-creep-punish", { v3ArmyAtCamp: true });
    const memory = raiding();
    const commands = planV6Raid(snapshot, "v6", { ...V6, teams: game.teams, memory });
    expect(commands).toEqual([expect.objectContaining({ type: "move", unitIds: ["raider-0", "raider-1", "raider-2", "raider-3"] })]);
    expect(memory.v6?.raid).toMatchObject({ targetHallId: "v3-hall", reason: "creepPunish", phase: "travel" });
    expect(memory.v6?.plays?.["raid:creepPunish"]).toBe(1);
  });

  it("stays home when that army is standing on its own workers", () => {
    const { game, snapshot } = board("v6-raid-guarded", { v3ArmyAtCamp: false });
    const memory = raiding();
    expect(planV6Raid(snapshot, "v6", { ...V6, teams: game.teams, memory })).toEqual([]);
    expect(memory.v6?.raid).toBeUndefined();
  });

  it("strikes workers once there, and goes home when the defenders come back", () => {
    const { game, snapshot } = board("v6-raid-strike", { v3ArmyAtCamp: true });
    const memory = raiding();
    planV6Raid(snapshot, "v6", { ...V6, teams: game.teams, memory });
    for (const unit of game.units.filter((candidate) => candidate.id.startsWith("raider-"))) unit.y = 3_200;
    const strike = planV6Raid(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory }) as Extract<GameCommand, { type: "attack" }>[];
    expect(strike).toHaveLength(4);
    expect(strike.every((command) => command.type === "attack" && command.targetId.startsWith("v3-worker-"))).toBe(true);
    for (const unit of game.units.filter((candidate) => candidate.id.startsWith("v3-footman-"))) {
      unit.x = 760;
      unit.y = 3_250;
    }
    expect(planV6Raid(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory })).toEqual([expect.objectContaining({ type: "move", x: 500, y: 500 })]);
    expect(memory.v6?.raid?.phase).toBe("home");
  });
});

describe("v6 raid abort rules", () => {
  function striking(name: string) {
    const { game, snapshot } = board(name, { v3ArmyAtCamp: true });
    const memory = raiding();
    planV6Raid(snapshot, "v6", { ...V6, teams: game.teams, memory });
    for (const unit of game.units.filter((candidate) => candidate.id.startsWith("raider-"))) unit.y = 3_200;
    return { game, memory };
  }

  it("goes home the moment a tower sees it", () => {
    const { game, memory } = striking("v6-raid-tower");
    game.buildings.push(createBuilding("v3-tower", "v3", "defenseTower", 900, 3_450, true));
    expect(planV6Raid(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory })).toEqual([expect.objectContaining({ type: "move", x: 500, y: 500 })]);
    expect(memory.v6?.plays?.["raid:abort:tower"]).toBe(1);
  });

  it("sends a badly hurt raider home alone while the others keep striking", () => {
    const { game, memory } = striking("v6-raid-wounded");
    const hurt = game.units.find((unit) => unit.id === "raider-0")!;
    hurt.hp = hurt.maxHp * 0.3;
    const commands = planV6Raid(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(commands[0]).toMatchObject({ type: "move", unitIds: ["raider-0"], x: 500, y: 500 });
    expect(commands.slice(1).every((command) => command.type === "attack" && command.unitIds[0] !== "raider-0")).toBe(true);
    expect(memory.v6?.raid?.unitIds).not.toContain("raider-0");
  });
});

describe("v6 closeout", () => {
  it("sends a detachment to raze a beaten opponent's buildings", () => {
    const { game, snapshot } = board("v6-closeout", { v3ArmyAtCamp: false, v3Army: 0, v3Workers: 0, v3Buildings: true, v5Workers: 3 });
    const memory = createAiPolicyMemory();
    const [command] = planV6Closeout(snapshot, "v6", { ...V6, teams: game.teams, memory }) as Extract<GameCommand, { type: "attack" }>[];
    expect(command).toMatchObject({ type: "attack" });
    expect(["v3-hall", "v3-farm"]).toContain(command!.targetId);
    expect(command!.unitIds.length).toBeGreaterThanOrEqual(3);
    expect(memory.v6?.plays?.closeout).toBe(1);
  });

  it("leaves a living opponent's buildings to the main army", () => {
    const { game, snapshot } = board("v6-no-closeout", { v3ArmyAtCamp: false, v3Buildings: true, v5Workers: 3 });
    expect(planV6Closeout(snapshot, "v6", { ...V6, teams: game.teams, memory: createAiPolicyMemory() })).toEqual([]);
  });
});
