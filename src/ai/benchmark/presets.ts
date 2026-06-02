import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { AI_SCRIPT_LIBRARY, type AiScript } from "../policy";
import { sketchScene } from "../../sdk/scene";
import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import type { ItemKind, MapId, PlayerId, RaceId, UnitKind } from "../../shared/types";
import type { BenchmarkEvaluationReport, BenchmarkInput, BenchmarkReport, BenchmarkMatchInput } from "../../sdk/benchmark/core";
import { runBenchmark } from "../../sdk/benchmark/core";
import type { SdkAgentAdapter } from "../../sdk/game-runner";

export type GauntletMapSelection<TMapId extends string> = {
  mode: "sample" | "full";
  seed: string;
  mapIds: TMapId[];
};

export type GauntletSelectionEnv = Partial<Record<"AI_GAUNTLET_FULL" | "AI_GAUNTLET_MAP_COUNT" | "AI_GAUNTLET_SEED", string>>;

export type AiVersionBenchmarkOptions = {
  seed?: string;
  mapCount?: number;
  full?: boolean;
  maxTicks?: number;
  thinkInterval?: number;
  adapter?: SdkAgentAdapter;
};

export type AiVersionBenchmarkDashboardReport = {
  seed: string;
  mapPoolSize: number;
  selectedRichScoreMapIds: MapId[];
  scoreSummary: BenchmarkEvaluationSummary;
  probeSummaries: BenchmarkEvaluationSummary[];
  combatSummaries: BenchmarkEvaluationSummary[];
  sanitySummary: BenchmarkEvaluationSummary;
  report: BenchmarkReport;
};

export type BenchmarkEvaluationSummary = {
  name: string;
  tag?: string;
  wins: number;
  losses: number;
  failures: number;
  successRate: number;
  matchCount: number;
};

const DEFAULT_SCORE_SAMPLE_SIZE = 10;
const DEFAULT_ONE_V_THREE_PROBE_SIZE = 2;
const DEFAULT_TWO_V_THREE_PROBE_SIZE = 2;
const DEFAULT_SANITY_SAMPLE_SIZE = 3;
const DEFAULT_SAMPLE_SIZE = DEFAULT_SCORE_SAMPLE_SIZE + DEFAULT_ONE_V_THREE_PROBE_SIZE + DEFAULT_TWO_V_THREE_PROBE_SIZE + DEFAULT_SANITY_SAMPLE_SIZE;
const DEFAULT_MAX_TICKS = 48_000;
const DEFAULT_THINK_INTERVAL = 45;
let randomSeedCounter = 0;
const V2: PlayerId = "v2";
const V2B: PlayerId = "v2b";
const V1A: PlayerId = "v1a";
const V1B: PlayerId = "v1b";
const V1C: PlayerId = "v1c";
const TEAMS: Record<PlayerId, string> = { v2: "north", v2b: "north", v1a: "south", v1b: "south", v1c: "south" };
const RACES: Record<PlayerId, RaceId> = { v2: "grove", v2b: "grove", v1a: "grove", v1b: "grove", v1c: "grove" };
const V2_COMBAT_SCRIPTS: AiScript[] = [AI_SCRIPT_LIBRARY.items, AI_SCRIPT_LIBRARY.abilities, AI_SCRIPT_LIBRARY.focusFire, AI_SCRIPT_LIBRARY.attackWave];
const V1_COMBAT_SCRIPTS: AiScript[] = [AI_SCRIPT_LIBRARY.items, AI_SCRIPT_LIBRARY.abilities, AI_SCRIPT_LIBRARY.attackWave];

export function selectGauntletRichScoreMaps<TMapId extends string>(mapIds: readonly TMapId[], env: GauntletSelectionEnv = {}): GauntletMapSelection<TMapId> {
  const seed = env.AI_GAUNTLET_SEED ?? randomSeed();
  if (env.AI_GAUNTLET_FULL === "1") return { mode: "full", seed, mapIds: [...mapIds] };

  const sampleSize = Math.min(parseSampleSize(env.AI_GAUNTLET_MAP_COUNT), mapIds.length);
  return { mode: "sample", seed, mapIds: shuffledBySeed(mapIds, seed).slice(0, sampleSize) };
}

