import { runGame, type SdkAgentAdapter, type SdkGameAgent } from "../src/sdk/game-runner";
import { RICH_SCORE_MAP_IDS } from "../src/shared/map";
import type { CreateGameOptions } from "../src/shared/sim";
import { seconds } from "../src/shared/time";
import type { AiScriptVersion, MapId, PlayerId, RaceId, ScenarioOverride } from "../src/shared/types";
import { selectGauntletRichScoreMaps } from "./ai-version-gauntlet-selection";

type AdapterCase = {
  name: string;
  adapters: Record<PlayerId, SdkAgentAdapter>;
};

type GauntletCase = {
  name: string;
  mapId: MapId;
  options?: CreateGameOptions;
};

const MAX_TICKS = 48_000;
const THINK_INTERVAL = 45;
const SAMPLE_INTERVAL = 1_200;
const V2: PlayerId = "v2";
const V1A: PlayerId = "v1a";
const V1B: PlayerId = "v1b";
const PLAYERS = [V2, V1A, V1B];
const TEAMS: Record<PlayerId, string> = { v2: "north", v1a: "south", v1b: "south" };
const RACES: Record<PlayerId, RaceId> = { v2: "grove", v1a: "grove", v1b: "grove" };
const VERSIONS: Record<PlayerId, AiScriptVersion> = { v2: "v2", v1a: "v1", v1b: "v1" };

const adapterCases: AdapterCase[] = [
  { name: "internal-only", adapters: { v2: "internal", v1a: "internal", v1b: "internal" } },
  { name: "external-only", adapters: { v2: "external", v1a: "external", v1b: "external" } },
  { name: "mixed-v2-external", adapters: { v2: "external", v1a: "internal", v1b: "internal" } },
  { name: "mixed-v2-internal", adapters: { v2: "internal", v1a: "external", v1b: "external" } },
];

const mapSelection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], process.env);
const richScoreMaps: MapId[] = mapSelection.mapIds;
const curatedScenarioCases: GauntletCase[] = [
  ...(mapSelection.mode === "full"
    ? [
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
      ]
    : []),
];
const scoreCases: GauntletCase[] = [
  ...richScoreMaps.map((mapId) => ({ name: `${mapId} official triangle`, mapId })),
  ...curatedScenarioCases,
];

const robustnessCases: GauntletCase[] = [
  { name: "bare duel no-expansion pressure", mapId: "bareDuel" },
  { name: "open claims no-creep smoke", mapId: "openClaims" },
  { name: "camp rush no-expansion objectives", mapId: "campRush" },
];

const started = performance.now();
const cpuStarted = process.cpuUsage();
const scoreReports = adapterCases.flatMap((adapterCase) => scoreCases.map((testCase) => ({ ...runCase(testCase, adapterCase, "score"), lane: "score" as const })));
const robustnessReports = adapterCases.flatMap((adapterCase) => robustnessCases.map((testCase) => ({ ...runCase(testCase, adapterCase, "robustness"), lane: "robustness" as const })));
const reports = [...scoreReports, ...robustnessReports];
const cpu = process.cpuUsage(cpuStarted);
const summaries = adapterCases.map((adapterCase) => {
  const relevant = scoreReports.filter((report) => report.adapterCase === adapterCase.name);
  return {
    adapterCase: adapterCase.name,
    wins: relevant.filter((report) => report.winnerTeam === "north").length,
    losses: relevant.filter((report) => report.winnerTeam === "south").length,
    failures: relevant.filter((report) => report.failed).length,
    successRate: relevant.filter((report) => !report.failed).length / relevant.length,
  };
});
const robustnessSummaries = adapterCases.map((adapterCase) => {
  const relevant = robustnessReports.filter((report) => report.adapterCase === adapterCase.name);
  return {
    adapterCase: adapterCase.name,
    cases: relevant.length,
    failures: relevant.filter((report) => report.failed).length,
    successRate: relevant.filter((report) => !report.failed).length / relevant.length,
  };
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: summaries.every((summary) => summary.successRate >= 0.9),
      totalElapsedMs: Number((performance.now() - started).toFixed(3)),
      totalCpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
      gauntletMode: mapSelection.mode,
      mapSelectionSeed: mapSelection.seed,
      selectedRichScoreMapIds: richScoreMaps,
      scoreCaseCount: scoreCases.length,
      robustnessCaseCount: robustnessCases.length,
      summaries,
      robustnessSummaries,
      reports,
    },
    null,
    2,
  )}\n`,
);

if (!summaries.every((summary) => summary.successRate >= 0.9)) {
  throw new Error("AI version gauntlet failed: v2 did not beat two healthy v1 players at 90% in every adapter class");
}

function runCase(testCase: GauntletCase, adapterCase: AdapterCase, lane: "score" | "robustness") {
  const report = runGame({
    name: testCase.name,
    mapId: testCase.mapId,
    agents: Object.fromEntries(
      PLAYERS.map((owner) => [
        owner,
        { adapter: adapterCase.adapters[owner], team: TEAMS[owner], race: RACES[owner], version: VERSIONS[owner] },
      ]),
    ) as Record<PlayerId, SdkGameAgent>,
    ...(testCase.options ? { options: testCase.options } : {}),
    maxTicks: MAX_TICKS,
    thinkInterval: THINK_INTERVAL,
    sampleInterval: SAMPLE_INTERVAL,
  });
  return {
    ...report,
    adapterCase: adapterCase.name,
    failed: lane === "score" ? report.winnerTeam !== "north" : robustnessFailed(report),
    snapshot: undefined,
  };
}

function robustnessFailed(report: ReturnType<typeof runGame>) {
  return (report.commandsByOwner[V2] ?? 0) === 0 || (report.goldSpent[V2] ?? 0) === 0;
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
