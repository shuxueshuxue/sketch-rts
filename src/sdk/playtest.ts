import { createSaveGameRecord, restoreGameFromSave, type SaveGameRecord } from "../shared/savegame";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import { createGame, snapshotGame, stepGame, type CreateGameOptions, type Game } from "../shared/sim";
import type { Building, GameCommand, GameSnapshot, MapId, PlayerId, RaceId, RoomState, Unit, UnitOrder } from "../shared/types";
import { issueCommandFrame, type CommandFrameEntry } from "./commands/frame";
import { controlledPoint, resolveSdkCommandIntent, type SdkCommandIntent, type SdkUnitSelector } from "./commands/intent";
import { createSnapshotQuery } from "./snapshot/query";
import { normalizeWinnerForMode, type SdkWinnerMode } from "./winner-mode";

export type InteractiveUnitSelector = SdkUnitSelector;

export type InteractivePlaytestCommand =
  | { type: "raw"; owner?: PlayerId; command: GameCommand }
  | SdkCommandIntent;

export type InteractivePlaytestSessionInput = {
  id?: string;
  mapId: MapId;
  controlledPlayer: PlayerId;
  scriptedPlayers: PlayerId[];
  winnerMode?: SdkWinnerMode;
  options?: CreateGameOptions;
};

export type InteractivePlaytestTranscriptEntry =
  | { type: "command"; tick: number; owner: PlayerId; command: GameCommand }
  | { type: "step"; fromTick: number; toTick: number; scriptedCommands: number };

export type InteractivePlaytestEvents = {
  firstFightTick: number | null;
  lastStepUntil: { condition: InteractivePlaytestCondition["type"]; checkedAtTick: number; timedOut: boolean } | null;
};

export type InteractivePlaytestSession = {
  id: string;
  controlledPlayer: PlayerId;
  scriptedPlayers: PlayerId[];
  winnerMode: SdkWinnerMode;
  game: Game;
  events: InteractivePlaytestEvents;
  transcript: InteractivePlaytestTranscriptEntry[];
};

export type SerializedInteractivePlaytestSession = {
  schemaVersion: 3;
  id: string;
  controlledPlayer: PlayerId;
  scriptedPlayers: PlayerId[];
  winnerMode: SdkWinnerMode;
  save: SaveGameRecord;
  events: InteractivePlaytestEvents;
  transcript: InteractivePlaytestTranscriptEntry[];
};

export type InteractivePlaytestSummary = {
  id: string;
  tick: number;
  gameSecond: number;
  controlledPlayer: PlayerId;
  winner: PlayerId | null;
  runState: {
    winner: PlayerId | null;
    timeout: boolean;
  };
  fight: {
    state: "none" | "inContact" | "contactRecorded";
    firstFightGameSecond: number | null;
  };
  players: Record<PlayerId, InteractivePlaytestPlayerSummary>;
  controlledUnits: InteractivePlaytestUnitSummary[];
  visibleObjectives: InteractiveObjectiveSummary[];
  nearbyEnemies: { id: string; kind: string; x: number; y: number; hp: number; maxHp: number }[];
};

export type InteractivePlaytestUnitInspectionOwner = Unit["owner"] | "all";

export type InteractivePlaytestUnitInspection = {
  tick: number;
  gameSecond: number;
  winner: PlayerId | null;
  owner: InteractivePlaytestUnitInspectionOwner;
  units: InteractivePlaytestInspectedUnit[];
};

export type InteractivePlaytestPlayerSummary = {
  race: RaceId;
  gold: number;
  supplyUsed: number;
  supplyCap: number;
  workers: number;
  combatUnits: number;
  bases: number;
  buildings: number;
  orders: Record<string, number>;
};

export type InteractiveObjectiveSummary = {
  id: string;
  kind: "resource" | "mercenaryCamp" | "item";
  x: number;
  y: number;
  distance: number;
};

export type InteractivePlaytestUnitSummary = {
  id: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  order: UnitOrder;
  carriedItems: { id: string; kind: string; cooldownRemaining: number }[];
};

export type InteractivePlaytestInspectedUnit = InteractivePlaytestUnitSummary & {
  owner: Unit["owner"];
};

export type InteractivePlaytestStepOptions<Source extends string = string> = {
  beforeStep?: (session: InteractivePlaytestSession) => number | void;
  scriptedPlayers?: Partial<Record<PlayerId, (snapshot: GameSnapshot, owner: PlayerId, game: Game) => CommandFrameEntry<Source>[]>>;
};

export type InteractivePlaytestCondition =
  | { type: "firstFight" }
  | { type: "winner" }
  | { type: "tick"; tick: number }
  | { type: "enemyNearby"; range?: number };

