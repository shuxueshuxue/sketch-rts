import { planPresetAiCommandEntries } from "../shared/ai-policy";
import { summarizeMatchState, summarizeTimelineSample, type MatchStateSummary, type MatchTimelineSample } from "./match-report";
import { createAiRuntime, runPresetAiRuntime } from "../shared/ai-runtime";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type CreateGameOptions, type Game } from "../shared/sim";
import type { AiScriptVersion, GameCommand, GameSnapshot, MapId, PlayerId, RaceId } from "../shared/types";

export type SdkAgentAdapter = "internal" | "external";

export type SdkGameAgent = {
  adapter: SdkAgentAdapter;
  team: string;
  version: AiScriptVersion;
  race?: RaceId;
};

export type SdkGameRunInput = {
  name: string;
  mapId?: MapId;
  game?: Game;
  agents: Record<PlayerId, SdkGameAgent>;
  options?: CreateGameOptions;
  maxTicks: number;
  thinkInterval: number;
  sampleInterval?: number;
  trace?: SdkGameRunTraceOptions;
};

export type SdkGameRunTraceOptions = {
  commands?: boolean;
};

export type SdkCommandTraceEntry = {
  tick: number;
  owner: PlayerId;
  source: "internal-ai" | "external-agent";
  scriptId: string;
  command: GameCommand;
};

export type SdkGameRunReport = {
  name: string;
  mapId: MapId;
  tick: number;
  timeout: boolean;
  winner: PlayerId | null;
  winnerTeam: string;
  elapsedMs: number;
  cpuMs: number;
  snapshot: GameSnapshot;
  remaining: MatchStateSummary;
  timeline: MatchTimelineSample[];
  commandCounts: Partial<Record<GameCommand["type"], number>>;
  commandsByOwner: Record<PlayerId, number>;
  goldSpent: GameSnapshot["match"]["stats"]["goldSpent"];
  unitsKilled: GameSnapshot["match"]["stats"]["unitsKilled"];
  unitsLost: GameSnapshot["match"]["stats"]["unitsLost"];
  neutralUnitsKilled: GameSnapshot["match"]["stats"]["neutralUnitsKilled"];
  mercenaryKills: GameSnapshot["match"]["stats"]["mercenaryKills"];
  nonBaseBuildingsDestroyed: GameSnapshot["match"]["stats"]["nonBaseBuildingsDestroyed"];
  economy: Record<PlayerId, SdkPlayerEconomyReport>;
  economyTimings: Record<PlayerId, SdkPlayerEconomyTimingReport>;
  bases: Record<PlayerId, number>;
  expansions: Record<PlayerId, number>;
  miningBases: Record<PlayerId, number>;
  commands: SdkCommandTraceEntry[];
};

export type SdkPlayerEconomyReport = {
  bases: number;
  expansions: number;
  miningBases: number;
};

export type SdkPlayerEconomyTimingReport = {
  firstExpansionTick: number | null;
  firstMiningExpansionTick: number | null;
  maxBases: number;
  maxMiningBases: number;
};

