import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { MERCENARY_UNIT_KINDS, UNIT_DEFS, UPGRADE_DEFS } from "../../shared/catalog";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import type { GameSnapshot, PlayerId, UpgradeKind } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";
import { neutralCamps } from "../policy/v7/creep";
import { distance } from "../policy/spatial";
import { areEnemyOwners } from "../../shared/sim/command-validation";

// @@@bench-metrics - Direct measures a bench can take in the same games it plays, named on the command line
// (`--metrics clear,bases@4,trade@15`), so a change is judged by what it is meant to move and not by win rate alone.
// Each is a tracker; its result is one number (or null) per player. The names:
//   bases@N    complete town halls at minute N
//   workers@N  workers alive at minute N
//   spent@N    gold spent by minute N
//   trade@N    gold worth of fighters lost by minute N (a bench reads the ratio of the two sides)
//   clear      minute the player's fighters took their first neutral camp (null: none in the game)
//   hire       minute the player first had a mercenary (null: none)
//   upgrade@K.L  minute the player's upgrade K reached level L (null: never), e.g. upgrade@weaponTraining.3
//   stall@N    unit-minutes the player's land fighters stood still under a move or attack-move for N seconds or more
//              in a row, with no enemy within reach and no shot fired: an army jammed (an own idle hull parked on a
//              land pass held fifteen for twenty minutes on ladder-52)
export type MetricValues = Record<PlayerId, number | null>;
type MetricTracker = BenchmarkTracker<AiGameAgent, unknown, MetricValues>;

const MINUTE = 60 * SIM_TICKS_PER_SECOND;
// Sampled each second: the measures are minutes apart, and a per-tick scan of every unit would slow the bench.
const SAMPLE = SIM_TICKS_PER_SECOND;

export function parseMetric(name: string): { kind: string; minute?: number; upgrade?: UpgradeKind; level?: number } {
  const match = name.match(/^(bases|workers|spent|trade)@(\d+)$/);
  if (match) return { kind: match[1]!, minute: Number(match[2]) };
  if (name === "clear" || name === "hire") return { kind: name };
  const stall = name.match(/^stall@(\d+)$/);
  if (stall) return { kind: "stall", minute: Number(stall[1]) };
  const upgrade = name.match(/^upgrade@(\w+)\.([1-3])$/);
  if (upgrade && upgrade[1]! in UPGRADE_DEFS) return { kind: "upgrade", upgrade: upgrade[1] as UpgradeKind, level: Number(upgrade[2]) };
  throw new Error(`Unknown bench metric "${name}" (bases@N, workers@N, spent@N, trade@N, clear, hire, upgrade@K.L)`);
}

export function createMetricTrackers(names: readonly string[]): MetricTracker[] {
  return names.map((name) => {
    const { kind, minute, upgrade, level } = parseMetric(name);
    const id = `metric:${name}`;
    if (kind === "bases" || kind === "workers" || kind === "spent") {
      const read = (after: GameSnapshot, owner: PlayerId) => kind === "bases"
        ? after.buildings.filter((building) => building.owner === owner && building.kind === "townHall" && building.complete).length
        : kind === "workers" ? after.units.filter((unit) => unit.owner === owner && unit.kind === "worker").length
          : after.match.stats.goldSpent[owner] ?? 0;
      return atMinute(id, minute!, read);
    }
    if (kind === "trade") return lostByMinute(id, minute!);
    if (kind === "stall") return stalled(id, minute!);
    if (kind === "upgrade") return firstMinute(id, (after, owner) => (after.players[owner]?.upgrades[upgrade!] ?? 0) >= level!);
    if (kind === "hire") return firstMinute(id, (after, owner) => after.units.some((unit) => unit.owner === owner && (MERCENARY_UNIT_KINDS as readonly string[]).includes(unit.kind)));
    return firstCampCleared(id);
  });
}

function atMinute(id: string, minute: number, read: (after: GameSnapshot, owner: PlayerId) => number): MetricTracker {
  return {
    id,
    create: ({ players }) => Object.fromEntries(players.map((owner) => [owner, null])) as MetricValues,
    afterStep(state, { after, players }) {
      if (after.tick !== minute * MINUTE) return;
      for (const owner of players) (state as MetricValues)[owner] = read(after, owner);
    },
    finish: (state) => state as MetricValues,
  };
}

