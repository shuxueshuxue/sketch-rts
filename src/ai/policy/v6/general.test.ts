import { describe, expect, it } from "vitest";
import { createBuilding } from "../../../shared/map";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import type { GameCommand } from "../../../shared/types";
import { createAiPolicyMemory, type AiPolicyMemory } from "../../memory";
import { planAbilityCommands } from "../spell-tactics";
import { planV6General } from "./general";

const V6 = { version: "v2", requestedVersion: "v6" } as const;
const V7 = { version: "v2", requestedVersion: "v7" } as const;

function steady(): AiPolicyMemory {
  const memory = createAiPolicyMemory();
  memory.v6 = { doctrine: { profileId: "steady", strategyId: "grove-spirit-host", decidedTick: 0 } };
  return memory;
}

// "home" stands between the two enemy halls; "farHome" behind V3's, out of reach of V5's.
function board(name: string, options: { v6Footmen: number; enemyFootmen: number; enemyAt: "home" | "farHome" | "ourBase" | "passing"; camp?: boolean; campAt?: { x: number; y: number }; tower?: boolean }) {
  let scene = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v6", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v5", { team: "south", race: "grove" })
    .townHall("v6", 500, 500, { id: "v6-hall" })
    .building("v6", "barracks", 700, 420, { id: "v6-barracks" })
    .townHall("v3", 3_400, 3_300, { id: "v3-hall" })
    .townHall("v5", 3_400, 2_150, { id: "v5-hall" });
  for (let index = 0; index < options.v6Footmen; index += 1) scene = scene.unit("v6", "footman", 800 + (index % 5) * 30, 800 + Math.floor(index / 5) * 30, { id: `v6-footman-${index}` });
  const origins = { home: { x: 3_300, y: 3_150 }, farHome: { x: 3_700, y: 4_000 }, ourBase: { x: 900, y: 1_100 }, passing: { x: 1_500, y: 1_300 } };
  const enemyOrigin = origins[options.enemyAt];
  for (let index = 0; index < options.enemyFootmen; index += 1) scene = scene.unit("v3", "footman", enemyOrigin.x + index * 30, enemyOrigin.y, { id: `v3-footman-${index}` });
  if (options.tower) scene = scene.building("v6", "defenseTower", 720, 700, { id: "v6-tower" });
  const camp = options.campAt ?? (options.camp ? { x: 1_600, y: 1_500 } : undefined);
  if (camp) scene = scene.unit("neutral", "wildling", camp.x, camp.y, { id: "camp-a" }).unit("neutral", "wildling", camp.x + 50, camp.y + 40, { id: "camp-b" });
  const game = scene.build().createGame();
  return { game, snapshot: snapshotGame(game) };
}

// V7 (in the "v6" seat) with its main at (500, 500) and a natural at (500, 1500); V3's footmen come at the natural from the
// south-east, their middle about 490 from it.
function naturalBoard(name: string, options: { footmen: { x: number; y: number; hp?: number }[]; attackers: number; naturalComplete?: boolean; thirdMineCamp?: boolean }) {
  let scene = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v6", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .townHall("v6", 500, 500, { id: "v6-hall" })
    .townHall("v6", 500, 1_500, { id: "v6-natural", complete: options.naturalComplete ?? true })
    .townHall("v3", 3_400, 3_300, { id: "v3-hall" });
  options.footmen.forEach((unit, index) => (scene = scene.unit("v6", "footman", unit.x, unit.y, { id: `v7-footman-${index}`, ...(unit.hp !== undefined ? { hp: unit.hp } : {}) })));
  for (let index = 0; index < options.attackers; index += 1) scene = scene.unit("v3", "footman", 900 + index * 30, 1_700, { id: `v3-footman-${index}` });
  if (options.thirdMineCamp) scene = scene.goldMine("third-mine", 1_500, 700, 6_000).unit("neutral", "wildling", 1_600, 700, { id: "third-guard" });
  const game = scene.build().createGame();
  const memory = steady();
  return { game, memory, plan: () => planV6General(snapshotGame(game), "v6", { ...V7, teams: game.teams, memory }) };
}

