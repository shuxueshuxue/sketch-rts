import { UNIT_DEFS, unitMover } from '../shared/catalog';
import { isTransportKind } from '../shared/transport-role';
import { groundWholeAt, sameGround } from '../shared/terrain';
import { observeSimulation, type Game } from '../shared/sim';
import type { ObservedSource, ObservedUnit, SimulationDamageEvent, SimulationKillEvent, SimulationRemovalEvent } from '../shared/sim/observation';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../shared/types';
import type { AiPolicyMemory } from './memory';
import { createAiPolicyMemory } from './memory';
import { effectiveCombatRating, structureRating } from './policy/v6/strength';
import { deathTaskIndex, inferDeathAssignment, treatmentOrder } from './death-ledger-context';
import { classifyAiDeath } from './death-ledger-classification';
import { inferAiDeathEngagement, isAiDeathOpponent } from './death-ledger-engagement';
import { summarizeAiDeaths } from './death-ledger-summary';
import { deathAttributionContext } from './death-ledger-attribution';
import type { AiDeathAssignment, AiDeathBalance, AiDeathLedgerFrame, AiDeathSummary, AiIssuedOrder, AiUnitDeathRecord } from './death-ledger-types';
export type * from './death-ledger-types';

const HISTORY_TICKS = 300;
const HEALTH_POINTS = 128;
const BALANCE_RADIUS = 900;
const MOTION = new Set(['move', 'attackMove', 'attack', 'holdPosition', 'follow', 'board', 'mine', 'build', 'repair', 'repairUnit', 'repairShip', 'stop', 'garrison', 'ungarrison', 'cast', 'pickupItem', 'buy', 'hire']);
function last<T>(values: readonly T[], predicate: (value: T) => boolean): T | undefined {
  for (let i = values.length - 1; i >= 0; i--) if (predicate(values[i]!)) return values[i];
  return undefined;
}
type UnitHistory = {
  health: AiUnitDeathRecord['health']; damage: SimulationDamageEvent[];
  dealt: { tick: number; damage: number; targetOwner: PlayerId }[];
  sinkingCarrier: { unit: ObservedUnit; damageWindow: AiUnitDeathRecord['damageWindow'] } | null; kill: SimulationKillEvent | null;
  assignment: AiDeathAssignment | null; switches: AiUnitDeathRecord['context']['switches'];
  order: AiIssuedOrder | null; orders: AiIssuedOrder[]; wornTick: number | null; balance: AiDeathBalance | null;
  sinkingProfile: SimulationDamageEvent['profile'] | null;
  pendingMetadata: boolean;
};
type OwnerContext = { memory: AiPolicyMemory; index: ReturnType<typeof deathTaskIndex>; priorAttack: Set<string> };

/** Pure observation. The object and its histories belong to the caller, never to Game or AI memory.
 * Hook recordThink after the ordinary planner and recordIssuedCommand at the command frame's afterIssue boundary.
 */
export class AiDeathLedger {
  private readonly histories = new Map<string, UnitHistory>();
  private readonly contexts = new Map<PlayerId, OwnerContext>();
  private readonly identities = new Map<string, Pick<ObservedSource, 'kind' | 'owner' | 'entityType'>>();
  private readonly forfeited = new Set<PlayerId>();
  private readonly rows: AiUnitDeathRecord[] = [];
  private readonly seen = new Set<string>();
  private readonly stop: () => void;
  private readonly owners: Set<PlayerId>;
  readonly errors: string[] = [];

  constructor(private readonly game: Game, options: { owners: readonly PlayerId[] }) {
    this.owners = new Set(options.owners);
    this.rememberIdentities(game);
    this.stop = observeSimulation(game, {
      label: 'AiDeathLedger',
      damage: event => this.onDamage(event), kill: event => this.onKill(event), removed: event => this.onRemoval(event),
      command: event => this.recordActualCommand(event.tick, event.owner, event.command as GameCommand),
      error: error => this.errors.push(error instanceof Error ? error.message : String(error)),
    });
  }

  dispose() { this.stop(); }

  private history(id: string): UnitHistory {
    let state = this.histories.get(id);
    if (!state) { state = { health: [], damage: [], dealt: [], sinkingCarrier: null, kill: null, assignment: null, switches: [], order: null, orders: [], wornTick: null, balance: null, sinkingProfile: null, pendingMetadata: false }; this.histories.set(id, state); }
    return state;
  }

