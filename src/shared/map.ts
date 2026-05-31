import { BUILDING_DEFS, UNIT_DEFS } from "./catalog";
import type { Building, BuildingKind, GameMap, MapId, MercenaryCamp, Owner, PlayerId, ResourceNode, TrainableUnitKind, Unit, UnitKind } from "./types";

export type MapScenario = {
  id: MapId;
  name: string;
  note: string;
  tags: string[];
};

export const DEFAULT_MAP_ID: MapId = "verdantCrossroads";
export const STANDARD_MAP_SIZE = 4096;
const AUTHOR_MAP_SIZE = 8192;
const MAP_SCALE = STANDARD_MAP_SIZE / AUTHOR_MAP_SIZE;

export const MAP_SCENARIOS: MapScenario[] = [
  { id: "verdantCrossroads", name: "Verdant Crossroads", note: "Compact ladder-style map with expansions, wild camps, and a mercenary crossroad.", tags: ["4096", "expansions", "wild camps", "mercs"] },
  { id: "bareDuel", name: "Bare Duel", note: "A cleaner duel layout for AI pressure tests without neutral distractions.", tags: ["4096", "few camps", "fast contact"] },
  { id: "openClaims", name: "Open Claims", note: "Expansion-focused economy map with no neutral camps blocking the mines.", tags: ["4096", "expansions", "no wild camps"] },
  { id: "campRush", name: "Camp Rush", note: "No-expansion pressure map where neutral camps and mercenaries shape the route.", tags: ["4096", "no expansions", "wild camps"] },
  { id: "wildMarches", name: "Wild Marches", note: "Neutral-heavy route network where armies read as moving sketches across a compact battlefield.", tags: ["4096", "many camps", "mercs"] },
  { id: "grandThirty", name: "Grand Thirty", note: "Super-large 15v15 stress battlefield with many starts, lanes, mines, camps, and room-scale minimap proof.", tags: ["12288", "15v15", "stress", "many camps"] },
];

export function createMap(id: MapId = DEFAULT_MAP_ID): GameMap {
  const scenario = scenarioFor(id);
  return {
    id,
    name: scenario.name,
    width: id === "grandThirty" ? STANDARD_MAP_SIZE * 3 : STANDARD_MAP_SIZE,
    height: id === "grandThirty" ? STANDARD_MAP_SIZE * 3 : STANDARD_MAP_SIZE,
    landmarks: scenarioLandmarks(id),
  };
}

export const SAMPLE_MAP: GameMap = createMap(DEFAULT_MAP_ID);

function scenarioLandmarks(id: MapId): GameMap["landmarks"] {
  const landmarks: GameMap["landmarks"] = [
    { id: "road-west-1", kind: "road", x: 1180, y: 1240, size: 420, rotation: 0.3 },
    { id: "road-mid-1", kind: "road", x: 2380, y: 2440, size: 520, rotation: 0.8 },
    { id: "road-mid-2", kind: "road", x: 3980, y: 3900, size: 660, rotation: 0.7 },
    { id: "road-east-1", kind: "road", x: 6100, y: 6020, size: 520, rotation: 0.8 },
    { id: "grove-player", kind: "grove", x: 650, y: 1460, size: 340, rotation: 0.1 },
    { id: "grove-north", kind: "grove", x: 3360, y: 1040, size: 420, rotation: 1.2 },
    { id: "grove-center", kind: "grove", x: 4820, y: 3480, size: 360, rotation: 0.4 },
    { id: "grove-enemy", kind: "grove", x: 6880, y: 6520, size: 420, rotation: 0.7 },
    { id: "ridge-north", kind: "ridge", x: 4100, y: 980, size: 500, rotation: 0.2 },
    { id: "ridge-west", kind: "ridge", x: 1740, y: 3180, size: 460, rotation: 1.4 },
    { id: "ridge-south", kind: "ridge", x: 3960, y: 6640, size: 540, rotation: 0.4 },
    { id: "ruin-center-a", kind: "ruin", x: 4300, y: 4200, size: 260, rotation: 0.1 },
    { id: "ruin-center-b", kind: "ruin", x: 4620, y: 4460, size: 220, rotation: 0.6 },
    { id: "ditch-west", kind: "ditch", x: 2540, y: 4520, size: 560, rotation: 0.15 },
    { id: "ditch-east", kind: "ditch", x: 5700, y: 3320, size: 620, rotation: -0.2 },
    { id: "camp-north", kind: "campMark", x: 3980, y: 1540, size: 220, rotation: 0.2 },
    { id: "camp-center", kind: "campMark", x: 4300, y: 4200, size: 260, rotation: 0.7 },
    { id: "camp-south", kind: "campMark", x: 3700, y: 6080, size: 240, rotation: 0.5 },
    { id: "scar-player", kind: "mineScar", x: 1180, y: 920, size: 220, rotation: 0.4 },
    { id: "scar-enemy", kind: "mineScar", x: 7000, y: 7140, size: 240, rotation: 0.4 },
    { id: "scar-center", kind: "mineScar", x: 4300, y: 4200, size: 180, rotation: 0.2 },
    { id: "stone-crossroad", kind: "bannerStone", x: 4020, y: 4020, size: 180, rotation: 0.1 },
    { id: "stone-west", kind: "bannerStone", x: 2060, y: 2200, size: 140, rotation: 0.3 },
    { id: "stone-east", kind: "bannerStone", x: 5920, y: 5900, size: 140, rotation: 0.3 },
  ];
  const scaled = landmarks.map(scaleLandmark);
  if (id === "bareDuel") return scaled.filter((landmark) => landmark.kind !== "campMark").slice(0, 20);
  if (id === "openClaims") return scaled.filter((landmark) => landmark.kind !== "campMark");
  if (id === "campRush") return scaled.filter((landmark) => landmark.kind !== "mineScar" || landmark.id === "scar-player" || landmark.id === "scar-enemy");
  if (id === "wildMarches") {
    return [
      ...scaled,
      ...([
        { id: "camp-far-west", kind: "campMark", x: 1680, y: 5120, size: 220, rotation: 0.9 },
        { id: "camp-far-east", kind: "campMark", x: 6240, y: 2440, size: 220, rotation: 0.1 },
        { id: "road-north-loop", kind: "road", x: 5120, y: 1780, size: 540, rotation: -0.4 },
        { id: "grove-marches", kind: "grove", x: 5460, y: 5100, size: 360, rotation: 0.3 },
      ] satisfies GameMap["landmarks"]).map(scaleLandmark),
    ];
  }
  if (id === "grandThirty") return grandThirtyLandmarks();
  return scaled;
}

