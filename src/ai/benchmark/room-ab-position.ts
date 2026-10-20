import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { observeSimulation, type Game } from '../../shared/sim';
import type { SimulationKillEvent, SimulationMiningIncomeEvent } from '../../shared/sim/observation';
import { sameGround } from '../../shared/terrain';
import type { BuildingKind, GameSnapshot, UnitKind } from '../../shared/types';

export type RoomAbExchangeRatio = { status: 'finite' | 'no-loss' | 'no-exchange'; value: number | null };
export function roomAbExchangeRatio(killedGold: number, lostGold: number): RoomAbExchangeRatio {
  return lostGold > 0 ? { status: 'finite', value: killedGold / lostGold }
    : { status: killedGold > 0 ? 'no-loss' : 'no-exchange', value: null };
}
export type RoomAbPositionSeat = {
  killedUnitGold: number; killedBuildingGold: number; lostUnitGold: number; lostBuildingGold: number;
  killedGold: number; lostGold: number; exchangeNetGold: number; exchangeRatio: RoomAbExchangeRatio;
  crossKilledGold: number; crossLostGold: number; crossExchangeNetGold: number; crossExchangeRatio: RoomAbExchangeRatio;
  aliveUnitGold: number; aliveBuildingGold: number; unfinishedBuildingGold: number;
  heldMines: number; heldMineReserves: number;
  miningGoldPerMinute: number; miningWindowGold: number; miningWindowSeconds: number;
  enemyMiningHallsDestroyed: number; ownMiningHallsLost: number;
};
type CombatEvent = { type: 'unit-loss' | 'building-loss'; tick: number; targetId: string; targetOwner: string;
  sourceOwner: string | null; hostile: boolean; kind: UnitKind | BuildingKind; gold: number; complete?: boolean };
export type RoomAbPositionEvent = CombatEvent | ({ type: 'mining-income' } & SimulationMiningIncomeEvent);
export type RoomAbMinePosition = { id: string; amount: number; owners: string[]; hallIds: string[];
  status: 'held' | 'contested' | 'unheld' | 'exhausted' };

/** A mine is held only by one seat's completed, living hall within the economy's baseRange on its land.
 * Multiple halls of that seat count once; competing seats (even in the same cohort) are contested.
 */
export function roomAbMinePositions(snapshot: Pick<GameSnapshot, 'map' | 'buildings' | 'resources'>): RoomAbMinePosition[] {
  const halls = snapshot.buildings.filter(b => b.kind === 'townHall' && b.hp > 0 && b.complete);
  return snapshot.resources.map(mine => {
    const nearby = halls.filter(hall => Math.hypot(hall.x - mine.x, hall.y - mine.y) <= GOLD_MINE_RULES.baseRange
      && sameGround(snapshot.map, hall, mine));
    const owners = [...new Set(nearby.map(hall => hall.owner))].sort();
    return { id: mine.id, amount: mine.amount, owners, hallIds: nearby.map(hall => hall.id).sort(),
      status: mine.amount <= 0 ? 'exhausted' : owners.length === 1 ? 'held' : owners.length > 1 ? 'contested' : 'unheld' };
  });
}
const empty = (): RoomAbPositionSeat => ({ killedUnitGold: 0, killedBuildingGold: 0, lostUnitGold: 0, lostBuildingGold: 0,
  killedGold: 0, lostGold: 0, exchangeNetGold: 0, exchangeRatio: roomAbExchangeRatio(0, 0),
  crossKilledGold: 0, crossLostGold: 0, crossExchangeNetGold: 0, crossExchangeRatio: roomAbExchangeRatio(0, 0),
  aliveUnitGold: 0, aliveBuildingGold: 0, unfinishedBuildingGold: 0, heldMines: 0, heldMineReserves: 0,
  miningGoldPerMinute: 0, miningWindowGold: 0, miningWindowSeconds: 0, enemyMiningHallsDestroyed: 0, ownMiningHallsLost: 0 });

/** External observer only. Prices are UNIT_DEFS/BUILDING_DEFS[kind].cost, not HP, equipment or historical expenditure.
 * Unit losses follow native removal counters: expiry/script exits grant neither a loss nor kill value.
 */
