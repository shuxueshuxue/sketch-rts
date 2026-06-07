import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import { seconds } from "../../shared/time";
import type { CreateGameOptions } from "../../shared/sim";
import type { AiScriptVersion, MapId, PlayerId, RaceId, ScenarioOverride } from "../../shared/types";
import type { SdkAgentController } from "../../sdk/game-runner";
import type { AiGameAgent } from "../game-runner";
import { allocateGauntletBenchmarkMaps, selectGauntletRichScoreMaps, type GauntletMapSelection } from "./presets";

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
  selection: GauntletMapSelection<MapId>;
  selectedRichScoreMapIds: MapId[];
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
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  return createAiGauntletCatalogFromSelection(selection);
}

export function createAiGauntletCatalogFromEnv(env: NodeJS.ProcessEnv): AiGauntletCatalog {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], env);
  return createAiGauntletCatalogFromSelection(selection);
}

function createAiGauntletCatalogFromSelection(selection: GauntletMapSelection<MapId>): AiGauntletCatalog {
  const allocatedMaps = allocateGauntletBenchmarkMaps(selection.mapIds);
  const curatedScenarioCases = selection.mode === "full" ? fullCuratedScenarioCases() : [];
  const scoreCases: AiGauntletCase[] = [
    ...allocatedMaps.score.map((mapId) => ({ name: `${mapId} official triangle`, mapId })),
    ...curatedScenarioCases,
  ];
  const oneVThreeCases: AiGauntletCase[] = allocatedMaps.oneVThreeProbe.map((mapId) => ({ name: `${mapId} 1v3 probe`, mapId }));
  const twoVThreeCases: AiGauntletCase[] = allocatedMaps.twoVThreeProbe.map((mapId) => ({ name: `${mapId} 2v3 probe`, mapId }));
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

function fullCuratedScenarioCases(): AiGauntletCase[] {
  return [
    { name: "wild marches extra camp", mapId: "wildMarches", options: { scenario: scenarioWildlings("gauntlet-extra", 2100, 2100) } },
    { name: "stag hollow extra merc", mapId: "stagHollow", options: { scenario: scenarioMerc("gauntlet-center-merc", 2100, 2100, 3) } },
    { name: "wild marches pocket gold", mapId: "wildMarches", options: { scenario: scenarioResource("gauntlet-pocket-gold", 2450, 1350, 3200) } },
    { name: "thorned delta west storm road", mapId: "thornedDelta", options: { scenario: scenarioWildlings("gauntlet-west-storm", 900, 2840) } },
    { name: "wild marches north red camp", mapId: "wildMarches", options: { scenario: scenarioWildlings("gauntlet-north-red", 2700, 860) } },
    { name: "silver ridge south boss", mapId: "silverRidge", options: { scenario: scenarioWildlings("gauntlet-south-boss", 3260, 3140) } },
    { name: "wild marches south bounty", mapId: "wildMarches", options: { scenario: scenarioWildlings("gauntlet-south-bounty", 1450, 3340) } },
    { name: "ember fen east pocket gold", mapId: "emberFen", options: { scenario: scenarioResource("gauntlet-east-pocket-gold", 3160, 1120, 3200) } },
    { name: "wild marches ridge merc", mapId: "wildMarches", options: { scenario: scenarioMerc("gauntlet-ridge-merc", 3120, 1180, 2) } },
    { name: "ash vale contested book", mapId: "ashVale", options: { scenario: scenarioWildlings("gauntlet-ash-book", 1840, 2120) } },
    { name: "reed basin side gold", mapId: "reedBasin", options: { scenario: scenarioResource("gauntlet-reed-side-gold", 1060, 2920, 3200) } },
    { name: "frost meadow ridge merc", mapId: "frostMeadow", options: { scenario: scenarioMerc("gauntlet-frost-ridge-merc", 2860, 1710, 2) } },
    { name: "sunken orchard red bend", mapId: "sunkenOrchard", options: { scenario: scenarioWildlings("gauntlet-orchard-red", 2860, 3080) } },
    { name: "cedar pass pocket gold", mapId: "cedarPass", options: { scenario: scenarioResource("gauntlet-cedar-pocket-gold", 2280, 1160, 3200) } },
  ];
}

function scenarioResource(id: string, x: number, y: number, amount: number): ScenarioOverride {
  return {
    addResources: [{ id, kind: "goldMine", x, y, amount }],
    addUnits: [
      { id: `${id}-guard-brute`, owner: "neutral", kind: "stonebackBrute", x: x - 70, y: y - 25 },
      { id: `${id}-guard-witch`, owner: "neutral", kind: "gladeWitch", x: x + 45, y: y + 50 },
      { id: `${id}-guard-slinger`, owner: "neutral", kind: "thornSlinger", x: x + 80, y: y - 55 },
    ],
  };
}

function scenarioMerc(id: string, x: number, y: number, stock: number): ScenarioOverride {
  return {
    addMercenaryCamps: [{ id, x, y, radius: 54, hireKind: "mercenary", cost: 185, stock, cooldown: seconds(8), cooldownRemaining: 0 }],
    addUnits: [
      { id: `${id}-guard-brute`, owner: "neutral", kind: "stonebackBrute", x: x - 65, y: y - 30 },
      { id: `${id}-guard-slinger`, owner: "neutral", kind: "thornSlinger", x: x + 60, y: y + 35 },
    ],
  };
}

function scenarioWildlings(prefix: string, x: number, y: number): ScenarioOverride {
  return {
    addUnits: [
      { id: `${prefix}-brute`, owner: "neutral", kind: "stonebackBrute", x: x - 40, y },
      { id: `${prefix}-witch`, owner: "neutral", kind: "gladeWitch", x: x + 35, y: y + 30 },
      { id: `${prefix}-slinger`, owner: "neutral", kind: "thornSlinger", x: x + 15, y: y - 45 },
    ],
  };
}
