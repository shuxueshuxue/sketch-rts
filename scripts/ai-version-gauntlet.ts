import { planPresetAiCommands } from "../src/sdk/ai-policy";
import { createAiRuntime, runPresetAiRuntime, type AiRuntimeState } from "../src/shared/ai-runtime";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type CreateGameOptions, type Game } from "../src/shared/sim";
import type { AiScriptVersion, GameCommand, MapId, PlayerId, RaceId, ScenarioOverride } from "../src/shared/types";

type Adapter = "internal" | "external";
type AdapterCase = {
  name: string;
  adapters: Record<PlayerId, Adapter>;
};

type GauntletCase = {
  name: string;
  mapId: MapId;
  options?: CreateGameOptions;
};

const MAX_TICKS = 48_000;
const THINK_INTERVAL = 45;
const V2: PlayerId = "v2";
const V1A: PlayerId = "v1a";
const V1B: PlayerId = "v1b";
const PLAYERS = [V2, V1A, V1B];
const TEAMS: Record<PlayerId, string> = { v2: "north", v1a: "south", v1b: "south" };
const RACES: Record<PlayerId, RaceId> = { v2: "grove", v1a: "grove", v1b: "ember" };
const VERSIONS: Record<PlayerId, AiScriptVersion> = { v2: "v2", v1a: "v1", v1b: "v1" };

const adapterCases: AdapterCase[] = [
  { name: "internal-only", adapters: { v2: "internal", v1a: "internal", v1b: "internal" } },
  { name: "external-only", adapters: { v2: "external", v1a: "external", v1b: "external" } },
  { name: "mixed-v2-external", adapters: { v2: "external", v1a: "internal", v1b: "internal" } },
  { name: "mixed-v2-internal", adapters: { v2: "internal", v1a: "external", v1b: "external" } },
];

const cases: GauntletCase[] = [
  { name: "bare duel triangle", mapId: "bareDuel" },
  { name: "open claims triangle", mapId: "openClaims" },
  { name: "camp rush triangle", mapId: "campRush" },
  { name: "wild marches triangle", mapId: "wildMarches" },
  { name: "verdant crossroads triangle", mapId: "verdantCrossroads" },
  { name: "bare duel center mine", mapId: "bareDuel", options: { scenario: scenarioResource("gauntlet-mid-gold", 2048, 2048, 4500) } },
  { name: "open claims west merc", mapId: "openClaims", options: { scenario: scenarioMerc("gauntlet-west-merc", 1500, 2500, 4) } },
  { name: "camp rush pocket gold", mapId: "campRush", options: { scenario: scenarioResource("gauntlet-pocket-gold", 2450, 1350, 3200) } },
  { name: "wild marches extra camp", mapId: "wildMarches", options: { scenario: scenarioWildlings("gauntlet-extra", 2100, 2100) } },
  { name: "verdant extra merc", mapId: "verdantCrossroads", options: { scenario: scenarioMerc("gauntlet-center-merc", 2100, 2100, 3) } },
];

const started = performance.now();
const cpuStarted = process.cpuUsage();
const reports = adapterCases.flatMap((adapterCase) => cases.map((testCase) => runCase(testCase, adapterCase)));
const cpu = process.cpuUsage(cpuStarted);
const summaries = adapterCases.map((adapterCase) => {
  const relevant = reports.filter((report) => report.adapterCase === adapterCase.name);
  return {
    adapterCase: adapterCase.name,
    wins: relevant.filter((report) => report.winnerTeam === "north").length,
    losses: relevant.filter((report) => report.winnerTeam === "south").length,
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
      summaries,
      reports,
    },
    null,
    2,
  )}\n`,
);

if (!summaries.every((summary) => summary.successRate >= 0.9)) {
  throw new Error("AI version gauntlet failed: v2 did not beat two healthy v1 players at 90% in every adapter class");
}

function runCase(testCase: GauntletCase, adapterCase: AdapterCase) {
  const game = createGame(testCase.mapId, {
    players: PLAYERS,
    aiPlayers: PLAYERS.filter((owner) => adapterCase.adapters[owner] === "internal"),
    teams: TEAMS,
    races: RACES,
    ...(testCase.options?.scenario ? { scenario: testCase.options.scenario } : {}),
  });
  const runtime = createAiRuntime(PLAYERS.filter((owner) => adapterCase.adapters[owner] === "internal"), { versions: VERSIONS });
  const commandCounts: Record<string, number> = {};
  const commandsByOwner: Record<PlayerId, number> = { v2: 0, v1a: 0, v1b: 0 };
  const started = performance.now();
  const cpuStarted = process.cpuUsage();

  for (let tick = 0; tick < MAX_TICKS && !game.match.winner; tick += 1) {
    if (tick % THINK_INTERVAL === 0) {
      runPresetAiRuntime(game, runtime);
      runExternalAdapters(game, adapterCase, commandCounts, commandsByOwner);
    }
    stepGame(game);
  }

  const cpu = process.cpuUsage(cpuStarted);
  const winnerTeam = game.match.winner ? TEAMS[game.match.winner] : "timeout";
  const failed = winnerTeam !== "north";
  return {
    name: testCase.name,
    adapterCase: adapterCase.name,
    mapId: testCase.mapId,
    tick: game.tick,
    timeout: !game.match.winner,
    winner: game.match.winner,
    winnerTeam,
    failed,
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    goldSpent: game.match.stats.goldSpent,
    unitsKilled: game.match.stats.unitsKilled,
    unitsLost: game.match.stats.unitsLost,
    neutralUnitsKilled: game.match.stats.neutralUnitsKilled,
    mercenaryKills: game.match.stats.mercenaryKills,
    nonBaseBuildingsDestroyed: game.match.stats.nonBaseBuildingsDestroyed,
    commandCounts,
    commandsByOwner,
  };
}

function runExternalAdapters(game: Game, adapterCase: AdapterCase, commandCounts: Record<string, number>, commandsByOwner: Record<PlayerId, number>) {
  const snapshot = snapshotGame(game);
  const hiredCampIds = new Set<string>();
  for (const owner of PLAYERS) {
    if (adapterCase.adapters[owner] !== "external") continue;
    for (const command of planPresetAiCommands(snapshot, owner, { teams: TEAMS, version: VERSIONS[owner] })) {
      if (command.type === "hire") {
        if (hiredCampIds.has(command.campId)) continue;
        hiredCampIds.add(command.campId);
      }
      issuePlayerCommand(game, owner, command);
      commandCounts[command.type] = (commandCounts[command.type] ?? 0) + 1;
      commandsByOwner[owner] += 1;
    }
  }
}

function scenarioResource(id: string, x: number, y: number, amount: number): ScenarioOverride {
  return { addResources: [{ id, kind: "goldMine", x, y, amount }] };
}

function scenarioMerc(id: string, x: number, y: number, stock: number): ScenarioOverride {
  return { addMercenaryCamps: [{ id, x, y, radius: 54, hireKind: "mercenary", cost: 185, stock, cooldown: 160, cooldownRemaining: 0 }] };
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
