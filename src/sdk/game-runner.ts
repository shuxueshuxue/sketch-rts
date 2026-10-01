import { createSdkCommandFrameRuntime, type CommandFrameEntry, type SdkCommandFrameRuntime } from "./commands/frame";
import { summarizeMatchState, summarizeTimelineSample, type MatchStateSummary, type MatchTimelineSample } from "./match-report";
import { normalizeWinnerForMode, type SdkWinnerMode } from "./winner-mode";
import { createGame, snapshotGame, type CreateGameOptions, type Game } from "../shared/sim";
import type { GameCommand, GameSnapshot, MapId, PlayerId, RaceId } from "../shared/types";

export type SdkAgentController = "internal-ai" | "external-agent";
export type SdkPlannerOrigin = "local-command-planner" | "none";
export type SdkCommandSource = "internal-ai" | "external-agent";

export type SdkGameAgent = {
  controller: SdkAgentController;
  traceSource?: SdkCommandSource;
  team: string;
  race?: RaceId;
  versionLabel?: string;
};

export type SdkGameCommandPlannerContext<TAgent extends SdkGameAgent = SdkGameAgent> = {
  game: Game;
  snapshot: GameSnapshot;
  owner: PlayerId;
  agent: TAgent;
  source: SdkCommandSource;
  plannerOrigin: SdkPlannerOrigin;
  teams: Record<PlayerId, string>;
};

export type SdkGameCommandPlanner<TAgent extends SdkGameAgent = SdkGameAgent> = (context: SdkGameCommandPlannerContext<TAgent>) => CommandFrameEntry<SdkCommandSource>[];

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
  source: SdkCommandSource;
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

export type SdkGameLoopCommandEvent = SdkGameLoopContext & {
  tick: number;
  owner: PlayerId;
  source: SdkCommandSource;
  plannerOrigin: SdkPlannerOrigin;
  scriptId: string;
  command: GameCommand;
};

export type SdkGameLoopCommandContext = SdkGameLoopCommandEvent & {
  before: GameSnapshot;
  after: GameSnapshot;
};

export type SdkGameLoopStepContext = SdkGameLoopContext & {
  before: GameSnapshot;
  after: GameSnapshot;
};

