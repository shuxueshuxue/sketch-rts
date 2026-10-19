import type { BenchmarkTracker } from '../../sdk/benchmark/core';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { SHIP_HULL_COST, SHIP_WEAPONS, installedWeapons } from '../../shared/ship-equipment';
import { isShipKind, shipProfile } from '../../shared/ship-geometry';
import { headingDifference } from '../../shared/ship-navigation';
import { sameGround } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND as TPS } from '../../shared/time';
import { isTransportKind } from '../../shared/transport-role';
import type { GameSnapshot, PlayerId, Unit, UnitKind, UnitOrder } from '../../shared/types';
import type { AiGameAgent } from '../game-runner';
import type { AiPolicyMemory } from '../memory';

type Point = { x: number; y: number };
export type IslandAttempt = {
  mineId: string; x: number; y: number; startSecond: number;
  lastSeenSecond: number; completedSecond: number | null; endedSecond: number | null;
};
export type NavalShipSample = Point & {
  second: number; id: string; kind: UnitKind; hp: number; order: UnitOrder;
  passengers: number; mission?: NonNullable<AiPolicyMemory['naval']>['ferries'];
};
export type NavalOwnerMetrics = {
  firstLandingSecond: number | null;
  firstMilitaryLandingSecond: number | null;
  checkpoints: Record<number, { islandBases: number; islandMines: number; islandGold: number }>;
  lostGold: number;
  // The enemy team's losses; this is an exchange measure, not individual kill attribution.
  enemyLostGold: number;
  idleShipSeconds: number;
  stalledShipSeconds: number;
  shipSeconds: number;
  deliveries: number;
  roundTrips: number;
  landings: { second: number; shipId: string; workers: number; military: number; remote: boolean; x: number; y: number }[];
  plans: IslandAttempt[];
  ships: { id: string; kind: UnitKind; bornSecond: number; sunkSecond: number | null; capturedSecond: number | null; gold: number; idleSeconds: number; stalledSeconds: number }[];
  samples: NavalShipSample[];
};
type ShipRecord = NavalOwnerMetrics['ships'][number];
type ShipState = Point & { owner: PlayerId; record: ShipRecord; heading: number; since: number; hp: number; crew: string; kills: number; cooldown: number };
type State = {
  owners: Record<PlayerId, NavalOwnerMetrics>; homes: Record<PlayerId, Point>;
  ships: Map<string, ShipState>; aboard: Map<string, string>;
  // A delivery is counted once per boarding-to-unloading cycle. Returning empty still completes a round trip.
  voyages: Map<string, { origin: Point; delivered: boolean; unitIds: Set<string> }>;
};

