import { BUILDING_DEFS, UNIT_DEFS, UPGRADE_KINDS } from "../../shared/catalog";
import type { CreateGameOptions, Game } from "../../shared/sim";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import type { Building, BuildingKind, GameCommand, GameSnapshot, ItemKind, MapId, PlayerId, RaceId, Unit, UpgradeKind } from "../../shared/types";
import { analyzeGameMapObjectives, type SdkMapObjectiveReport } from "../map-analysis";
import { runGameLoop, type SdkAgentAdapter, type SdkGameAgent, type SdkGameCommandPlanner } from "../game-runner";

export type BenchmarkInput<TAgent extends SdkGameAgent = SdkGameAgent> = {
  name: string;
  evaluations: BenchmarkEvaluationInput<TAgent>[];
  trackers?: BenchmarkTracker<TAgent>[];
};

export type BenchmarkEvaluationInput<TAgent extends SdkGameAgent = SdkGameAgent> = {
  name: string;
  tag?: string;
  matches: BenchmarkMatchInput<TAgent>[];
};

export type BenchmarkMatchInput<TAgent extends SdkGameAgent = SdkGameAgent> = {
  name: string;
  mapId?: MapId;
  game?: Game;
  agents: Record<PlayerId, TAgent>;
  commandPlanner?: SdkGameCommandPlanner<TAgent>;
  options?: CreateGameOptions;
  winnerMode?: "match" | "combatElimination";
  maxTicks: number;
  thinkInterval: number;
};

export type BenchmarkTracker<TAgent extends SdkGameAgent = SdkGameAgent, State = unknown, Result = unknown> = {
  id: string;
  create?: (context: BenchmarkTrackerContext<TAgent>) => State;
  onCommand?: (state: State, context: BenchmarkCommandContext<TAgent>) => void;
  afterStep?: (state: State, context: BenchmarkStepContext<TAgent>) => void;
  finish: (state: State, context: BenchmarkFinishContext<TAgent>) => Result;
};

export type BenchmarkTrackerContext<TAgent extends SdkGameAgent = SdkGameAgent> = {
  game: Game;
  match: BenchmarkMatchInput<TAgent>;
  players: PlayerId[];
};

export type BenchmarkCommandContext<TAgent extends SdkGameAgent = SdkGameAgent> = BenchmarkTrackerContext<TAgent> & {
  tick: number;
  owner: PlayerId;
  adapter: SdkAgentAdapter;
  scriptId: string;
  command: GameCommand;
};

export type BenchmarkStepContext<TAgent extends SdkGameAgent = SdkGameAgent> = BenchmarkTrackerContext<TAgent> & {
  before: GameSnapshot;
  after: GameSnapshot;
};

export type BenchmarkFinishContext<TAgent extends SdkGameAgent = SdkGameAgent> = BenchmarkTrackerContext<TAgent> & {
  report: BenchmarkMatchReport;
};

export type BenchmarkReport = {
  name: string;
  startedAt: string;
  evaluationCount: number;
  matchCount: number;
  elapsedMs: number;
  cpuMs: number;
  evaluations: BenchmarkEvaluationReport[];
};

export type BenchmarkEvaluationReport = {
  name: string;
  tag?: string;
  startedAt: string;
  elapsedMs: number;
  cpuMs: number;
  matchCount: number;
  matches: BenchmarkMatchReport[];
};

export type BenchmarkMatchReport = {
  name: string;
  elapsedMs: number;
  cpuMs: number;
  setup: BenchmarkMatchSetup;
  result: BenchmarkMatchResult;
};

export type BenchmarkMatchSetup = {
  map: BenchmarkMapSetup;
  players: Record<PlayerId, BenchmarkPlayerSetup>;
};

export type BenchmarkMapSetup = {
  id: MapId;
  name: string;
  width: number;
  height: number;
  goldMineCount: number;
  goldMines: { id: string; x: number; y: number; amount: number }[];
  neutralCamps: SdkMapObjectiveReport;
  mercenaryCamps: { id: string; x: number; y: number; hireKind: string; stock: number }[];
  items: { total: number; byKind: Partial<Record<ItemKind, number>> };
};

