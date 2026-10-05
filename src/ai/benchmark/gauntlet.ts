import { LADDER_SLOT_IDS } from "../../shared/map";
import type { CreateGameOptions } from "../../shared/sim";
import type { AiScriptVersion, MapId, PlayerId, RaceId } from "../../shared/types";
import type { SdkAgentController } from "../../sdk/game-runner";
import type { AiGameAgent } from "../game-runner";
import { allocateGauntletBenchmarkMaps, gauntletLadderGame, selectGauntletLadderMaps, selectGauntletMaps, type GauntletMapSelection } from "./presets";

export type AiGauntletLane = "score" | "1v3" | "2v3" | "robustness";

export type AiGauntletControllerCase = {
  name: string;
  controllers: Record<PlayerId, SdkAgentController>;
};

export type AiGauntletCase = {
  name: string;
  mapId: MapId;
  options?: CreateGameOptions;
  maxTicks?: number;
};

export type AiGauntletMatch = {
  name: string;
  lane: AiGauntletLane;
  controllerCase: string;
  mapId: MapId;
  agents: Record<PlayerId, AiGameAgent>;
  options?: CreateGameOptions;
  maxTicks: number;
  thinkInterval: number;
  sampleInterval: number;
};

export type AiGauntletCatalogOptions = {
  seed?: string;
  mapCount?: number;
  full?: boolean;
};

export type AiGauntletCatalog = {
  selection: GauntletMapSelection;
  // The ladder slots played (named as the dry-run manifest has always named them).
  selectedRichScoreMapIds: string[];
  scoreCaseCount: number;
  oneVThreeCaseCount: number;
  twoVThreeCaseCount: number;
  robustnessCaseCount: number;
  matches: AiGauntletMatch[];
};

export const AI_GAUNTLET_MAX_TICKS = 48_000;
export const AI_GAUNTLET_THINK_INTERVAL = 45;
export const AI_GAUNTLET_SAMPLE_INTERVAL = 1_200;
export const AI_GAUNTLET_V2: PlayerId = "v2";
export const AI_GAUNTLET_V2B: PlayerId = "v2b";
export const AI_GAUNTLET_V1A: PlayerId = "v1a";
export const AI_GAUNTLET_V1B: PlayerId = "v1b";
export const AI_GAUNTLET_V1C: PlayerId = "v1c";

export const AI_GAUNTLET_SCORE_PLAYERS = [AI_GAUNTLET_V2, AI_GAUNTLET_V1A, AI_GAUNTLET_V1B] as const;
export const AI_GAUNTLET_ONE_V_THREE_PLAYERS = [AI_GAUNTLET_V2, AI_GAUNTLET_V1A, AI_GAUNTLET_V1B, AI_GAUNTLET_V1C] as const;
export const AI_GAUNTLET_TWO_V_THREE_PLAYERS = [AI_GAUNTLET_V2, AI_GAUNTLET_V2B, AI_GAUNTLET_V1A, AI_GAUNTLET_V1B, AI_GAUNTLET_V1C] as const;

export const AI_GAUNTLET_TEAMS: Record<PlayerId, string> = { v2: "north", v2b: "north", v1a: "south", v1b: "south", v1c: "south" };
export const AI_GAUNTLET_RACES: Record<PlayerId, RaceId> = { v2: "grove", v2b: "grove", v1a: "grove", v1b: "grove", v1c: "grove" };
export const AI_GAUNTLET_VERSIONS: Record<PlayerId, AiScriptVersion> = { v2: "v2", v2b: "v2", v1a: "v1", v1b: "v1", v1c: "v1" };

export const AI_GAUNTLET_CONTROLLER_CASES: AiGauntletControllerCase[] = [
  { name: "internal-only", controllers: { v2: "internal-ai", v2b: "internal-ai", v1a: "internal-ai", v1b: "internal-ai", v1c: "internal-ai" } },
  { name: "external-only", controllers: { v2: "external-agent", v2b: "external-agent", v1a: "external-agent", v1b: "external-agent", v1c: "external-agent" } },
  { name: "mixed-v2-external", controllers: { v2: "external-agent", v2b: "external-agent", v1a: "internal-ai", v1b: "internal-ai", v1c: "internal-ai" } },
  { name: "mixed-v2-internal", controllers: { v2: "internal-ai", v2b: "internal-ai", v1a: "external-agent", v1b: "external-agent", v1c: "external-agent" } },
];