/** Passive measurement only. The optional memory reader observes the actual planner, never reruns policy. */
export function createNavalMetricsTracker(options: {
  minutes?: readonly number[];
  memory?: (owner: PlayerId) => AiPolicyMemory | undefined;
  // Detailed samples are optional; aggregate counters and every plan/landing are always retained.
  sampleSeconds?: number;
} = {}): BenchmarkTracker<AiGameAgent, State, Record<PlayerId, NavalOwnerMetrics>> {
  const minutes = options.minutes ?? [3, 5, 10, 15, 20, 30, 40];
  return {
    id: 'naval',
    create: ({ game, players }) => ({
      owners: Object.fromEntries(players.map(owner => [owner, emptyOwner()])),
      homes: Object.fromEntries(players.map(owner => {
        const hall = game.buildings.find(b => b.owner === owner && b.kind === 'townHall')!;
        return [owner, { x: hall.x, y: hall.y }];
      })),
      ships: new Map(), aboard: new Map(), voyages: new Map(),
    }),
    afterStep(state, { after, players }) {
      const now = after.tick / TPS;
      const units = new Map(after.units.map(unit => [unit.id, unit]));
      const hulls = after.units.filter(unit => isShipKind(unit.kind) && unit.owner in state.owners && unit.hp > 0);
      // Observe every tick: a boarding, death or unload between one-second samples must not disappear.
      const nextAboard = new Map<string, string>();
      const landed = new Map<string, Unit[]>();
      for (const unit of after.units) {
        const boat = unit.deck && units.get(unit.deck.shipId);
        if (boat && isTransportKind(boat.kind)) {
          nextAboard.set(unit.id, boat.id);
          let voyage = state.voyages.get(boat.id);
          if (!voyage) {
            voyage = { origin: { x: boat.x, y: boat.y }, delivered: false, unitIds: new Set() };
            state.voyages.set(boat.id, voyage);
          }
          voyage.unitIds.add(unit.id);
        } else if (!unit.deck && unit.hp > 0 && state.aboard.has(unit.id)) {
          const shipId = state.aboard.get(unit.id)!;
          if (!units.has(shipId)) continue; // A drowning is not a landing.
          const list = landed.get(shipId) ?? [];
          list.push(unit); landed.set(shipId, list);
        }
      }
      for (const [shipId, crew] of landed) {
        const boat = units.get(shipId)!;
        const stats = state.owners[boat.owner];
        const home = state.homes[boat.owner];
        if (!stats || !home) continue;
        const remote = !sameGround(after.map, home, crew[0]!);
        const workers = crew.filter(unit => unit.kind === 'worker').length;
        const military = crew.filter(unit => unit.kind !== 'worker' && unit.expiresTick === undefined).length;
        stats.landings.push({ second: now, shipId, workers, military, remote, x: crew[0]!.x, y: crew[0]!.y });
        if (remote) {
          stats.firstLandingSecond ??= now;
          if (military) stats.firstMilitaryLandingSecond ??= now;
          const voyage = state.voyages.get(shipId);
          if (voyage && !voyage.delivered) { stats.deliveries++; voyage.delivered = true; }
        }
      }
      state.aboard = nextAboard;
      for (const [shipId, voyage] of state.voyages) {
        const boat = units.get(shipId);
        if (!boat) { state.voyages.delete(shipId); continue; }
        if (voyage.delivered && Math.hypot(boat.x - voyage.origin.x, boat.y - voyage.origin.y) <= 160) {
          state.owners[boat.owner]!.roundTrips++;
          state.voyages.delete(shipId);
        } else if (!voyage.delivered && ![...nextAboard.values()].includes(shipId)) state.voyages.delete(shipId);
      }
      const liveHulls = new Set(hulls.map(hull => hull.id));
      for (const [id, previous] of state.ships) if (!liveHulls.has(id)) {
        // Captured hulls remain present. Only disappearance counts as a loss.
        if (!units.has(id)) {
          previous.record.sunkSecond = now;
          state.owners[previous.owner]!.lostGold += previous.record.gold;
        }
        state.ships.delete(id);
      }
      for (const boat of hulls) {
        let previous = state.ships.get(boat.id);
        if (previous && previous.owner !== boat.owner) { previous.record.capturedSecond = now; previous = undefined; }
        if (!previous) {
          const record = { id: boat.id, kind: boat.kind, bornSecond: now, sunkSecond: null, capturedSecond: null, gold: shipGold(after, boat), idleSeconds: 0, stalledSeconds: 0 };
          state.owners[boat.owner]!.ships.push(record);
          previous = { owner: boat.owner as PlayerId, record, x: boat.x, y: boat.y, heading: boat.sailing?.heading ?? 0, since: now, hp: boat.hp, crew: '', kills: boat.kills, cooldown: boat.cooldown };
          state.ships.set(boat.id, previous);
        }
        // Keep the last live hull's fittings, including equipment bought after launch.
        previous.record.gold = shipGold(after, boat);
        const stats = state.owners[boat.owner]!;
        stats.shipSeconds += 1 / TPS;
        if (boat.order.type === 'idle') { stats.idleShipSeconds += 1 / TPS; previous.record.idleSeconds += 1 / TPS; }
      }
      if (after.tick % TPS !== 0) return;
      for (const owner of players) {
        const stats = state.owners[owner]!;
        const current = options.memory?.(owner)?.naval?.island?.plan;
        const last = stats.plans.at(-1);
        if (current && (!last || last.mineId !== current.mineId || last.endedSecond !== null)) {
          if (last && last.endedSecond === null) last.endedSecond = now;
          const mine = after.resources.find(mine => mine.id === current.mineId);
          if (mine) stats.plans.push({ mineId: mine.id, x: mine.x, y: mine.y, startSecond: now, lastSeenSecond: now, completedSecond: null, endedSecond: null });
        } else if (!current && last && last.endedSecond === null) last.endedSecond = now;
        if (current && stats.plans.at(-1)?.mineId === current.mineId) stats.plans.at(-1)!.lastSeenSecond = now;
        for (const plan of stats.plans) if (plan.completedSecond === null && after.buildings.some(hall => hall.owner === owner && hall.kind === 'townHall' && hall.complete && hall.hp > 0 && Math.hypot(hall.x - plan.x, hall.y - plan.y) <= GOLD_MINE_RULES.baseRange)) plan.completedSecond = now;
        if (minutes.includes(now / 60)) stats.checkpoints[now / 60] = islandCheckpoint(after, owner, state.homes[owner]!);
      }
      for (const boat of hulls) {
        const stats = state.owners[boat.owner]!, previous = state.ships.get(boat.id)!;
        const crew = after.units.filter(unit => unit.deck?.shipId === boat.id).map(unit => unit.id).sort().join('|');
        const heading = boat.sailing?.heading ?? 0;
        const angularTravel = Math.abs(headingDifference(previous.heading, heading)) * (shipProfile(boat)?.length ?? 0) / 2;
        const firing = boat.cooldown > previous.cooldown || installedWeapons(after, boat).some(item => item.cooldownRemaining > 0);
        if (Math.hypot(boat.x - previous.x, boat.y - previous.y) > 32 || angularTravel > 32 || boat.hp !== previous.hp || boat.kills !== previous.kills || crew !== previous.crew || firing) {
          previous.x = boat.x; previous.y = boat.y; previous.heading = heading; previous.since = now;
        } else if (now - previous.since >= 30) { stats.stalledShipSeconds++; previous.record.stalledSeconds++; }
        previous.hp = boat.hp; previous.crew = crew; previous.kills = boat.kills; previous.cooldown = boat.cooldown;
        if (options.sampleSeconds && now % options.sampleSeconds === 0) {
          const mission = options.memory?.(boat.owner as PlayerId)?.naval?.ferries?.[boat.id];
          stats.samples.push({ second: now, id: boat.id, kind: boat.kind, x: boat.x, y: boat.y, hp: boat.hp, order: structuredClone(boat.order), passengers: crew ? crew.split('|').length : 0, ...(mission ? { mission: { [boat.id]: structuredClone(mission) } } : {}) });
        }
      }
    },
    finish(state, { game, players }) {
      for (const owner of players) state.owners[owner]!.enemyLostGold = players.filter(other => game.teams[other] !== game.teams[owner]).reduce((sum, other) => sum + state.owners[other]!.lostGold, 0);
      return state.owners;
    },
  };
}