export type BenchmarkPlayerSetup = {
  team: string;
  race: RaceId;
  aiVersion: string;
  adapter: SdkAgentAdapter;
};

export type BenchmarkMatchResult = {
  tick: number;
  gameSecond: number;
  winner: PlayerId | null;
  winnerTeam: string;
  timeout: boolean;
  players: Record<PlayerId, BenchmarkPlayerResult>;
  trackers: Record<string, unknown>;
};

export type BenchmarkPlayerResult = {
  team: string;
  race: RaceId;
  aiVersion: string;
  firstExpansionMiningSecond: number | null;
  upgradeSeconds: Partial<Record<UpgradeKind, Record<number, number>>>;
  starUnitCounts: Record<number, number>;
  firstEnemyEngagementSecond: number | null;
  firstEnemyExpansionAttackSecond: number | null;
  firstOwnExpansionAttackedSecond: number | null;
  baseBuildCount: number;
  neutralUnitKills: number;
  enemyUnitKills: number;
  unitsLost: number;
  unitsKilledByNeutral: number;
  defenseTowerBuildCount: number;
  moonWellBuildCount: number;
  moonWellHealingEvents: number;
  moonWellHealingHp: number;
  itemPickupCount: number;
  itemUseCount: number;
  peakSupply: number;
  finalSupply: number;
  finalBuildingCount: number;
  goldMineIncome: number;
  creepBountyIncome: number;
  totalGoldIncome: number;
  unitTrainingGoldSpent: number;
  buildingGoldSpent: number;
  totalGoldSpent: number;
};

type StandardBenchmarkState = {
  players: PlayerId[];
  teams: Record<PlayerId, string>;
  mainTownHallIds: Record<PlayerId, string | undefined>;
  expansionTownHallIds: Record<PlayerId, Set<string>>;
  baseBuildCount: Record<PlayerId, number>;
  defenseTowerBuildCount: Record<PlayerId, number>;
  moonWellBuildCount: Record<PlayerId, number>;
  moonWellHealingEvents: Record<PlayerId, number>;
  moonWellHealingHp: Record<PlayerId, number>;
  unitTrainingGoldSpent: Record<PlayerId, number>;
  buildingGoldSpent: Record<PlayerId, number>;
  itemPickupCount: Record<PlayerId, number>;
  itemUseCount: Record<PlayerId, number>;
  peakSupply: Record<PlayerId, number>;
  firstExpansionMiningSecond: Record<PlayerId, number | null>;
  upgradeSeconds: Record<PlayerId, Partial<Record<UpgradeKind, Record<number, number>>>>;
  firstEnemyEngagementSecond: Record<PlayerId, number | null>;
  firstEnemyExpansionAttackSecond: Record<PlayerId, number | null>;
  firstOwnExpansionAttackedSecond: Record<PlayerId, number | null>;
  goldMineIncome: Record<PlayerId, number>;
  creepBountyIncome: Record<PlayerId, number>;
};

export function runBenchmark<TAgent extends SdkGameAgent = SdkGameAgent>(input: BenchmarkInput<TAgent>): BenchmarkReport {
  const started = performance.now();
  const cpuStarted = cpuUsageNow();
  const startedAt = new Date().toISOString();
  const evaluations = input.evaluations.map((evaluation) => runBenchmarkEvaluation(evaluation, input.trackers ?? []));
  return {
    name: input.name,
    startedAt,
    evaluationCount: evaluations.length,
    matchCount: evaluations.reduce((total, evaluation) => total + evaluation.matchCount, 0),
    elapsedMs: roundMs(performance.now() - started),
    cpuMs: elapsedCpuMs(cpuStarted),
    evaluations,
  };
}

function runBenchmarkEvaluation<TAgent extends SdkGameAgent>(input: BenchmarkEvaluationInput<TAgent>, trackers: BenchmarkTracker<TAgent>[]): BenchmarkEvaluationReport {
  const started = performance.now();
  const cpuStarted = cpuUsageNow();
  const startedAt = new Date().toISOString();
  const matches = input.matches.map((match) => runBenchmarkMatch(match, trackers));
  return {
    name: input.name,
    ...(input.tag ? { tag: input.tag } : {}),
    startedAt,
    elapsedMs: roundMs(performance.now() - started),
    cpuMs: elapsedCpuMs(cpuStarted),
    matchCount: matches.length,
    matches,
  };
}