export function createAiVersionBenchmarkInput(options: AiVersionBenchmarkOptions = {}) {
  const env: GauntletSelectionEnv = {};
  if (options.seed !== undefined) env.AI_GAUNTLET_SEED = options.seed;
  if (options.mapCount !== undefined) env.AI_GAUNTLET_MAP_COUNT = String(options.mapCount);
  if (options.full) env.AI_GAUNTLET_FULL = "1";
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], env);
  const allocatedMaps = allocateGauntletBenchmarkMaps(selection.mapIds);
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  const thinkInterval = options.thinkInterval ?? DEFAULT_THINK_INTERVAL;
  const adapter = options.adapter ?? "external";
  const agents = (players: PlayerId[], options: { disableV2WorkerHarassment?: boolean } = {}) =>
    Object.fromEntries(
      players.map((owner) => [
        owner,
        {
          adapter,
          team: TEAMS[owner],
          race: RACES[owner],
          version: owner === V2 || owner === V2B ? "v2" : "v1",
          versionLabel: owner === V2 || owner === V2B ? "v2" : "v1",
          ...((owner === V2 || owner === V2B) && options.disableV2WorkerHarassment ? { disabledBehaviors: ["workerHarassment"] as const } : {}),
        },
      ]),
    ) as Record<PlayerId, AiGameAgent>;
  const match = (name: string, mapId: MapId, players: PlayerId[], index: number): BenchmarkMatchInput<AiGameAgent> => ({
    name,
    mapId,
    agents: agents(players, { disableV2WorkerHarassment: index % 2 === 1 }),
    commandPlanner: createAiGameCommandPlanner(),
    maxTicks,
    thinkInterval,
  });
  const input: BenchmarkInput<AiGameAgent> = {
    name: "AI Version Benchmark",
    evaluations: [
      {
        name: "1v2 score",
        tag: "melee",
        matches: allocatedMaps.score.map((mapId, index) => match(`${mapId} 1v2`, mapId, [V2, V1A, V1B], index)),
      },
      {
        name: "1v3 probe",
        tag: "melee",
        matches: allocatedMaps.oneVThreeProbe.map((mapId, index) => match(`${mapId} 1v3`, mapId, [V2, V1A, V1B, V1C], index)),
      },
      {
        name: "2v3 probe",
        tag: "melee",
        matches: allocatedMaps.twoVThreeProbe.map((mapId, index) => match(`${mapId} 2v3`, mapId, [V2, V2B, V1A, V1B, V1C], index)),
      },
      {
        name: "1v1 sanity",
        tag: "melee",
        matches: allocatedMaps.sanity.map((mapId, index) => match(`${mapId} 1v1`, mapId, [V2, V1A], index)),
      },
      {
        name: "15v20 mixed combat",
        tag: "combat",
        matches: combatMatches("15v20", 15, 20, adapter, maxTicks, thinkInterval),
      },
      {
        name: "10v12 mixed combat",
        tag: "combat",
        matches: combatMatches("10v12", 10, 12, adapter, maxTicks, thinkInterval),
      },
    ],
  };
  return { input, selection };
}

export function allocateGauntletBenchmarkMaps<TMapId extends string>(mapIds: readonly TMapId[]) {
  let cursor = 0;
  const take = (count: number) => {
    const result = mapIds.slice(cursor, cursor + count);
    cursor += count;
    return result;
  };
  return {
    score: take(DEFAULT_SCORE_SAMPLE_SIZE),
    oneVThreeProbe: take(DEFAULT_ONE_V_THREE_PROBE_SIZE),
    twoVThreeProbe: take(DEFAULT_TWO_V_THREE_PROBE_SIZE),
    sanity: take(DEFAULT_SANITY_SAMPLE_SIZE),
  };
}

export function runAiVersionBenchmark(options: AiVersionBenchmarkOptions = {}): AiVersionBenchmarkDashboardReport {
  const { input, selection } = createAiVersionBenchmarkInput(options);
  const report = runBenchmark(input);
  const [score, oneVThreeProbe, twoVThreeProbe, sanity, combat15v20, combat10v12] = report.evaluations;
  if (!score || !oneVThreeProbe || !twoVThreeProbe || !sanity || !combat15v20 || !combat10v12) throw new Error("AI version benchmark preset must produce melee score, probe, sanity, and combat evaluations");
  return {
    seed: selection.seed,
    mapPoolSize: RICH_SCORE_MAP_IDS.length,
    selectedRichScoreMapIds: selection.mapIds,
    scoreSummary: summarizeEvaluation(score, "north"),
    probeSummaries: [summarizeEvaluation(oneVThreeProbe, "north"), summarizeEvaluation(twoVThreeProbe, "north")],
    combatSummaries: [summarizeCombatEvaluation(combat15v20), summarizeCombatEvaluation(combat10v12)],
    sanitySummary: summarizeSanityEvaluation(sanity),
    report,
  };
}