export type InteractivePlaytestUntilOptions<Source extends string = string> = InteractivePlaytestStepOptions<Source> & {
  maxTicks: number;
};

export type InteractivePlaytestUntilResult = {
  conditionMet: boolean;
  timedOut: boolean;
  tick: number;
};

export function createInteractivePlaytestSession(input: InteractivePlaytestSessionInput): InteractivePlaytestSession {
  const players = input.options?.players ? [...new Set([...input.options.players, input.controlledPlayer, ...input.scriptedPlayers])] : [...new Set([input.controlledPlayer, ...input.scriptedPlayers])];
  const game = createGame(input.mapId, {
    ...(input.options ?? {}),
    players,
    aiPlayers: input.scriptedPlayers,
  });
  return {
    id: input.id ?? `interactive-${input.mapId}`,
    controlledPlayer: input.controlledPlayer,
    scriptedPlayers: [...input.scriptedPlayers],
    winnerMode: input.winnerMode ?? "match",
    game,
    events: { firstFightTick: null, lastStepUntil: null },
    transcript: [],
  };
}

export function applyInteractivePlaytestCommand(session: InteractivePlaytestSession, command: InteractivePlaytestCommand) {
  const owner = command.type === "raw" ? command.owner ?? session.controlledPlayer : session.controlledPlayer;
  const gameCommand = toGameCommand(session.game, owner, command);
  const result = issueCommandFrame(session.game, [{ playerId: owner, source: "interactive", scriptId: `interactive-${command.type}`, command: gameCommand }]);
  for (const issued of result.commands) {
    session.transcript.push({ type: "command", tick: session.game.tick, owner: issued.playerId, command: issued.command });
  }
  recordPlaytestEvents(session);
  return result;
}

export function stepInteractivePlaytestSession<Source extends string = string>(session: InteractivePlaytestSession, ticks: number, options: InteractivePlaytestStepOptions<Source> = {}) {
  if (!Number.isInteger(ticks) || ticks < 1) throw new Error(`Step ticks must be a positive integer, got ${ticks}`);
  const fromTick = session.game.tick;
  let scriptedCommands = 0;
  for (let elapsed = 0; elapsed < ticks && !session.game.match.winner; elapsed += 1) {
    scriptedCommands += stepInteractivePlaytestTick(session, options);
  }
  session.transcript.push({ type: "step", fromTick, toTick: session.game.tick, scriptedCommands });
}

export function stepInteractivePlaytestUntil<Source extends string = string>(session: InteractivePlaytestSession, condition: InteractivePlaytestCondition, options: InteractivePlaytestUntilOptions<Source>): InteractivePlaytestUntilResult {
  if (!Number.isInteger(options.maxTicks) || options.maxTicks < 1) throw new Error(`Step-until maxTicks must be a positive integer, got ${options.maxTicks}`);
  const fromTick = session.game.tick;
  let scriptedCommands = 0;
  let conditionMet = conditionMatches(session, condition);
  for (let elapsed = 0; elapsed < options.maxTicks && !conditionMet && !session.game.match.winner; elapsed += 1) {
    scriptedCommands += stepInteractivePlaytestTick(session, options);
    conditionMet = conditionMatches(session, condition);
  }
  const timedOut = !conditionMet;
  session.events.lastStepUntil = { condition: condition.type, checkedAtTick: session.game.tick, timedOut };
  session.transcript.push({ type: "step", fromTick, toTick: session.game.tick, scriptedCommands });
  return { conditionMet, timedOut, tick: session.game.tick };
}

export function serializeInteractivePlaytestSession(session: InteractivePlaytestSession): SerializedInteractivePlaytestSession {
  const room = roomForSession(session);
  return {
    schemaVersion: 3,
    id: session.id,
    controlledPlayer: session.controlledPlayer,
    scriptedPlayers: [...session.scriptedPlayers],
    winnerMode: session.winnerMode,
    save: createSaveGameRecord(session.game, room, { id: session.id, label: `Interactive ${session.game.map.name}` }, new Date(), session.scriptedPlayers),
    events: clone(session.events),
    transcript: clone(session.transcript),
  };
}

export function restoreInteractivePlaytestSession(serialized: SerializedInteractivePlaytestSession): InteractivePlaytestSession {
  if (serialized.schemaVersion !== 3) throw new Error(`Unsupported interactive playtest schema ${serialized.schemaVersion}`);
  return {
    id: serialized.id,
    controlledPlayer: serialized.controlledPlayer,
    scriptedPlayers: [...serialized.scriptedPlayers],
    winnerMode: serialized.winnerMode,
    game: restoreGameFromSave(serialized.save),
    events: clone(serialized.events),
    transcript: clone(serialized.transcript),
  };
}