  private rememberIdentities(snapshot: GameSnapshot) {
    for (const unit of snapshot.units) this.identities.set(unit.id, { kind: unit.kind, owner: unit.owner, entityType: 'unit' });
    for (const building of snapshot.buildings) this.identities.set(building.id, { kind: building.kind, owner: building.owner, entityType: 'building' });
  }

  private sample(state: UnitHistory, unit: Pick<Unit, 'hp' | 'maxHp'>, tick: number, source: AiUnitDeathRecord['health'][number]['source']) {
    const previous = state.health.at(-1);
    if (previous?.tick === tick && previous.source === source && previous.hp === unit.hp && previous.maxHp === unit.maxHp) return;
    state.health.push({ tick, hp: unit.hp, maxHp: unit.maxHp, source });
    let remove = Math.max(0, state.health.length - HEALTH_POINTS);
    while (remove < state.health.length && state.health[remove]!.tick < tick - HISTORY_TICKS) remove++;
    if (remove) state.health.splice(0, remove);
  }

  /** Copies only selected task facts and health points; does not call selectors or alter their caches. */
  recordThink(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
    if (!this.owners.has(owner)) return;
    this.rememberIdentities(snapshot);
    const previous = this.contexts.get(owner), index = deathTaskIndex(snapshot, owner, memory);
    const current = { memory, index, priorAttack: new Set(memory.landAttack?.general.group ?? memory.v6?.general?.group ?? []) };
    this.contexts.set(owner, current);
    const worn = memory.landAttackResult;
    if (worn?.reason === 'general:retreat:worn' && worn.tick >= (previous ? snapshot.tick - 15 : snapshot.tick))
      for (const id of previous?.priorAttack ?? []) this.history(id).wornTick = worn.tick;
    for (const unit of snapshot.units) if (unit.owner === owner && unit.hp > 0) {
      const state = this.history(unit.id);
      this.assign(state, inferDeathAssignment(snapshot, unit, memory, index, state.order));
      this.sample(state, unit, snapshot.tick, 'think');
    }
  }

  private assign(state: UnitHistory, assignment: AiDeathAssignment) {
    const before = state.assignment?.task?.id ?? null, after = assignment.task?.id ?? null;
    if (state.assignment && before !== after) state.switches.push({ tick: assignment.observedTick, from: before, to: after, attribution: 'inferred' });
    state.switches = state.switches.filter(change => change.tick >= assignment.observedTick - HISTORY_TICKS);
    state.assignment = assignment;
  }

  /** Enrich only an actually applied native command. Frame afterIssue hooks can also
   * run for a transient refusal, and can retain operands removed by frame narrowing.
   * Those hooks must not manufacture an order or replace its actual live operands.
   */
  recordIssuedCommand(tick: number, owner: PlayerId, command: GameCommand, executor?: string, source?: string) {
    if (!this.owners.has(owner)) return;
    const ids = 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
    const shape = (value: GameCommand) => JSON.stringify('unitIds' in value ? { ...value, unitIds: [] } : value);
    for (const id of ids) {
      const state = this.histories.get(id);
      if (!state?.pendingMetadata || !state.order || state.order.tick !== tick || shape(state.order.command) !== shape(command)) continue;
      state.pendingMetadata = false;
      state.order = { ...state.order, executor: executor ?? null, source: source ?? null,
        attribution: executor === undefined ? 'sim-command-without-executor' : 'recorded-issued-command' };
      state.orders[state.orders.length - 1] = state.order;
      this.refreshAssignment(owner, id, state);
    }
  }

  private recordActualCommand(tick: number, owner: PlayerId, command: GameCommand) {
    if (!this.owners.has(owner)) return;
    if (command.type === 'forfeit') this.forfeited.add(owner);
    if (!MOTION.has(command.type)) return;
    const ids = 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
    for (const id of ids) {
      const state = this.history(id);
      state.order = { tick, command: structuredClone(command), executor: null, source: null, attribution: 'sim-command-without-executor' };
      state.orders.push(state.order); if (state.orders.length > 64) state.orders.shift();
      state.pendingMetadata = true;
      this.refreshAssignment(owner, id, state);
    }
  }

  private refreshAssignment(owner: PlayerId, id: string, state: UnitHistory) {
    const unit = this.game.units.find(candidate => candidate.id === id && candidate.owner === owner);
    const context = this.contexts.get(owner);
    if (unit && context) this.assign(state, inferDeathAssignment(this.game, unit, context.memory, context.index, state.order));
  }