function summarizeEvaluation(evaluation: BenchmarkEvaluationReport, expectedWinnerTeam: string): BenchmarkEvaluationSummary {
  const wins = evaluation.matches.filter((match) => match.result.winnerTeam === expectedWinnerTeam).length;
  const losses = evaluation.matches.length - wins;
  return {
    name: evaluation.name,
    ...(evaluation.tag ? { tag: evaluation.tag } : {}),
    wins,
    losses,
    failures: losses,
    successRate: evaluation.matches.length === 0 ? 0 : wins / evaluation.matches.length,
    matchCount: evaluation.matches.length,
  };
}

export function summarizeSanityEvaluation(evaluation: BenchmarkEvaluationReport): BenchmarkEvaluationSummary {
  const wins = evaluation.matches.filter((match) => match.result.winnerTeam === "north" && v2KilledEnemy(match) && opponentWasNotOnlyNeutralKilled(match)).length;
  const losses = evaluation.matches.length - wins;
  return {
    name: evaluation.name,
    ...(evaluation.tag ? { tag: evaluation.tag } : {}),
    wins,
    losses,
    failures: losses,
    successRate: evaluation.matches.length === 0 ? 0 : wins / evaluation.matches.length,
    matchCount: evaluation.matches.length,
  };
}

export function summarizeCombatEvaluation(evaluation: BenchmarkEvaluationReport): BenchmarkEvaluationSummary {
  const wins = evaluation.matches.filter((match) => northEliminatedEnemyCombat(match)).length;
  const losses = evaluation.matches.length - wins;
  return {
    name: evaluation.name,
    ...(evaluation.tag ? { tag: evaluation.tag } : {}),
    wins,
    losses,
    failures: losses,
    successRate: evaluation.matches.length === 0 ? 0 : wins / evaluation.matches.length,
    matchCount: evaluation.matches.length,
  };
}

function northEliminatedEnemyCombat(match: BenchmarkEvaluationReport["matches"][number]) {
  const players = Object.values(match.result.players);
  const north = players.filter((player) => player.team === "north");
  const south = players.filter((player) => player.team === "south");
  return north.some((player) => player.finalSupply > 0 && player.enemyUnitKills > 0) && south.length > 0 && south.every((player) => player.finalSupply === 0);
}

function v2KilledEnemy(match: BenchmarkEvaluationReport["matches"][number]) {
  return (match.result.players.v2?.enemyUnitKills ?? 0) > 0;
}

function opponentWasNotOnlyNeutralKilled(match: BenchmarkEvaluationReport["matches"][number]) {
  return Object.entries(match.result.players)
    .filter(([owner]) => owner !== V2)
    .some(([, player]) => player.unitsLost > 0 && player.unitsKilledByNeutral < player.unitsLost);
}

type CombatRecipe = {
  name: string;
  units: UnitKind[];
  itemLoadout: [ItemKind, number][];
  v1ItemLoadout: [ItemKind, number][];
  columns: number;
  xSpacing: number;
  ySpacing: number;
  yOffset: number;
  xp?: (index: number) => number;
};

const COMBAT_RECIPES: CombatRecipe[] = [
  {
    name: "early mixed",
    units: ["footman", "footman", "lancer", "archer", "raider", "archer"],
    itemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 2],
      ["lightningRod", 4],
      ["breachCharge", 5],
    ],
    v1ItemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 2],
      ["lightningRod", 4],
      ["breachCharge", 5],
    ],
    columns: 5,
    xSpacing: 38,
    ySpacing: 46,
    yOffset: 0,
  },
  {
    name: "ranged casters",
    units: ["archer", "contractArcher", "priest", "summoner", "witch", "archer", "fieldMedic", "lancer"],
    itemLoadout: [
      ["stormStaff", 1],
      ["guardianScroll", 2],
      ["lightningRod", 4],
      ["experienceBook", 5],
    ],
    v1ItemLoadout: [
      ["stormStaff", 1],
      ["guardianScroll", 2],
      ["lightningRod", 4],
    ],
    columns: 4,
    xSpacing: 34,
    ySpacing: 58,
    yOffset: -70,
  },
  {
    name: "high-star heavy",
    units: ["knight", "golem", "groveWarden", "summoner", "witch", "priest", "raider", "archer", "lancer", "footman"],
    itemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 3],
      ["stormStaff", 4],
      ["lightningRod", 7],
      ["experienceBook", 8],
    ],
    v1ItemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 3],
      ["stormStaff", 4],
      ["lightningRod", 7],
    ],
    columns: 6,
    xSpacing: 42,
    ySpacing: 42,
    yOffset: 64,
    xp: (index) => (index % 5 === 0 ? 260 : index % 3 === 0 ? 130 : index % 2 === 0 ? 60 : 0),
  },
];

