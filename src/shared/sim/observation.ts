import type { Game } from '../sim';
import type { DamageProfile } from '../damage-types';
import type { Building, GameCommand, Obstacle, PlayerId, Unit } from '../types';

export type Observed<T> = T extends readonly (infer V)[] ? readonly Observed<V>[]
  : T extends object ? { readonly [K in keyof T]: Observed<T[K]> } : T;
export type ObservedUnit = Observed<Pick<Unit, 'id' | 'owner' | 'kind' | 'x' | 'y' | 'hp' | 'maxHp'
  | 'attackDamage' | 'attackRange' | 'attackClass' | 'attackCooldown' | 'level' | 'speed' | 'order' | 'orderQueue'
  | 'deck' | 'cabin' | 'garrison' | 'expiresTick'>>;
export type ObservedSource = Observed<Pick<Unit | Building, 'id' | 'owner' | 'kind' | 'x' | 'y'>> & {
  readonly entityType: 'unit' | 'building';
  /** False for a projectile/status source which outlived its entity. Its fallback kind may be synthetic. */
  readonly present: boolean;
};
export type SimulationDamageEvent = {
  readonly tick: number;
  readonly source: ObservedSource;
  readonly target: ObservedUnit;
  readonly damage: number;
  readonly hpBefore: number;
  readonly profile: Observed<DamageProfile>;
};
export type SimulationKillEvent = {
  readonly tick: number;
  readonly source: ObservedSource;
  readonly unit: ObservedUnit;
  readonly cause: 'damage' | 'sinking';
};
export type SimulationRemovalEvent = {
  readonly tick: number;
  readonly unit: ObservedUnit;
  readonly reason: 'death' | 'expired' | 'script-exit';
  /** The native unitsLost counter excludes expiry and scripted exits, even at nonpositive HP. */
  readonly countedAsLoss: boolean;
};
export type SimulationCommandEvent = {
  readonly tick: number;
  readonly owner: PlayerId;
  readonly command: Observed<GameCommand>;
};
export type SimulationObservation = {
  label?: string;
  damage?(event: SimulationDamageEvent): void;
  kill?(event: SimulationKillEvent): void;
  removed?(event: SimulationRemovalEvent): void;
  command?(event: SimulationCommandEvent): void;
  /** Diagnostics cannot interrupt simulation, including when an observer throws. */
  error?(error: unknown): void;
};

// Outside Game: registration cannot enter snapshots, canonical state, command frames or checksums.
const subscriptions = new WeakMap<Game, Set<SimulationObservation>>();
export let simulationObservationActive = 0;

/** Public, opt-in boundary shared by server rooms, single-player and replay tools.
 * Callbacks receive deeply frozen copies, never live entities. Dispose on room/replay teardown.
 * With no subscriptions the sim skips every publisher and allocates no observation data.
 */
export function observeSimulation(game: Game, observer: SimulationObservation): () => void {
  const registered = { ...observer };
  const listeners = subscriptions.get(game) ?? new Set<SimulationObservation>();
  listeners.add(registered); subscriptions.set(game, listeners); simulationObservationActive++;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true; listeners.delete(registered); simulationObservationActive--;
    if (!listeners.size) subscriptions.delete(game);
  };
}

function frozenCopy<T>(value: T): Observed<T> {
  const copy = structuredClone(value);
  const freeze = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Object.isFrozen(node)) return;
    for (const child of Object.values(node)) freeze(child);
    Object.freeze(node);
  };
  freeze(copy);
  return copy as Observed<T>;
}

function unitView(unit: Unit): ObservedUnit {
  const { id, owner, kind, x, y, hp, maxHp, attackDamage, attackRange, attackClass, attackCooldown, level,
    speed, order, orderQueue, deck, cabin, garrison, expiresTick } = unit;
  return frozenCopy({ id, owner, kind, x, y, hp, maxHp, attackDamage, attackRange, attackCooldown, level,
    speed, order, ...(attackClass ? { attackClass } : {}), ...(orderQueue ? { orderQueue } : {}), ...(deck ? { deck } : {}),
    ...(cabin ? { cabin } : {}), ...(garrison ? { garrison } : {}),
    ...(expiresTick !== undefined ? { expiresTick } : {}) });
}

function sourceView(game: Game, source: Unit | Building): ObservedSource {
  return Object.freeze({ id: source.id, owner: source.owner, kind: source.kind, x: source.x, y: source.y,
    entityType: 'order' in source ? 'unit' as const : 'building' as const,
    present: game.units.some(unit => unit.id === source.id) || game.buildings.some(building => building.id === source.id) });
}

function reportObserverError(listener: SimulationObservation, kind: string, error: unknown) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[simulation observation: ${listener.label ?? 'anonymous'} / ${kind}]\n${detail}`);
  if (typeof process !== 'undefined' && process.env.VITEST) queueMicrotask(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function publish<K extends 'damage' | 'kill' | 'removed' | 'command'>(listeners: Set<SimulationObservation>, kind: K,
  event: Parameters<NonNullable<SimulationObservation[K]>>[0]) {
  for (const listener of [...listeners]) {
    try { (listener[kind] as ((value: typeof event) => void) | undefined)?.(event); }
    catch (error) {
      reportObserverError(listener, kind, error);
      try { listener.error?.(error); }
      catch (reportingError) { reportObserverError(listener, 'error handler', reportingError); }
    }
  }
}

export function observeDamage(game: Game, source: Unit | Building, target: Unit | Building | Obstacle,
  damage: number, hpBefore: number, profile: DamageProfile) {
  const listeners = subscriptions.get(game);
  if (!listeners || !('order' in target) || ![...listeners].some(listener => listener.damage)) return;
  publish(listeners, 'damage', Object.freeze({ tick: game.tick, source: sourceView(game, source),
    target: unitView(target), damage, hpBefore, profile: frozenCopy(profile) }));
}

export function observeKill(game: Game, source: Unit | Building, unit: Unit | Building, cause: SimulationKillEvent['cause']) {
  const listeners = subscriptions.get(game);
  if (!listeners || !('order' in unit) || ![...listeners].some(listener => listener.kill)) return;
  publish(listeners, 'kill', Object.freeze({ tick: game.tick, source: sourceView(game, source), unit: unitView(unit), cause }));
}

export function observeRemoval(game: Game, unit: Unit, reason: SimulationRemovalEvent['reason']) {
  const listeners = subscriptions.get(game);
  if (!listeners || ![...listeners].some(listener => listener.removed)) return;
  publish(listeners, 'removed', Object.freeze({ tick: game.tick, unit: unitView(unit), reason, countedAsLoss: reason === 'death' }));
}

export function observeCommand(game: Game, owner: PlayerId, command: GameCommand) {
  const listeners = subscriptions.get(game);
  if (!listeners || ![...listeners].some(listener => listener.command)) return;
  publish(listeners, 'command', Object.freeze({ tick: game.tick, owner, command: frozenCopy(command) }));
}
