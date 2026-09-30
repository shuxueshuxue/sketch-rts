import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { DEFAULT_AI_THINK_INTERVAL } from "../runtime";
import { LADDER_MAP_ID, LADDER_SLOT_IDS } from "../../shared/map";
import type { MapId, PlayerId, RaceId } from "../../shared/types";
import type { BenchmarkEvaluationReport, BenchmarkInput, BenchmarkReport, BenchmarkMatchInput } from "../../sdk/benchmark/core";
import { runBenchmark } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import type { SdkAgentController } from "../../sdk/game-runner";
import { COMBAT_SCENARIO_RECIPES, createCombatScenarioSetup, type CombatScenarioRecipe } from "../../sdk/scenarios/combat";

// The maps a gauntlet plays, drawn from its pool: for every gauntlet the pool is LADDER_SLOT_IDS, so each entry is a
// ladder slot, the name of one generated ladder map (see gauntletLadderGame). Reports list and key the maps by it.
export type GauntletMapSelection<TMapId extends string = string> = {
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
  controller?: SdkAgentController;
  workers?: number;
  workerHarassment?: WorkerHarassmentBenchmarkMode;
};

export type WorkerHarassmentBenchmarkMode = 0 | 0.5 | 1;

export type AiVersionBenchmarkDashboardReport = {
  seed: string;
  mapPoolSize: number;
  // The ladder slots played (the field keeps its name so the dashboard reads older runs).
  selectedRichScoreMapIds: string[];
  scoreSummary: BenchmarkEvaluationSummary;
  scoreControlSummary: BenchmarkEvaluationSummary;
  probeSummaries: BenchmarkEvaluationSummary[];
  combatSummaries: BenchmarkEvaluationSummary[];
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

const DEFAULT_SCORE_SAMPLE_SIZE = 12;
const DEFAULT_ONE_V_THREE_PROBE_SIZE = 3;
const DEFAULT_TWO_V_THREE_PROBE_SIZE = 3;
const DEFAULT_SAMPLE_SIZE = DEFAULT_SCORE_SAMPLE_SIZE + DEFAULT_ONE_V_THREE_PROBE_SIZE + DEFAULT_TWO_V_THREE_PROBE_SIZE;
const DEFAULT_MAX_TICKS = 48_000;
const DEFAULT_THINK_INTERVAL = DEFAULT_AI_THINK_INTERVAL;
let randomSeedCounter = 0;
const V2: PlayerId = "v2";
const V2B: PlayerId = "v2b";
const V1A: PlayerId = "v1a";
const V1B: PlayerId = "v1b";
const V1C: PlayerId = "v1c";
const TEAMS: Record<PlayerId, string> = { v2: "north", v2b: "north", v1a: "south", v1b: "south", v1c: "south" };
const RACES: Record<PlayerId, RaceId> = { v2: "grove", v2b: "grove", v1a: "grove", v1b: "grove", v1c: "grove" };

type AiBenchmarkAgentOptions = {
  controller?: SdkAgentController;
  disableV2WorkerHarassment?: boolean;
  teams?: Partial<Record<PlayerId, string>>;
};

function aiBenchmarkAgents(players: PlayerId[], options: AiBenchmarkAgentOptions = {}) {
  const controller = options.controller ?? "external-agent";
  return Object.fromEntries(
    players.map((owner) => [
      owner,
      {
        controller,
        team: options.teams?.[owner] ?? TEAMS[owner],
        race: RACES[owner],
        version: owner === V2 || owner === V2B ? "v2" : "v1",
        versionLabel: owner === V2 || owner === V2B ? "v2" : "v1",
        ...((owner === V2 || owner === V2B) && options.disableV2WorkerHarassment ? { disabledBehaviors: ["workerHarassment"] as const } : {}),
      },
    ]),
  ) as Record<PlayerId, AiGameAgent>;
}

// Draws a gauntlet's maps from a pool of ladder slots: a seeded sample, or the whole pool.
export function selectGauntletMaps<TMapId extends string>(slots: readonly TMapId[], env: GauntletSelectionEnv = {}): GauntletMapSelection<TMapId> {
  const seed = env.AI_GAUNTLET_SEED ?? randomSeed();
  if (env.AI_GAUNTLET_FULL === "1") return { mode: "full", seed, mapIds: [...slots] };

  const sampleSize = Math.min(parseSampleSize(env.AI_GAUNTLET_MAP_COUNT), slots.length);
  return { mode: "sample", seed, mapIds: shuffledBySeed(slots, seed).slice(0, sampleSize) };
}

export function selectGauntletLadderMaps(options: Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full"> = {}): GauntletMapSelection {
  return selectGauntletMaps(LADDER_SLOT_IDS, {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
}

// @@@gauntlet-ladder-game - A gauntlet game on a ladder slot is played on the ladder map, on the layout generated from the
// gauntlet's seed, the slot and its place in the draw: the same seed replays the same maps, and every game of a slot (both
// sides of a side-balanced pair) plays the same one.
export function gauntletLadderGame(seed: string, slot: string, index: number): { mapId: MapId; options: { layout: { seed: string } } } {
  return { mapId: LADDER_MAP_ID, options: { layout: { seed: `layout:${seed}:${slot}:${index}` } } };
}

// The map a gauntlet game is on, as its name starts with it: the ladder slot (every ladder game's map id is the same).
export function gauntletMapOf(match: { name: string }) {
  const space = match.name.indexOf(" ");
  return space === -1 ? match.name : match.name.slice(0, space);
}

export function createAiVersionBenchmarkInput(options: AiVersionBenchmarkOptions = {}) {
  const selection = selectGauntletLadderMaps(options);
  const allocatedMaps = allocateGauntletBenchmarkMaps(selection.mapIds);
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  const thinkInterval = options.thinkInterval ?? DEFAULT_THINK_INTERVAL;
  const controller = options.controller ?? "external-agent";
  const match = (name: string, slot: string, players: PlayerId[], index: number): BenchmarkMatchInput<AiGameAgent> => ({
    name,
    ...gauntletLadderGame(selection.seed, slot, index),
    agents: aiBenchmarkAgents(players, { controller, disableV2WorkerHarassment: index % 2 === 1 }),
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
        matches: allocatedMaps.score.map((slot, index) => match(`${slot} 1v2`, slot, [V2, V1A, V1B], index)),
      },
      {
        name: "1v1 score control",
        tag: "melee",
        matches: allocatedMaps.score.flatMap((slot, index) => createAiMeleeControlMatches(selection.seed, slot, index, { controller, maxTicks, thinkInterval })),
      },
      {
        name: "1v3 probe",
        tag: "melee",
        matches: allocatedMaps.oneVThreeProbe.map((slot, index) => match(`${slot} 1v3`, slot, [V2, V1A, V1B, V1C], index)),
      },
      {
        name: "2v3 probe",
        tag: "melee",
        matches: allocatedMaps.twoVThreeProbe.map((slot, index) => match(`${slot} 2v3`, slot, [V2, V2B, V1A, V1B, V1C], index)),
      },
      {
        name: "15v20 mixed combat",
        tag: "combat",
        matches: combatMatches("15v20", 15, 20, controller, maxTicks, thinkInterval),
      },
      {
        name: "10v12 mixed combat",
        tag: "combat",
        matches: combatMatches("10v12", 10, 12, controller, maxTicks, thinkInterval),
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
  };
}

export function createAiMeleeControlMatches(seed: string, slot: string, index: number, options: Pick<AiVersionBenchmarkOptions, "controller" | "maxTicks" | "thinkInterval" | "workerHarassment"> = {}) {
  const controller = options.controller ?? "external-agent";
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  const thinkInterval = options.thinkInterval ?? DEFAULT_THINK_INTERVAL;
  const disableV2WorkerHarassment = workerHarassmentDisabledForIndex(options.workerHarassment ?? 0.5, index);
  const match = (name: string, agents: Record<PlayerId, AiGameAgent>): BenchmarkMatchInput<AiGameAgent> => ({
    name,
    ...gauntletLadderGame(seed, slot, index),
    agents,
    commandPlanner: createAiGameCommandPlanner(),
    maxTicks,
    thinkInterval,
  });
  return [
    match(`${slot} 1v1 control north`, aiBenchmarkAgents([V2, V1A], { controller, disableV2WorkerHarassment })),
    match(
      `${slot} 1v1 control south`,
      // @@@Side-balanced control - the same map must be checked from both start teams, otherwise spawn bias looks like AI strength.
      aiBenchmarkAgents([V1A, V2], { controller, disableV2WorkerHarassment, teams: { [V2]: "south", [V1A]: "north" } }),
    ),
  ];
}

function workerHarassmentDisabledForIndex(mode: WorkerHarassmentBenchmarkMode, index: number) {
  if (mode === 0) return true;
  if (mode === 1) return false;
  return index % 2 === 1;
}

export function runAiVersionBenchmark(options: AiVersionBenchmarkOptions = {}): AiVersionBenchmarkDashboardReport {
  const { input, selection } = createAiVersionBenchmarkInput(options);
  const report = runBenchmark(input);
  return aiVersionBenchmarkDashboardReport(selection.mapIds, selection.seed, report);
}

export async function runAiVersionBenchmarkParallel(options: AiVersionBenchmarkOptions = {}): Promise<AiVersionBenchmarkDashboardReport> {
  const { input, selection } = createAiVersionBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return aiVersionBenchmarkDashboardReport(selection.mapIds, selection.seed, report);
}

function aiVersionBenchmarkDashboardReport(selectedRichScoreMapIds: string[], seed: string, report: BenchmarkReport): AiVersionBenchmarkDashboardReport {
  const [score, scoreControl, oneVThreeProbe, twoVThreeProbe, combat15v20, combat10v12] = report.evaluations;
  if (!score || !scoreControl || !oneVThreeProbe || !twoVThreeProbe || !combat15v20 || !combat10v12) throw new Error("AI version benchmark preset must produce paired melee score, probe, and combat evaluations");
  return {
    seed,
    mapPoolSize: LADDER_SLOT_IDS.length,
    selectedRichScoreMapIds,
    scoreSummary: summarizePairedScoreEvaluation(score, scoreControl),
    scoreControlSummary: summarizeMeleeControlEvaluation(scoreControl),
    probeSummaries: [summarizeEvaluation(oneVThreeProbe, "north"), summarizeEvaluation(twoVThreeProbe, "north")],
    combatSummaries: [summarizeCombatEvaluation(combat15v20), summarizeCombatEvaluation(combat10v12)],
    report,
  };
}

export function serializableAiBenchmarkInput(input: BenchmarkInput<AiGameAgent>): BenchmarkInput<AiGameAgent> {
  return {
    ...input,
    evaluations: input.evaluations.map((evaluation) => ({
      ...evaluation,
      matches: evaluation.matches.map((match) => {
        if (match.game) throw new Error(`AI benchmark parallel match ${match.name} cannot include a prebuilt game`);
        const { commandPlanner: _commandPlanner, game: _game, ...serializableMatch } = match;
        return {
          ...serializableMatch,
          agents: Object.fromEntries(
            Object.entries(serializableMatch.agents).map(([owner, agent]) => {
              const { scripts, ...rest } = agent;
              return [owner, scripts ? { ...rest, scriptIds: scripts.map((script) => script.id) } : rest];
            }),
          ) as Record<PlayerId, AiGameAgent>,
        };
      }),
    })),
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

export function summarizePairedScoreEvaluation(scoreEvaluation: BenchmarkEvaluationReport, controlEvaluation: BenchmarkEvaluationReport): BenchmarkEvaluationSummary {
  const controlsByMap = new Map<string, BenchmarkEvaluationReport["matches"]>();
  for (const match of controlEvaluation.matches) {
    const controls = controlsByMap.get(gauntletMapOf(match)) ?? [];
    controls.push(match);
    controlsByMap.set(gauntletMapOf(match), controls);
  }
  const wins = scoreEvaluation.matches.filter((match) => {
    const controls = controlsByMap.get(gauntletMapOf(match));
    if (!controls?.length) throw new Error(`Missing 1v1 score control for ${gauntletMapOf(match)}`);
    return match.result.winnerTeam === "north" && controls.length === 2 && controls.every(v2WonControl);
  }).length;
  const losses = scoreEvaluation.matches.length - wins;
  return {
    name: "paired 1v2 score",
    ...(scoreEvaluation.tag ? { tag: scoreEvaluation.tag } : {}),
    wins,
    losses,
    failures: losses,
    successRate: scoreEvaluation.matches.length === 0 ? 0 : wins / scoreEvaluation.matches.length,
    matchCount: scoreEvaluation.matches.length,
  };
}

export function summarizeMeleeControlEvaluation(evaluation: BenchmarkEvaluationReport): BenchmarkEvaluationSummary {
  const wins = evaluation.matches.filter(v2WonControl).length;
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

function v2WonControl(match: BenchmarkEvaluationReport["matches"][number]) {
  return match.result.winner === V2 && v2KilledEnemy(match) && opponentWasNotOnlyNeutralKilled(match);
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

function combatMatches(label: "15v20" | "10v12", v2Count: number, v1Count: number, controller: SdkAgentController, maxTicks: number, thinkInterval: number) {
  return COMBAT_SCENARIO_RECIPES.map((recipe) => combatMatch(label, recipe, v2Count, v1Count, controller, maxTicks, thinkInterval));
}

function combatMatch(label: "15v20" | "10v12", recipe: CombatScenarioRecipe, v2Count: number, v1Count: number, controller: SdkAgentController, maxTicks: number, thinkInterval: number): BenchmarkMatchInput<AiGameAgent> {
  const setup = createCombatScenarioSetup({ label, recipeSlug: recipe.slug, v2Owner: V2, v1Owner: V1A });
  if (setup.v2Count !== v2Count || setup.v1Count !== v1Count) throw new Error(`Combat setup ${label} count mismatch`);

  return {
    name: `combatArena ${label} ${recipe.name}`,
    mapId: setup.mapId,
    options: setup.options,
    agents: {
      [V2]: { controller, team: "north", race: "grove", version: "v2", versionLabel: "v2", policyMode: "combat" },
      [V1A]: { controller, team: "south", race: "grove", version: "v1", versionLabel: "v1", policyMode: "combat" },
    },
    commandPlanner: createAiGameCommandPlanner(),
    winnerMode: "combatElimination",
    maxTicks: Math.min(maxTicks, 9_000),
    thinkInterval,
  };
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