function combatMatches(label: "15v20" | "10v12", v2Count: number, v1Count: number, adapter: SdkAgentAdapter, maxTicks: number, thinkInterval: number) {
  return COMBAT_RECIPES.map((recipe) => combatMatch(label, recipe, v2Count, v1Count, adapter, maxTicks, thinkInterval));
}

function combatMatch(label: "15v20" | "10v12", recipe: CombatRecipe, v2Count: number, v1Count: number, adapter: SdkAgentAdapter, maxTicks: number, thinkInterval: number): BenchmarkMatchInput<AiGameAgent> {
  const scene = sketchScene(`benchmark-${label}-${recipe.name.replace(/\s+/g, "-")}-combat`)
    .map("combatArena")
    .replaceDefaults()
    .player(V2, { team: "north", race: "grove" })
    .player(V1A, { team: "south", race: "grove" })
    .townHall(V2, 150, 800, { id: "combat-v2-anchor" })
    .townHall(V1A, 1450, 800, { id: "combat-v1-anchor" });
  addCombatArmy(scene, V2, recipe, v2Count, 520, 800, 1);
  addCombatArmy(scene, V1A, recipe, v1Count, 1080, 800, -1);
  addCombatItems(scene, V2, v2Count, recipe.itemLoadout);
  addCombatItems(scene, V1A, v1Count, recipe.v1ItemLoadout);

  return {
    name: `combatArena ${label} ${recipe.name}`,
    mapId: "combatArena",
    options: scene.toGameSetup(),
    agents: {
      [V2]: { adapter, team: "north", race: "grove", version: "v2", versionLabel: "v2", scripts: V2_COMBAT_SCRIPTS, policyMode: "combat" },
      [V1A]: { adapter, team: "south", race: "grove", version: "v1", versionLabel: "v1", scripts: V1_COMBAT_SCRIPTS, policyMode: "combat" },
    },
    commandPlanner: createAiGameCommandPlanner(),
    maxTicks: Math.min(maxTicks, 9_000),
    thinkInterval,
  };
}

function addCombatArmy(scene: ReturnType<typeof sketchScene>, owner: PlayerId, recipe: CombatRecipe, count: number, centerX: number, centerY: number, direction: 1 | -1) {
  for (let index = 0; index < count; index += 1) {
    const column = index % recipe.columns;
    const row = Math.floor(index / recipe.columns);
    scene.unit(owner, combatUnitKind(recipe, index), centerX - direction * row * recipe.xSpacing, centerY + recipe.yOffset + (column - (recipe.columns - 1) / 2) * recipe.ySpacing, { id: combatUnitId(owner, index), ...(recipe.xp ? { xp: recipe.xp(index) } : {}) });
  }
}

function combatUnitKind(recipe: CombatRecipe, index: number): UnitKind {
  return recipe.units[index % recipe.units.length]!;
}

function addCombatItems(scene: ReturnType<typeof sketchScene>, owner: PlayerId, unitCount: number, loadout: [ItemKind, number][]) {
  for (const [kind, carrierIndex] of loadout) {
    if (carrierIndex >= unitCount) continue;
    scene.item(`combat-${owner}-${kind}-${carrierIndex}`, kind, 0, 0, { carrierId: combatUnitId(owner, carrierIndex) });
  }
}

function combatUnitId(owner: PlayerId, index: number) {
  return `combat-${owner}-unit-${index + 1}`;
}

function parseSampleSize(value: string | undefined) {
  if (!value) return DEFAULT_SAMPLE_SIZE;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_SIZE;
}

function randomSeed() {
  randomSeedCounter += 1;
  return `${Date.now().toString(36)}-${randomSeedCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function shuffledBySeed<T>(items: readonly T[], seed: string) {
  const result = [...items];
  let state = hashSeed(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = nextRandomState(state);
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandomState(state: number) {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}
