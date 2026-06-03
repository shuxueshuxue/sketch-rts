import { UNIT_DEFS, UPGRADE_KINDS } from "../shared/catalog";
import type { Game } from "../shared/sim";
import type { PlayerId, Unit } from "../shared/types";

export type PlayerMatchSummary = {
  team: string;
  remainingWorkers: number;
  remainingCombatUnits: number;
  remainingArmyValue: number;
  remainingArmyPower: number;
  remainingBuildings: number;
  remainingTownHalls: number;
  remainingNonBaseBuildings: number;
};

export type MatchStateSummary = {
  players: Record<PlayerId, PlayerMatchSummary>;
  teams: Record<string, PlayerMatchSummary>;
};

export type PlayerTimelineSummary = {
  team: string;
  gold: number;
  supplyUsed: number;
  supplyCap: number;
  workers: number;
  combatUnits: number;
  armyValue: number;
  armyPower: number;
  bases: number;
  productionBuildings: number;
  towers: number;
  queuedUnits: number;
  upgrades: string[];
};

export type MatchTimelineSample = {
  tick: number;
  players: Record<PlayerId, PlayerTimelineSummary>;
  teams: Record<string, PlayerTimelineSummary>;
};

export function summarizeMatchState(game: Game, teams: Partial<Record<PlayerId, string>> = game.teams): MatchStateSummary {
  const players: Record<PlayerId, PlayerMatchSummary> = {};
  for (const owner of activeReportPlayers(game)) {
    players[owner] = summarizePlayer(game, owner, teams[owner] ?? owner);
  }

  const teamIds = new Set(Object.values(players).map((summary) => summary.team));
  const teamSummaries: Record<string, PlayerMatchSummary> = {};
  for (const team of teamIds) {
    teamSummaries[team] = emptySummary(team);
  }
  for (const summary of Object.values(players)) {
    addSummary(teamSummaries[summary.team]!, summary);
  }

  return { players, teams: teamSummaries };
}

export function summarizeTimelineSample(game: Game, teams: Partial<Record<PlayerId, string>> = game.teams): MatchTimelineSample {
  const players: Record<PlayerId, PlayerTimelineSummary> = {};
  for (const owner of activeReportPlayers(game)) {
    players[owner] = summarizePlayerTimeline(game, owner, teams[owner] ?? owner);
  }

  const teamSummaries: Record<string, PlayerTimelineSummary> = {};
  for (const summary of Object.values(players)) {
    teamSummaries[summary.team] ??= emptyTimelineSummary(summary.team);
    addTimelineSummary(teamSummaries[summary.team]!, summary);
  }

  return { tick: game.tick, players, teams: teamSummaries };
}

function activeReportPlayers(game: Game) {
  return game.activePlayers.filter((owner) => game.units.some((unit) => unit.owner === owner) || game.buildings.some((building) => building.owner === owner) || game.players[owner]);
}

function summarizePlayer(game: Game, owner: PlayerId, team: string): PlayerMatchSummary {
  const summary = emptySummary(team);
  for (const unit of game.units) {
    if (unit.owner !== owner) continue;
    if (unit.kind === "worker") {
      summary.remainingWorkers += 1;
      continue;
    }
    summary.remainingCombatUnits += 1;
    summary.remainingArmyValue += unitValue(unit);
    summary.remainingArmyPower += unitPower(unit);
  }
  for (const building of game.buildings) {
    if (building.owner !== owner) continue;
    summary.remainingBuildings += 1;
    if (building.kind === "townHall") summary.remainingTownHalls += 1;
    else summary.remainingNonBaseBuildings += 1;
  }
  return summary;
}

function emptySummary(team: string): PlayerMatchSummary {
  return {
    team,
    remainingWorkers: 0,
    remainingCombatUnits: 0,
    remainingArmyValue: 0,
    remainingArmyPower: 0,
    remainingBuildings: 0,
    remainingTownHalls: 0,
    remainingNonBaseBuildings: 0,
  };
}

function addSummary(target: PlayerMatchSummary, source: PlayerMatchSummary) {
  target.remainingWorkers += source.remainingWorkers;
  target.remainingCombatUnits += source.remainingCombatUnits;
  target.remainingArmyValue += source.remainingArmyValue;
  target.remainingArmyPower += source.remainingArmyPower;
  target.remainingBuildings += source.remainingBuildings;
  target.remainingTownHalls += source.remainingTownHalls;
  target.remainingNonBaseBuildings += source.remainingNonBaseBuildings;
}

function summarizePlayerTimeline(game: Game, owner: PlayerId, team: string): PlayerTimelineSummary {
  const player = game.players[owner];
  const summary = emptyTimelineSummary(team);
  summary.gold = player?.gold ?? 0;
  summary.supplyUsed = player?.supplyUsed ?? 0;
  summary.supplyCap = player?.supplyCap ?? 0;
  summary.upgrades = UPGRADE_KINDS.flatMap((upgradeKind) => {
    const level = player?.upgrades[upgradeKind] ?? 0;
    return level > 0 ? [`${upgradeKind}:${level}`] : [];
  });

  for (const unit of game.units) {
    if (unit.owner !== owner) continue;
    if (unit.kind === "worker") {
      summary.workers += 1;
    } else {
      summary.combatUnits += 1;
      summary.armyValue += unitValue(unit);
      summary.armyPower += unitPower(unit);
    }
  }

  for (const building of game.buildings) {
    if (building.owner !== owner || !building.complete) continue;
    if (building.kind === "townHall") summary.bases += 1;
    else if (building.kind === "defenseTower") summary.towers += 1;
    else if (building.kind !== "farm" && building.kind !== "moonWell") summary.productionBuildings += 1;
    summary.queuedUnits += building.queue.length;
  }

  return summary;
}

function emptyTimelineSummary(team: string): PlayerTimelineSummary {
  return {
    team,
    gold: 0,
    supplyUsed: 0,
    supplyCap: 0,
    workers: 0,
    combatUnits: 0,
    armyValue: 0,
    armyPower: 0,
    bases: 0,
    productionBuildings: 0,
    towers: 0,
    queuedUnits: 0,
    upgrades: [],
  };
}

function addTimelineSummary(target: PlayerTimelineSummary, source: PlayerTimelineSummary) {
  target.gold += source.gold;
  target.supplyUsed += source.supplyUsed;
  target.supplyCap += source.supplyCap;
  target.workers += source.workers;
  target.combatUnits += source.combatUnits;
  target.armyValue += source.armyValue;
  target.armyPower += source.armyPower;
  target.bases += source.bases;
  target.productionBuildings += source.productionBuildings;
  target.towers += source.towers;
  target.queuedUnits += source.queuedUnits;
  target.upgrades = [...new Set([...target.upgrades, ...source.upgrades])].sort();
}

function unitValue(unit: Unit) {
  const def = UNIT_DEFS[unit.kind];
  return def.cost * Math.max(0, unit.hp) / Math.max(1, unit.maxHp);
}

function unitPower(unit: Unit) {
  const health = Math.max(0, unit.hp) / Math.max(1, unit.maxHp);
  // @@@range-power-cap - Long attack reach creates uptime, but reports must not count 600 range as several extra bodies.
  return health * (1 + unit.attackDamage / 18 + Math.min(unit.attackRange, 260) / 520 + UNIT_DEFS[unit.kind].supplyUsed * 0.2);
}