export function runBenchmarkMatch<TAgent extends SdkGameAgent>(input: BenchmarkMatchInput<TAgent>, trackers: BenchmarkTracker<TAgent>[] = []): BenchmarkMatchReport {
  const started = performance.now();
  const cpuStarted = cpuUsageNow();
  let setup!: BenchmarkMatchSetup;
  let standard!: StandardBenchmarkState;
  let trackerStates: { tracker: BenchmarkTracker<TAgent>; state: unknown }[] = [];
  const loop = runGameLoop(input, {
    beforeLoop({ game, players }) {
      setup = benchmarkSetup(game, input);
      standard = createStandardState(game, input, players);
      trackerStates = trackers.map((tracker) => ({ tracker, state: tracker.create ? tracker.create({ game, match: input, players }) : undefined }));
    },
    afterCommand(context) {
      updateStandardOnCommand(standard, context.game, context.owner, context.command);
      recordItemTransitions(standard, context.before, context.after);
      const benchmarkContext: BenchmarkCommandContext<TAgent> = {
        game: context.game,
        match: input,
        players: context.players,
        tick: context.tick,
        owner: context.owner,
        adapter: commandSourceAdapter(context.source),
        scriptId: context.scriptId,
        command: context.command,
      };
      for (const tracker of trackerStates) tracker.tracker.onCommand?.(tracker.state, benchmarkContext);
    },
    afterStep({ game, players, before, after }) {
      updateStandardAfterStep(standard, before, after);
      for (const entry of trackerStates) entry.tracker.afterStep?.(entry.state, { game, match: input, players, before, after });
    },
  });

  const result = benchmarkResult(loop.game, loop.snapshot, input, standard);
  const report: BenchmarkMatchReport = { name: input.name, elapsedMs: roundMs(performance.now() - started), cpuMs: elapsedCpuMs(cpuStarted), setup, result };
  for (const entry of trackerStates) {
    report.result.trackers[entry.tracker.id] = entry.tracker.finish(entry.state, { game: loop.game, match: input, players: loop.players, report });
  }
  return report;
}

function commandSourceAdapter(source: "internal-ai" | "external-agent"): SdkAgentAdapter {
  return source === "internal-ai" ? "internal" : "external";
}

function createStandardState<TAgent extends SdkGameAgent>(game: Game, input: BenchmarkMatchInput<TAgent>, players: PlayerId[]): StandardBenchmarkState {
  const mainTownHallIds = Object.fromEntries(players.map((owner) => [owner, firstTownHall(game, owner)?.id])) as Record<PlayerId, string | undefined>;
  const expansionTownHallIds = Object.fromEntries(
    players.map((owner) => [owner, new Set(game.buildings.filter((building) => building.owner === owner && building.kind === "townHall" && building.id !== mainTownHallIds[owner]).map((building) => building.id))]),
  ) as Record<PlayerId, Set<string>>;
  const initialBuildingCounts = (kind: BuildingKind) => Object.fromEntries(players.map((owner) => [owner, game.buildings.filter((building) => building.owner === owner && building.kind === kind).length])) as Record<PlayerId, number>;
  return {
    players,
    teams: teamsOf(input),
    mainTownHallIds,
    expansionTownHallIds,
    baseBuildCount: initialBuildingCounts("townHall"),
    defenseTowerBuildCount: initialBuildingCounts("defenseTower"),
    moonWellBuildCount: initialBuildingCounts("moonWell"),
    moonWellHealingEvents: zeroRecord(players),
    moonWellHealingHp: zeroRecord(players),
    unitTrainingGoldSpent: zeroRecord(players),
    buildingGoldSpent: zeroRecord(players),
    itemPickupCount: zeroRecord(players),
    itemUseCount: zeroRecord(players),
    peakSupply: Object.fromEntries(players.map((owner) => [owner, game.players[owner]?.supplyUsed ?? 0])) as Record<PlayerId, number>,
    firstExpansionMiningSecond: Object.fromEntries(players.map((owner) => [owner, miningBaseCount(game, owner) > 1 ? 0 : null])) as Record<PlayerId, number | null>,
    upgradeSeconds: Object.fromEntries(players.map((owner) => [owner, {}])) as Record<PlayerId, Partial<Record<UpgradeKind, Record<number, number>>>>,
    firstEnemyEngagementSecond: Object.fromEntries(players.map((owner) => [owner, firstEngagementSecond(game, owner, teamsOf(input))])) as Record<PlayerId, number | null>,
    firstEnemyExpansionAttackSecond: Object.fromEntries(players.map((owner) => [owner, null])) as Record<PlayerId, number | null>,
    firstOwnExpansionAttackedSecond: Object.fromEntries(players.map((owner) => [owner, null])) as Record<PlayerId, number | null>,
    goldMineIncome: zeroRecord(players),
    creepBountyIncome: zeroRecord(players),
  };
}