const NATURAL = { x: 500, y: 1_500 };
const AT_NATURAL = [
  { x: 600, y: 1_450 },
  { x: 620, y: 1_470 },
  { x: 640, y: 1_450 },
  { x: 600, y: 1_480 },
  { x: 620, y: 1_430 },
];

function attackMoves(commands: GameCommand[]) {
  return commands.filter((command): command is Extract<GameCommand, { type: "attackMove" }> => command.type === "attackMove");
}

describe("v6 general", () => {
  it("meets an enemy army that has come to its base", () => {
    const { game, snapshot } = board("v6-general-defend", { v6Footmen: 6, enemyFootmen: 4, enemyAt: "ourBase" });
    const memory = steady();
    const [move] = attackMoves(planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory }));
    expect(move!.unitIds).toHaveLength(6);
    expect(Math.hypot(move!.x - 945, move!.y - 1_100)).toBeLessThan(10);
    expect(memory.v6?.general?.mode).toBe("defend");
  });

  it("guards its hall, under its towers, when the attackers are stronger and still out in the open", () => {
    const { game, snapshot } = board("v6-general-guard", { v6Footmen: 6, enemyFootmen: 8, enemyAt: "ourBase" });
    const memory = steady();
    const [move] = attackMoves(planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory }));
    expect(memory.v6?.general?.mode).toBe("guard");
    expect(Math.hypot(move!.x - 500, move!.y - 500)).toBeCloseTo(150, 0);
    expect(memory.v6?.plays?.["general:guard"]).toBe(1);
  });

  it("fights the same stronger attackers once they walk into a tower's reach", () => {
    const { game, snapshot } = board("v6-general-covered", { v6Footmen: 6, enemyFootmen: 8, enemyAt: "ourBase", tower: true });
    const memory = steady();
    const [move] = attackMoves(planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory }));
    expect(memory.v6?.general?.mode).toBe("defend");
    expect(Math.hypot(move!.x - 1_005, move!.y - 1_100)).toBeLessThan(10);
  });

  it("does not treat an army passing 1200 away as an attack on its base", () => {
    const { game, snapshot } = board("v6-general-passing", { v6Footmen: 6, enemyFootmen: 4, enemyAt: "passing" });
    const memory = steady();
    planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general?.mode).not.toBe("defend");
    expect(memory.v6?.general?.mode).not.toBe("guard");
  });

  it("holds at a rally in front of its main while the enemy is too strong to attack and nothing is left to creep", () => {
    const { game, snapshot } = board("v6-general-hold", { v6Footmen: 4, enemyFootmen: 8, enemyAt: "home" });
    const memory = steady();
    planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general?.mode).toBe("hold");
    expect(Math.hypot(memory.v6!.general!.target!.x - 500, memory.v6!.general!.target!.y - 500)).toBeCloseTo(380, 0);
  });

  it("calls back a unit that chased an enemy far past its rally while holding", () => {
    const { game } = board("v6-general-leash", { v6Footmen: 4, enemyFootmen: 8, enemyAt: "home" });
    const chaser = game.units.find((unit) => unit.id === "v6-footman-0")!;
    chaser.x = 1_300;
    chaser.y = 1_300;
    chaser.order = { type: "attack", targetId: "v3-footman-0" };
    const memory = steady();
    const [move] = attackMoves(planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory }));
    expect(memory.v6?.general?.mode).toBe("hold");
    expect(move!.unitIds).toContain("v6-footman-0");
  });

  it("leaves a camp on the enemy's side of the map alone while it does not outweigh their armies", () => {
    // Nearer V5's hall than its own, and clear of enemies for 1200: V6 went creeping at such a camp and V5's army caught it.
    const { game, snapshot } = board("v6-general-far-camp", { v6Footmen: 6, enemyFootmen: 8, enemyAt: "home", campAt: { x: 2_300, y: 1_900 } });
    const memory = steady();
    planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general?.mode).toBe("hold");
  });

  it("creeps a camp it can beat while the enemy is too strong to attack", () => {
    const { game, snapshot } = board("v6-general-creep", { v6Footmen: 6, enemyFootmen: 8, enemyAt: "home", camp: true });
    const memory = steady();
    const [move] = attackMoves(planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory }));
    expect(memory.v6?.general?.mode).toBe("creep");
    expect(Math.hypot(move!.x - 1_600, move!.y - 1_500)).toBeLessThan(60);
    expect(memory.v6?.plays?.["general:creep"]).toBe(1);
  });

  it("does not cross the map on a peak of spirits that will have expired when it arrives", () => {
    const { game } = board("v6-general-spirit-peak", { v6Footmen: 0, enemyFootmen: 5, enemyAt: "home" });
    for (let index = 0; index < 3; index += 1) game.spawnUnit("v6", "summoner", 820 + index * 30, 760);
    for (let index = 0; index < 14; index += 1) game.spawnUnit("v6", "spirit", 800 + (index % 7) * 30, 820 + Math.floor(index / 7) * 30);
    const memory = steady();
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general?.mode).not.toBe("attack");
  });

  it("sends an army that has idled at its rally for a minute and a half against defenders it only matches", () => {
    // Thirty at V3's hall stand 1000 from V5's: they defend it at half, 15, and 20 footmen match that but do not clear it.
    const { game } = board("v6-general-idle", { v6Footmen: 20, enemyFootmen: 30, enemyAt: "home" });
    game.tick = 600 * 20;
    const fresh = steady();
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory: fresh });
    expect(fresh.v6?.general?.mode).toBe("hold");

    const idle = steady();
    idle.v6!.general = { mode: "hold", target: { x: 800, y: 730 }, holdingSince: game.tick - 91 * 20 };
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory: idle });
    expect(idle.v6?.general?.mode).toBe("attack");
    expect(idle.v6?.plays?.["general:attack:idleArmy"]).toBe(1);
  });

  it("marches as one group: a unit trained after it set out waits at the rally, and a worn-out group comes home", () => {
    const { game } = board("v6-general-group", { v6Footmen: 20, enemyFootmen: 3, enemyAt: "farHome" });
    const memory = steady();
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general?.mode).toBe("attack");
    for (const unit of game.units.filter((candidate) => candidate.id.startsWith("v6-footman-"))) {
      unit.x = 2_500;
      unit.y = 1_800;
    }
    const recruit = game.spawnUnit("v6", "footman", 520, 520);
    const moves = attackMoves(planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory }));
    const recruitMove = moves.find((move) => move.unitIds.includes(recruit.id));
    expect(Math.hypot(recruitMove!.x - 500, recruitMove!.y - 500)).toBeCloseTo(380, 0);
    expect(moves.find((move) => move.unitIds.includes("v6-footman-0"))).toMatchObject({ x: 3_400, y: 2_150 });

    game.units = game.units.filter((unit) => !Array.from({ length: 11 }, (_, index) => `v6-footman-${index}`).includes(unit.id));
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.plays?.["general:retreat:worn"]).toBe(1);
    expect(memory.v6?.general?.mode).toBe("hold");
  });

  it("goes after an enemy expansion that only its own few units defend, whatever stands back at the main", () => {
    const { game } = board("v6-general-deny", { v6Footmen: 10, enemyFootmen: 0, enemyAt: "home" });
    game.buildings.push(createBuilding("v5-farm", "v5", "farm", 3_550, 2_050, true));
    game.buildings.push(createBuilding("v5-expansion", "v5", "townHall", 2_000, 1_800, false));
    for (let index = 0; index < 2; index += 1) game.spawnUnit("v5", "footman", 2_050 + index * 30, 1_850);
    // V5's army at its main, 1400 from the new hall: it would count at half against the main, not against the expansion.
    for (let index = 0; index < 12; index += 1) game.spawnUnit("v5", "footman", 3_250 + (index % 4) * 30, 2_150 + Math.floor(index / 4) * 30);
    const memory = steady();
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general).toMatchObject({ mode: "attack", targetHallId: "v5-expansion" });
    expect(memory.v6?.plays?.["general:attack:expansion"]).toBe(1);
  });

  it("V7 goes after a far expansion only with most of the two opponents' armies together behind it", () => {
    const deny = (footmen: number) => {
      const { game } = board(`v7-general-far-${footmen}`, { v6Footmen: 0, enemyFootmen: 0, enemyAt: "home" });
      for (let index = 0; index < footmen; index += 1) game.spawnUnit("v6", "footman", 800 + (index % 5) * 30, 800 + Math.floor(index / 5) * 30);
      game.buildings.push(createBuilding("v5-expansion", "v5", "townHall", 2_000, 1_800, false));
      for (let index = 0; index < 2; index += 1) game.spawnUnit("v5", "footman", 2_050 + index * 30, 1_850);
      for (let index = 0; index < 12; index += 1) game.spawnUnit("v5", "footman", 3_250 + (index % 4) * 30, 2_150 + Math.floor(index / 4) * 30);
      const memory = steady();
      planV6General(snapshotGame(game), "v6", { ...V7, teams: game.teams, memory });
      return memory.v6?.general?.mode;
    };
    // Fourteen enemy footmen in all: five is too few to cross the map, twelve is enough.
    expect(deny(5)).not.toBe("attack");
    expect(deny(12)).toBe("attack");
  });

  it("V7 meets attackers at its natural just in front of the hall, and walks a unit that chased past the leash back", () => {
    const { game, memory, plan } = naturalBoard("v7-general-defend-natural", { footmen: [...AT_NATURAL, { x: 1_300, y: 1_900 }], attackers: 6 });
    game.units.find((unit) => unit.id === "v7-footman-5")!.order = { type: "attack", targetId: "v3-footman-0" };
    const commands = plan();
    expect(memory.v6?.general?.mode).toBe("defend");
    const point = memory.v6!.general!.target!;
    // Six against six: two hundred paces in front of the hall, toward the attackers, not at their middle (about 530 out).
    expect(Math.hypot(point.x - NATURAL.x, point.y - NATURAL.y)).toBeCloseTo(200, 0);
    expect(point.x).toBeGreaterThan(NATURAL.x);
    const back = commands.find((command) => command.type === "move");
    expect(back).toMatchObject({ unitIds: ["v7-footman-5"], x: point.x, y: point.y });
    expect(attackMoves(commands).flatMap((command) => command.unitIds)).not.toContain("v7-footman-5");
  });

  it("V7 marches at attackers it clearly outweighs, and destroys them where they stand", () => {
    const { memory, plan } = naturalBoard("v7-general-defend-field", { footmen: AT_NATURAL, attackers: 3 });
    plan();
    expect(memory.v6?.general?.mode).toBe("defend");
    const point = memory.v6!.general!.target!;
    expect(Math.hypot(point.x - (900 + 30), point.y - 1_700)).toBeLessThan(5);
  });

  it("V7 falls back to its main from a natural whose attackers outweigh what stands there, but stays at a fight it has taken until it turns well against it", () => {
    const three = AT_NATURAL.slice(0, 3);
    const fresh = naturalBoard("v7-general-natural-fallback", { footmen: three, attackers: 4 });
    fresh.plan();
    expect(fresh.memory.v6?.general?.mode).toBe("guard");
    const guard = fresh.memory.v6!.general!.target!;
    expect(Math.hypot(guard.x - 500, guard.y - 500)).toBeLessThanOrEqual(200 + 1);
    const holding = naturalBoard("v7-general-natural-stay", { footmen: three, attackers: 4 });
    holding.memory.v6!.general = { mode: "defend", target: { x: 680, y: 1_580 } };
    holding.plan();
    expect(holding.memory.v6?.general?.mode).toBe("defend");
  });

  it("V7 steps its badly wounded back to the hall behind the line while the rest hold it", () => {
    const { plan } = naturalBoard("v7-general-defend-wounded", { footmen: [...AT_NATURAL, { x: 700, y: 1_600, hp: 40 }], attackers: 5 });
    const commands = plan();
    expect(commands.find((command) => command.type === "move")).toMatchObject({ unitIds: ["v7-footman-5"], x: NATURAL.x, y: NATURAL.y });
    expect(attackMoves(commands).flatMap((command) => command.unitIds)).not.toContain("v7-footman-5");
  });

  it("V7 clears no further mine's guard while its natural rises and the phase wants no third base", () => {
    const home = [0, 1, 2, 3, 4, 5].map((index) => ({ x: 700 + (index % 3) * 30, y: 650 + Math.floor(index / 3) * 30 }));
    const rising = naturalBoard("v7-general-no-third-guard", { footmen: home, attackers: 0, naturalComplete: false, thirdMineCamp: true });
    rising.plan();
    expect(rising.memory.v6?.plays?.["general:clearExpansion"]).toBeUndefined();
    // Without the natural's hall standing, the same mine is the base V7 wants next, and its guard is cleared.
    const { game, memory } = naturalBoard("v7-general-third-guard-wanted", { footmen: home, attackers: 0, thirdMineCamp: true });
    game.buildings.splice(game.buildings.findIndex((building) => building.id === "v6-natural"), 1);
    planV6General(snapshotGame(game), "v6", { ...V7, teams: game.teams, memory });
    expect(memory.v6?.plays?.["general:clearExpansion"]).toBe(1);
  });

  it("does not march on an enemy main with a small army, however empty the main stands; an expansion needs no such floor", () => {
    const small = board("v6-general-floor-small", { v6Footmen: 12, enemyFootmen: 3, enemyAt: "farHome" });
    const memory = steady();
    planV6General(small.snapshot, "v6", { ...V6, teams: small.game.teams, memory });
    expect(memory.v6?.general?.mode).not.toBe("attack");
    const big = board("v6-general-floor-big", { v6Footmen: 20, enemyFootmen: 3, enemyAt: "farHome" });
    const bigMemory = steady();
    planV6General(big.snapshot, "v6", { ...V6, teams: big.game.teams, memory: bigMemory });
    expect(bigMemory.v6?.general).toMatchObject({ mode: "attack", targetHallId: "v5-hall" });
  });

  it("pulses at an enemy main: gathers out of reach with its summons held, then strikes once most casters can cast", () => {
    const { game } = board("v6-general-pulse", { v6Footmen: 14, enemyFootmen: 3, enemyAt: "farHome" });
    const summoners = Array.from({ length: 4 }, (_, index) => game.spawnUnit("v6", "summoner", 760 + index * 30, 700));
    for (const summoner of summoners) summoner.cooldown = 400;
    const memory = steady();
    const options = () => ({ ...V6, teams: game.teams, memory });
    const [gather] = attackMoves(planV6General(snapshotGame(game), "v6", options()));
    expect(memory.v6?.general).toMatchObject({ mode: "attack", targetHallId: "v5-hall", stage: "gather" });
    // It walks to a point 850 short of V5's hall, not at the hall.
    expect(Math.hypot(gather!.x - 3_400, gather!.y - 2_150)).toBeCloseTo(850, 0);

    // At the gathering point with every spell back: a ready summoner still holds its summon while gathering...
    for (const unit of game.units.filter((candidate) => candidate.owner === "v6" && candidate.kind !== "worker")) {
      unit.x = gather!.x;
      unit.y = gather!.y;
      unit.cooldown = 0;
    }
    expect(planAbilityCommands(snapshotGame(game), "v6", options()).filter((command) => command.type === "cast")).toEqual([]);
    // ...and the army goes in together, casting as it goes.
    const [strike] = attackMoves(planV6General(snapshotGame(game), "v6", options()));
    expect(memory.v6?.general?.stage).toBe("strike");
    expect(strike).toMatchObject({ x: 3_400, y: 2_150 });
    expect(memory.v6?.plays?.["general:pulse"]).toBe(1);
    expect(planAbilityCommands(snapshotGame(game), "v6", options()).filter((command) => command.type === "cast").length).toBe(4);
  });

  it("ends a gathering pulse once its front is gone, so its casters summon again", () => {
    const { game } = board("v6-general-pulse-empty", { v6Footmen: 0, enemyFootmen: 3, enemyAt: "farHome" });
    const summoners = Array.from({ length: 4 }, (_, index) => game.spawnUnit("v6", "summoner", 760 + index * 30, 700));
    for (const summoner of summoners) summoner.cooldown = 0;
    const memory = steady();
    memory.v6!.general = { mode: "attack", target: { x: 3_400, y: 2_150 }, targetHallId: "v5-hall", stage: "gather", stageSince: 0 };
    const options = { ...V6, teams: game.teams, memory };
    planV6General(snapshotGame(game), "v6", options);
    expect(memory.v6?.general?.stage).toBeUndefined();
    expect(planAbilityCommands(snapshotGame(game), "v6", options).filter((command) => command.type === "cast").length).toBe(4);
  });

  it("goes after an opponent's last building once it has no hall left", () => {
    const { game } = board("v6-general-last-farm", { v6Footmen: 10, enemyFootmen: 0, enemyAt: "home" });
    game.buildings = game.buildings.filter((building) => building.id !== "v3-hall" && building.id !== "v5-hall");
    game.buildings.push(createBuilding("v5-farm", "v5", "farm", 3_450, 2_880, true));
    game.spawnUnit("v5", "footman", 3_420, 2_900);
    const memory = steady();
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general).toMatchObject({ mode: "attack", targetHallId: "v5-farm" });
  });

  it("breaks off an attack as soon as another army closes in, before it arrives", () => {
    const { game, snapshot } = board("v6-general-incoming", { v6Footmen: 20, enemyFootmen: 3, enemyAt: "farHome" });
    const memory = steady();
    planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general).toMatchObject({ mode: "attack", targetHallId: "v5-hall" });
    for (const unit of game.units.filter((candidate) => candidate.id.startsWith("v6-footman-"))) {
      unit.x = 3_000;
      unit.y = 2_300;
    }
    // Thirty of V3's 1500 away: not in the fight yet, and first seen standing, so the attack goes on.
    const relief = Array.from({ length: 30 }, (_, index) => game.spawnUnit("v3", "footman", 3_000 + (index % 5) * 20, 3_800 + Math.floor(index / 5) * 20));
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.general?.mode).toBe("attack");
    // Now they come: 1200 away and closing, still out of the fight, and V6 walks away before they reach it.
    for (const unit of relief) unit.y -= 300;
    planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory });
    expect(memory.v6?.plays?.["general:retreat:incoming"]).toBe(1);
    expect(memory.v6?.general?.mode).not.toBe("attack");
  });

  it("attacks the cheaper enemy base once it clearly outweighs what defends it, and walks back when the fight turns", () => {
    const { game, snapshot } = board("v6-general-attack", { v6Footmen: 20, enemyFootmen: 3, enemyAt: "farHome" });
    const memory = steady();
    const [move] = attackMoves(planV6General(snapshot, "v6", { ...V6, teams: game.teams, memory }));
    expect(memory.v6?.general).toMatchObject({ mode: "attack", targetHallId: "v5-hall" });
    // V5's hall is its main: the army first gathers short of it (the pulse).
    expect(Math.hypot(move!.x - 3_400, move!.y - 2_150)).toBeCloseTo(850, 0);

    for (const unit of game.units.filter((candidate) => candidate.id.startsWith("v6-footman-"))) {
      unit.x = 3_000;
      unit.y = 2_700;
    }
    for (let index = 0; index < 30; index += 1) game.spawnUnit("v5", "footman", 3_050 + (index % 10) * 20, 2_750 + Math.floor(index / 10) * 20);
    const [back] = attackMoves(planV6General(snapshotGame(game), "v6", { ...V6, teams: game.teams, memory }));
    expect(memory.v6?.general?.mode).toBe("hold");
    expect(Math.hypot(back!.x - 500, back!.y - 500)).toBeCloseTo(380, 0);
    expect(memory.v6?.plays?.["general:retreat"]).toBe(1);
  });
});
