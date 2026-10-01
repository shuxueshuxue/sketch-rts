import { BUILDING_DEFS, UNIT_DEFS, constructionStartHp } from "./catalog";
import { detCos, detSin } from "./det-math";
import { seconds } from "./time";
import { MAP_POOL } from "./map-pool";
import type { Building, BuildingKind, GameMap, MapId, MercenaryCamp, MercenaryUnitKind, Owner, PlayerId, ResourceNode, TrainableUnitKind, Unit, UnitKind, WorldItem } from "./types";

export { LADDER_MAP_ID, LADDER_SLOT_IDS } from "./map-ids";

export type MapScenario = {
  id: MapId;
  name: string;
  note: string;
  tags: string[];
};

export const DEFAULT_MAP_ID: MapId = "verdantCrossroads";
export const STANDARD_MAP_SIZE = 4096;
export const COMBAT_ARENA_MAP_SIZE = 1600;
const AUTHOR_MAP_SIZE = 8192;
const MAP_SCALE = STANDARD_MAP_SIZE / AUTHOR_MAP_SIZE;

export const MAP_SCENARIOS: MapScenario[] = [
  { id: "ladder", name: "Ladder Map", note: "Every game draws a new War3-style ladder map: each main on a plateau with one ramp, a natural of its own, guarded contested mines, mercenary posts and a hard middle, walled by forest, rock and water.", tags: ["generated", "terrain", "expansions", "wild camps", "mercs"] },
  ...MAP_POOL.map((map) => ({ id: map.id, name: map.name.en, note: `A ${map.players}-player War3-style ladder map, ${map.layout.kind === "sides" ? "two teams facing each other across it" : "every start on one ring"}.`, tags: ["pool", String(map.layout.size), `${map.players} players`, map.layout.kind] })),
  { id: "verdantCrossroads", name: "Verdant Crossroads", note: "Compact ladder-style map with expansions, wild camps, and a mercenary crossroad.", tags: ["4096", "expansions", "wild camps", "mercs"] },
  { id: "bareDuel", name: "Bare Duel", note: "A cleaner duel layout for AI pressure tests without neutral distractions.", tags: ["4096", "few camps", "fast contact"] },
  { id: "openClaims", name: "Open Claims", note: "Expansion-focused economy map with no neutral camps blocking the mines.", tags: ["4096", "expansions", "no wild camps"] },
  { id: "campRush", name: "Camp Rush", note: "No-expansion pressure map where neutral camps and mercenaries shape the route.", tags: ["4096", "no expansions", "wild camps"] },
  { id: "combatArena", name: "Combat Arena", note: "Small benchmark arena for mixed-army micro without economy or neutral routing.", tags: ["1600", "combat", "micro"] },
  { id: "goldGrid", name: "Gold Grid", note: "V5 economy research map with sixteen open gold points for expansion stress tests.", tags: ["4096", "research", "many mines", "no wild camps"] },
  { id: "mercPocket", name: "Merc Pocket", note: "V5 economy research map with nearby unguarded mercenary camps for hire-tempo stress tests.", tags: ["4096", "research", "mercs", "no wild camps"] },
  { id: "grandThirty", name: "Grand Thirty", note: "Super-large 15v15 stress battlefield with many starts, lanes, mines, camps, and room-scale minimap proof.", tags: ["12288", "15v15", "stress", "many camps"] },
];

export function createMap(id: MapId = DEFAULT_MAP_ID): GameMap {
  const scenario = scenarioFor(id);
  const mapSize = mapSizeFor(id);
  return {
    id,
    name: scenario.name,
    width: mapSize,
    height: mapSize,
    landmarks: scenarioLandmarks(id),
  };
}

export const SAMPLE_MAP: GameMap = createMap(DEFAULT_MAP_ID);

