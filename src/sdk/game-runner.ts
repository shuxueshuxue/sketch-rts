import { createSdkCommandFrameRuntime, type CommandFrameEntry, type SdkCommandFrameRuntime } from "./commands/frame";
import { summarizeMatchState, summarizeTimelineSample, type MatchStateSummary, type MatchTimelineSample } from "./match-report";
import { normalizeWinnerForMode, type SdkWinnerMode } from "./winner-mode";
import { createGame, snapshotGame, type CreateGameOptions, type Game } from "../shared/sim";
import type { GameCommand, GameSnapshot, MapId, PlayerId, RaceId } from "../shared/types";

export type SdkAgentAdapter = "internal" | "external";

export type SdkGameAgent = {
  adapter: SdkAgentAdapter;
  team: string;
  race?: RaceId;
  versionLabel?: string;
};

export type SdkGameCommandPlannerContext<TAgent extends SdkGameAgent = SdkGameAgent> = {
  game: Game;
  snapshot: GameSnapshot;
  owner: PlayerId;
  agent: TAgent;
  source: SdkCommandTraceEntry["source"];
  teams: Record<PlayerId, string>;
};

export type SdkGameCommandPlanner<TAgent extends SdkGameAgent = SdkGameAgent> = (context: SdkGameCommandPlannerContext<TAgent>) => CommandFrameEntry<SdkCommandTraceEntry["source"]>[];