export function createAiGauntletCatalog(options: AiGauntletCatalogOptions = {}): AiGauntletCatalog {
  return createAiGauntletCatalogFromSelection(selectGauntletLadderMaps(options));
}

export function createAiGauntletCatalogFromEnv(env: NodeJS.ProcessEnv): AiGauntletCatalog {
  return createAiGauntletCatalogFromSelection(selectGauntletMaps(LADDER_SLOT_IDS, env));
}

function createAiGauntletCatalogFromSelection(selection: GauntletMapSelection): AiGauntletCatalog {
  const allocatedMaps = allocateGauntletBenchmarkMaps(selection.mapIds);
  const ladderCase = (name: string, slot: string, index: number): AiGauntletCase => ({ name, ...gauntletLadderGame(selection.seed, slot, index) });
  const scoreCases = allocatedMaps.score.map((slot, index) => ladderCase(`${slot} official triangle`, slot, index));
  const oneVThreeCases = allocatedMaps.oneVThreeProbe.map((slot, index) => ladderCase(`${slot} 1v3 probe`, slot, index));
  const twoVThreeCases = allocatedMaps.twoVThreeProbe.map((slot, index) => ladderCase(`${slot} 2v3 probe`, slot, index));
  const robustnessCases = aiGauntletRobustnessCases();

  return {
    selection,
    selectedRichScoreMapIds: selection.mapIds,
    scoreCaseCount: scoreCases.length,
    oneVThreeCaseCount: oneVThreeCases.length,
    twoVThreeCaseCount: twoVThreeCases.length,
    robustnessCaseCount: robustnessCases.length,
    matches: AI_GAUNTLET_CONTROLLER_CASES.flatMap((controllerCase) => [
      ...scoreCases.map((testCase, index) => createAiGauntletMatch(testCase, controllerCase, "score", AI_GAUNTLET_SCORE_PLAYERS, index)),
      ...oneVThreeCases.map((testCase, index) => createAiGauntletMatch(testCase, controllerCase, "1v3", AI_GAUNTLET_ONE_V_THREE_PLAYERS, index)),
      ...twoVThreeCases.map((testCase, index) => createAiGauntletMatch(testCase, controllerCase, "2v3", AI_GAUNTLET_TWO_V_THREE_PLAYERS, index)),
      ...robustnessCases.map((testCase) => createAiGauntletMatch(testCase, controllerCase, "robustness", AI_GAUNTLET_SCORE_PLAYERS, 0)),
    ]),
  };
}

function createAiGauntletMatch(testCase: AiGauntletCase, controllerCase: AiGauntletControllerCase, lane: AiGauntletLane, players: readonly PlayerId[], index: number): AiGauntletMatch {
  return {
    name: `${controllerCase.name} ${lane} ${testCase.name}`,
    lane,
    controllerCase: controllerCase.name,
    mapId: testCase.mapId,
    agents: agentsFor(players, controllerCase, index),
    ...(testCase.options ? { options: testCase.options } : {}),
    maxTicks: testCase.maxTicks ?? AI_GAUNTLET_MAX_TICKS,
    thinkInterval: AI_GAUNTLET_THINK_INTERVAL,
    sampleInterval: AI_GAUNTLET_SAMPLE_INTERVAL,
  };
}

function agentsFor(players: readonly PlayerId[], controllerCase: AiGauntletControllerCase, index: number): Record<PlayerId, AiGameAgent> {
  return Object.fromEntries(
    players.map((owner) => [
      owner,
      {
        controller: controllerCase.controllers[owner] ?? controllerCase.controllers[AI_GAUNTLET_V2]!,
        team: AI_GAUNTLET_TEAMS[owner]!,
        race: AI_GAUNTLET_RACES[owner]!,
        version: AI_GAUNTLET_VERSIONS[owner]!,
        ...((owner === AI_GAUNTLET_V2 || owner === AI_GAUNTLET_V2B) && index % 2 === 1 ? { disabledBehaviors: ["workerHarassment"] as const } : {}),
      },
    ]),
  ) as Record<PlayerId, AiGameAgent>;
}

function aiGauntletRobustnessCases(): AiGauntletCase[] {
  return [
    { name: "bare duel no-expansion pressure", mapId: "bareDuel" },
    { name: "open claims no-creep smoke", mapId: "openClaims" },
    { name: "camp rush no-expansion objectives", mapId: "campRush" },
  ];
}