export function runGame(input: SdkGameRunInput): SdkGameRunReport {
  const game =
    input.game ??
    createGame(requireMapId(input), {
      ...(input.options ?? {}),
      players: playersOf(input),
      aiPlayers: playersOf(input).filter((owner) => input.agents[owner]?.adapter === "internal"),
      teams: teamsOf(input),
      races: racesOf(input),
      ...(input.options?.scenario ? { scenario: input.options.scenario } : {}),
    });
  const players = playersOf(input);
  const teams = teamsOf(input);
  const versions = versionsOf(input);
  const internalPlayers = players.filter((owner) => input.agents[owner]?.adapter === "internal");
  const runtime = createAiRuntime(internalPlayers, { versions });
  const commandCounts: Partial<Record<GameCommand["type"], number>> = {};
  const commandsByOwner = Object.fromEntries(players.map((owner) => [owner, 0])) as Record<PlayerId, number>;
  const commandTrace: SdkCommandTraceEntry[] = [];
  const timeline = [summarizeTimelineSample(game, teams)];
  const economyTimings = initializeEconomyTimings(game, players);
  const sampleInterval = input.sampleInterval ?? 1_200;
  const started = performance.now();
  const cpuStarted = process.cpuUsage();

  while (game.tick < input.maxTicks && !game.match.winner) {
    if (game.tick % input.thinkInterval === 0) {
      issueInternalCommands(game, runtime, commandCounts, commandsByOwner, commandTrace, input.trace?.commands === true);
      issueExternalCommands(game, input, commandCounts, commandsByOwner, commandTrace, input.trace?.commands === true);
    }
    stepGame(game);
    updateEconomyTimings(economyTimings, game, players);
    if (game.tick % sampleInterval === 0 || game.match.winner) timeline.push(summarizeTimelineSample(game, teams));
  }

  const cpu = process.cpuUsage(cpuStarted);
  const snapshot = snapshotGame(game);
  const economy = summarizeRunEconomy(game, players);
  return {
    name: input.name,
    mapId: input.mapId ?? game.map.id,
    tick: game.tick,
    timeout: !game.match.winner,
    winner: game.match.winner,
    winnerTeam: game.match.winner ? teams[game.match.winner] ?? game.match.winner : "timeout",
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    snapshot,
    remaining: summarizeMatchState(game, teams),
    timeline,
    commandCounts,
    commandsByOwner,
    goldSpent: snapshot.match.stats.goldSpent,
    unitsKilled: snapshot.match.stats.unitsKilled,
    unitsLost: snapshot.match.stats.unitsLost,
    neutralUnitsKilled: snapshot.match.stats.neutralUnitsKilled,
    mercenaryKills: snapshot.match.stats.mercenaryKills,
    nonBaseBuildingsDestroyed: snapshot.match.stats.nonBaseBuildingsDestroyed,
    economy,
    economyTimings,
    bases: Object.fromEntries(Object.entries(economy).map(([owner, summary]) => [owner, summary.bases])),
    expansions: Object.fromEntries(Object.entries(economy).map(([owner, summary]) => [owner, summary.expansions])),
    miningBases: Object.fromEntries(Object.entries(economy).map(([owner, summary]) => [owner, summary.miningBases])),
    commands: commandTrace,
  };
}

function initializeEconomyTimings(game: Game, players: PlayerId[]): Record<PlayerId, SdkPlayerEconomyTimingReport> {
  const timings = Object.fromEntries(
    players.map((owner) => [
      owner,
      {
        firstExpansionTick: null,
        firstMiningExpansionTick: null,
        maxBases: 0,
        maxMiningBases: 0,
      },
    ]),
  ) as Record<PlayerId, SdkPlayerEconomyTimingReport>;
  updateEconomyTimings(timings, game, players);
  return timings;
}

function updateEconomyTimings(timings: Record<PlayerId, SdkPlayerEconomyTimingReport>, game: Game, players: PlayerId[]) {
  for (const owner of players) {
    const summary = summarizePlayerEconomy(game, owner);
    const timing = timings[owner];
    if (!timing) continue;
    timing.maxBases = Math.max(timing.maxBases, summary.bases);
    timing.maxMiningBases = Math.max(timing.maxMiningBases, summary.miningBases);
    if (summary.expansions > 0 && timing.firstExpansionTick === null) timing.firstExpansionTick = game.tick;
    if (summary.miningBases > 1 && timing.firstMiningExpansionTick === null) timing.firstMiningExpansionTick = game.tick;
  }
}

function summarizeRunEconomy(game: Game, players: PlayerId[]): Record<PlayerId, SdkPlayerEconomyReport> {
  return Object.fromEntries(players.map((owner) => [owner, summarizePlayerEconomy(game, owner)])) as Record<PlayerId, SdkPlayerEconomyReport>;
}