function scenarioFor(id: MapId) {
  const scenario = MAP_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown map scenario ${id}`);
  return scenario;
}

export function createInitialResources(mapId: MapId = DEFAULT_MAP_ID, players: PlayerId[] = ["player", "enemy"]): ResourceNode[] {
  if (mapId === "grandThirty") {
    return [
      ...players.map((owner, index) => {
        const start = startPositionFor(owner, index, players.length, STANDARD_MAP_SIZE * 3);
        return { id: `gold-${owner}-main`, kind: "goldMine" as const, x: start.mineX, y: start.mineY, amount: 10_000 };
      }),
      ...grandThirtyExpansionMines(),
    ];
  }
  const resources: ResourceNode[] = [
    { id: "gold-player-main", kind: "goldMine", x: 1180, y: 920, amount: 8000 },
    { id: "gold-enemy-main", kind: "goldMine", x: 7000, y: 7140, amount: 8000 },
    { id: "gold-north-ridge", kind: "goldMine", x: 4060, y: 1320, amount: 6000 },
    { id: "gold-south-grove", kind: "goldMine", x: 3720, y: 6260, amount: 6000 },
    { id: "gold-center-scar", kind: "goldMine", x: 4300, y: 4200, amount: 4500 },
  ];
  for (const [index, owner] of players.entries()) {
    if (owner === "player" || owner === "enemy") continue;
    const start = startPositionFor(owner, index, players.length, STANDARD_MAP_SIZE);
    resources.push({ id: `gold-${owner}-main`, kind: "goldMine", x: start.mineX / MAP_SCALE, y: start.mineY / MAP_SCALE, amount: 8000 });
  }
  if (mapId === "bareDuel" || mapId === "campRush") return resources.slice(0, 2).map(scaleResource);
  if (mapId === "wildMarches") {
    return ([
      ...resources,
      { id: "gold-west-march", kind: "goldMine", x: 1620, y: 5220, amount: 4200 },
      { id: "gold-east-march", kind: "goldMine", x: 6280, y: 2520, amount: 4200 },
    ] satisfies ResourceNode[]).map(scaleResource);
  }
  return resources.map(scaleResource);
}

export function createInitialMercenaryCamps(mapId: MapId = DEFAULT_MAP_ID): MercenaryCamp[] {
  if (mapId === "bareDuel" || mapId === "openClaims") return [];
  const camps: MercenaryCamp[] = [
    { id: "merc-camp-crossroad", x: 6400, y: 6020, radius: 54, hireKind: "mercenary", cost: UNIT_DEFS.mercenary.cost, stock: 5, cooldown: 180, cooldownRemaining: 0 },
  ];
  if (mapId === "wildMarches") {
    camps.push({ id: "merc-camp-west-road", x: 1720, y: 5040, radius: 54, hireKind: "mercenary", cost: UNIT_DEFS.mercenary.cost, stock: 4, cooldown: 160, cooldownRemaining: 0 });
  }
  return camps.map(scaleMercenaryCamp);
}

export function createInitialBuildings(players: PlayerId[] = ["player", "enemy"], mapId: MapId = DEFAULT_MAP_ID): Building[] {
  return players.map((owner, index) => {
    const start = startPositionFor(owner, index, players.length, mapId === "grandThirty" ? STANDARD_MAP_SIZE * 3 : STANDARD_MAP_SIZE);
    return createBuilding(`building-${owner}-townhall`, owner, "townHall", start.baseX, start.baseY, true);
  });
}

export function createInitialUnits(mapId: MapId = DEFAULT_MAP_ID, players: PlayerId[] = ["player", "enemy"]): Unit[] {
  const units: Unit[] = players.flatMap((owner, index) => {
    const start = startPositionFor(owner, index, players.length, mapId === "grandThirty" ? STANDARD_MAP_SIZE * 3 : STANDARD_MAP_SIZE);
    return [
      createUnit(`unit-${owner}-worker-1`, owner, "worker", start.baseX - 55, start.baseY + 10),
      createUnit(`unit-${owner}-worker-2`, owner, "worker", start.baseX - 10, start.baseY + 65),
      createUnit(`unit-${owner}-worker-3`, owner, "worker", start.baseX + 55, start.baseY + 40),
    ];
  });
  units.push(
    createUnit("wildling-north-1", "neutral", "wildling", 3920, 1560),
    createUnit("wildling-north-2", "neutral", "thornSlinger", 4010, 1510),
    createUnit("wildling-center-1", "neutral", "stonebackBrute", 4200, 4070),
    createUnit("wildling-center-2", "neutral", "gladeWitch", 4380, 4310),
    createUnit("wildling-south-1", "neutral", "mossGnawer", 3580, 6040),
    createUnit("wildling-south-2", "neutral", "barkMender", 3810, 6110),
  );
  if (mapId === "grandThirty") return [...units.filter((unit) => unit.owner !== "neutral"), ...grandThirtyWildlings()];
  const playerUnits = units.filter((unit) => unit.owner !== "neutral");
  const neutralUnits = units.filter((unit) => unit.owner === "neutral");
  if (mapId === "bareDuel" || mapId === "openClaims") return playerUnits;
  if (mapId === "wildMarches") {
    neutralUnits.push(
      createUnit("wildling-west-1", "neutral", "stonebackBrute", 1680, 5120),
      createUnit("wildling-west-2", "neutral", "thornSlinger", 1780, 5020),
      createUnit("wildling-east-1", "neutral", "gladeWitch", 6240, 2440),
      createUnit("wildling-east-2", "neutral", "ancientStag", 6360, 2520),
    );
  }
  return [...playerUnits, ...neutralUnits.map(scaleUnit)];
}

export function createBuilding(
  id: string,
  owner: PlayerId,
  kind: BuildingKind,
  x: number,
  y: number,
  complete: boolean,
): Building {
  const def = BUILDING_DEFS[kind];
  return {
    id,
    owner,
    kind,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    radius: def.radius,
    complete,
    buildProgress: complete ? buildTimeFor(kind) : 0,
    buildTime: buildTimeFor(kind),
    attackDamage: def.attackDamage,
    attackRange: def.attackRange,
    attackCooldown: def.attackCooldown,
    cooldown: 0,
    rallyX: x + 90,
    rallyY: y + 60,
    queue: [],
  };
}

export function createUnit(
  id: string,
  owner: Owner,
  kind: UnitKind,
  x: number,
  y: number,
): Unit {
  const stats = UNIT_DEFS[kind];
  return {
    id,
    owner,
    kind,
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed,
    attackDamage: stats.attackDamage,
    attackRange: stats.attackRange,
    attackCooldown: stats.attackCooldown,
    cooldown: 0,
    radius: stats.radius,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 1,
    effects: [],
    order: { type: "idle" },
  };
}

export function buildTimeFor(kind: BuildingKind) {
  return BUILDING_DEFS[kind].buildTime;
}

export function trainTimeFor(kind: TrainableUnitKind) {
  return UNIT_DEFS[kind].trainTime;
}

function scale(value: number) {
  return value * MAP_SCALE;
}

function scaleLandmark(landmark: GameMap["landmarks"][number]): GameMap["landmarks"][number] {
  return { ...landmark, x: scale(landmark.x), y: scale(landmark.y), size: scale(landmark.size) };
}

function scaleResource(resource: ResourceNode): ResourceNode {
  return { ...resource, x: scale(resource.x), y: scale(resource.y) };
}

function scaleMercenaryCamp(camp: MercenaryCamp): MercenaryCamp {
  return { ...camp, x: scale(camp.x), y: scale(camp.y), radius: scale(camp.radius) };
}

function scaleUnit(unit: Unit): Unit {
  return { ...unit, x: scale(unit.x), y: scale(unit.y) };
}

function startPositionFor(owner: PlayerId, index: number, total: number, mapSize: number) {
  if (mapSize === STANDARD_MAP_SIZE) {
    if (owner === "player") return { baseX: scale(900), baseY: scale(900), mineX: scale(1180), mineY: scale(920) };
    if (owner === "enemy") return { baseX: scale(7240), baseY: scale(7240), mineX: scale(7000), mineY: scale(7140) };
    if (owner === "enemy2") return { baseX: mapSize - 480, baseY: 480, mineX: mapSize - 590, mineY: 460 };
  }

  const side = index < Math.ceil(total / 2) ? 0 : 1;
  const sideIndex = side === 0 ? index : index - Math.ceil(total / 2);
  const sideCount = side === 0 ? Math.ceil(total / 2) : Math.floor(total / 2);
  const lane = (sideIndex + 1) / (sideCount + 1);
  const x = side === 0 ? mapSize * 0.12 : mapSize * 0.88;
  const y = mapSize * (0.08 + lane * 0.84);
  const mineX = side === 0 ? x + 210 : x - 210;
  return { baseX: x, baseY: y, mineX, mineY: y + (sideIndex % 2 === 0 ? -90 : 90) };
}

function grandThirtyLandmarks(): GameMap["landmarks"] {
  const mapSize = STANDARD_MAP_SIZE * 3;
  const landmarks: GameMap["landmarks"] = [];
  for (let i = 0; i < 15; i += 1) {
    const y = mapSize * ((i + 1) / 16);
    landmarks.push(
      { id: `grand-road-${i}`, kind: "road", x: mapSize / 2, y, size: 720, rotation: i % 2 === 0 ? 0.1 : -0.1 },
      { id: `grand-grove-west-${i}`, kind: "grove", x: mapSize * 0.27, y: y + 120, size: 260, rotation: i * 0.2 },
      { id: `grand-ridge-east-${i}`, kind: "ridge", x: mapSize * 0.73, y: y - 120, size: 280, rotation: -i * 0.18 },
      { id: `grand-camp-${i}`, kind: "campMark", x: mapSize * (i % 2 === 0 ? 0.42 : 0.58), y, size: 180, rotation: i * 0.31 },
    );
  }
  for (let i = 0; i < 10; i += 1) {
    landmarks.push({ id: `grand-ruin-${i}`, kind: "ruin", x: mapSize * (0.35 + (i % 5) * 0.075), y: mapSize * (0.15 + Math.floor(i / 5) * 0.7), size: 240, rotation: i * 0.21 });
  }
  return landmarks;
}

function grandThirtyExpansionMines(): ResourceNode[] {
  const mapSize = STANDARD_MAP_SIZE * 3;
  return Array.from({ length: 18 }, (_, index) => {
    const lane = (index % 9) + 1;
    const row = Math.floor(index / 9);
    return {
      id: `gold-grand-expansion-${index + 1}`,
      kind: "goldMine" as const,
      x: mapSize * (row === 0 ? 0.37 : 0.63),
      y: mapSize * (lane / 10),
      amount: 6500,
    };
  });
}

function grandThirtyWildlings(): Unit[] {
  const mapSize = STANDARD_MAP_SIZE * 3;
  const kinds: UnitKind[] = ["mossGnawer", "thornSlinger", "barkMender", "stonebackBrute", "gladeWitch", "ancientStag"];
  const units: Unit[] = [];
  for (let camp = 0; camp < 15; camp += 1) {
    const x = mapSize * (camp % 2 === 0 ? 0.44 : 0.56);
    const y = mapSize * ((camp + 1) / 16);
    for (let i = 0; i < 3; i += 1) {
      units.push(createUnit(`wildling-grand-${camp + 1}-${i + 1}`, "neutral", kinds[(camp + i) % kinds.length]!, x + (i - 1) * 42, y + (i % 2 === 0 ? -34 : 34)));
    }
    if (camp % 5 === 4) {
      units.push(
        createUnit(`wildling-grand-${camp + 1}-leader`, "neutral", "ancientStag", x + 72, y - 72),
        createUnit(`wildling-grand-${camp + 1}-guard`, "neutral", "stonebackBrute", x - 72, y + 72),
        createUnit(`wildling-grand-${camp + 1}-hex`, "neutral", "gladeWitch", x + 8, y + 92),
      );
    }
  }
  return units;
}
