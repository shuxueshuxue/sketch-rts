import { BUILDING_DEFS, UNIT_DEFS } from "./catalog";
import { GENERATED_RICH_SCORE_MAP_IDS, RICH_SCORE_MAP_IDS } from "./map-ids";
import { seconds } from "./time";
import type { Building, BuildingKind, GameMap, MapId, MercenaryCamp, MercenaryUnitKind, Owner, PlayerId, ResourceNode, TrainableUnitKind, Unit, UnitKind, WorldItem } from "./types";

export { RICH_SCORE_MAP_IDS } from "./map-ids";

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

const GENERATED_RICH_MAP_SCENARIOS: MapScenario[] = GENERATED_RICH_SCORE_MAP_IDS.map((id) => ({
  id,
  name: titleizeMapId(id),
  note: "Generated official scoring map with guarded economy routes, mercenary timing, bounded neutral density, and item pressure for broad AI scoring.",
  tags: ["4096", "score", "bounded camps", "mercs"],
}));

export const MAP_SCENARIOS: MapScenario[] = [
  { id: "verdantCrossroads", name: "Verdant Crossroads", note: "Compact ladder-style map with expansions, wild camps, and a mercenary crossroad.", tags: ["4096", "expansions", "wild camps", "mercs"] },
  { id: "bareDuel", name: "Bare Duel", note: "A cleaner duel layout for AI pressure tests without neutral distractions.", tags: ["4096", "few camps", "fast contact"] },
  { id: "openClaims", name: "Open Claims", note: "Expansion-focused economy map with no neutral camps blocking the mines.", tags: ["4096", "expansions", "no wild camps"] },
  { id: "campRush", name: "Camp Rush", note: "No-expansion pressure map where neutral camps and mercenaries shape the route.", tags: ["4096", "no expansions", "wild camps"] },
  { id: "combatArena", name: "Combat Arena", note: "Small benchmark arena for mixed-army micro without economy or neutral routing.", tags: ["1600", "combat", "micro"] },
  { id: "goldGrid", name: "Gold Grid", note: "V5 economy research map with sixteen open gold points for expansion stress tests.", tags: ["4096", "research", "many mines", "no wild camps"] },
  { id: "mercPocket", name: "Merc Pocket", note: "V5 economy research map with nearby unguarded mercenary camps for hire-tempo stress tests.", tags: ["4096", "research", "mercs", "no wild camps"] },
  { id: "wildMarches", name: "Wild Marches", note: "Neutral-heavy route network where armies read as moving sketches across a compact battlefield.", tags: ["4096", "many camps", "mercs"] },
  { id: "stagHollow", name: "Stag Hollow", note: "Rich official map with guarded mines, red-camp item pressure, and a mercenary loop around the hollow.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "emberFen", name: "Ember Fen", note: "Rich official map with dense neutral rewards and competing expansion routes through a smoky lowland.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "thornedDelta", name: "Thorned Delta", note: "Rich official map with split objective lanes, contested mercenary camps, and guarded third-base routes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "silverRidge", name: "Silver Ridge", note: "Rich official map with high-ground sketch landmarks, many drops, and mine/mercenary tension.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "ashVale", name: "Ash Vale", note: "Rich official map with a smoky center valley, side mines, and guarded item camps that reward route control.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "reedBasin", name: "Reed Basin", note: "Rich official map with a wetland lane shape, staggered expansions, and mercenary camps near contested crossings.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "frostMeadow", name: "Frost Meadow", note: "Rich official map with safer outer paths, hard center camps, and several recovery routes after failed creep attempts.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "sunkenOrchard", name: "Sunken Orchard", note: "Rich official map with orchard ruins, diagonal red camps, and expansion harassment paths.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "cedarPass", name: "Cedar Pass", note: "Rich official map with a narrow pass rhythm, guarded third bases, and many valuable neutral detours.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "moonlitCauseway", name: "Moonlit Causeway", note: "Rich official map with a long center crossing, paired side mines, and mercenary stops that reward staged advances.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "briarToll", name: "Briar Toll", note: "Rich official map with thorny side tolls, guarded expansion bends, and free camps that pay for route scouting.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "amberReach", name: "Amber Reach", note: "Rich official map with offset red camps, contested mid-map gold, and safer green camps near the opening lanes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "lichenCrown", name: "Lichen Crown", note: "Rich official map with a crown-shaped neutral ring, valuable item carriers, and a mercenary triangle around the center.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "obsidianBrook", name: "Obsidian Brook", note: "Rich official map with brook-like diagonal lanes, guarded mines off the main path, and recovery camps behind the front.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "willowCircuit", name: "Willow Circuit", note: "Rich official map with a looped objective circuit, evenly spaced creep rewards, and several contested camp handoffs.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "quarrySong", name: "Quarry Song", note: "Rich official map with quarry ridges, dense yellow camps, and mercenary control that can convert creep power into tempo.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "mistHarbor", name: "Mist Harbor", note: "Rich official map with harbor-like side pockets, red-camp anchors, and multiple routes to deny greedy expansions.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "sableRun", name: "Sable Run", note: "Rich official map with long brush lanes, mirrored pocket mines, and red camps that punish straight-line pushes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "fernBarrow", name: "Fern Barrow", note: "Rich official map with barrow-like center ruins, close green routes, and mercenary rewards off the safest path.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "glassmereFord", name: "Glassmere Ford", note: "Rich official map with shallow-ford crossings, exposed third mines, and item camps that pull armies sideways.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "cinderHeath", name: "Cinder Heath", note: "Rich official map with dry heath lanes, strong red anchors, and greedy expansions behind guarded bends.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "runeMeadow", name: "Rune Meadow", note: "Rich official map with rune-stone landmarks, open mid camps, and several routes for harassment and recovery.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "saltwindBasin", name: "Saltwind Basin", note: "Rich official map with basin pockets, mercenary camps near side winds, and mines that need staged control.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "verdigrisSpire", name: "Verdigris Spire", note: "Rich official map with a vertical objective spine, guarded side mines, and mercenary pressure on both approach lanes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "pineTangle", name: "Pine Tangle", note: "Rich official map with tangled side paths, dense green recovery camps, and red rewards offset from direct base routes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "pearlBog", name: "Pearl Bog", note: "Rich official map with wet pocket expansions, hard center treasure, and mercenary control near crossing points.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "ironMoss", name: "Iron Moss", note: "Rich official map with heavier center camps, protected outer mines, and multiple lateral item-routing choices.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "duskGrove", name: "Dusk Grove", note: "Rich official map with shaded grove loops, contested yellow camps, and side mercenary pivots for harassment.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "hollowFord", name: "Hollow Ford", note: "Rich official map with shallow crossing lanes, exposed middle rewards, and guarded expansions that require staged clearing.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "copperWeald", name: "Copper Weald", note: "Rich official map with warm ridge pockets, valuable red drops, and mercenary camps that reward map control.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "opalFen", name: "Opal Fen", note: "Rich official map with offset wetland routes, split mine pressure, and enough neutral rewards for adaptive creeping.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "ivoryTarn", name: "Ivory Tarn", note: "Rich official map with pale waterline routes, guarded side gold, and mid-map drops that invite staged creeping.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "mallowRun", name: "Mallow Run", note: "Rich official map with soft outer loops, contested medic hire points, and several recovery camps near expansion paths.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "graniteBloom", name: "Granite Bloom", note: "Rich official map with hard central treasure, offset mines, and mercenary anchors away from the shortest attack lane.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "rainbarrow", name: "Rainbarrow", note: "Rich official map with barrow-like red camps, wet side approaches, and enough free camps to reward route judgment.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "umberCauseway", name: "Umber Causeway", note: "Rich official map with long causeway pressure, guarded third-base pockets, and hire camps that demand forward presence.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "tealFissure", name: "Teal Fissure", note: "Rich official map with split fissure lanes, mine guards near bends, and red drops away from straight-line pushes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "saffronFen", name: "Saffron Fen", note: "Rich official map with fen loops, bright item rewards, and expansion harassment routes around guarded crossings.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "mirrorHeath", name: "Mirror Heath", note: "Rich official map with mirrored heath pockets, balanced mercenary access, and green camps that support early scouting.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "basaltMeadow", name: "Basalt Meadow", note: "Rich official map with darker ridge flow, strong yellow camps, and side mines that need escort discipline.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "juniperDelta", name: "Juniper Delta", note: "Rich official map with branching neutral lanes, safe opening camps, and contested outer gold routes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "ochreRidge", name: "Ochre Ridge", note: "Rich official map with ridge-heavy pressure, guarded mercenary turns, and red item camps off the center line.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "quietMire", name: "Quiet Mire", note: "Rich official map with sparse linework, muddy expansion timing, and enough neutral economy to punish pure turtling.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "lanternFord", name: "Lantern Ford", note: "Rich official map with ford crossings, visible item landmarks, and hire routes that favor map presence over base racing.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "viridianToll", name: "Viridian Toll", note: "Rich official map with toll-like side objectives, guarded mines, and free camps arranged for adaptive creeping.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "marbleGrove", name: "Marble Grove", note: "Rich official map with pale grove landmarks, expensive center rewards, and multiple expansion denial paths.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "sundialReach", name: "Sundial Reach", note: "Rich official map with radial objective pressure, far-side hire value, and red rewards that shape late-game pushes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "heatherCircuit", name: "Heather Circuit", note: "Rich official map with looping heather lanes, mirrored free camps, and mercenary pivots that reward route discipline.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "chalkFen", name: "Chalk Fen", note: "Rich official map with pale wetland scars, guarded side gold, and item camps offset from direct base pressure.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "russetBrook", name: "Russet Brook", note: "Rich official map with diagonal brook pressure, recovery greens, and red rewards that pull armies across the center.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "celadonPass", name: "Celadon Pass", note: "Rich official map with pass-like staging areas, guarded third mines, and three mercenary roles in contested lanes.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "plumTarn", name: "Plum Tarn", note: "Rich official map with tarn-side expansions, dense yellow camps, and late red drops for veteran carriers.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "wispQuarry", name: "Wisp Quarry", note: "Rich official map with quarry marks, safer opening greens, and hard center camps that test creep judgment.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "brackenFord", name: "Bracken Ford", note: "Rich official map with ford crossings, bracken pockets, and hire camps positioned for staged map control.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "mossglassRun", name: "Mossglass Run", note: "Rich official map with glassy moss clearings, lateral mine routes, and free camps for secondary economy.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "auricDelta", name: "Auric Delta", note: "Rich official map with gold-toned delta branches, red-camp anchors, and multiple expansion denial paths.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "bluebellHeath", name: "Bluebell Heath", note: "Rich official map with heathland loops, quiet side objectives, and item rewards that favor mobile armies.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "cairnCauseway", name: "Cairn Causeway", note: "Rich official map with causeway pressure, cairn landmarks, and guarded mines away from straight-line attacks.", tags: ["4096", "score", "many camps", "mercs"] },
  { id: "foxgloveMire", name: "Foxglove Mire", note: "Rich official map with mire bends, strong yellow camps, and enough drops to keep objective-control AI honest.", tags: ["4096", "score", "many camps", "mercs"] },
  ...GENERATED_RICH_MAP_SCENARIOS,
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
  if (isRichScoreMap(id)) {
    return [
      ...scaled,
      ...([
        { id: "camp-far-west", kind: "campMark", x: 1680, y: 5120, size: 220, rotation: 0.9 },
        { id: "camp-far-east", kind: "campMark", x: 6240, y: 2440, size: 220, rotation: 0.1 },
        { id: "road-north-loop", kind: "road", x: 5120, y: 1780, size: 540, rotation: -0.4 },
        { id: "grove-marches", kind: "grove", x: 5460, y: 5100, size: 360, rotation: 0.3 },
        ...richVariantLandmarks(id),
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

function titleizeMapId(id: string) {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
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
  if (isRichScoreMap(mapId)) {
    return ([
      ...mainMines,
      ...expansionMines.map((resource) => scaleResource(richAuthorResource(mapId, resource))),
      { id: "gold-west-march", kind: "goldMine", x: 1620, y: 5220, amount: 6_000 },
      { id: "gold-east-march", kind: "goldMine", x: 6572, y: 5220, amount: 6_000 },
    ] satisfies ResourceNode[]).map((resource) => (resource.id.startsWith("gold-west") || resource.id.startsWith("gold-east") ? scaleResource(richAuthorResource(mapId, resource)) : resource));
  }
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
  if (isRichScoreMap(mapId)) {
    camps.push({ id: "merc-camp-west-bow-post", x: 2312, y: 4080, radius: 50, hireKind: "contractArcher", cost: UNIT_DEFS.contractArcher.cost, stock: 3, cooldown: seconds(16), cooldownRemaining: 0 });
  }
  return camps.map((camp) => scaleMercenaryCamp(isRichScoreMap(mapId) ? richAuthorMercenaryCamp(mapId, camp) : camp));
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
  if (isRichScoreMap(mapId)) {
    items.push(
      { id: "treasure-west-storm", kind: "stormStaff", x: 0, y: 0, carrierId: "wildling-west-1", cooldownRemaining: 0 },
      { id: "treasure-east-scroll", kind: "guardianScroll", x: 0, y: 0, carrierId: "wildling-east-2", cooldownRemaining: 0 },
    );
  }
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
  if (isRichScoreMap(mapId)) {
    neutralUnits.push(
      createUnit("wildling-west-1", "neutral", "stonebackBrute", 1680, 5120),
      createUnit("wildling-west-2", "neutral", "thornSlinger", 1780, 5020),
      createUnit("wildling-west-3", "neutral", "gladeWitch", 1740, 5160),
      createUnit("wildling-east-1", "neutral", "stonebackBrute", 6572, 5060),
      createUnit("wildling-east-2", "neutral", "thornSlinger", 6472, 5120),
      createUnit("wildling-east-3", "neutral", "gladeWitch", 6532, 4980),
      createUnit("wildling-merc-west-bow-1", "neutral", "gladeWitch", 2352, 4020),
      createUnit("wildling-merc-west-bow-2", "neutral", "thornSlinger", 2232, 4120),
      createUnit("wildling-merc-west-bow-3", "neutral", "barkMender", 2312, 4180),
    );
  }
  const authoredNeutrals = [...neutralUnits.map((unit) => scaleUnit(isRichScoreMap(mapId) ? richAuthorUnit(mapId, unit) : unit)), ...freeWildlingCamps(mapId)];
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
    researchQueue: [],
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

function isRichScoreMap(mapId: MapId) {
  return (RICH_SCORE_MAP_IDS as readonly string[]).includes(mapId);
}

function isGeneratedRichScoreMap(mapId: MapId) {
  return (GENERATED_RICH_SCORE_MAP_IDS as readonly string[]).includes(mapId);
}

function richAuthorResource(mapId: MapId, resource: ResourceNode): ResourceNode {
  const point = richAuthorPoint(mapId, resource.x, resource.y);
  return { ...resource, x: point.x, y: point.y };
}

function richAuthorMercenaryCamp(mapId: MapId, camp: MercenaryCamp): MercenaryCamp {
  const point = richAuthorPoint(mapId, camp.x, camp.y);
  return { ...camp, x: point.x, y: point.y };
}

function richAuthorUnit(mapId: MapId, unit: Unit): Unit {
  const point = richAuthorPoint(mapId, unit.x, unit.y);
  return withUnitHome({ ...unit, x: point.x, y: point.y }, point.x, point.y);
}

function richAuthorPoint(mapId: MapId, x: number, y: number) {
  if (isFixedRichObjectiveAuthorPoint(x, y)) return { x, y };
  if (mapId === "wildMarches") return { x, y };
  if (mapId === "emberFen") return { x: clampAuthor(x * 0.94 + 220), y: clampAuthor(y * 0.9 + 440) };
  if (mapId === "thornedDelta") return { x: clampAuthor(x * 1.03 - 120), y: clampAuthor(y * 0.95 + 210) };
  if (mapId === "silverRidge") return { x: clampAuthor(x * 0.9 + 560), y: clampAuthor(y * 0.94 + 260) };
  if (mapId === "stagHollow") return { x: clampAuthor(x * 0.92 + 330), y: clampAuthor(y * 1.04 - 160) };
  if (mapId === "ashVale") return { x: clampAuthor(x + 120), y: clampAuthor(y * 0.98 + 70) };
  if (mapId === "reedBasin") return { x: clampAuthor(x * 0.96 + 380), y: clampAuthor(y * 1.02 - 70) };
  if (mapId === "frostMeadow") return { x: clampAuthor(x * 1.04 - 210), y: clampAuthor(y * 0.92 + 310) };
  if (mapId === "sunkenOrchard") return { x: clampAuthor(x * 0.88 + 760), y: clampAuthor(y * 1.01 - 40) };
  if (mapId === "cedarPass") return { x: clampAuthor(x * 1.02 - 180), y: clampAuthor(y * 0.88 + 520) };
  if (mapId === "moonlitCauseway") return { x: clampAuthor(x * 0.97 + 170), y: clampAuthor(y * 1.07 - 310) };
  if (mapId === "briarToll") return { x: clampAuthor(x * 1.06 - 320), y: clampAuthor(y * 0.97 + 180) };
  if (mapId === "amberReach") return { x: clampAuthor(x * 0.91 + 520), y: clampAuthor(y * 1.05 - 210) };
  if (mapId === "lichenCrown") return { x: clampAuthor(x * 1.01 - 40), y: clampAuthor(y * 1.01 - 30) };
  if (mapId === "obsidianBrook") return { x: clampAuthor(x * 0.95 + 260), y: clampAuthor(y * 0.93 + 420) };
  if (mapId === "willowCircuit") return { x: clampAuthor(x * 1.08 - 340), y: clampAuthor(y * 1.03 - 120) };
  if (mapId === "quarrySong") return { x: clampAuthor(x * 0.89 + 700), y: clampAuthor(y * 0.96 + 170) };
  if (mapId === "mistHarbor") return { x: clampAuthor(x * 1.04 - 170), y: clampAuthor(y * 1.08 - 430) };
  if (mapId === "sableRun") return { x: clampAuthor(x * 1.05 - 260), y: clampAuthor(y * 0.99 + 110) };
  if (mapId === "fernBarrow") return { x: clampAuthor(x * 0.93 + 430), y: clampAuthor(y * 1.04 - 130) };
  if (mapId === "glassmereFord") return { x: clampAuthor(x * 1.02 - 80), y: clampAuthor(y * 0.91 + 300) };
  if (mapId === "cinderHeath") return { x: clampAuthor(x * 0.9 + 610), y: clampAuthor(y * 1.03 - 60) };
  if (mapId === "runeMeadow") return { x: clampAuthor(x * 1.01 + 20), y: clampAuthor(y * 0.96 + 110) };
  if (mapId === "saltwindBasin") return { x: clampAuthor(x * 0.96 + 260), y: clampAuthor(y * 1.06 - 250) };
  if (mapId === "verdigrisSpire") return { x: clampAuthor(x * 0.98 + 140), y: clampAuthor(y * 1.08 - 360) };
  if (mapId === "pineTangle") return { x: clampAuthor(x * 1.07 - 450), y: clampAuthor(y * 0.94 + 430) };
  if (mapId === "pearlBog") return { x: clampAuthor(x * 0.93 + 460), y: clampAuthor(y * 1.02 + 40) };
  if (mapId === "ironMoss") return { x: clampAuthor(x * 1.04 - 280), y: clampAuthor(y * 0.95 + 260) };
  if (mapId === "duskGrove") return { x: clampAuthor(x * 0.91 + 620), y: clampAuthor(y * 1.05 - 220) };
  if (mapId === "hollowFord") return { x: clampAuthor(x * 1.02 - 210), y: clampAuthor(y * 0.9 + 460) };
  if (mapId === "copperWeald") return { x: clampAuthor(x * 0.95 + 320), y: clampAuthor(y * 0.98 + 170) };
  if (mapId === "opalFen") return { x: clampAuthor(x * 1.05 - 220), y: clampAuthor(y * 1.04 - 150) };
  return richGeneratedPoint(mapId, x, y, AUTHOR_MAP_SIZE);
}

function isFixedRichObjectiveAuthorPoint(x: number, y: number) {
  // @@@fixed-rich-objective-clusters - Score maps may vary routes, but paired early objectives must keep camp and guard geometry together.
  return (
    (x === 1620 && y === 5220) ||
    (x === 1680 && y === 5120) ||
    (x === 1780 && y === 5020) ||
    (x === 1740 && y === 5160) ||
    (x === 6572 && y === 5220) ||
    (x === 6572 && y === 5060) ||
    (x === 6472 && y === 5120) ||
    (x === 6532 && y === 4980) ||
    (x === 4096 && y === 4200) ||
    (x === 4416 && y === 4460) ||
    (x === 3996 && y === 4070) ||
    (x === 4176 && y === 4310) ||
    (x === 4086 && y === 4210) ||
    (x === 3976 && y === 4300) ||
    (x === 5880 && y === 3880) ||
    (x === 5840 && y === 3820) ||
    (x === 5960 && y === 3920) ||
    (x === 5880 && y === 3980) ||
    (x === 2312 && y === 4080) ||
    (x === 2352 && y === 4020) ||
    (x === 2232 && y === 4120) ||
    (x === 2312 && y === 4180)
  );
}

function richStandardPoint(mapId: MapId, x: number, y: number) {
  if (mapId === "wildMarches") return { x, y };
  if (mapId === "emberFen") return { x: clampStandard(x * 0.94 + 110), y: clampStandard(y * 0.9 + 220) };
  if (mapId === "thornedDelta") return { x: clampStandard(x * 1.03 - 60), y: clampStandard(y * 0.95 + 105) };
  if (mapId === "silverRidge") return { x: clampStandard(x * 0.9 + 280), y: clampStandard(y * 0.94 + 130) };
  if (mapId === "stagHollow") return { x: clampStandard(x * 0.92 + 165), y: clampStandard(y * 1.04 - 80) };
  if (mapId === "ashVale") return { x: clampStandard(x + 60), y: clampStandard(y * 0.98 + 35) };
  if (mapId === "reedBasin") return { x: clampStandard(x * 0.96 + 190), y: clampStandard(y * 1.02 - 35) };
  if (mapId === "frostMeadow") return { x: clampStandard(x * 1.04 - 105), y: clampStandard(y * 0.92 + 155) };
  if (mapId === "sunkenOrchard") return { x: clampStandard(x * 0.88 + 380), y: clampStandard(y * 1.01 - 20) };
  if (mapId === "cedarPass") return { x: clampStandard(x * 1.02 - 90), y: clampStandard(y * 0.88 + 260) };
  if (mapId === "moonlitCauseway") return { x: clampStandard(x * 0.97 + 85), y: clampStandard(y * 1.07 - 155) };
  if (mapId === "briarToll") return { x: clampStandard(x * 1.06 - 160), y: clampStandard(y * 0.97 + 90) };
  if (mapId === "amberReach") return { x: clampStandard(x * 0.91 + 260), y: clampStandard(y * 1.05 - 105) };
  if (mapId === "lichenCrown") return { x: clampStandard(x * 1.01 - 20), y: clampStandard(y * 1.01 - 15) };
  if (mapId === "obsidianBrook") return { x: clampStandard(x * 0.95 + 130), y: clampStandard(y * 0.93 + 210) };
  if (mapId === "willowCircuit") return { x: clampStandard(x * 1.08 - 170), y: clampStandard(y * 1.03 - 60) };
  if (mapId === "quarrySong") return { x: clampStandard(x * 0.89 + 350), y: clampStandard(y * 0.96 + 85) };
  if (mapId === "mistHarbor") return { x: clampStandard(x * 1.04 - 85), y: clampStandard(y * 1.08 - 215) };
  if (mapId === "sableRun") return { x: clampStandard(x * 1.05 - 130), y: clampStandard(y * 0.99 + 55) };
  if (mapId === "fernBarrow") return { x: clampStandard(x * 0.93 + 215), y: clampStandard(y * 1.04 - 65) };
  if (mapId === "glassmereFord") return { x: clampStandard(x * 1.02 - 40), y: clampStandard(y * 0.91 + 150) };
  if (mapId === "cinderHeath") return { x: clampStandard(x * 0.9 + 305), y: clampStandard(y * 1.03 - 30) };
  if (mapId === "runeMeadow") return { x: clampStandard(x * 1.01 + 10), y: clampStandard(y * 0.96 + 55) };
  if (mapId === "saltwindBasin") return { x: clampStandard(x * 0.96 + 130), y: clampStandard(y * 1.06 - 125) };
  if (mapId === "verdigrisSpire") return { x: clampStandard(x * 0.98 + 70), y: clampStandard(y * 1.08 - 180) };
  if (mapId === "pineTangle") return { x: clampStandard(x * 1.07 - 225), y: clampStandard(y * 0.94 + 215) };
  if (mapId === "pearlBog") return { x: clampStandard(x * 0.93 + 230), y: clampStandard(y * 1.02 + 20) };
  if (mapId === "ironMoss") return { x: clampStandard(x * 1.04 - 140), y: clampStandard(y * 0.95 + 130) };
  if (mapId === "duskGrove") return { x: clampStandard(x * 0.91 + 310), y: clampStandard(y * 1.05 - 110) };
  if (mapId === "hollowFord") return { x: clampStandard(x * 1.02 - 105), y: clampStandard(y * 0.9 + 230) };
  if (mapId === "copperWeald") return { x: clampStandard(x * 0.95 + 160), y: clampStandard(y * 0.98 + 85) };
  if (mapId === "opalFen") return { x: clampStandard(x * 1.05 - 110), y: clampStandard(y * 1.04 - 75) };
  return richGeneratedPoint(mapId, x, y, STANDARD_MAP_SIZE);
}

function richGeneratedPoint(mapId: MapId, x: number, y: number, mapSize: number) {
  const seed = hashString(mapId);
  if (!isGeneratedRichScoreMap(mapId)) {
    const shiftX = (((seed >>> 10) % 161) - 80) * (mapSize / AUTHOR_MAP_SIZE);
    const shiftY = (((seed >>> 19) % 161) - 80) * (mapSize / AUTHOR_MAP_SIZE);
    const clamp = mapSize === AUTHOR_MAP_SIZE ? clampAuthor : clampStandard;
    return { x: clamp(x + shiftX), y: clamp(y + shiftY) };
  }
  const center = mapSize / 2;
  const localX = x - center;
  const localY = y - center;
  const scaleX = 0.96 + ((seed >>> 1) % 9) / 100;
  const scaleY = 0.96 + ((seed >>> 6) % 9) / 100;
  const angle = (((seed >>> 11) % 15) - 7) * 0.008;
  const shear = (((seed >>> 16) % 13) - 6) * 0.004;
  const shiftX = (((seed >>> 21) % 241) - 120) * (mapSize / AUTHOR_MAP_SIZE);
  const shiftY = (((seed >>> 9) % 241) - 120) * (mapSize / AUTHOR_MAP_SIZE);
  const stretchedX = localX * scaleX;
  const stretchedY = localY * scaleY;
  const rotatedX = stretchedX * Math.cos(angle) - stretchedY * Math.sin(angle) + stretchedY * shear;
  const rotatedY = stretchedX * Math.sin(angle) + stretchedY * Math.cos(angle) + stretchedX * shear * 0.5;
  const clamp = mapSize === AUTHOR_MAP_SIZE ? clampAuthor : clampStandard;
  // @@@rich-map-family - Seeded transforms keep every generated official map fair but stop them from being cloned objective routes.
  return keepAwayFromStartingMines({ x: clamp(center + rotatedX + shiftX), y: clamp(center + rotatedY + shiftY) }, mapSize, clamp);
}

function keepAwayFromStartingMines(point: { x: number; y: number }, mapSize: number, clamp: (value: number) => number) {
  const factor = mapSize / AUTHOR_MAP_SIZE;
  const safeGap = 480 * (mapSize / STANDARD_MAP_SIZE);
  let adjusted = point;
  const mines = [
    { x: 1180 * factor, y: 920 * factor },
    { x: 7000 * factor, y: 7140 * factor },
    ...teamLaneMineSafetyPoints(mapSize),
  ];
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const mine of mines) {
      const dx = adjusted.x - mine.x;
      const dy = adjusted.y - mine.y;
      const gap = Math.hypot(dx, dy);
      if (gap >= safeGap) continue;
      const tieBreakX = adjusted.x >= mapSize / 2 ? 1 : -1;
      const tieBreakY = adjusted.y >= mapSize / 2 ? 1 : -1;
      const unitX = gap > 0 ? dx / gap : tieBreakX / Math.SQRT2;
      const unitY = gap > 0 ? dy / gap : tieBreakY / Math.SQRT2;
      adjusted = { x: clamp(mine.x + unitX * safeGap), y: clamp(mine.y + unitY * safeGap) };
      moved = true;
    }
    if (!moved) break;
  }
  return adjusted;
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
          candidates.push({ x: clamp(point.x + Math.cos(angle) * safeGap), y: clamp(point.y + Math.sin(angle) * safeGap) });
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

function teamLaneMineSafetyPoints(mapSize: number) {
  const offsetScale = mapSize / STANDARD_MAP_SIZE;
  const points: { x: number; y: number }[] = [];
  for (const side of [0, 1]) {
    for (let sideCount = 1; sideCount <= 4; sideCount += 1) {
      for (let sideIndex = 0; sideIndex < sideCount; sideIndex += 1) {
        const lane = (sideIndex + 1) / (sideCount + 1);
        const x = side === 0 ? mapSize * 0.12 : mapSize * 0.88;
        const y = mapSize * (0.08 + lane * 0.84);
        points.push({ x: side === 0 ? x + 210 * offsetScale : x - 210 * offsetScale, y: y + (sideIndex % 2 === 0 ? -90 : 90) * offsetScale });
      }
    }
  }
  return points;
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

function hashString(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function clampAuthor(value: number) {
  return Math.max(260, Math.min(AUTHOR_MAP_SIZE - 260, value));
}

function clampStandard(value: number) {
  return Math.max(130, Math.min(STANDARD_MAP_SIZE - 130, value));
}

function richVariantLandmarks(mapId: MapId): GameMap["landmarks"] {
  if (mapId === "stagHollow") {
    return [
      { id: "stag-hollow-ring", kind: "grove", x: 3020, y: 2840, size: 480, rotation: 0.8 },
      { id: "stag-hollow-ridge", kind: "ridge", x: 5260, y: 5520, size: 420, rotation: -0.35 },
      { id: "stag-hollow-road", kind: "road", x: 2360, y: 5720, size: 520, rotation: -0.6 },
    ];
  }
  if (mapId === "emberFen") {
    return [
      { id: "ember-fen-ditch-a", kind: "ditch", x: 3180, y: 1980, size: 520, rotation: 0.45 },
      { id: "ember-fen-ditch-b", kind: "ditch", x: 5140, y: 5620, size: 540, rotation: -0.55 },
      { id: "ember-fen-stone", kind: "bannerStone", x: 5940, y: 2140, size: 160, rotation: 0.2 },
    ];
  }
  if (mapId === "thornedDelta") {
    return [
      { id: "thorn-delta-road-a", kind: "road", x: 2080, y: 3740, size: 620, rotation: 0.15 },
      { id: "thorn-delta-road-b", kind: "road", x: 5980, y: 4520, size: 620, rotation: -0.15 },
      { id: "thorn-delta-ruin", kind: "ruin", x: 4100, y: 2440, size: 260, rotation: 0.4 },
    ];
  }
  if (mapId === "silverRidge") {
    return [
      { id: "silver-ridge-north", kind: "ridge", x: 2540, y: 1580, size: 500, rotation: 0.1 },
      { id: "silver-ridge-south", kind: "ridge", x: 5600, y: 6500, size: 520, rotation: -0.2 },
      { id: "silver-ridge-grove", kind: "grove", x: 6120, y: 3600, size: 360, rotation: 0.6 },
    ];
  }
  if (mapId === "ashVale") {
    return [
      { id: "ash-vale-ditch", kind: "ditch", x: 4180, y: 2140, size: 560, rotation: -0.15 },
      { id: "ash-vale-road", kind: "road", x: 2380, y: 4880, size: 540, rotation: 0.62 },
      { id: "ash-vale-stone", kind: "bannerStone", x: 5460, y: 5480, size: 160, rotation: -0.2 },
    ];
  }
  if (mapId === "reedBasin") {
    return [
      { id: "reed-basin-ditch-a", kind: "ditch", x: 2400, y: 1760, size: 500, rotation: 0.7 },
      { id: "reed-basin-ditch-b", kind: "ditch", x: 5680, y: 5160, size: 520, rotation: -0.7 },
      { id: "reed-basin-grove", kind: "grove", x: 3380, y: 5740, size: 390, rotation: 0.3 },
    ];
  }
  if (mapId === "frostMeadow") {
    return [
      { id: "frost-meadow-ridge", kind: "ridge", x: 3220, y: 2040, size: 520, rotation: 0.18 },
      { id: "frost-meadow-road", kind: "road", x: 5480, y: 3260, size: 560, rotation: -0.48 },
      { id: "frost-meadow-ruin", kind: "ruin", x: 2460, y: 6040, size: 250, rotation: 0.5 },
    ];
  }
  if (mapId === "sunkenOrchard") {
    return [
      { id: "sunken-orchard-grove-a", kind: "grove", x: 2080, y: 3260, size: 460, rotation: 0.15 },
      { id: "sunken-orchard-grove-b", kind: "grove", x: 5940, y: 4740, size: 430, rotation: -0.2 },
      { id: "sunken-orchard-ruin", kind: "ruin", x: 4100, y: 5880, size: 260, rotation: 0.22 },
    ];
  }
  if (mapId === "cedarPass") {
    return [
      { id: "cedar-pass-ridge-a", kind: "ridge", x: 2780, y: 2880, size: 500, rotation: 0.95 },
      { id: "cedar-pass-ridge-b", kind: "ridge", x: 5520, y: 4360, size: 520, rotation: -0.85 },
      { id: "cedar-pass-road", kind: "road", x: 4200, y: 3960, size: 620, rotation: 0.04 },
    ];
  }
  if (mapId === "moonlitCauseway") {
    return [
      { id: "moonlit-causeway-road", kind: "road", x: 4100, y: 4020, size: 760, rotation: 0.72 },
      { id: "moonlit-causeway-stone", kind: "bannerStone", x: 3180, y: 2680, size: 170, rotation: 0.22 },
      { id: "moonlit-causeway-grove", kind: "grove", x: 5480, y: 5380, size: 390, rotation: -0.3 },
    ];
  }
  if (mapId === "briarToll") {
    return [
      { id: "briar-toll-grove-a", kind: "grove", x: 1880, y: 4200, size: 430, rotation: 0.5 },
      { id: "briar-toll-grove-b", kind: "grove", x: 6160, y: 3100, size: 430, rotation: -0.4 },
      { id: "briar-toll-road", kind: "road", x: 4260, y: 2760, size: 560, rotation: -0.18 },
    ];
  }
  if (mapId === "amberReach") {
    return [
      { id: "amber-reach-ridge", kind: "ridge", x: 4940, y: 2360, size: 500, rotation: 0.38 },
      { id: "amber-reach-ditch", kind: "ditch", x: 3020, y: 5680, size: 520, rotation: -0.5 },
      { id: "amber-reach-stone", kind: "bannerStone", x: 3940, y: 4140, size: 170, rotation: 0.1 },
    ];
  }
  if (mapId === "lichenCrown") {
    return [
      { id: "lichen-crown-grove-n", kind: "grove", x: 4080, y: 1880, size: 410, rotation: 0.1 },
      { id: "lichen-crown-grove-s", kind: "grove", x: 4080, y: 6100, size: 410, rotation: -0.1 },
      { id: "lichen-crown-ruin", kind: "ruin", x: 4080, y: 4080, size: 300, rotation: 0.6 },
    ];
  }
  if (mapId === "obsidianBrook") {
    return [
      { id: "obsidian-brook-ditch", kind: "ditch", x: 4260, y: 3720, size: 700, rotation: 0.78 },
      { id: "obsidian-brook-ridge", kind: "ridge", x: 5720, y: 5560, size: 480, rotation: -0.35 },
      { id: "obsidian-brook-road", kind: "road", x: 2440, y: 2460, size: 540, rotation: 0.72 },
    ];
  }
  if (mapId === "willowCircuit") {
    return [
      { id: "willow-circuit-road-a", kind: "road", x: 2420, y: 3980, size: 560, rotation: 0.08 },
      { id: "willow-circuit-road-b", kind: "road", x: 5740, y: 3980, size: 560, rotation: -0.08 },
      { id: "willow-circuit-grove", kind: "grove", x: 4100, y: 4020, size: 470, rotation: 0.4 },
    ];
  }
  if (mapId === "quarrySong") {
    return [
      { id: "quarry-song-ridge-a", kind: "ridge", x: 2520, y: 5020, size: 520, rotation: 1.05 },
      { id: "quarry-song-ridge-b", kind: "ridge", x: 5600, y: 2740, size: 520, rotation: -1.0 },
      { id: "quarry-song-ruin", kind: "ruin", x: 4300, y: 4500, size: 270, rotation: 0.18 },
    ];
  }
  if (mapId === "mistHarbor") {
    return [
      { id: "mist-harbor-ditch", kind: "ditch", x: 3060, y: 2280, size: 560, rotation: -0.7 },
      { id: "mist-harbor-road", kind: "road", x: 5320, y: 5720, size: 590, rotation: 0.64 },
      { id: "mist-harbor-stone", kind: "bannerStone", x: 4020, y: 3060, size: 160, rotation: -0.3 },
    ];
  }
  if (mapId === "sableRun") {
    return [
      { id: "sable-run-road", kind: "road", x: 2460, y: 3720, size: 650, rotation: 0.18 },
      { id: "sable-run-grove", kind: "grove", x: 5920, y: 4660, size: 410, rotation: -0.45 },
      { id: "sable-run-ridge", kind: "ridge", x: 4220, y: 6120, size: 500, rotation: 0.25 },
    ];
  }
  if (mapId === "fernBarrow") {
    return [
      { id: "fern-barrow-ruin", kind: "ruin", x: 4140, y: 3920, size: 330, rotation: 0.12 },
      { id: "fern-barrow-grove", kind: "grove", x: 2680, y: 5460, size: 440, rotation: 0.38 },
      { id: "fern-barrow-road", kind: "road", x: 5480, y: 2740, size: 540, rotation: -0.52 },
    ];
  }
  if (mapId === "glassmereFord") {
    return [
      { id: "glassmere-ford-ditch", kind: "ditch", x: 4040, y: 3520, size: 720, rotation: 0.68 },
      { id: "glassmere-ford-stone", kind: "bannerStone", x: 3040, y: 2340, size: 170, rotation: 0.2 },
      { id: "glassmere-ford-road", kind: "road", x: 5220, y: 5120, size: 610, rotation: 0.62 },
    ];
  }
  if (mapId === "cinderHeath") {
    return [
      { id: "cinder-heath-ridge", kind: "ridge", x: 5060, y: 1980, size: 500, rotation: 0.34 },
      { id: "cinder-heath-ditch", kind: "ditch", x: 2940, y: 5900, size: 560, rotation: -0.58 },
      { id: "cinder-heath-stone", kind: "bannerStone", x: 3940, y: 4300, size: 170, rotation: 0.16 },
    ];
  }
  if (mapId === "runeMeadow") {
    return [
      { id: "rune-meadow-stone-a", kind: "bannerStone", x: 3300, y: 2940, size: 175, rotation: 0.12 },
      { id: "rune-meadow-stone-b", kind: "bannerStone", x: 4960, y: 5100, size: 175, rotation: -0.18 },
      { id: "rune-meadow-grove", kind: "grove", x: 4140, y: 4040, size: 470, rotation: 0.52 },
    ];
  }
  if (mapId === "saltwindBasin") {
    return [
      { id: "saltwind-basin-ditch", kind: "ditch", x: 3100, y: 2360, size: 620, rotation: -0.64 },
      { id: "saltwind-basin-road", kind: "road", x: 5500, y: 5600, size: 600, rotation: 0.7 },
      { id: "saltwind-basin-ridge", kind: "ridge", x: 4100, y: 3320, size: 470, rotation: -0.1 },
    ];
  }
  if (mapId === "verdigrisSpire") {
    return [
      { id: "verdigris-spire-stone", kind: "bannerStone", x: 4160, y: 2140, size: 190, rotation: 0.08 },
      { id: "verdigris-spire-road", kind: "road", x: 4180, y: 4620, size: 720, rotation: 1.48 },
      { id: "verdigris-spire-grove", kind: "grove", x: 5780, y: 5400, size: 420, rotation: -0.34 },
    ];
  }
  if (mapId === "pineTangle") {
    return [
      { id: "pine-tangle-grove-a", kind: "grove", x: 2220, y: 3260, size: 470, rotation: 0.44 },
      { id: "pine-tangle-grove-b", kind: "grove", x: 6080, y: 4380, size: 450, rotation: -0.42 },
      { id: "pine-tangle-road", kind: "road", x: 4040, y: 2460, size: 610, rotation: -0.16 },
    ];
  }
  if (mapId === "pearlBog") {
    return [
      { id: "pearl-bog-ditch-a", kind: "ditch", x: 2860, y: 1860, size: 590, rotation: 0.62 },
      { id: "pearl-bog-ditch-b", kind: "ditch", x: 5280, y: 5840, size: 620, rotation: -0.6 },
      { id: "pearl-bog-stone", kind: "bannerStone", x: 6060, y: 2680, size: 165, rotation: 0.18 },
    ];
  }
  if (mapId === "ironMoss") {
    return [
      { id: "iron-moss-ridge-a", kind: "ridge", x: 3140, y: 2080, size: 540, rotation: 0.2 },
      { id: "iron-moss-ridge-b", kind: "ridge", x: 5400, y: 5980, size: 540, rotation: -0.26 },
      { id: "iron-moss-ruin", kind: "ruin", x: 4300, y: 4160, size: 300, rotation: 0.36 },
    ];
  }
  if (mapId === "duskGrove") {
    return [
      { id: "dusk-grove-loop-a", kind: "grove", x: 1880, y: 3940, size: 460, rotation: 0.58 },
      { id: "dusk-grove-loop-b", kind: "grove", x: 6120, y: 2800, size: 430, rotation: -0.36 },
      { id: "dusk-grove-road", kind: "road", x: 4160, y: 5220, size: 610, rotation: 0.5 },
    ];
  }
  if (mapId === "hollowFord") {
    return [
      { id: "hollow-ford-ditch", kind: "ditch", x: 4000, y: 3320, size: 760, rotation: 0.68 },
      { id: "hollow-ford-road", kind: "road", x: 5520, y: 5020, size: 620, rotation: 0.66 },
      { id: "hollow-ford-ruin", kind: "ruin", x: 2780, y: 2380, size: 260, rotation: 0.18 },
    ];
  }
  if (mapId === "copperWeald") {
    return [
      { id: "copper-weald-ridge", kind: "ridge", x: 5040, y: 2440, size: 520, rotation: 0.32 },
      { id: "copper-weald-grove", kind: "grove", x: 2940, y: 5600, size: 440, rotation: -0.5 },
      { id: "copper-weald-stone", kind: "bannerStone", x: 4100, y: 4100, size: 180, rotation: 0.1 },
    ];
  }
  if (mapId === "opalFen") {
    return [
      { id: "opal-fen-ditch", kind: "ditch", x: 3060, y: 2460, size: 650, rotation: -0.58 },
      { id: "opal-fen-road", kind: "road", x: 5500, y: 5500, size: 640, rotation: 0.7 },
      { id: "opal-fen-grove", kind: "grove", x: 4200, y: 3320, size: 460, rotation: -0.08 },
    ];
  }
  return richGeneratedLandmarks(mapId);
}

function richGeneratedLandmarks(mapId: MapId): GameMap["landmarks"] {
  const seed = hashString(mapId);
  const primaryKinds: GameMap["landmarks"][number]["kind"][] = ["grove", "ridge", "ditch", "road", "ruin", "bannerStone"];
  const kindA = primaryKinds[seed % primaryKinds.length]!;
  const kindB = primaryKinds[(seed >>> 5) % primaryKinds.length]!;
  return [
    { id: `${mapId}-rich-a`, kind: kindA, x: 1900 + (seed % 900), y: 1240 + ((seed >>> 8) % 1280), size: 430 + (seed % 120), rotation: ((seed % 70) - 35) / 100 },
    { id: `${mapId}-rich-b`, kind: kindB, x: 5080 + ((seed >>> 12) % 920), y: 4020 + ((seed >>> 18) % 1280), size: 390 + ((seed >>> 3) % 150), rotation: (((seed >>> 9) % 90) - 45) / 100 },
    { id: `${mapId}-rich-c`, kind: "campMark", x: 3300 + ((seed >>> 4) % 1540), y: 2740 + ((seed >>> 16) % 1420), size: 210 + ((seed >>> 2) % 80), rotation: (((seed >>> 11) % 120) - 60) / 100 },
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
  if (mapId !== "verdantCrossroads" && mapId !== "campRush" && !isRichScoreMap(mapId)) return [];
  if (isRichScoreMap(mapId)) {
    return [
      ...wildlingCamp(mapId, "wildling-free-yellow-north", 2800, 850, ["stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
      ...wildlingCamp(mapId, "wildling-free-red-west", 620, 3330, ["ancientStag", "ancientStag", "stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
      ...wildlingCamp(mapId, "wildling-free-red-east", 2300, 3300, ["ancientStag", "ancientStag", "stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
    ];
  }
  return [
    ...wildlingCamp(mapId, "wildling-free-green-west", 820, 2490, ["mossGnawer", "wildling"]),
    ...wildlingCamp(mapId, "wildling-free-yellow-north", 2800, 850, ["stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
    ...wildlingCamp(mapId, "wildling-free-red-west", 620, 3330, ["ancientStag", "ancientStag", "stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
    ...wildlingCamp(mapId, "wildling-free-yellow-east", 3000, 1040, ["stonebackBrute", "gladeWitch", "thornSlinger", "barkMender"]),
    ...wildlingCamp(mapId, "wildling-free-red-east", 2300, 3300, ["ancientStag", "ancientStag", "stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger"]),
    ...wildlingCamp(mapId, "wildling-free-green-east", 3650, 2280, ["wildling", "thornSlinger"]),
    ...wildlingCamp(mapId, "wildling-free-green-south", 1490, 3560, ["mossGnawer", "barkMender"]),
  ];
}

function wildlingCamp(mapId: MapId, prefix: string, x: number, y: number, kinds: UnitKind[]): Unit[] {
  const point = isRichScoreMap(mapId) ? richStandardPoint(mapId, x, y) : { x, y };
  return kinds.map((kind, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, kinds.length);
    const radius = index === 0 ? 0 : 44 + (index % 2) * 16;
    return createUnit(`${prefix}-${index + 1}`, "neutral", kind, point.x + Math.cos(angle) * radius, point.y + Math.sin(angle) * radius);
  });
}
