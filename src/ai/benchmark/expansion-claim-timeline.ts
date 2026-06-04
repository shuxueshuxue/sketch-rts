import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import type { PlayerId, Unit, UnitOrder } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";

export type ExpansionClaimTimelineStats = {
  owners: Record<PlayerId, ExpansionClaimTimelineOwnerStats>;
};

export type ExpansionClaimTimelineOwnerStats = {
  commands: ExpansionClaimCommandEvent[];
  samples: ExpansionClaimTimelineSample[];
};

export type ExpansionClaimCommandEvent = {
  second: number;
  unitCount: number;
  x: number;
  y: number;
};

export type ExpansionClaimTimelineSample = {
  second: number;
  target: { x: number; y: number };
  alive: number;
  avgHpRatio: number | null;
  lowHp: number;
  orderCounts: Partial<Record<UnitOrder["type"], number>>;
  avgDistanceToTarget: number | null;
  avgDistanceToMoonWell: number | null;
  neutralGuardsNearTarget: number;
  enemyCombatNearGroup: number;
};

type ExpansionClaimTimelineState = {
  players: PlayerId[];
  teams: Partial<Record<PlayerId, string>>;
  owners: Record<PlayerId, ExpansionClaimTimelineOwnerStats>;
  activeClaims: Record<PlayerId, ActiveExpansionClaim | undefined>;
};

type ActiveExpansionClaim = {
  unitIds: string[];
  x: number;
  y: number;
  lastSampleTick: number;
};

const SAMPLE_INTERVAL_TICKS = 5 * SIM_TICKS_PER_SECOND;
const MAX_EVENTS_PER_OWNER = 24;
const MAX_SAMPLES_PER_OWNER = 80;
const LOW_HP_RATIO = 0.5;
const TARGET_GUARD_RANGE = 320;
const ENEMY_GROUP_RANGE = 620;

export function createExpansionClaimTimelineTracker(): BenchmarkTracker<AiGameAgent, ExpansionClaimTimelineState, ExpansionClaimTimelineStats> {
  return {
    id: "expansionClaimTimeline",
    create: ({ players, match }) => ({
      players,
      teams: Object.fromEntries(Object.entries(match.agents).map(([owner, agent]) => [owner, agent.team])),
      owners: Object.fromEntries(players.map((owner) => [owner, emptyOwnerStats()])),
      activeClaims: {},
    }),
    onCommand(state, context) {
      if (context.scriptId !== "expansion" || context.command.type !== "attackMove") return;
      const ownerStats = (state.owners[context.owner] ??= emptyOwnerStats());
      pushCapped(ownerStats.commands, {
        second: roundSecond(context.tick),
        unitCount: context.command.unitIds.length,
        x: context.command.x,
        y: context.command.y,
      }, MAX_EVENTS_PER_OWNER);
      const previous = state.activeClaims[context.owner];
      const sameTarget = previous && distance(previous, context.command) <= 1;
      state.activeClaims[context.owner] = {
        unitIds: context.command.unitIds,
        x: context.command.x,
        y: context.command.y,
        lastSampleTick: sameTarget ? previous.lastSampleTick : context.tick - SAMPLE_INTERVAL_TICKS,
      };
    },
    afterStep(state, context) {
      const tick = context.after.tick;
      for (const owner of state.players) {
        const claim = state.activeClaims[owner];
        if (!claim || tick - claim.lastSampleTick < SAMPLE_INTERVAL_TICKS) continue;
        claim.lastSampleTick = tick;
        const units = context.after.units.filter((unit) => claim.unitIds.includes(unit.id) && unit.owner === owner);
        if (units.length === 0) {
          state.activeClaims[owner] = undefined;
          continue;
        }
        pushCapped(state.owners[owner]!.samples, expansionClaimSample(context.after.units, context.after.buildings, state.teams, owner, claim, units, tick), MAX_SAMPLES_PER_OWNER);
      }
    },
    finish: (state) => ({ owners: state.owners }),
  };
}

function expansionClaimSample(
  allUnits: Unit[],
  buildings: { owner: PlayerId; kind: string; complete: boolean; hp: number; x: number; y: number }[],
  teams: Partial<Record<PlayerId, string>>,
  owner: PlayerId,
  claim: ActiveExpansionClaim,
  units: Unit[],
  tick: number,
): ExpansionClaimTimelineSample {
  const center = averagePoint(units);
  const target = { x: claim.x, y: claim.y };
  const moonWells = buildings.filter((building) => building.owner === owner && building.kind === "moonWell" && building.complete && building.hp > 0);
  return {
    second: roundSecond(tick),
    target,
    alive: units.length,
    avgHpRatio: roundNullable(units.reduce((total, unit) => total + unit.hp / Math.max(1, unit.maxHp), 0) / units.length),
    lowHp: units.filter((unit) => unit.hp / Math.max(1, unit.maxHp) <= LOW_HP_RATIO).length,
    orderCounts: orderCounts(units),
    avgDistanceToTarget: roundNullable(units.reduce((total, unit) => total + distance(unit, target), 0) / units.length),
    avgDistanceToMoonWell: averageNearestDistance(units, moonWells),
    neutralGuardsNearTarget: allUnits.filter((unit) => unit.owner === "neutral" && distance(unit, target) <= TARGET_GUARD_RANGE).length,
    enemyCombatNearGroup: allUnits.filter((unit) => unit.owner !== owner && unit.owner !== "neutral" && teams[unit.owner] !== teams[owner] && isCombatUnit(unit) && distance(unit, center) <= ENEMY_GROUP_RANGE).length,
  };
}

function emptyOwnerStats(): ExpansionClaimTimelineOwnerStats {
  return { commands: [], samples: [] };
}

function orderCounts(units: Unit[]) {
  const counts: Partial<Record<UnitOrder["type"], number>> = {};
  for (const unit of units) counts[unit.order.type] = (counts[unit.order.type] ?? 0) + 1;
  return counts;
}

function averageNearestDistance(units: Unit[], targets: { x: number; y: number }[]) {
  if (units.length === 0 || targets.length === 0) return null;
  return roundNullable(units.reduce((total, unit) => total + nearestDistance(unit, targets), 0) / units.length);
}

function nearestDistance(unit: Unit, targets: { x: number; y: number }[]) {
  return targets.reduce((best, target) => Math.min(best, distance(unit, target)), Infinity);
}

function averagePoint(units: Unit[]) {
  return {
    x: units.reduce((total, unit) => total + unit.x, 0) / units.length,
    y: units.reduce((total, unit) => total + unit.y, 0) / units.length,
  };
}

function isCombatUnit(unit: Unit) {
  return unit.kind !== "worker";
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roundSecond(tick: number) {
  return Number((tick / SIM_TICKS_PER_SECOND).toFixed(2));
}

function roundNullable(value: number | null) {
  return value === null ? null : Number(value.toFixed(3));
}

function pushCapped<T>(items: T[], item: T, max: number) {
  items.push(item);
  if (items.length > max) items.shift();
}
