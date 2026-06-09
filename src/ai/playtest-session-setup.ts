import { createAiCrossRaceBenchmarkInput, createAiMeleeControlBenchmarkInput, createAiV3VsProdV2BenchmarkInput, createAiV4TrVsV3BenchmarkInput, createAiV5VsHybridBenchmarkInput } from "./benchmark/control";
import { createAiGauntletCatalog } from "./benchmark/gauntlet";
import { createAiVersionBenchmarkInput } from "./benchmark/presets";
import type { AiGameAgent } from "./game-runner";
import type { AiRuntimeState } from "./runtime";
import { createCombatScenarioSetup, type CombatScenarioLabel } from "../sdk/scenarios/combat";
import type { BenchmarkInput, BenchmarkMatchInput } from "../sdk/benchmark/core";
import type { SdkWinnerMode } from "../sdk/winner-mode";
import type { AiScriptVersion, GameSetupOptions, MapId, PlayerId, RaceId } from "../shared/types";

export type AiPlaytestSetupDescription = {
  id?: string;
  mapId: MapId;
  options: GameSetupOptions;
  policyMode?: "melee" | "combat";
  winnerMode?: SdkWinnerMode;
  scriptedPlayers?: PlayerId[];
  versions?: Partial<Record<PlayerId, AiScriptVersion>>;
  disabledBehaviorsByPlayer?: AiRuntimeState["disabledBehaviorsByPlayer"];
  thinkInterval?: number;
};

export function createAiPlaytestSetupFromArgs(args: string[], controlledPlayer: PlayerId, enemy: PlayerId): AiPlaytestSetupDescription {
  const gauntletMatchName = flag(args, "from-gauntlet");
  if (gauntletMatchName !== undefined) return gauntletPlaytestSetup(args, gauntletMatchName, controlledPlayer);

  const crossRaceBenchmarkMatchName = flag(args, "from-cross-race-benchmark");
  if (crossRaceBenchmarkMatchName !== undefined) return crossRaceBenchmarkPlaytestSetup(args, crossRaceBenchmarkMatchName, controlledPlayer);

  const v3VsProdV2BenchmarkMatchName = flag(args, "from-v3-vs-prod-v2-benchmark");
  if (v3VsProdV2BenchmarkMatchName !== undefined) return v3VsProdV2BenchmarkPlaytestSetup(args, v3VsProdV2BenchmarkMatchName, controlledPlayer);

  const v4TrVsV3BenchmarkMatchName = flag(args, "from-v4-tr-vs-v3-benchmark");
  if (v4TrVsV3BenchmarkMatchName !== undefined) return v4TrVsV3BenchmarkPlaytestSetup(args, v4TrVsV3BenchmarkMatchName, controlledPlayer);

  const v5VsHybridBenchmarkMatchName = flag(args, "from-v5-vs-hybrid-benchmark");
  if (v5VsHybridBenchmarkMatchName !== undefined) return v5VsHybridBenchmarkPlaytestSetup(args, v5VsHybridBenchmarkMatchName, controlledPlayer);

  const controlBenchmarkMatchName = flag(args, "from-control-benchmark");
  if (controlBenchmarkMatchName !== undefined) return controlBenchmarkPlaytestSetup(args, controlBenchmarkMatchName, controlledPlayer);

  const benchmarkMatchName = flag(args, "from-benchmark");
  if (benchmarkMatchName !== undefined) return benchmarkPlaytestSetup(args, benchmarkMatchName, controlledPlayer);

  const setup = flag(args, "setup");
  if (setup === undefined) {
    const controlledTeam = flag(args, "you-team") ?? "north";
    const enemyTeam = flag(args, "enemy-team") ?? "south";
    const controlledRace = flag(args, "you-race") as RaceId | undefined;
    const enemyRace = flag(args, "enemy-race") as RaceId | undefined;
    return {
      mapId: (flag(args, "map") ?? "bareDuel") as MapId,
      options: {
        players: [controlledPlayer, enemy],
        teams: { [controlledPlayer]: controlledTeam, [enemy]: enemyTeam },
        ...(controlledRace || enemyRace ? { races: { ...(controlledRace ? { [controlledPlayer]: controlledRace } : {}), ...(enemyRace ? { [enemy]: enemyRace } : {}) } } : {}),
      },
    };
  }
  if (setup === "combat-15v20" || setup === "combat-10v12") {
    const combat = createCombatScenarioSetup({
      label: setup.replace("combat-", "") as CombatScenarioLabel,
      recipeSlug: flag(args, "recipe") ?? "early-mixed",
      v2Owner: controlledPlayer,
      v1Owner: enemy,
    });
    return { mapId: combat.mapId, options: combat.options, policyMode: "combat", winnerMode: "combatElimination" };
  }
  throw new Error(`Unknown ai playtest setup ${setup}`);
}