function updateStandardOnCommand(state: StandardBenchmarkState, game: Game, owner: PlayerId, command: GameCommand) {
  if (command.type === "build") {
    state.buildingGoldSpent[owner] = (state.buildingGoldSpent[owner] ?? 0) + BUILDING_DEFS[command.buildingKind].cost;
    if (command.buildingKind === "townHall") state.baseBuildCount[owner] = (state.baseBuildCount[owner] ?? 0) + 1;
    if (command.buildingKind === "defenseTower") state.defenseTowerBuildCount[owner] = (state.defenseTowerBuildCount[owner] ?? 0) + 1;
    if (command.buildingKind === "moonWell") state.moonWellBuildCount[owner] = (state.moonWellBuildCount[owner] ?? 0) + 1;
  }
  if (command.type === "train") state.unitTrainingGoldSpent[owner] = (state.unitTrainingGoldSpent[owner] ?? 0) + UNIT_DEFS[command.unitKind].cost;
  if (command.type === "build" && command.buildingKind === "townHall") {
    const nextId = `building-${owner}-townHall-${game.nextId}`;
    if (nextId !== state.mainTownHallIds[owner]) state.expansionTownHallIds[owner]?.add(nextId);
  }
}

function updateStandardAfterStep(state: StandardBenchmarkState, before: GameSnapshot, after: GameSnapshot) {
  const beforeBuildings = new Map(before.buildings.map((building) => [building.id, building]));
  const afterBuildings = new Map(after.buildings.map((building) => [building.id, building]));
  const beforeUnits = new Map(before.units.map((unit) => [unit.id, unit]));
  const afterUnits = new Map(after.units.map((unit) => [unit.id, unit]));
  const missingNeutralUnits = before.units.filter((unit) => unit.owner === "neutral" && !afterUnits.has(unit.id));
  recordMoonWellHealing(state, before, after, afterUnits);
  for (const owner of state.players) {
    state.peakSupply[owner] = Math.max(state.peakSupply[owner] ?? 0, after.players[owner]?.supplyUsed ?? 0);
    if (state.firstExpansionMiningSecond[owner] === null && miningBaseCount(after, owner) > 1) state.firstExpansionMiningSecond[owner] = tickSecond(after.tick);
    recordUpgradeSeconds(state, owner, before, after);
    if (state.firstEnemyEngagementSecond[owner] === null) {
      state.firstEnemyEngagementSecond[owner] = firstDamagingEnemyEngagementSecond(state, owner, beforeUnits, beforeBuildings, afterUnits, afterBuildings, after.tick) ?? firstEngagementSecond(after, owner, state.teams);
    }
    if (state.firstEnemyExpansionAttackSecond[owner] === null && attacksOpponentExpansion(state, owner, beforeBuildings, afterBuildings, after.units)) {
      state.firstEnemyExpansionAttackSecond[owner] = tickSecond(after.tick);
    }
    if (state.firstOwnExpansionAttackedSecond[owner] === null && ownExpansionDamaged(state, owner, beforeBuildings, afterBuildings)) {
      state.firstOwnExpansionAttackedSecond[owner] = tickSecond(after.tick);
    }
    const spent = (after.match.stats.goldSpent[owner] ?? 0) - (before.match.stats.goldSpent[owner] ?? 0);
    const bounty = neutralBountyForOwner(before, after, owner, missingNeutralUnits);
    const goldDelta = (after.players[owner]?.gold ?? 0) - (before.players[owner]?.gold ?? 0);
    const mined = Math.max(0, goldDelta + spent - bounty);
    state.creepBountyIncome[owner] = (state.creepBountyIncome[owner] ?? 0) + bounty;
    state.goldMineIncome[owner] = (state.goldMineIncome[owner] ?? 0) + mined;
  }
  recordItemTransitions(state, before, after);
}

