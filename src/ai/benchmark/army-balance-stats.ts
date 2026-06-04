import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import type { PlayerId, Unit } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";
import { armyPower } from "../policy/combat-math";

export type ArmyBalanceStats = {
  owners: Record<PlayerId, ArmyBalanceOwnerStats>;
};

export type ArmyBalanceOwnerStats = {
  samples: number;
  powerLeadSum: number;
  avgPowerLead: number | null;
  minPowerLead: number | null;
  minPowerLeadSecond: number | null;
  maxPowerLead: number | null;
  maxPowerLeadSecond: number | null;
  firstPositivePowerLeadSecond: number | null;
  firstLocalCombatSecond: number | null;
  firstLocalCombatPowerLead: number | null;
};

type ArmyBalanceTrackerState = {
  players: PlayerId[];
  teams: Partial<Record<PlayerId, string>>;
  owners: Record<PlayerId, ArmyBalanceOwnerStats>;
};

const LOCAL_COMBAT_RANGE = 700;

export function createArmyBalanceStatsTracker(): BenchmarkTracker<AiGameAgent, ArmyBalanceTrackerState, ArmyBalanceStats> {
  return {
    id: "armyBalanceStats",
    create: ({ players, match }) => ({
      players,
      teams: Object.fromEntries(Object.entries(match.agents).map(([owner, agent]) => [owner, agent.team])),
      owners: Object.fromEntries(players.map((owner) => [owner, emptyOwnerStats()])),
    }),
    afterStep(state, context) {
      const tick = context.after.tick;
      if (tick % SIM_TICKS_PER_SECOND !== 0) return;
      const second = tick / SIM_TICKS_PER_SECOND;
      for (const owner of state.players) {
        const ownCombat = combatUnitsForOwner(context.after.units, owner);
        const enemyCombat = opponentCombatUnits(context.after.units, owner, state.teams);
        const ownPower = armyPower(ownCombat);
        const enemyPower = armyPower(enemyCombat);
        recordSample(state.owners[owner] ??= emptyOwnerStats(), second, ownPower - enemyPower, localCombatStarted(ownCombat, enemyCombat));
      }
    },
    finish(state) {
      for (const stats of Object.values(state.owners)) stats.avgPowerLead = stats.samples > 0 ? stats.powerLeadSum / stats.samples : null;
      return { owners: state.owners };
    },
  };
}

function recordSample(stats: ArmyBalanceOwnerStats, second: number, powerLead: number, localCombat: boolean) {
  stats.samples += 1;
  stats.powerLeadSum += powerLead;
  if (stats.minPowerLead === null || powerLead < stats.minPowerLead) {
    stats.minPowerLead = powerLead;
    stats.minPowerLeadSecond = second;
  }
  if (stats.maxPowerLead === null || powerLead > stats.maxPowerLead) {
    stats.maxPowerLead = powerLead;
    stats.maxPowerLeadSecond = second;
  }
  if (stats.firstPositivePowerLeadSecond === null && powerLead > 0) stats.firstPositivePowerLeadSecond = second;
  if (stats.firstLocalCombatSecond === null && localCombat) {
    stats.firstLocalCombatSecond = second;
    stats.firstLocalCombatPowerLead = powerLead;
  }
}

function emptyOwnerStats(): ArmyBalanceOwnerStats {
  return {
    samples: 0,
    powerLeadSum: 0,
    avgPowerLead: null,
    minPowerLead: null,
    minPowerLeadSecond: null,
    maxPowerLead: null,
    maxPowerLeadSecond: null,
    firstPositivePowerLeadSecond: null,
    firstLocalCombatSecond: null,
    firstLocalCombatPowerLead: null,
  };
}

function combatUnitsForOwner(units: Unit[], owner: PlayerId) {
  return units.filter((unit) => unit.owner === owner && isCombatUnit(unit));
}

function opponentCombatUnits(units: Unit[], owner: PlayerId, teams: Partial<Record<PlayerId, string>>) {
  const ownTeam = teams[owner];
  return units.filter((unit) => unit.owner !== owner && unit.owner !== "neutral" && teams[unit.owner] !== ownTeam && isCombatUnit(unit));
}

function localCombatStarted(ownCombat: Unit[], enemyCombat: Unit[]) {
  return ownCombat.some((own) => enemyCombat.some((enemy) => distance(own, enemy) <= LOCAL_COMBAT_RANGE));
}

function isCombatUnit(unit: Unit) {
  return unit.kind !== "worker";
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