function mapSizeFor(id: MapId) {
  if (id === "grandThirty") return STANDARD_MAP_SIZE * 3;
  if (id === "combatArena") return COMBAT_ARENA_MAP_SIZE;
  return STANDARD_MAP_SIZE;
}

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
    { id: "ruin-center-a", kind: "ruin", x: 4096, y: 4200, size: 260, rotation: 0.1 },
    { id: "ruin-center-b", kind: "ruin", x: 4416, y: 4460, size: 220, rotation: 0.6 },
    { id: "ditch-west", kind: "ditch", x: 2540, y: 4520, size: 560, rotation: 0.15 },
    { id: "ditch-east", kind: "ditch", x: 5700, y: 3320, size: 620, rotation: -0.2 },
    { id: "camp-north", kind: "campMark", x: 3980, y: 1540, size: 220, rotation: 0.2 },
    { id: "camp-center", kind: "campMark", x: 4096, y: 4200, size: 260, rotation: 0.7 },
    { id: "camp-south", kind: "campMark", x: 3700, y: 6080, size: 240, rotation: 0.5 },
    { id: "scar-player", kind: "mineScar", x: 1180, y: 920, size: 220, rotation: 0.4 },
    { id: "scar-enemy", kind: "mineScar", x: 7000, y: 7140, size: 240, rotation: 0.4 },
    { id: "scar-center", kind: "mineScar", x: 4096, y: 4200, size: 180, rotation: 0.2 },
    { id: "stone-crossroad", kind: "bannerStone", x: 4020, y: 4020, size: 180, rotation: 0.1 },
    { id: "stone-west", kind: "bannerStone", x: 2060, y: 2200, size: 140, rotation: 0.3 },
    { id: "stone-east", kind: "bannerStone", x: 5920, y: 5900, size: 140, rotation: 0.3 },
  ];
  const scaled = landmarks.map(scaleLandmark);
  if (id === "combatArena") return [];
  if (id === "bareDuel") return scaled.filter((landmark) => landmark.kind !== "campMark").slice(0, 20);
  if (id === "openClaims") return scaled.filter((landmark) => landmark.kind !== "campMark");
  if (id === "campRush") return scaled.filter((landmark) => landmark.kind !== "mineScar" || landmark.id === "scar-player" || landmark.id === "scar-enemy");
  if (id === "grandThirty") return grandThirtyLandmarks();
  return scaled;
}