function recordMoonWellHealing(state: StandardBenchmarkState, before: GameSnapshot, after: GameSnapshot, afterUnits: Map<string, Unit>) {
  const wells = after.buildings.filter((building) => building.kind === "moonWell" && building.complete && building.hp > 0);
  for (const effect of after.effects) {
    if (effect.type !== "heal" || effect.remaining !== effect.duration || effect.fromX === undefined || effect.fromY === undefined || effect.toX === undefined || effect.toY === undefined) continue;
    const well = wells.find((candidate) => distance(candidate, { x: effect.fromX!, y: effect.fromY! }) <= 1);
    if (!well) continue;
    let healedHp = 0;
    for (const beforeUnit of before.units) {
      if (beforeUnit.owner !== well.owner || beforeUnit.kind === "worker" || distance(beforeUnit, { x: effect.toX, y: effect.toY }) > 2) continue;
      const afterUnit = afterUnits.get(beforeUnit.id);
      if (!afterUnit) continue;
      healedHp = Math.max(healedHp, Math.max(0, afterUnit.hp - beforeUnit.hp));
    }
    state.moonWellHealingEvents[well.owner] = (state.moonWellHealingEvents[well.owner] ?? 0) + 1;
    state.moonWellHealingHp[well.owner] = (state.moonWellHealingHp[well.owner] ?? 0) + healedHp;
  }
}

function recordItemTransitions(state: StandardBenchmarkState, before: GameSnapshot, after: GameSnapshot) {
  const beforeItems = new Map(before.items.map((item) => [item.id, item]));
  const afterItems = new Map(after.items.map((item) => [item.id, item]));
  const beforeUnits = new Map(before.units.map((unit) => [unit.id, unit]));
  const afterUnits = new Map(after.units.map((unit) => [unit.id, unit]));

  for (const item of after.items) {
    const previous = beforeItems.get(item.id);
    if (!previous || previous.carrierId || !item.carrierId) continue;
    const carrier = afterUnits.get(item.carrierId);
    if (!carrier || carrier.owner === "neutral") continue;
    state.itemPickupCount[carrier.owner] = (state.itemPickupCount[carrier.owner] ?? 0) + 1;
  }

  for (const item of before.items) {
    if (!item.carrierId) continue;
    const carrier = beforeUnits.get(item.carrierId);
    if (!carrier || carrier.owner === "neutral") continue;
    const next = afterItems.get(item.id);
    if (!next || next.cooldownRemaining > item.cooldownRemaining) {
      state.itemUseCount[carrier.owner] = (state.itemUseCount[carrier.owner] ?? 0) + 1;
    }
  }
}

function benchmarkSetup<TAgent extends SdkGameAgent>(game: Game, input: BenchmarkMatchInput<TAgent>): BenchmarkMatchSetup {
  return {
    map: {
      id: game.map.id,
      name: game.map.name,
      width: game.map.width,
      height: game.map.height,
      goldMineCount: game.resources.length,
      goldMines: game.resources.map((resource) => ({ id: resource.id, x: resource.x, y: resource.y, amount: resource.amount })),
      neutralCamps: analyzeGameMapObjectives(game),
      mercenaryCamps: game.mercenaryCamps.map((camp) => ({ id: camp.id, x: camp.x, y: camp.y, hireKind: camp.hireKind, stock: camp.stock })),
      items: { total: game.items.length, byKind: countBy(game.items.map((item) => item.kind)) },
    },
    players: Object.fromEntries(
      Object.entries(input.agents).map(([owner, agent]) => [
        owner,
        { team: agent.team, race: agent.race ?? game.players[owner]?.race ?? "grove", aiVersion: agent.versionLabel ?? "unknown", adapter: agent.adapter },
      ]),
    ),
  };
}