export function summarizeInteractivePlaytestSession(session: InteractivePlaytestSession): InteractivePlaytestSummary {
  const snapshot = snapshotGame(session.game);
  const query = createSnapshotQuery(snapshot, { teams: session.game.teams });
  const controlledCenter = armyCenter(query.combatUnitsFor(session.controlledPlayer)) ?? baseCenter(query.buildingsFor(session.controlledPlayer)) ?? { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
  const nearbyEnemies = query
    .opponentUnitsNear(session.controlledPlayer, controlledCenter, 800)
    .slice(0, 12)
    .map((unit) => ({ id: unit.id, kind: unit.kind, x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp }));
  return {
    id: session.id,
    tick: snapshot.tick,
    gameSecond: tickSecond(snapshot.tick),
    controlledPlayer: session.controlledPlayer,
    winner: snapshot.match.winner,
    runState: {
      winner: snapshot.match.winner,
      timeout: session.events.lastStepUntil?.timedOut === true,
    },
    fight: {
      state: session.events.firstFightTick !== null ? "contactRecorded" : playerFightInContact(session.game) ? "inContact" : "none",
      firstFightGameSecond: session.events.firstFightTick === null ? null : tickSecond(session.events.firstFightTick),
    },
    players: Object.fromEntries(session.game.activePlayers.map((owner) => [owner, summarizePlayer(snapshot, owner)])),
    controlledUnits: controlledUnits(snapshot, session.controlledPlayer),
    visibleObjectives: visibleObjectives(snapshot, controlledCenter),
    nearbyEnemies,
  };
}

export function inspectInteractivePlaytestUnits(session: InteractivePlaytestSession, options: { owner?: InteractivePlaytestUnitInspectionOwner } = {}): InteractivePlaytestUnitInspection {
  const snapshot = snapshotGame(session.game);
  const owner = options.owner ?? "all";
  if (owner !== "all" && owner !== "neutral" && !session.game.players[owner]) throw new Error(`Unknown playtest player ${owner}`);
  return {
    tick: snapshot.tick,
    gameSecond: tickSecond(snapshot.tick),
    winner: snapshot.match.winner,
    owner,
    units: snapshot.units
      .filter((unit) => owner === "all" || unit.owner === owner)
      .map((unit) => ({ owner: unit.owner, ...summarizeUnit(snapshot, unit) }))
      .sort((a, b) => a.owner.localeCompare(b.owner) || a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id)),
  };
}

function toGameCommand(game: Game, owner: PlayerId, command: InteractivePlaytestCommand): GameCommand {
  if (command.type === "raw") return command.command;
  return resolveSdkCommandIntent(snapshotGame(game), owner, command, { teams: game.teams });
}

function stepInteractivePlaytestTick<Source extends string = string>(session: InteractivePlaytestSession, options: InteractivePlaytestStepOptions<Source>) {
  recordPlaytestEvents(session);
  let scriptedCommands = options.beforeStep?.(session) ?? 0;
  const snapshot = snapshotGame(session.game);
  const planned = session.scriptedPlayers.flatMap((owner) => options.scriptedPlayers?.[owner]?.(snapshot, owner, session.game) ?? []);
  scriptedCommands += issueCommandFrame(session.game, planned).commands.length;
  recordPlaytestEvents(session);
  stepGame(session.game);
  normalizeWinnerForMode(session.game, session.game.teams, session.winnerMode);
  recordPlaytestEvents(session);
  return scriptedCommands;
}

function conditionMatches(session: InteractivePlaytestSession, condition: InteractivePlaytestCondition) {
  recordPlaytestEvents(session);
  if (condition.type === "firstFight") return session.events.firstFightTick !== null;
  if (condition.type === "winner") return session.game.match.winner !== null;
  if (condition.type === "tick") return session.game.tick >= condition.tick;
  if (condition.type === "enemyNearby") {
    const snapshot = snapshotGame(session.game);
    const query = createSnapshotQuery(snapshot, { teams: session.game.teams });
    return query.opponentUnitsNear(session.controlledPlayer, controlledPoint(snapshot, session.controlledPlayer), condition.range ?? 800).length > 0;
  }
  return assertNever(condition);
}

function recordPlaytestEvents(session: InteractivePlaytestSession) {
  if (session.events.firstFightTick === null && playerFightInContact(session.game)) session.events.firstFightTick = session.game.tick;
}