function benchmarkPlaytestSetup(args: string[], matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const { input } = createAiVersionBenchmarkInput({
    ...(flag(args, "benchmark-seed") ? { seed: requiredFlag(args, "benchmark-seed") } : {}),
    ...(flag(args, "benchmark-map-count") ? { mapCount: requiredNumberFlag(args, "benchmark-map-count") } : {}),
    full: boolFlag(args, "benchmark-full"),
  });
  return setupFromBenchmarkInput(input, matchName, controlledPlayer, "benchmark");
}

function controlBenchmarkPlaytestSetup(args: string[], matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const { input } = createAiMeleeControlBenchmarkInput({
    ...(flag(args, "control-seed") ? { seed: requiredFlag(args, "control-seed") } : {}),
    ...(flag(args, "control-map-count") ? { mapCount: requiredNumberFlag(args, "control-map-count") } : {}),
    ...(flag(args, "control-worker-harassment") ? { workerHarassment: workerHarassmentFlag(args, "control-worker-harassment") } : {}),
    full: boolFlag(args, "control-full"),
  });
  return setupFromBenchmarkInput(input, matchName, controlledPlayer, "control benchmark");
}

function crossRaceBenchmarkPlaytestSetup(args: string[], matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const { input } = createAiCrossRaceBenchmarkInput({
    ...(flag(args, "cross-race-seed") ? { seed: requiredFlag(args, "cross-race-seed") } : {}),
    ...(flag(args, "cross-race-map-count") ? { mapCount: requiredNumberFlag(args, "cross-race-map-count") } : {}),
    full: boolFlag(args, "cross-race-full"),
  });
  return setupFromBenchmarkInput(input, matchName, controlledPlayer, "cross-race benchmark");
}

function v3VsProdV2BenchmarkPlaytestSetup(args: string[], matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const { input } = createAiV3VsProdV2BenchmarkInput({
    ...(flag(args, "v3-prod-seed") ? { seed: requiredFlag(args, "v3-prod-seed") } : {}),
    ...(flag(args, "v3-prod-map-count") ? { mapCount: requiredNumberFlag(args, "v3-prod-map-count") } : {}),
    full: boolFlag(args, "v3-prod-full"),
  });
  return setupFromBenchmarkInput(input, matchName, controlledPlayer, "V3 versus frozen V2-prod benchmark");
}

function v4TrVsV3BenchmarkPlaytestSetup(args: string[], matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const { input } = createAiV4TrVsV3BenchmarkInput({
    ...(flag(args, "v4-tr-seed") ? { seed: requiredFlag(args, "v4-tr-seed") } : {}),
    ...(flag(args, "v4-tr-map-count") ? { mapCount: requiredNumberFlag(args, "v4-tr-map-count") } : {}),
    full: boolFlag(args, "v4-tr-full"),
  });
  return setupFromBenchmarkInput(input, matchName, controlledPlayer, "V4-TR versus V3 benchmark");
}

function v5VsHybridBenchmarkPlaytestSetup(args: string[], matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const { input } = createAiV5VsHybridBenchmarkInput({
    ...(flag(args, "v5-hybrid-seed") ? { seed: requiredFlag(args, "v5-hybrid-seed") } : {}),
    ...(flag(args, "v5-hybrid-map-count") ? { mapCount: requiredNumberFlag(args, "v5-hybrid-map-count") } : {}),
    full: boolFlag(args, "v5-hybrid-full"),
  });
  return setupFromBenchmarkInput(input, matchName, controlledPlayer, "V5 versus hybrid benchmark");
}