function benchmarkResult<TAgent extends SdkGameAgent>(game: Game, snapshot: GameSnapshot, input: BenchmarkMatchInput<TAgent>, state: StandardBenchmarkState): BenchmarkMatchResult {
  const players = Object.fromEntries(state.players.map((owner) => [owner, playerResult(owner, snapshot, input, state)])) as Record<PlayerId, BenchmarkPlayerResult>;
  const overrideWinner = input.winnerMode === "combatElimination" ? combatEliminationWinner(snapshot, state) : undefined;
  const winner = game.match.winner ?? overrideWinner?.winner ?? null;
  const winnerTeam = game.match.winner ? state.teams[game.match.winner] ?? game.match.winner : (overrideWinner?.team ?? "timeout");
  return {
    tick: game.tick,
    gameSecond: tickSecond(game.tick),
    winner,
    winnerTeam,
    timeout: !winner,
    players,
    trackers: {},
  };
}

function combatEliminationWinner(snapshot: GameSnapshot, state: StandardBenchmarkState): { winner: PlayerId; team: string } | undefined {
  const combatByTeam = new Map<string, PlayerId[]>();
  for (const owner of state.players) {
    const team = state.teams[owner] ?? owner;
    const combatUnits = snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker");
    if (combatUnits.length > 0) combatByTeam.set(team, [...(combatByTeam.get(team) ?? []), owner]);
  }
  if (combatByTeam.size !== 1) return undefined;
  const [team, owners] = [...combatByTeam.entries()][0]!;
  return { team, winner: owners[0]! };
}

function playerResult<TAgent extends SdkGameAgent>(owner: PlayerId, snapshot: GameSnapshot, input: BenchmarkMatchInput<TAgent>, state: StandardBenchmarkState): BenchmarkPlayerResult {
  const agent = input.agents[owner]!;
  const neutralKills = snapshot.match.stats.neutralUnitsKilled[owner] ?? 0;
  const totalKills = snapshot.match.stats.unitsKilled[owner] ?? 0;
  const finalUnits = snapshot.units.filter((unit) => unit.owner === owner);
  return {
    team: agent.team,
    race: agent.race ?? snapshot.players[owner]?.race ?? "grove",
    aiVersion: agent.versionLabel ?? "unknown",
    firstExpansionMiningSecond: state.firstExpansionMiningSecond[owner] ?? null,
    upgradeSeconds: state.upgradeSeconds[owner] ?? {},
    starUnitCounts: countBy(finalUnits.filter((unit) => unit.kind !== "worker" && unit.level > 0).map((unit) => unit.level)),
    firstEnemyEngagementSecond: state.firstEnemyEngagementSecond[owner] ?? null,
    firstEnemyExpansionAttackSecond: state.firstEnemyExpansionAttackSecond[owner] ?? null,
    firstOwnExpansionAttackedSecond: state.firstOwnExpansionAttackedSecond[owner] ?? null,
    baseBuildCount: Math.max(1, state.baseBuildCount[owner] ?? 0),
    neutralUnitKills: neutralKills,
    enemyUnitKills: Math.max(0, totalKills - neutralKills),
    unitsLost: snapshot.match.stats.unitsLost[owner] ?? 0,
    unitsKilledByNeutral: snapshot.match.stats.unitsKilledByNeutral[owner] ?? 0,
    defenseTowerBuildCount: state.defenseTowerBuildCount[owner] ?? 0,
    moonWellBuildCount: state.moonWellBuildCount[owner] ?? 0,
    moonWellHealingEvents: state.moonWellHealingEvents[owner] ?? 0,
    moonWellHealingHp: state.moonWellHealingHp[owner] ?? 0,
    itemPickupCount: state.itemPickupCount[owner] ?? 0,
    itemUseCount: state.itemUseCount[owner] ?? 0,
    peakSupply: state.peakSupply[owner] ?? 0,
    finalSupply: snapshot.players[owner]?.supplyUsed ?? 0,
    finalBuildingCount: snapshot.buildings.filter((building) => building.owner === owner).length,
    goldMineIncome: state.goldMineIncome[owner] ?? 0,
    creepBountyIncome: state.creepBountyIncome[owner] ?? 0,
    totalGoldIncome: (state.goldMineIncome[owner] ?? 0) + (state.creepBountyIncome[owner] ?? 0),
    unitTrainingGoldSpent: state.unitTrainingGoldSpent[owner] ?? 0,
    buildingGoldSpent: state.buildingGoldSpent[owner] ?? 0,
    totalGoldSpent: snapshot.match.stats.goldSpent[owner] ?? 0,
  };
}