function playerFightInContact(game: Game) {
  const units = game.units.filter((unit) => unit.owner !== "neutral");
  for (let outer = 0; outer < units.length; outer += 1) {
    for (let inner = outer + 1; inner < units.length; inner += 1) {
      const first = units[outer]!;
      const second = units[inner]!;
      if (game.teams[first.owner] === game.teams[second.owner]) continue;
      const offensive = isOffensiveOrder(first) || isOffensiveOrder(second);
      if (offensive && distance(first, second) <= Math.max(first.attackRange, second.attackRange) + first.radius + second.radius + 30) return true;
    }
  }
  return false;
}

function isOffensiveOrder(unit: Unit) {
  return unit.order.type === "attack" || unit.order.type === "attackMove";
}

function summarizePlayer(snapshot: GameSnapshot, owner: PlayerId): InteractivePlaytestPlayerSummary {
  const player = snapshot.players[owner];
  if (!player) throw new Error(`Snapshot missing player state for ${owner}`);
  const units = snapshot.units.filter((unit) => unit.owner === owner);
  const buildings = snapshot.buildings.filter((building) => building.owner === owner);
  return {
    race: player.race,
    gold: player.gold,
    supplyUsed: player.supplyUsed,
    supplyCap: player.supplyCap,
    workers: units.filter((unit) => unit.kind === "worker").length,
    combatUnits: units.filter((unit) => unit.kind !== "worker").length,
    bases: buildings.filter((building) => building.kind === "townHall").length,
    buildings: buildings.length,
    orders: countBy(units, (unit) => unit.order.type),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled interactive playtest value ${JSON.stringify(value)}`);
}

function visibleObjectives(snapshot: GameSnapshot, point: { x: number; y: number }): InteractiveObjectiveSummary[] {
  return [
    ...snapshot.resources.map((resource) => ({ id: resource.id, kind: "resource" as const, x: resource.x, y: resource.y, distance: distance(resource, point) })),
    ...snapshot.mercenaryCamps.map((camp) => ({ id: camp.id, kind: "mercenaryCamp" as const, x: camp.x, y: camp.y, distance: distance(camp, point) })),
    ...snapshot.items.filter((item) => !item.carrierId).map((item) => ({ id: item.id, kind: "item" as const, x: item.x, y: item.y, distance: distance(item, point) })),
  ].sort((a, b) => a.distance - b.distance).slice(0, 12);
}

function controlledUnits(snapshot: GameSnapshot, owner: PlayerId): InteractivePlaytestUnitSummary[] {
  return snapshot.units
    .filter((unit) => unit.owner === owner)
    .map((unit) => summarizeUnit(snapshot, unit))
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id))
    .slice(0, 24);
}

function summarizeUnit(snapshot: GameSnapshot, unit: Unit): InteractivePlaytestUnitSummary {
  return {
    id: unit.id,
    kind: unit.kind,
    x: unit.x,
    y: unit.y,
    hp: unit.hp,
    maxHp: unit.maxHp,
    order: clone(unit.order),
    carriedItems: snapshot.items.filter((item) => item.carrierId === unit.id).map((item) => ({ id: item.id, kind: item.kind, cooldownRemaining: item.cooldownRemaining })),
  };
}

function roomForSession(session: InteractivePlaytestSession): RoomState {
  return {
    id: session.id,
    name: `Interactive ${session.game.map.name}`,
    hostUserId: "interactive-playtest",
    visibility: "private",
    mapId: session.game.map.id,
    status: "inMatch",
    autoTick: false,
    slots: session.game.activePlayers.map((owner) => ({
      id: `slot-${owner}`,
      playerId: owner,
      controller: session.scriptedPlayers.includes(owner) ? "ai" : "human",
      name: owner,
      team: session.game.teams[owner] ?? owner,
      race: session.game.players[owner]?.race ?? "grove",
      ready: true,
    })),
  };
}

function tickSecond(tick: number) {
  return Number((tick / SIM_TICKS_PER_SECOND).toFixed(2));
}

function armyCenter(units: Pick<Unit, "x" | "y">[]) {
  if (units.length === 0) return undefined;
  return { x: average(units.map((unit) => unit.x)), y: average(units.map((unit) => unit.y)) };
}

function baseCenter(buildings: Pick<Building, "kind" | "x" | "y">[]) {
  const bases = buildings.filter((building) => building.kind === "townHall");
  return armyCenter(bases.length > 0 ? bases : buildings);
}

function nearest<T extends { x: number; y: number }>(candidates: T[], point: { x: number; y: number }): T | undefined {
  return candidates.map((candidate) => ({ candidate, distance: distance(candidate, point) })).sort((a, b) => a.distance - b.distance)[0]?.candidate;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countBy<T>(values: T[], keyFor: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[keyFor(value)] = (result[keyFor(value)] ?? 0) + 1;
  return result;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