  private onDamage(event: SimulationDamageEvent) {
    if (event.source.present) this.identities.set(event.source.id, event.source);
    if (event.source.entityType === 'unit' && this.owners.has(event.source.owner) && !this.seen.has(event.source.id) && event.damage > 0) {
      const source = this.history(event.source.id);
      source.dealt = source.dealt.filter(hit => hit.tick >= event.tick - HISTORY_TICKS);
      source.dealt.push({ tick: event.tick, damage: event.damage, targetOwner: event.target.owner });
    }
    if (!this.owners.has(event.target.owner) || event.hpBefore <= 0) return;
    const state = this.history(event.target.id);
    this.sample(state, { hp: event.hpBefore, maxHp: event.target.maxHp }, event.tick, 'damage-before');
    this.sample(state, event.target, event.tick, 'damage-after');
    state.damage = state.damage.filter(hit => hit.tick >= event.tick - HISTORY_TICKS);
    state.damage.push(event);
    if (event.hpBefore > 0 && event.target.hp <= 0) state.balance = this.localBalance(event.target, event.hpBefore);
  }

  private onKill(event: SimulationKillEvent) {
    if (!this.owners.has(event.unit.owner)) return;
    const state = this.history(event.unit.id);
    state.kill = event;
    if (event.cause === 'sinking' && event.unit.deck) {
      const carrier = this.history(event.unit.deck.shipId);
      state.sinkingProfile = last(carrier.damage, hit => hit.target.hp <= 0)?.profile ?? null;
      // The hull hit samples force before the native sinking code zeroes every passenger.
      // Cleanup would otherwise describe the already-dead crew as zero friendly force.
      state.balance = carrier.balance;
      if (carrier.kill) state.sinkingCarrier = { unit: carrier.kill.unit,
        damageWindow: { fromTick: Math.max(0, event.tick - HISTORY_TICKS), toTick: event.tick,
          sources: carrier.damage.filter(hit => hit.tick >= event.tick - HISTORY_TICKS)
            .map(hit => ({ source: hit.source, profile: hit.profile, damage: hit.damage, hits: 1 })) } };
    }
  }

  private localBalance(unit: ObservedUnit, hpBefore?: number): AiDeathBalance {
    const ownIds: string[] = [], hostileIds: string[] = []; let own = 0, hostile = 0;
    const team = (owner: string) => owner === 'neutral' ? 'neutral' : this.game.teams[owner] ?? owner;
    const homeTeam = team(unit.owner), sea = unitMover(unit.kind) === 'sea' || !!unit.deck;
    for (const soldier of this.game.units) {
      if (soldier.hp <= 0 && soldier.id !== unit.id || Math.hypot(soldier.x - unit.x, soldier.y - unit.y) > BALANCE_RADIUS) continue;
      if (!sea && !soldier.deck && !sameGround(this.game.map, unit, soldier)) continue;
      const sample = soldier.id === unit.id && hpBefore !== undefined ? { ...soldier, hp: hpBefore } : soldier;
      const power = effectiveCombatRating(this.game, sample);
      if (!(power > 0)) continue;
      if (team(soldier.owner) === homeTeam) { own += power; ownIds.push(soldier.id); }
      else { hostile += power; hostileIds.push(soldier.id); }
    }
    for (const building of this.game.buildings) {
      if (building.hp <= 0 || !building.complete || building.attackDamage <= 0
        || Math.hypot(building.x - unit.x, building.y - unit.y) > BALANCE_RADIUS) continue;
      const power = structureRating(building);
      if (team(building.owner) === homeTeam) { own += power; ownIds.push(building.id); }
      else { hostile += power; hostileIds.push(building.id); }
    }
    return { tick: this.game.tick, radius: BALANCE_RADIUS, own, hostile, ratio: hostile > 0 ? own / hostile : null,
      ownIds, hostileIds, estimator: 'effective-combat-rating' };
  }