function summarizePlayerEconomy(game: Game, owner: PlayerId): SdkPlayerEconomyReport {
  const townHalls = game.buildings.filter((building) => building.owner === owner && building.kind === "townHall" && building.complete);
  const minedResourceIds = new Set(
    game.units
      .filter((unit) => unit.owner === owner && unit.kind === "worker" && unit.order.type === "mine")
      .map((unit) => (unit.order.type === "mine" ? unit.order.resourceId : "")),
  );
  const miningBases = townHalls.filter((townHall) =>
    game.resources.some((resource) => minedResourceIds.has(resource.id) && distance(townHall, resource) <= 280),
  ).length;
  return {
    bases: townHalls.length,
    expansions: Math.max(0, townHalls.length - 1),
    miningBases,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function issueInternalCommands(
  game: Game,
  runtime: ReturnType<typeof createAiRuntime>,
  commandCounts: Partial<Record<GameCommand["type"], number>>,
  commandsByOwner: Record<PlayerId, number>,
  commandTrace: SdkCommandTraceEntry[],
  shouldTraceCommands: boolean,
) {
  const result = runPresetAiRuntime(game, runtime);
  for (const entry of result.commands) recordCommand(game.tick, entry.playerId, "internal-ai", entry.scriptId, entry.command, commandCounts, commandsByOwner, commandTrace, shouldTraceCommands);
}

function issueExternalCommands(
  game: Game,
  input: SdkGameRunInput,
  commandCounts: Partial<Record<GameCommand["type"], number>>,
  commandsByOwner: Record<PlayerId, number>,
  commandTrace: SdkCommandTraceEntry[],
  shouldTraceCommands: boolean,
) {
  const snapshot = snapshotGame(game);
  const hiredCampIds = new Set<string>();
  const pickedItemIds = new Set<string>();
  const teams = teamsOf(input);
  for (const owner of playersOf(input)) {
    const agent = input.agents[owner];
    if (!agent || agent.adapter !== "external") continue;
    for (const entry of planPresetAiCommandEntries(snapshot, owner, { teams, version: agent.version })) {
      const command = entry.command;
      if (command.type === "hire") {
        if (hiredCampIds.has(command.campId)) continue;
        hiredCampIds.add(command.campId);
      }
      if (command.type === "pickupItem") {
        if (pickedItemIds.has(command.itemId)) continue;
        pickedItemIds.add(command.itemId);
      }
      issuePlayerCommand(game, owner, command);
      recordCommand(game.tick, owner, "external-agent", entry.scriptId, command, commandCounts, commandsByOwner, commandTrace, shouldTraceCommands);
    }
  }
}

function recordCommand(
  tick: number,
  owner: PlayerId,
  source: SdkCommandTraceEntry["source"],
  scriptId: string,
  command: GameCommand,
  commandCounts: Partial<Record<GameCommand["type"], number>>,
  commandsByOwner: Record<PlayerId, number>,
  commandTrace: SdkCommandTraceEntry[],
  shouldTraceCommands: boolean,
) {
  commandCounts[command.type] = (commandCounts[command.type] ?? 0) + 1;
  commandsByOwner[owner] = (commandsByOwner[owner] ?? 0) + 1;
  if (shouldTraceCommands) commandTrace.push({ tick, owner, source, scriptId, command });
}

function playersOf(input: SdkGameRunInput): PlayerId[] {
  return Object.keys(input.agents);
}

function teamsOf(input: SdkGameRunInput): Record<PlayerId, string> {
  return Object.fromEntries(Object.entries(input.agents).map(([owner, agent]) => [owner, agent.team])) as Record<PlayerId, string>;
}

function racesOf(input: SdkGameRunInput): Record<PlayerId, RaceId> {
  return Object.fromEntries(Object.entries(input.agents).filter((entry): entry is [PlayerId, SdkGameAgent & { race: RaceId }] => entry[1].race !== undefined).map(([owner, agent]) => [owner, agent.race])) as Record<PlayerId, RaceId>;
}

function versionsOf(input: SdkGameRunInput): Record<PlayerId, AiScriptVersion> {
  return Object.fromEntries(Object.entries(input.agents).map(([owner, agent]) => [owner, agent.version])) as Record<PlayerId, AiScriptVersion>;
}

function requireMapId(input: SdkGameRunInput): MapId {
  if (!input.mapId) throw new Error("runGame requires mapId when no game is supplied");
  return input.mapId;
}