function scenarioFor(id: MapId) {
  const scenario = MAP_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown map scenario ${id}`);
  return scenario;
}

export function createInitialResources(mapId: MapId = DEFAULT_MAP_ID, players: PlayerId[] = ["player", "enemy"], teams?: Partial<Record<PlayerId, string>>): ResourceNode[] {
  if (mapId === "combatArena") return [];
  if (mapId === "goldGrid") return goldGridMines();
  if (mapId === "grandThirty") {
    return [
      ...players.map((owner, index) => {
        const start = startPositionFor(owner, index, players.length, STANDARD_MAP_SIZE * 3, players, teams);
        return { id: `gold-${owner}-main`, kind: "goldMine" as const, x: start.mineX, y: start.mineY, amount: 6_000 };
      }),
      ...grandThirtyExpansionMines(),
    ];
  }
  const mainMines: ResourceNode[] = players.map((owner, index) => {
    const start = startPositionFor(owner, index, players.length, STANDARD_MAP_SIZE, players, teams);
    return { id: `gold-${owner}-main`, kind: "goldMine" as const, x: start.mineX, y: start.mineY, amount: 6_000 };
  });
  const expansionMines: ResourceNode[] = [
    { id: "gold-north-ridge", kind: "goldMine", x: 4060, y: 1320, amount: 6_000 },
    { id: "gold-south-grove", kind: "goldMine", x: 3720, y: 6260, amount: 6_000 },
    { id: "gold-center-scar", kind: "goldMine", x: 4096, y: 4200, amount: 6_000 },
  ];
  if (mapId === "bareDuel" || mapId === "campRush") return mainMines;
  return [...mainMines, ...expansionMines.map(scaleResource)];
}

export function createInitialMercenaryCamps(mapId: MapId = DEFAULT_MAP_ID): MercenaryCamp[] {
  if (mapId === "combatArena") return [];
  if (mapId === "goldGrid") return [];
  if (mapId === "mercPocket") return mercPocketCamps();
  if (mapId === "bareDuel" || mapId === "openClaims") return [];
  if (mapId === "grandThirty") return grandThirtyMercenaryCamps();
  const camps: MercenaryCamp[] = [
    { id: "merc-camp-crossroad", x: 6400, y: 6020, radius: 54, hireKind: "mercenary", cost: UNIT_DEFS.mercenary.cost, stock: 5, cooldown: seconds(9), cooldownRemaining: 0 },
    { id: "merc-camp-bow-post", x: 5880, y: 3880, radius: 50, hireKind: "contractArcher", cost: UNIT_DEFS.contractArcher.cost, stock: 3, cooldown: seconds(16), cooldownRemaining: 0 },
    { id: "merc-camp-field-tent", x: 2520, y: 3100, radius: 50, hireKind: "fieldMedic", cost: UNIT_DEFS.fieldMedic.cost, stock: 3, cooldown: seconds(18), cooldownRemaining: 0 },
  ];
  return camps.map(scaleMercenaryCamp);
}

export function createInitialItems(mapId: MapId = DEFAULT_MAP_ID): WorldItem[] {
  if (mapId === "combatArena") return [];
  if (mapId === "goldGrid" || mapId === "mercPocket") return [];
  if (mapId === "bareDuel" || mapId === "openClaims") return [];
  const items: WorldItem[] = [
    { id: "treasure-center-lightning", kind: "lightningRod", x: 0, y: 0, carrierId: "wildling-center-2", cooldownRemaining: 0 },
    { id: "treasure-south-book", kind: "experienceBook", x: 0, y: 0, carrierId: "wildling-south-2", cooldownRemaining: 0 },
    { id: "treasure-north-flame", kind: "flameCloak", x: 0, y: 0, carrierId: "wildling-north-2", cooldownRemaining: 0 },
    { id: "treasure-free-yellow-scroll", kind: "guardianScroll", x: 0, y: 0, carrierId: "wildling-free-yellow-north-2", cooldownRemaining: 0 },
    { id: "treasure-free-red-storm", kind: "stormStaff", x: 0, y: 0, carrierId: "wildling-free-red-west-1", cooldownRemaining: 0 },
    { id: "treasure-free-red-breach", kind: "breachCharge", x: 0, y: 0, carrierId: "wildling-free-red-east-1", cooldownRemaining: 0 },
  ];
  if (mapId === "grandThirty") {
    return Array.from({ length: 30 }, (_, index) => ({
      id: `treasure-grand-${index + 1}`,
      kind: grandTreasureKind(index),
      x: 0,
      y: 0,
      carrierId: `wildling-grand-${(index % 15) + 1}-${Math.floor(index / 15) + 1}`,
      cooldownRemaining: 0,
    }));
  }
  return items;
}

function grandTreasureKind(index: number): WorldItem["kind"] {
  const cycle: WorldItem["kind"][] = ["flameCloak", "lightningRod", "stormStaff", "guardianScroll", "experienceBook", "breachCharge"];
  return cycle[index % cycle.length]!;
}

export function createInitialBuildings(players: PlayerId[] = ["player", "enemy"], mapId: MapId = DEFAULT_MAP_ID, teams?: Partial<Record<PlayerId, string>>): Building[] {
  return players.map((owner, index) => {
    const start = startPositionFor(owner, index, players.length, mapSizeFor(mapId), players, teams);
    return createBuilding(`building-${owner}-townhall`, owner, "townHall", start.baseX, start.baseY, true);
  });
}

export function createInitialUnits(mapId: MapId = DEFAULT_MAP_ID, players: PlayerId[] = ["player", "enemy"], teams?: Partial<Record<PlayerId, string>>): Unit[] {
  const units: Unit[] = players.flatMap((owner, index) => {
    const start = startPositionFor(owner, index, players.length, mapSizeFor(mapId), players, teams);
    return [
      createUnit(`unit-${owner}-worker-1`, owner, "worker", start.baseX - 55, start.baseY + 10),
      createUnit(`unit-${owner}-worker-2`, owner, "worker", start.baseX - 10, start.baseY + 65),
    createUnit(`unit-${owner}-worker-3`, owner, "worker", start.baseX + 55, start.baseY + 40),
    ];
  });
  units.push(
    createUnit("wildling-north-1", "neutral", "wildling", 3920, 1560),
    createUnit("wildling-north-2", "neutral", "thornSlinger", 4010, 1510),
    createUnit("wildling-north-3", "neutral", "stonebackBrute", 3970, 1620),
    createUnit("wildling-north-4", "neutral", "gladeWitch", 4050, 1600),
    createUnit("wildling-north-5", "neutral", "barkMender", 3890, 1500),
    createUnit("wildling-center-1", "neutral", "stonebackBrute", 3996, 4070),
    createUnit("wildling-center-2", "neutral", "gladeWitch", 4176, 4310),
    createUnit("wildling-center-3", "neutral", "barkMender", 4086, 4210),
    createUnit("wildling-center-4", "neutral", "thornSlinger", 3976, 4300),
    createUnit("wildling-south-1", "neutral", "mossGnawer", 3580, 6040),
    createUnit("wildling-south-2", "neutral", "barkMender", 3810, 6110),
    createUnit("wildling-south-3", "neutral", "stonebackBrute", 3690, 6160),
    createUnit("wildling-south-4", "neutral", "gladeWitch", 3750, 6010),
    createUnit("wildling-south-5", "neutral", "thornSlinger", 3860, 6200),
    createUnit("wildling-south-6", "neutral", "thornSlinger", 3620, 6140),
    createUnit("wildling-merc-crossroad-1", "neutral", "stonebackBrute", 6320, 5980),
    createUnit("wildling-merc-crossroad-2", "neutral", "thornSlinger", 6460, 6060),
    createUnit("wildling-merc-crossroad-3", "neutral", "barkMender", 6380, 6120),
    createUnit("wildling-merc-bow-1", "neutral", "gladeWitch", 5840, 3820),
    createUnit("wildling-merc-bow-2", "neutral", "thornSlinger", 5960, 3920),
    createUnit("wildling-merc-bow-3", "neutral", "barkMender", 5880, 3980),
    createUnit("wildling-merc-field-1", "neutral", "barkMender", 2480, 3040),
    createUnit("wildling-merc-field-2", "neutral", "wildling", 2580, 3160),
    createUnit("wildling-merc-field-3", "neutral", "stonebackBrute", 2520, 3200),
  );
  if (mapId === "grandThirty") return [...units.filter((unit) => unit.owner !== "neutral"), ...grandThirtyWildlings()];
  const playerUnits = units.filter((unit) => unit.owner !== "neutral");
  const neutralUnits = units.filter((unit) => unit.owner === "neutral");
  if (mapId === "combatArena") return playerUnits;
  if (mapId === "goldGrid" || mapId === "mercPocket") return playerUnits;
  if (mapId === "bareDuel" || mapId === "openClaims") return playerUnits;
  const authoredNeutrals = [...neutralUnits.map(scaleUnit), ...freeWildlingCamps(mapId)];
  return [...playerUnits, ...keepNeutralUnitsAwayFromPlayerStarts(authoredNeutrals, mapId, players, teams)];
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
    hp: complete ? def.hp : constructionStartHp(def.hp),
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
    researchQueue: [],
  };
}

// @@@unit-shape - A unit has every field from birth, in this order, the ones it has no value for yet set to undefined; it
// never gains or loses one later. The engine and the AIs read units in their hottest loops (separation, target search,
// planning), and V8 makes those reads fast only while the objects share one hidden class. A field added when a unit first
// needed it (variant, abilityCooldowns, autocast, expiresTick, in whatever order that happened) split units into several
// shapes, and a delete dropped a unit into a slow dictionary: separating 125 units took 34 us, against 10 us for the same
// units in one shape. JSON (snapshots, saves, the net) drops the undefined fields; a unit read back gets them again from
// withUnitShape.
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
    homeX: x,
    homeY: y,
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
    level: 0,
    effects: [],
    order: { type: "idle" },
    orderQueue: [],
    variant: undefined,
    abilityCooldowns: undefined,
    autocast: undefined,
    stance: undefined,
    pushX: undefined,
    pushY: undefined,
    arrivedAt: undefined,
    expiresTick: undefined,
  };
}

// A unit read back from JSON, in the one shape of createUnit's (see @@@unit-shape): its own fields over a fresh unit's, with
// the optional fields it lacks left undefined rather than filled in.
export function withUnitShape(unit: Unit): Unit {
  return Object.assign(createUnit(unit.id, unit.owner, unit.kind, unit.x, unit.y), { homeX: undefined, homeY: undefined, orderQueue: undefined }, unit);
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

function keepNeutralUnitsAwayFromPlayerStarts(units: Unit[], mapId: MapId, players: PlayerId[], teams?: Partial<Record<PlayerId, string>>) {
  const mapSize = mapId === "grandThirty" ? STANDARD_MAP_SIZE * 3 : STANDARD_MAP_SIZE;
  const safeGap = 440 * (mapSize / STANDARD_MAP_SIZE);
  const clamp = (value: number) => Math.max(80, Math.min(mapSize - 80, value));
  const safetyPoints = players.flatMap((owner, index) => {
    const start = startPositionFor(owner, index, players.length, mapSize, players, teams);
    return [
      { x: start.baseX, y: start.baseY },
      { x: start.mineX, y: start.mineY },
    ];
  });

  return units.map((unit) => {
    if (unit.owner !== "neutral") return unit;
    let x = unit.x;
    let y = unit.y;
    for (let pass = 0; pass < 5; pass += 1) {
      let moved = false;
      for (const point of safetyPoints) {
        const dx = x - point.x;
        const dy = y - point.y;
        const gap = Math.hypot(dx, dy);
        if (gap >= safeGap) continue;
        const tieBreakX = x >= point.x ? 1 : -1;
        const tieBreakY = y >= point.y ? 1 : -1;
        const unitX = gap > 0 ? dx / gap : tieBreakX / Math.SQRT2;
        const unitY = gap > 0 ? dy / gap : tieBreakY / Math.SQRT2;
        const radial = { x: clamp(point.x + unitX * safeGap), y: clamp(point.y + unitY * safeGap) };
        const candidates = [radial];
        for (let angleIndex = 0; angleIndex < 16; angleIndex += 1) {
          const angle = (Math.PI * 2 * angleIndex) / 16;
          candidates.push({ x: clamp(point.x + detCos(angle) * safeGap), y: clamp(point.y + detSin(angle) * safeGap) });
        }
        const best = candidates.reduce((winner, candidate) => (nearestSafetyGap(candidate) > nearestSafetyGap(winner) ? candidate : winner), radial);
        x = best.x;
        y = best.y;
        moved = true;
      }
      if (!moved) break;
    }
    // @@@start-safety - Map-authored objective density must not spawn neutral aggro inside a player's opening economy.
    return withUnitHome({ ...unit, x, y }, x, y);
  });

  function nearestSafetyGap(point: { x: number; y: number }) {
    return Math.min(...safetyPoints.map((start) => Math.hypot(point.x - start.x, point.y - start.y)));
  }
}

function goldGridMines(): ResourceNode[] {
  const slots = goldGridPoints();
  return slots.map((point, index) => ({
    id: `gold-grid-${index + 1}`,
    kind: "goldMine" as const,
    x: point.x,
    y: point.y,
    amount: 6_000,
  }));
}

function goldGridPoints() {
  const lanes = [640, 1_580, 2_520, 3_456];
  return lanes.flatMap((y) => lanes.map((x) => ({ x, y })));
}

function mercPocketCamps(): MercenaryCamp[] {
  return [
    { id: "merc-pocket-frontline", x: 840, y: 760, radius: 50, hireKind: "mercenary", cost: UNIT_DEFS.mercenary.cost, stock: 5, cooldown: seconds(9), cooldownRemaining: 0 },
    { id: "merc-pocket-bow", x: 760, y: 1_020, radius: 50, hireKind: "contractArcher", cost: UNIT_DEFS.contractArcher.cost, stock: 3, cooldown: seconds(16), cooldownRemaining: 0 },
    { id: "merc-pocket-medic", x: 1_020, y: 840, radius: 50, hireKind: "fieldMedic", cost: UNIT_DEFS.fieldMedic.cost, stock: 3, cooldown: seconds(18), cooldownRemaining: 0 },
  ];
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
  const x = scale(unit.x);
  const y = scale(unit.y);
  return withUnitHome({ ...unit, x, y }, x, y);
}

function withUnitHome(unit: Unit, x: number, y: number): Unit {
  if (unit.homeX === undefined || unit.homeY === undefined) return unit;
  return { ...unit, homeX: x, homeY: y };
}

function startPositionFor(
  owner: PlayerId,
  index: number,
  total: number,
  mapSize: number,
  players: PlayerId[] = ["player", "enemy"],
  teams?: Partial<Record<PlayerId, string>>,
) {
  if (mapSize === STANDARD_MAP_SIZE) {
    if (players.length === 2 && owner === "player") return { baseX: scale(900), baseY: scale(900), mineX: scale(1180), mineY: scale(920) };
    if (players.length === 2 && owner === "enemy") return { baseX: scale(7240), baseY: scale(7240), mineX: scale(7000), mineY: scale(7140) };
    if (owner === "enemy2") return { baseX: mapSize - 480, baseY: 480, mineX: mapSize - 590, mineY: 460 };
  }

  const sideStart = sideStartFor(owner, index, total, players, teams);
  const side = sideStart.side;
  const sideIndex = sideStart.sideIndex;
  const sideCount = sideStart.sideCount;
  const lane = (sideIndex + 1) / (sideCount + 1);
  const x = side === 0 ? mapSize * 0.12 : mapSize * 0.88;
  const y = mapSize * (0.08 + lane * 0.84);
  const mineX = side === 0 ? x + 210 : x - 210;
  return { baseX: x, baseY: y, mineX, mineY: y + (sideIndex % 2 === 0 ? -90 : 90) };
}

function sideStartFor(owner: PlayerId, index: number, total: number, players: PlayerId[], teams?: Partial<Record<PlayerId, string>>) {
  if (teams) {
    const teamOrder = [...new Set(players.map((player) => teams[player] ?? player))];
    if (teamOrder.length === 2) {
      const ownerTeam = teams[owner] ?? owner;
      const sidePlayers = players.filter((player) => (teams[player] ?? player) === ownerTeam);
      return {
        side: teamOrder.indexOf(ownerTeam) === 0 ? 0 : 1,
        sideIndex: Math.max(0, sidePlayers.indexOf(owner)),
        sideCount: sidePlayers.length,
      };
    }
  }
  const side = index < Math.ceil(total / 2) ? 0 : 1;
  return {
    side,
    sideIndex: side === 0 ? index : index - Math.ceil(total / 2),
    sideCount: side === 0 ? Math.ceil(total / 2) : Math.floor(total / 2),
  };
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
      amount: 6_000,
    };
  });
}

function grandThirtyMercenaryCamps(): MercenaryCamp[] {
  const mapSize = STANDARD_MAP_SIZE * 3;
  const kinds: MercenaryUnitKind[] = ["mercenary", "contractArcher", "fieldMedic", "mercenary", "contractArcher", "fieldMedic"];
  return Array.from({ length: 6 }, (_, index) => {
    const hireKind = kinds[index]!;
    const guardedCampIndex = index * 2 + 1;
    const x = mapSize * (guardedCampIndex % 2 === 0 ? 0.44 : 0.56);
    return {
      id: `merc-grand-lane-${index + 1}`,
      x,
      y: mapSize * ((guardedCampIndex + 1) / 16),
      radius: 72,
      hireKind,
      cost: UNIT_DEFS[hireKind].cost,
      stock: index % 3 === 2 ? 3 : 4,
      cooldown: seconds(index % 3 === 2 ? 18 : 16),
      cooldownRemaining: 0,
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

function freeWildlingCamps(mapId: MapId): Unit[] {
  if (mapId !== "verdantCrossroads" && mapId !== "campRush") return [];
  return [
    ...wildlingCamp("wildling-free-green-west", 820, 2490, ["mossGnawer", "wildling"]),
    ...wildlingCamp("wildling-free-yellow-north", 2800, 850, ["stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
    ...wildlingCamp("wildling-free-red-west", 620, 3330, ["ancientStag", "ancientStag", "stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
    ...wildlingCamp("wildling-free-yellow-east", 3000, 1040, ["stonebackBrute", "gladeWitch", "thornSlinger", "barkMender"]),
    ...wildlingCamp("wildling-free-red-east", 2300, 3300, ["ancientStag", "ancientStag", "stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
    ...wildlingCamp("wildling-free-green-east", 3650, 2280, ["wildling", "thornSlinger"]),
    ...wildlingCamp("wildling-free-green-south", 1490, 3560, ["mossGnawer", "barkMender"]),
  ];
}

function wildlingCamp(prefix: string, x: number, y: number, kinds: UnitKind[]): Unit[] {
  return kinds.map((kind, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, kinds.length);
    const radius = index === 0 ? 0 : 44 + (index % 2) * 16;
    return createUnit(`${prefix}-${index + 1}`, "neutral", kind, x + detCos(angle) * radius, y + detSin(angle) * radius);
  });
}
