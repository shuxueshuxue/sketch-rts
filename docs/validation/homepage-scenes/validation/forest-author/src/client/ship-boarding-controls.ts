import { shipProfile } from '../shared/ship-geometry';
import { shipBoardingRefusal, shipBoardingTargetRefusal } from '../shared/ship-gangway';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../shared/types';

type BoardingSnapshot = Pick<GameSnapshot, 'units' | 'tick' | 'variants'>;
export type ShipBoardingAction = {
  type: 'boardShip' | 'cancelBoardShip';
  unitIds: string[];
  enabled: boolean;
  problem?: 'crew' | 'cooldown';
  cooldownTicks?: number;
};

function ownShips(snapshot: BoardingSnapshot, owner: PlayerId, units: readonly Unit[]) {
  const ids = new Set(units.map(unit => unit.id));
  return snapshot.units.filter(unit => ids.has(unit.id) && unit.owner === owner && unit.hp > 0 && shipProfile(unit));
}

/** Active bridges are recalled first, like returning sheltered crew before
 * sheltering a mixed selection. Empty ships keep a visible disabled command. */
export function shipBoardingAction(snapshot: BoardingSnapshot, owner: PlayerId, units: readonly Unit[]): ShipBoardingAction | undefined {
  const ships = ownShips(snapshot, owner, units);
  if (!ships.length) return undefined;
  const active = ships.filter(ship => ship.sailing?.gangway);
  if (active.length) return { type: 'cancelBoardShip', unitIds: active.map(ship => ship.id), enabled: true };
  const reasons = ships.map(ship => shipBoardingRefusal(ship, snapshot.units, snapshot.tick, snapshot));
  const ready = ships.filter((_, index) => reasons[index] === undefined);
  if (ready.length) return { type: 'boardShip', unitIds: ready.map(ship => ship.id), enabled: true };
  const cooling = ships.filter((_, index) => reasons[index] === 'cooldown');
  return { type: 'boardShip', unitIds: ships.map(ship => ship.id), enabled: false,
    problem: cooling.length ? 'cooldown' : 'crew',
    ...(cooling.length ? { cooldownTicks: Math.min(...cooling.map(ship => Math.max(0, (ship.sailing?.gangwayCooldownUntilTick ?? 0) - snapshot.tick))) } : {}) };
}

/** A target click addresses the live hull, including a click on its deck crew.
 * Ownership and availability are sampled again after entering target mode. */
export function shipBoardingTargetCommand(snapshot: BoardingSnapshot, owner: PlayerId, sourceIds: readonly string[], target: Unit | undefined, queued = false): Extract<GameCommand, { type: 'boardShip' }> | undefined {
  if (!target) return undefined;
  const liveTarget = snapshot.units.find(unit => unit.id === target.id && unit.hp > 0);
  if (!liveTarget || !shipProfile(liveTarget)) return undefined;
  const ids = new Set(sourceIds);
  const sources = snapshot.units.filter(unit => ids.has(unit.id) && unit.owner === owner && unit.hp > 0 && shipProfile(unit) && !unit.sailing?.gangway
    && !shipBoardingRefusal(unit, snapshot.units, snapshot.tick, snapshot) && !shipBoardingTargetRefusal(unit, liveTarget));
  return sources.length ? { type: 'boardShip', unitIds: sources.map(ship => ship.id), targetId: liveTarget.id, ...(queued ? { queued: true } : {}) } : undefined;
}

export function boardingTargetHull(snapshot: Pick<GameSnapshot, 'units'>, target: Unit | undefined): Unit | undefined {
  if (!target || target.hp <= 0) return undefined;
  return shipProfile(target) ? target : target.deck ? snapshot.units.find(ship => ship.id === target.deck!.shipId && ship.hp > 0 && shipProfile(ship)) : undefined;
}

export function shipBoardingProblem(action: ShipBoardingAction, zh: boolean): string {
  return action.problem === 'cooldown' ? zh ? '接舷冷却中' : 'Boarding bridge cooling down'
    : zh ? '需甲板上的步行船员' : 'Needs walking crew on deck';
}

export function shipBoardingStatus(ship: Unit, tick: number, zh: boolean): string {
  const bridge = ship.sailing?.gangway;
  if (bridge?.phase === 'approach') return zh ? '正在靠拢目标船' : 'Approaching target ship';
  if (bridge?.phase === 'deploying') return `${zh ? '正在架桥' : 'Deploying bridge'} · ${Math.max(0, Math.ceil((bridge.readyAtTick - tick) / SIM_TICKS_PER_SECOND))}s`;
  if (bridge?.phase === 'ready') return zh ? '接舷桥已就绪' : 'Boarding bridge ready';
  const remaining = (ship.sailing?.gangwayCooldownUntilTick ?? 0) - tick;
  return remaining > 0 ? `${zh ? '接舷冷却' : 'Bridge cooldown'} ${Math.ceil(remaining / SIM_TICKS_PER_SECOND)}s` : '';
}