  private onRemoval(event: SimulationRemovalEvent) {
    const unit = event.unit;
    if (!this.owners.has(unit.owner) || this.seen.has(unit.id)) return;
    this.seen.add(unit.id);
    const state = this.history(unit.id), context = this.contexts.get(unit.owner);
    const live = this.game.units.find(candidate => candidate.id === unit.id);
    this.sample(state, unit, event.tick, 'removal');
    const actualDeath = unit.hp <= 0;
    const kill = actualDeath ? state.kill : null;
    const fatal = actualDeath ? last(state.damage, hit => hit.hpBefore > 0 && hit.target.hp <= 0) : undefined;
    const currentOrder = fatal?.target.order ?? unit.order;
    const currentOrderIssuer = last(state.orders, order => this.matchesOrder(currentOrder, order)) ?? null;
    if (live) {
      const memory = context?.memory ?? createAiPolicyMemory();
      const atHit = { ...live, order: structuredClone(currentOrder) as Unit['order'] };
      this.assign(state, inferDeathAssignment(this.game, atHit, memory,
        context?.index ?? deathTaskIndex(this.game, unit.owner, memory), currentOrderIssuer));
    }
    const diedTick = actualDeath ? kill?.tick ?? fatal?.tick ?? event.tick : event.tick;
    const source = kill?.source ?? fatal?.source ?? null;
    const remembered = source && this.identities.get(source.id);
    const killer = source ? { ...source, ...(!source.present && remembered ? remembered : {}) } : null;
    const profile = fatal?.profile ?? state.sinkingProfile;
    const damage = state.damage.filter(hit => hit.tick >= event.tick - HISTORY_TICKS);
    const groups = new Map<string, AiUnitDeathRecord['damageWindow']['sources'][number]>();
    for (const hit of damage) {
      const key = `${hit.source.id}:${JSON.stringify(hit.profile)}`, group = groups.get(key)
        ?? { source: hit.source, profile: hit.profile, damage: 0, hits: 0 };
      group.damage += hit.damage; group.hits++; groups.set(key, group);
    }
    const home = this.game.buildings.find(building => building.owner === unit.owner && building.kind === 'townHall');
    const onLand = unitMover(unit.kind) === 'land' && !unit.deck;
    const onHomeGround = onLand && home ? sameGround(this.game.map, unit, home) : null;
    const safeSites = onLand ? this.game.buildings.filter(building => building.owner === unit.owner && building.complete
      && building.hp >= building.maxHp * .5 && ['townHall', 'defenseTower', 'fortifiedTower'].includes(building.kind)
      && sameGround(this.game.map, unit, building)).map(building => building.id) : [];
    const assignment = state.assignment ?? { observedTick: event.tick, task: null, otherTaskCandidates: [],
      state: 'unassigned', stateAttribution: 'inferred', evidence: [], plannedBalanceRange: null } as AiDeathAssignment;
    const perimeter = assignment.task?.perimeter;
    const retreating = currentOrder.type === 'move' && currentOrder.avoidCombat === true
      || ['mineLeash', 'retreat', 'workerSafety'].includes(assignment.task?.kind ?? '');
    const treatment = treatmentOrder(currentOrderIssuer ?? state.order) && ['move', 'idle', 'hold'].includes(currentOrder.type);
    const landLabel = onLand ? groundWholeAt(this.game.map, unit) : undefined;
    const seaLabel = !onLand ? groundWholeAt(this.game.map, unit, 'sea') : undefined;
    const raw: Omit<AiUnitDeathRecord, 'classification' | 'attributionContext'> = {
      id: `${unit.id}@${diedTick}`, tick: diedTick, removedTick: event.tick, owner: unit.owner, unit, catalogGold: UNIT_DEFS[unit.kind].cost,
      removal: event.reason, countedAsNativeLoss: event.countedAsLoss, actualDeath,
      cause: !actualDeath ? event.reason === 'expired' ? 'expiry' : 'script-exit'
        : this.forfeited.has(unit.owner) ? 'forfeit' : kill?.cause ?? (fatal ? 'damage' : 'unknown'),
      killer, killerKindAttribution: !source ? null : source.present ? 'observed-live-entity' : remembered ? 'previously-observed-entity' : 'unresolved-source',
      fatalDamageProfile: profile ?? null,
      damageWindow: { fromTick: Math.max(0, event.tick - HISTORY_TICKS), toTick: event.tick, sources: [...groups.values()] },
      assignment, currentOrder, currentOrderIssuer, lastIssuedOrder: state.order,
      currentOrderSource: !currentOrderIssuer ? 'derived-or-unrecorded'
        : currentOrderIssuer === state.order ? 'matches-last-issued' : 'matches-earlier-issued',
      location: { space: unit.cabin ? 'cabin' : unit.deck ? 'deck' : unit.garrison ? 'garrison' : unitMover(unit.kind) === 'sea' ? 'sea' : 'land',
        landId: landLabel === undefined ? null : `land:${landLabel}`,
        seaId: seaLabel === undefined ? null : `sea:${seaLabel}`,
        carrierId: unit.deck?.shipId ?? unit.garrison?.buildingId ?? null },
      health: state.health,
      context: { retreating, treatment, killerIsAlly: killer ? killer.owner === unit.owner
        || killer.owner !== 'neutral' && this.game.teams[killer.owner] !== undefined
          && this.game.teams[killer.owner] === this.game.teams[unit.owner] : null,
        balance: state.balance ?? this.localBalance(unit), outsidePerimeter: perimeter
        ? Math.hypot(unit.x - perimeter.x, unit.y - perimeter.y) > perimeter.radius : null,
        onHomeGround, safeOwnSitesOnGround: safeSites, ownTransportIds: this.game.units.filter(ship => ship.owner === unit.owner
          && ship.hp > 0 && isTransportKind(ship.kind)).map(ship => ship.id),
        evacuationAssigned: assignment.task?.kind === 'workerSafety' || assignment.task?.stage?.startsWith('evacuate:') === true,
        escapeRoute: 'not-evaluated', switches: state.switches, wornRetreatTick: state.wornTick },
      limitations: ['previous-task-and-arrival-inference', 'formal-method-utility-and-combat-range-not-recorded',
        'local-ratio-is-a-diagnostic-not-a-fight-simulation', 'escape-route-not-evaluated', 'health-history-sampled-and-bounded',
        ...(!source ? ['fatal-source-not-recorded'] : !source.present && !remembered ? ['original-source-kind-unresolved'] : []),
        ...(currentOrderIssuer?.executor ? [] : ['current-order-executor-not-recorded']), 'issued-order-history-limited-to-64'],
    };
    const base = { ...raw, attributionContext: deathAttributionContext(raw) };
    const engagement = inferAiDeathEngagement(base, { identities: this.identities, teams: this.game.teams,
      dealtDamage: state.dealt.filter(hit => hit.tick >= diedTick - HISTORY_TICKS && isAiDeathOpponent(hit.targetOwner, base, this.game.teams))
        .reduce((sum, hit) => sum + hit.damage, 0) || null,
      ...(state.sinkingCarrier ? { carrier: state.sinkingCarrier } : {}), provenance: 'live-native-events' });
    this.rows.push(structuredClone({ ...base, classification: classifyAiDeath(base, engagement) }));
    this.histories.delete(unit.id);
  }