function firstMinute(id: string, reached: (after: GameSnapshot, owner: PlayerId) => boolean): MetricTracker {
  return {
    id,
    create: ({ players }) => Object.fromEntries(players.map((owner) => [owner, null])) as MetricValues,
    afterStep(state, { after, players }) {
      if (after.tick % SAMPLE !== 0) return;
      const values = state as MetricValues;
      for (const owner of players) if (values[owner] === null && reached(after, owner)) values[owner] = after.tick / MINUTE;
    },
    finish: (state) => state as MetricValues,
  };
}

// A fighter here is a unit with a weapon that is not a worker and was not summoned: what an army trades.
function lostByMinute(id: string, minute: number): MetricTracker {
  type State = { values: MetricValues; alive: Map<string, { owner: PlayerId; cost: number }> };
  return {
    id,
    create: ({ players }) => ({ values: Object.fromEntries(players.map((owner) => [owner, 0])), alive: new Map() }) as State,
    afterStep(raw, { after }) {
      const state = raw as State;
      if (after.tick % SAMPLE !== 0 || after.tick > minute * MINUTE) return;
      const now = new Map<string, { owner: PlayerId; cost: number }>();
      for (const unit of after.units) {
        if (unit.owner === "neutral" || unit.kind === "worker" || unit.attackDamage <= 0 || unit.expiresTick !== undefined) continue;
        now.set(unit.id, { owner: unit.owner, cost: UNIT_DEFS[unit.kind].cost });
      }
      for (const [unitId, fighter] of state.alive) if (!now.has(unitId) && fighter.owner in state.values) state.values[fighter.owner]! += fighter.cost;
      state.alive = now;
    },
    finish: (raw) => (raw as State).values,
  };
}

function stalled(id: string, seconds: number): MetricTracker {
  type State = { values: MetricValues; still: Map<string, { x: number; y: number; since: number }> };
  return {
    id,
    create: ({ players }) => ({ values: Object.fromEntries(players.map((owner) => [owner, 0])), still: new Map() }) as State,
    afterStep(raw, { after, players }) {
      const state = raw as State;
      if (after.tick % SAMPLE !== 0) return;
      const now = new Map<string, { x: number; y: number; since: number }>();
      for (const unit of after.units) {
        if (!players.includes(unit.owner as PlayerId) || unit.kind === "worker" || unit.attackDamage <= 0 || unit.deck || unit.garrison || UNIT_DEFS[unit.kind].naval) continue;
        if (unit.order.type !== "move" && unit.order.type !== "attackMove") continue;
        const last = state.still.get(unit.id);
        const fighting = unit.cooldown > 0 || after.units.some((foe) => foe.hp > 0 && areEnemyOwners(after, foe.owner, unit.owner)
          && distance(foe, unit) <= unit.attackRange + unit.radius + foe.radius + 50);
        // Still: within a cell of where it stood when the stillness began (pressed bodies jostle back and forth).
        if (fighting || !last || distance(last, unit) > 32) { now.set(unit.id, { x: unit.x, y: unit.y, since: after.tick }); continue; }
        now.set(unit.id, last);
        if (after.tick - last.since >= seconds * SIM_TICKS_PER_SECOND) state.values[unit.owner as PlayerId]! += SAMPLE / MINUTE;
      }
      state.still = now;
    },
    finish: (raw) => (raw as State).values,
  };
}

// A camp falls when its last creep dies; it is credited to the player whose fighter stands nearest its centre then.
function firstCampCleared(id: string): MetricTracker {
  type State = { values: MetricValues; camps?: { center: { x: number; y: number }; ids: string[]; done: boolean }[] };
  return {
    id,
    create: ({ players }) => ({ values: Object.fromEntries(players.map((owner) => [owner, null])) }) as State,
    afterStep(raw, { after }) {
      const state = raw as State;
      state.camps ??= neutralCamps(after).map((camp) => ({ center: camp.center, ids: camp.creeps.map((creep) => creep.id), done: false }));
      if (after.tick % SAMPLE !== 0) return;
      const alive = new Set(after.units.map((unit) => unit.id));
      for (const camp of state.camps) {
        if (camp.done || camp.ids.some((creepId) => alive.has(creepId))) continue;
        camp.done = true;
        const nearest = after.units.filter((unit) => unit.owner !== "neutral" && unit.kind !== "worker" && unit.attackDamage > 0)
          .sort((a, b) => distance(a, camp.center) - distance(b, camp.center))[0];
        if (nearest && state.values[nearest.owner] === null) state.values[nearest.owner] = after.tick / MINUTE;
      }
    },
    finish: (raw) => (raw as State).values,
  };
}