function emptyOwner(): NavalOwnerMetrics {
  return { firstLandingSecond: null, firstMilitaryLandingSecond: null, checkpoints: {}, lostGold: 0, enemyLostGold: 0, idleShipSeconds: 0, stalledShipSeconds: 0, shipSeconds: 0, deliveries: 0, roundTrips: 0, landings: [], plans: [], ships: [], samples: [] };
}

function shipGold(snapshot: GameSnapshot, ship: Unit): number {
  if (!isShipKind(ship.kind)) return 0;
  return SHIP_HULL_COST[ship.kind] + installedWeapons(snapshot, ship).reduce((sum, item) => sum + SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].cost, 0);
}

function islandCheckpoint(snapshot: GameSnapshot, owner: PlayerId, home: Point) {
  const halls = snapshot.buildings.filter(hall => hall.owner === owner && hall.kind === 'townHall' && hall.complete && hall.hp > 0 && !sameGround(snapshot.map, home, hall));
  const mines = snapshot.resources.filter(mine => mine.amount > 0 && !sameGround(snapshot.map, home, mine) && halls.some(hall => sameGround(snapshot.map, hall, mine) && Math.hypot(hall.x - mine.x, hall.y - mine.y) <= GOLD_MINE_RULES.baseRange));
  return { islandBases: halls.length, islandMines: mines.length, islandGold: mines.reduce((sum, mine) => sum + mine.amount, 0) };
}