  private matchesOrder(order: ObservedUnit['order'], issued: AiIssuedOrder | null) {
    if (!issued) return false;
    const command = issued.command;
    if (command.type === 'holdPosition') return order.type === 'hold';
    if (command.type === 'stop') return order.type === 'idle';
    if (command.type !== order.type) return false;
    if ('targetId' in command && (!('targetId' in order) || command.targetId !== order.targetId)) return false;
    if ('resourceId' in command && (!('resourceId' in order) || command.resourceId !== order.resourceId)) return false;
    if ('transportId' in command && (!('transportId' in order) || command.transportId !== order.transportId)) return false;
    if ('x' in command && typeof command.x === 'number' && typeof command.y === 'number'
      && (!('x' in order) || typeof order.x !== 'number' || typeof order.y !== 'number'
        || Math.hypot(command.x - order.x, command.y - order.y) > 1)) return false;
    return true;
  }

  records(owner?: PlayerId): AiUnitDeathRecord[] { return structuredClone(this.rows.filter(row => owner === undefined || row.owner === owner)); }

  summary(owner?: PlayerId, throughTick = this.game.tick): AiDeathSummary {
    return summarizeAiDeaths(this.rows, owner, throughTick);
  }

  frame(owner: PlayerId, throughTick = this.game.tick, sinceTick = -1): AiDeathLedgerFrame {
    return { schemaVersion: 2, owner, throughTick, sinceTick, records: structuredClone(this.rows.filter(row => row.owner === owner
      && row.removedTick > sinceTick && row.removedTick <= throughTick)), summary: this.summary(owner, throughTick) };
  }

  /** Structural adapter also accepts AiPlanTrace; no mutation of the supplied trace. */
  withPlanTrace<T extends { owner: PlayerId; tick: number }>(trace: T, sinceTick = -1): T & { deathLedger: AiDeathLedgerFrame } {
    return { ...trace, deathLedger: this.frame(trace.owner, trace.tick, sinceTick) };
  }
}