function recordUpgradeSeconds(state: StandardBenchmarkState, owner: PlayerId, before: GameSnapshot, after: GameSnapshot) {
  for (const kind of UPGRADE_KINDS) {
    const beforeLevel = before.players[owner]?.upgrades[kind] ?? 0;
    const afterLevel = after.players[owner]?.upgrades[kind] ?? 0;
    for (let level = beforeLevel + 1; level <= afterLevel; level += 1) {
      state.upgradeSeconds[owner] ??= {};
      state.upgradeSeconds[owner]![kind] ??= {};
      state.upgradeSeconds[owner]![kind]![level] = tickSecond(after.tick);
    }
  }
}

function neutralBountyForOwner(before: GameSnapshot, after: GameSnapshot, owner: PlayerId, missingNeutralUnits: Unit[]) {
  const killDelta = (after.match.stats.neutralUnitsKilled[owner] ?? 0) - (before.match.stats.neutralUnitsKilled[owner] ?? 0);
  if (killDelta <= 0) return 0;
  return missingNeutralUnits.slice(0, killDelta).reduce((total, unit) => total + (UNIT_DEFS[unit.kind].goldBounty ?? 0), 0);
}

function attacksOpponentExpansion(state: StandardBenchmarkState, owner: PlayerId, beforeBuildings: Map<string, Building>, afterBuildings: Map<string, Building>, units: Unit[]) {
  for (const opponent of state.players.filter((candidate) => state.teams[candidate] !== state.teams[owner])) {
    for (const id of state.expansionTownHallIds[opponent] ?? []) {
      const before = beforeBuildings.get(id);
      const after = afterBuildings.get(id);
      if (!before || !after || after.hp >= before.hp) continue;
      if (units.some((unit) => unit.owner === owner && (distance(unit, after) <= unit.attackRange + 20 || (unit.order.type === "attack" && unit.order.targetId === id)))) return true;
    }
  }
  return false;
}

function ownExpansionDamaged(state: StandardBenchmarkState, owner: PlayerId, beforeBuildings: Map<string, Building>, afterBuildings: Map<string, Building>) {
  for (const id of state.expansionTownHallIds[owner] ?? []) {
    const before = beforeBuildings.get(id);
    const after = afterBuildings.get(id);
    if (before && after && after.hp < before.hp) return true;
  }
  return false;
}

function firstEngagementSecond(snapshot: GameSnapshot, owner: PlayerId, teams: Record<PlayerId, string>) {
  const own = snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker");
  const enemies = snapshot.units.filter((unit) => unit.owner !== "neutral" && teams[unit.owner] !== teams[owner] && unit.kind !== "worker");
  return own.some((unit) => enemies.some((enemy) => distance(unit, enemy) <= Math.max(unit.attackRange, enemy.attackRange) + unit.radius + enemy.radius + 18)) ? tickSecond(snapshot.tick) : null;
}