export type SdkGameRunInput<TAgent extends SdkGameAgent = SdkGameAgent> = {
  name: string;
  mapId?: MapId;
  game?: Game;
  agents: Record<PlayerId, TAgent>;
  options?: CreateGameOptions;
  maxTicks: number;
  thinkInterval: number;
  commandPlanner?: SdkGameCommandPlanner<TAgent>;
  sampleInterval?: number;
  trace?: SdkGameRunTraceOptions;
  winnerMode?: SdkWinnerMode;
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
  unitsKilledByNeutral: GameSnapshot["match"]["stats"]["unitsKilledByNeutral"];
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

export type SdkGameLoopContext = {
  game: Game;
  players: PlayerId[];
  teams: Record<PlayerId, string>;
};

export type SdkGameLoopCommandContext = SdkGameLoopContext & {
  tick: number;
  owner: PlayerId;
  source: SdkCommandTraceEntry["source"];
  scriptId: string;
  command: GameCommand;
  before: GameSnapshot;
  after: GameSnapshot;
};

export type SdkGameLoopStepContext = SdkGameLoopContext & {
  before: GameSnapshot;
  after: GameSnapshot;
};

export type SdkGameLoopHooks = {
  beforeLoop?: (context: SdkGameLoopContext) => void;
  afterCommand?: (context: SdkGameLoopCommandContext) => void;
  afterStep?: (context: SdkGameLoopStepContext) => void;
};

export type SdkGameLoopResult = SdkGameLoopContext & {
  snapshot: GameSnapshot;
  elapsedMs: number;
  cpuMs: number;
};

export function runGame<TAgent extends SdkGameAgent = SdkGameAgent>(input: SdkGameRunInput<TAgent>): SdkGameRunReport {
  const commandCounts: Partial<Record<GameCommand["type"], number>> = {};
  let commandsByOwner: Record<PlayerId, number> = {};
  const commandTrace: SdkCommandTraceEntry[] = [];
  let timeline: MatchTimelineSample[] = [];
  let economyTimings: Record<PlayerId, SdkPlayerEconomyTimingReport> = {};
  const sampleInterval = input.sampleInterval ?? 1_200;

  const loop = runGameLoop(input, {
    beforeLoop({ game, players, teams }) {
      commandsByOwner = Object.fromEntries(players.map((owner) => [owner, 0])) as Record<PlayerId, number>;
      timeline = [summarizeTimelineSample(game, teams)];
      economyTimings = initializeEconomyTimings(game, players);
    },
    afterCommand({ tick, owner, source, scriptId, command }) {
      recordCommand(tick, owner, source, scriptId, command, commandCounts, commandsByOwner, commandTrace, input.trace?.commands === true);
    },
    afterStep({ game, players, teams }) {
      updateEconomyTimings(economyTimings, game, players);
      if (game.tick % sampleInterval === 0 || game.match.winner) timeline.push(summarizeTimelineSample(game, teams));
    },
  });

  const { game, players, teams, snapshot } = loop;
  const economy = summarizeRunEconomy(game, players);
  return {
    name: input.name,
    mapId: input.mapId ?? game.map.id,
    tick: game.tick,
    timeout: !game.match.winner,
    winner: game.match.winner,
    winnerTeam: game.match.winner ? teams[game.match.winner] ?? game.match.winner : "timeout",
    elapsedMs: loop.elapsedMs,
    cpuMs: loop.cpuMs,
    snapshot,
    remaining: summarizeMatchState(game, teams),
    timeline,
    commandCounts,
    commandsByOwner,
    goldSpent: snapshot.match.stats.goldSpent,
    unitsKilled: snapshot.match.stats.unitsKilled,
    unitsLost: snapshot.match.stats.unitsLost,
    neutralUnitsKilled: snapshot.match.stats.neutralUnitsKilled,
    unitsKilledByNeutral: snapshot.match.stats.unitsKilledByNeutral,
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

export function runGameLoop<TAgent extends SdkGameAgent = SdkGameAgent>(input: SdkGameRunInput<TAgent>, hooks: SdkGameLoopHooks = {}): SdkGameLoopResult {
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
  const loopContext = { game, players, teams };
  const frameRuntime = createSdkCommandFrameRuntime(game);
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  hooks.beforeLoop?.(loopContext);

  while (game.tick < input.maxTicks && !game.match.winner) {
    if (game.tick % input.thinkInterval === 0) {
      issueDueAgentCommands(frameRuntime, game, input, loopContext, hooks);
    }
    const before = snapshotGame(game);
    frameRuntime.tick();
    normalizeWinnerForMode(game, teams, input.winnerMode ?? "match");
    const after = snapshotGame(game);
    hooks.afterStep?.({ ...loopContext, before, after });
  }

  const cpu = process.cpuUsage(cpuStarted);
  return {
    ...loopContext,
    snapshot: snapshotGame(game),
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
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

function issueDueAgentCommands<TAgent extends SdkGameAgent>(
  frameRuntime: SdkCommandFrameRuntime,
  game: Game,
  input: SdkGameRunInput<TAgent>,
  loopContext: SdkGameLoopContext,
  hooks: SdkGameLoopHooks,
) {
  if (!input.commandPlanner) return;
  const snapshot = snapshotGame(game);
  const planned = playersOf(input).flatMap((owner) => {
    const agent = input.agents[owner];
    if (!agent) return [];
    return input.commandPlanner!({
      game,
      snapshot,
      owner,
      agent,
      source: agent.adapter === "internal" ? "internal-ai" : "external-agent",
      teams: loopContext.teams,
    });
  });
  let beforeCommand = snapshotGame(game);
  frameRuntime.issue(planned, {
    beforeIssue() {
      beforeCommand = snapshotGame(game);
    },
    afterIssue(entry) {
      hooks.afterCommand?.({
        ...loopContext,
        tick: game.tick,
        owner: entry.playerId,
        source: entry.source ?? "external-agent",
        scriptId: entry.scriptId,
        command: entry.command,
        before: beforeCommand,
        after: snapshotGame(game),
      });
    },
  });
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

function playersOf<TAgent extends SdkGameAgent>(input: SdkGameRunInput<TAgent>): PlayerId[] {
  return Object.keys(input.agents);
}

function teamsOf<TAgent extends SdkGameAgent>(input: SdkGameRunInput<TAgent>): Record<PlayerId, string> {
  return Object.fromEntries(Object.entries(input.agents).map(([owner, agent]) => [owner, agent.team])) as Record<PlayerId, string>;
}

function racesOf<TAgent extends SdkGameAgent>(input: SdkGameRunInput<TAgent>): Record<PlayerId, RaceId> {
  return Object.fromEntries(Object.entries(input.agents).flatMap(([owner, agent]) => (agent.race === undefined ? [] : [[owner, agent.race]]))) as Record<PlayerId, RaceId>;
}

function requireMapId<TAgent extends SdkGameAgent>(input: SdkGameRunInput<TAgent>): MapId {
  if (!input.mapId) throw new Error("runGame requires mapId when no game is supplied");
  return input.mapId;
}