export class RoomAbPosition {
  readonly errors: string[] = [];
  private readonly seats: Record<string, RoomAbPositionSeat>;
  private readonly killed = new Map<string, SimulationKillEvent>();
  private readonly stop: () => void;
  private readonly startTick: number;
  // Rolling income only; complete immutable event records go to the match's compressed audit log.
  private deliveries: SimulationMiningIncomeEvent[] = [];
  constructor(private readonly game: Game, private readonly sides: Readonly<Record<string, 'A' | 'B'>>,
    emit: (event: RoomAbPositionEvent) => void = () => {}) {
    this.startTick = game.tick;
    this.seats = Object.fromEntries(Object.keys(sides).map(owner => [owner, empty()]));
    const combat = (event: CombatEvent) => {
      emit(event);
      const victim = this.seats[event.targetOwner], killer = event.sourceOwner ? this.seats[event.sourceOwner] : undefined;
      const unit = event.type === 'unit-loss', hall = !unit && event.kind === 'townHall';
      if (victim) {
        victim[unit ? 'lostUnitGold' : 'lostBuildingGold'] += event.gold;
        if (hall) victim.ownMiningHallsLost++;
      }
      if (killer && event.hostile) {
        killer[unit ? 'killedUnitGold' : 'killedBuildingGold'] += event.gold;
        if (hall) killer.enemyMiningHallsDestroyed++;
      }
      if (victim && killer && event.hostile && sides[event.targetOwner] !== sides[event.sourceOwner!]) {
        killer.crossKilledGold += event.gold; victim.crossLostGold += event.gold;
      }
    };
    const hostile = (source: string | null, target: string) => source !== null && source !== target
      && (game.teams[source] ?? source) !== (game.teams[target] ?? target);
    this.stop = observeSimulation(game, { label: 'RoomAbPosition-v1',
      kill: event => this.killed.set(event.unit.id, event),
      removed: event => {
        const kill = this.killed.get(event.unit.id); this.killed.delete(event.unit.id);
        if (!event.countedAsLoss) return;
        const sourceOwner = kill?.source.owner ?? null;
        combat({ type: 'unit-loss', tick: event.tick, targetId: event.unit.id, targetOwner: event.unit.owner,
          sourceOwner, hostile: hostile(sourceOwner, event.unit.owner), kind: event.unit.kind, gold: UNIT_DEFS[event.unit.kind].cost });
      },
      buildingKill: event => combat({ type: 'building-loss', tick: event.tick, targetId: event.building.id,
        targetOwner: event.building.owner, sourceOwner: event.source.owner, hostile: hostile(event.source.owner, event.building.owner),
        kind: event.building.kind, gold: BUILDING_DEFS[event.building.kind].cost, complete: event.building.complete }),
      miningIncome: event => {
        emit({ type: 'mining-income', ...event });
        this.deliveries.push(event);
        if (this.deliveries.length > 2048) this.pruneIncome();
      },
      error: error => this.errors.push(String(error)),
    });
  }
  private pruneIncome() { this.deliveries = this.deliveries.filter(row => row.tick > this.game.tick - 1200); }
  finish() {
    this.stop(); this.pruneIncome();
    const mines = roomAbMinePositions(this.game);
    const windowSeconds = Math.min(1200, this.game.tick - this.startTick) / 20;
    for (const [owner, seat] of Object.entries(this.seats)) {
      seat.killedGold = seat.killedUnitGold + seat.killedBuildingGold;
      seat.lostGold = seat.lostUnitGold + seat.lostBuildingGold;
      seat.exchangeNetGold = seat.killedGold - seat.lostGold;
      seat.exchangeRatio = roomAbExchangeRatio(seat.killedGold, seat.lostGold);
      seat.crossExchangeNetGold = seat.crossKilledGold - seat.crossLostGold;
      seat.crossExchangeRatio = roomAbExchangeRatio(seat.crossKilledGold, seat.crossLostGold);
      for (const unit of this.game.units) if (unit.owner === owner && unit.hp > 0) seat.aliveUnitGold += UNIT_DEFS[unit.kind].cost;
      for (const building of this.game.buildings) if (building.owner === owner && building.hp > 0) {
        seat.aliveBuildingGold += BUILDING_DEFS[building.kind].cost;
        if (!building.complete) seat.unfinishedBuildingGold += BUILDING_DEFS[building.kind].cost;
      }
      for (const mine of mines) if (mine.status === 'held' && mine.owners[0] === owner) {
        seat.heldMines++; seat.heldMineReserves += mine.amount;
      }
      // Sum integer cents so the metric has no accumulating floating point drift.
      seat.miningWindowGold = this.deliveries.filter(row => row.owner === owner)
        .reduce((cents, row) => cents + Math.round(row.creditedGold * 100), 0) / 100;
      seat.miningWindowSeconds = windowSeconds;
      seat.miningGoldPerMinute = windowSeconds > 0 ? seat.miningWindowGold * 60 / windowSeconds : 0;
    }
    return { version: 1 as const, tick: this.game.tick, seats: this.seats, mines, errors: this.errors };
  }
}
export type RoomAbPositionReport = ReturnType<RoomAbPosition['finish']>;