function gauntletPlaytestSetup(args: string[], matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const catalog = createAiGauntletCatalog({
    ...(flag(args, "gauntlet-seed") ? { seed: requiredFlag(args, "gauntlet-seed") } : {}),
    ...(flag(args, "gauntlet-map-count") ? { mapCount: requiredNumberFlag(args, "gauntlet-map-count") } : {}),
    full: boolFlag(args, "gauntlet-full"),
  });
  const match = catalog.matches.find((candidate) => candidate.name === matchName);
  if (!match) throw new Error(`Unknown gauntlet match ${matchName}`);
  return playtestSetupFromBenchmarkMatch(
    {
      name: match.name,
      mapId: match.mapId,
      agents: match.agents,
      ...(match.options ? { options: match.options } : {}),
      maxTicks: match.maxTicks,
      thinkInterval: match.thinkInterval,
    },
    matchName,
    controlledPlayer,
  );
}

function setupFromBenchmarkInput(input: BenchmarkInput<AiGameAgent>, matchName: string, controlledPlayer: PlayerId, label: string): RequiredBenchmarkSetupDescription {
  const matches = input.evaluations.flatMap((evaluation) => evaluation.matches);
  const match = matches.find((candidate) => candidate.name === matchName);
  if (!match) throw new Error(`Unknown ${label} match ${matchName}`);
  return playtestSetupFromBenchmarkMatch(match, matchName, controlledPlayer);
}

function playtestSetupFromBenchmarkMatch(match: BenchmarkMatchInput<AiGameAgent>, matchName: string, controlledPlayer: PlayerId): RequiredBenchmarkSetupDescription {
  const agentEntries = Object.entries(match.agents);
  if (!match.agents[controlledPlayer]) throw new Error(`Benchmark match ${matchName} does not include controlled player ${controlledPlayer}`);
  const players = agentEntries.map(([owner]) => owner as PlayerId);
  const scriptedPlayers = players.filter((owner) => owner !== controlledPlayer);
  const teams = Object.fromEntries(agentEntries.map(([owner, agent]) => [owner, agent.team])) as Record<PlayerId, string>;
  const races = Object.fromEntries(agentEntries.map(([owner, agent]) => [owner, agent.race])) as Record<PlayerId, NonNullable<typeof match.agents[PlayerId]["race"]>>;
  const versions = Object.fromEntries(agentEntries.map(([owner, agent]) => [owner, agent.policyVersion ?? agent.version])) as Partial<Record<PlayerId, AiScriptVersion>>;
  const policyMode = agentEntries.find(([, agent]) => agent.policyMode)?.[1].policyMode;
  const disabledBehaviorsByPlayer = Object.fromEntries(agentEntries.filter(([, agent]) => agent.disabledBehaviors && agent.disabledBehaviors.length > 0).map(([owner, agent]) => [owner, [...agent.disabledBehaviors!]])) as AiRuntimeState["disabledBehaviorsByPlayer"];
  return {
    id: `interactive-${matchName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    mapId: match.mapId ?? "bareDuel",
    options: {
      ...(match.options ?? {}),
      players,
      teams,
      races,
    },
    ...(policyMode ? { policyMode } : {}),
    ...(match.winnerMode ? { winnerMode: match.winnerMode } : {}),
    scriptedPlayers,
    versions,
    thinkInterval: match.thinkInterval,
    ...(disabledBehaviorsByPlayer && Object.keys(disabledBehaviorsByPlayer).length > 0 ? { disabledBehaviorsByPlayer } : {}),
  };
}

type RequiredBenchmarkSetupDescription = AiPlaytestSetupDescription & {
  id: string;
  scriptedPlayers: PlayerId[];
  versions: Partial<Record<PlayerId, AiScriptVersion>>;
};

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

function numberFlag(args: string[], name: string, value: number): number {
  const raw = flag(args, name);
  if (raw === undefined) return value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a finite number`);
  return parsed;
}

function requiredNumberFlag(args: string[], name: string): number {
  requiredFlag(args, name);
  return numberFlag(args, name, Number.NaN);
}

function workerHarassmentFlag(args: string[], name: string): 0 | 0.5 | 1 {
  const value = requiredNumberFlag(args, name);
  if (value !== 0 && value !== 0.5 && value !== 1) throw new Error(`--${name} must be 0, 0.5, or 1`);
  return value;
}