function firstDamagingEnemyEngagementSecond(
  state: StandardBenchmarkState,
  owner: PlayerId,
  beforeUnits: Map<string, Unit>,
  beforeBuildings: Map<string, Building>,
  afterUnits: Map<string, Unit>,
  afterBuildings: Map<string, Building>,
  tick: number,
) {
  for (const target of damagedPlayerEntities(state, beforeUnits, beforeBuildings, afterUnits, afterBuildings)) {
    const victimOwner = target.owner;
    const attackers = possibleDamageAttackers(state, victimOwner, target, afterUnits, afterBuildings);
    if (attackers.length === 0) continue;
    if (owner === victimOwner || attackers.some((attacker) => attacker.owner === owner)) return tickSecond(tick);
  }
  return null;
}

function damagedPlayerEntities(
  state: StandardBenchmarkState,
  beforeUnits: Map<string, Unit>,
  beforeBuildings: Map<string, Building>,
  afterUnits: Map<string, Unit>,
  afterBuildings: Map<string, Building>,
) {
  const damaged: (Unit | Building)[] = [];
  for (const before of beforeUnits.values()) {
    if (!trackedPlayer(state, before.owner)) continue;
    const after = afterUnits.get(before.id);
    if (!after || after.hp < before.hp) damaged.push(before);
  }
  for (const before of beforeBuildings.values()) {
    if (!trackedPlayer(state, before.owner)) continue;
    const after = afterBuildings.get(before.id);
    if (!after || after.hp < before.hp) damaged.push(before);
  }
  return damaged;
}

function possibleDamageAttackers(
  state: StandardBenchmarkState,
  victimOwner: PlayerId,
  target: Unit | Building,
  afterUnits: Map<string, Unit>,
  afterBuildings: Map<string, Building>,
) {
  return [...afterUnits.values(), ...afterBuildings.values()].filter((attacker) => {
    if (!trackedPlayer(state, attacker.owner) || state.teams[attacker.owner] === state.teams[victimOwner]) return false;
    if ("order" in attacker && (attacker.order.type === "attack" || attacker.order.type === "attackMove") && attacker.order.targetId === target.id) return true;
    return attacker.attackDamage > 0 && distance(attacker, target) <= attacker.attackRange + attacker.radius + target.radius + 28;
  });
}

function trackedPlayer(state: StandardBenchmarkState, owner: string): owner is PlayerId {
  return state.players.includes(owner);
}

function miningBaseCount(snapshot: GameSnapshot, owner: PlayerId) {
  const minedResourceIds = new Set(snapshot.units.filter((unit) => unit.owner === owner && unit.kind === "worker" && unit.order.type === "mine").map((unit) => (unit.order.type === "mine" ? unit.order.resourceId : "")));
  return snapshot.buildings
    .filter((building) => building.owner === owner && building.kind === "townHall" && building.complete)
    .filter((townHall) => snapshot.resources.some((resource) => minedResourceIds.has(resource.id) && distance(townHall, resource) <= 280)).length;
}

function firstTownHall(game: Game, owner: PlayerId) {
  return game.buildings.find((building) => building.owner === owner && building.kind === "townHall");
}

function tickSecond(tick: number) {
  return Number((tick / SIM_TICKS_PER_SECOND).toFixed(2));
}

function countBy<T extends string | number>(values: T[]) {
  const counts: Record<T, number> = {} as Record<T, number>;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function zeroRecord(players: PlayerId[]) {
  return Object.fromEntries(players.map((owner) => [owner, 0])) as Record<PlayerId, number>;
}

function teamsOf<TAgent extends SdkGameAgent>(input: BenchmarkMatchInput<TAgent>): Record<PlayerId, string> {
  return Object.fromEntries(Object.entries(input.agents).map(([owner, agent]) => [owner, agent.team])) as Record<PlayerId, string>;
}

function roundMs(value: number) {
  return Number(value.toFixed(3));
}

function cpuUsageNow() {
  if (typeof process === "undefined" || typeof process.cpuUsage !== "function") throw new Error("Benchmark CPU timing requires Node.js process.cpuUsage");
  return process.cpuUsage();
}

function elapsedCpuMs(start: NodeJS.CpuUsage) {
  const usage = process.cpuUsage(start);
  return roundMs((usage.user + usage.system) / 1000);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