export type SdkGameLoopHooks = {
  beforeLoop?: (context: SdkGameLoopContext) => void;
  // After every issued command, with copies of the world just before and just after it.
  afterCommand?: (context: SdkGameLoopCommandContext) => void;
  // After every issued command (and after afterCommand), without the copies: for a hook that reads the game itself, as
  // the command left it, and keeps what it needs. A copy of the world per command is most of what a command costs.
  onCommand?: (context: SdkGameLoopCommandEvent) => void;
  // Just before every step, after the tick's commands, without copies: for a hook that keeps what it needs of the world
  // the step starts from.
  beforeStep?: (context: SdkGameLoopContext) => void;
  // After every step, with copies of the world just before and just after it.
  afterStep?: (context: SdkGameLoopStepContext) => void;
  // After every step (and after afterStep), without the copies, for a hook that reads the game itself.
  onStep?: (context: SdkGameLoopContext) => void;
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
    onCommand({ tick, owner, source, scriptId, command }) {
      recordCommand(tick, owner, source, scriptId, command, commandCounts, commandsByOwner, commandTrace, input.trace?.commands === true);
    },
    onStep({ game, players, teams }) {
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
      aiPlayers: playersOf(input).filter((owner) => input.agents[owner]?.controller === "internal-ai"),
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

  // @@@snapshot-reuse - A snapshot copies the whole world, and the hooks want one before and after every step and every
  // command. Nothing changes the game between one step's `after` and the next step's `before` (or the first command's
  // `before`), nor between one command's `after` and the next command's `before`, so one copy serves both; the hooks and
  // the benchmark's trackers only read them. `current` is a copy of the game as it stands, while nothing has changed it
  // since. Without an afterStep hook no step is copied at all, without an afterCommand hook no command.
  let current: GameSnapshot | undefined;
  while (game.tick < input.maxTicks && !game.match.winner) {
    if (game.tick % input.thinkInterval === 0) {
      current = issueDueAgentCommands(frameRuntime, game, input, loopContext, hooks, current);
    }
    hooks.beforeStep?.(loopContext);
    if (!hooks.afterStep) {
      frameRuntime.tick();
      normalizeWinnerForMode(game, teams, input.winnerMode ?? "match");
      current = undefined;
      hooks.onStep?.(loopContext);
      continue;
    }
    const before = current ?? snapshotGame(game);
    frameRuntime.tick();
    normalizeWinnerForMode(game, teams, input.winnerMode ?? "match");
    const after = snapshotGame(game);
    hooks.afterStep({ ...loopContext, before, after });
    current = after;
    hooks.onStep?.(loopContext);
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

// Plans and issues this tick's commands; returns a copy of the game as it stands afterwards when one was made on the way
// (the last command's `after`, or `current` when nothing was issued), else undefined (see @@@snapshot-reuse).
function issueDueAgentCommands<TAgent extends SdkGameAgent>(
  frameRuntime: SdkCommandFrameRuntime,
  game: Game,
  input: SdkGameRunInput<TAgent>,
  loopContext: SdkGameLoopContext,
  hooks: SdkGameLoopHooks,
  current: GameSnapshot | undefined,
): GameSnapshot | undefined {
  if (!input.commandPlanner) return current;
  const snapshot = plannerView(game);
  const planned = playersOf(input).flatMap((owner) => {
    const agent = input.agents[owner];
    if (!agent) return [];
    const plannerOrigin: SdkPlannerOrigin = "local-command-planner";
    return input.commandPlanner!({
      game,
      snapshot,
      owner,
      agent,
      source: traceSourceFor(agent),
      plannerOrigin,
      teams: loopContext.teams,
    });
  });
  const { afterCommand, onCommand } = hooks;
  if (!afterCommand && !onCommand) {
    const { commands } = frameRuntime.issue(planned, {}, { checksum: false });
    return commands.length === 0 ? current : undefined;
  }
  let latest = current;
  frameRuntime.issue(
    planned,
    {
      beforeIssue() {
        if (afterCommand) latest ??= snapshotGame(game);
      },
      afterIssue(entry) {
        const event: SdkGameLoopCommandEvent = {
          ...loopContext,
          tick: game.tick,
          owner: entry.playerId,
          source: requireCommandSource(entry),
          plannerOrigin: "local-command-planner",
          scriptId: entry.scriptId,
          command: entry.command,
        };
        if (afterCommand) {
          const before = latest!;
          latest = snapshotGame(game);
          afterCommand({ ...event, before, after: latest });
        } else {
          latest = undefined;
        }
        onCommand?.(event);
      },
    },
    { checksum: false },
  );
  return latest;
}

// @@@planner-view - What the planners read each think: the game's own units, buildings, players and so on, in lists of
// their own, instead of a deep copy of the world (snapshotGame, ~3% of a benchmark game). The planners run while the game
// stands still (every command is applied after all of them have planned) and only read what they are handed: with the
// view deep-frozen no planner wrote to it over the fixed set, and no AI memory kept anything of it past its think. The
// lists are copies because the planners reorder some of them in place (claims.ts sorts resources and mercenary camps);
// the view object is new each think, so caches keyed by it stay per think. snapshotGame also turns a missing orderQueue
// into [], which no planner reads.
function plannerView(game: Game): GameSnapshot {
  return {
    tick: game.tick,
    match: game.match,
    map: game.map,
    teams: { ...game.teams },
    players: game.players,
    units: game.units.slice(),
    buildings: game.buildings.slice(),
    resources: game.resources.slice(),
    mercenaryCamps: game.mercenaryCamps.slice(),
    ...(game.shops ? { shops: game.shops.slice() } : {}),
    items: game.items.slice(),
    projectiles: game.projectiles.slice(),
    effects: game.effects.slice(),
    ...(game.variants ? { variants: { ...game.variants } } : {}),
  };
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

export function traceSourceFor(agent: SdkGameAgent): SdkCommandSource {
  return agent.traceSource ?? agent.controller;
}

function requireCommandSource(entry: CommandFrameEntry<SdkCommandSource>): SdkCommandSource {
  if (!entry.source) throw new Error(`SDK game runner command ${entry.scriptId} for ${entry.playerId} is missing trace source`);
  return entry.source;
}

function requireMapId<TAgent extends SdkGameAgent>(input: SdkGameRunInput<TAgent>): MapId {
  if (!input.mapId) throw new Error("runGame requires mapId when no game is supplied");
  return input.mapId;
}
