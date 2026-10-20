import { activeCamp, neutralCamps } from './policy/v7/creep';
import { unitMover } from '../shared/catalog';
import type { GameSnapshot, PlayerId, Unit } from '../shared/types';
import type { AiPolicyMemory } from './memory';
import type { AiDeathAssignment, AiDeathTask, AiIssuedOrder } from './death-ledger-types';

const DEFENSE = new Set(['mineRally', 'mineGuard', 'mineLeash', 'expansionGarrison', 'harassSquad']);
const TREATMENT = new Set(['frontRecovery', 'campRecovery', 'mobileCare', 'medicalRecovery']);

export function treatmentOrder(order: AiIssuedOrder | null): boolean {
  return order?.executor !== null && order?.executor !== undefined && TREATMENT.has(order.executor);
}

/** This indexes retained facts only. Never invokes policy selectors, pathfinders or claim pruning. */
export function deathTaskIndex(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
  const byUnit = new Map<string, AiDeathTask[]>();
  let camps: ReturnType<typeof neutralCamps> | undefined;
  const targetCamp = (state: NonNullable<NonNullable<AiPolicyMemory['v6']>['creep']>) =>
    activeCamp(state, camps ??= neutralCamps(snapshot))?.creeps.map(unit => unit.id) ?? [];
  const clearingTask = (value: AiDeathTask, state: NonNullable<NonNullable<AiPolicyMemory['v6']>['creep']>) =>
    ({ ...value, clearingTargetIds: targetCamp(state) });
  const task = (id: string, kind: string, targetId: string | undefined, stage: string | undefined,
    source: string, combat = false, clearing = false, perimeter: AiDeathTask['perimeter'] = null): AiDeathTask =>
    ({ id, kind, targetId: targetId ?? null, stage: stage ?? null, source, combat, clearing, perimeter,
      attribution: 'inferred', methodId: null, utility: null });
  const add = (ids: readonly string[] | undefined, value: AiDeathTask, first = false) => {
    for (const id of ids ?? []) {
      const entries = byUnit.get(id) ?? [];
      const existing = entries.findIndex(entry => entry.id === value.id);
      // Explicit task membership refines a claim with the same objective ID.
      // Keep that ID stable, so an observation refinement is not a reassignment.
      if (existing < 0) first ? entries.unshift(value) : entries.push(value);
      else if (first) { entries.splice(existing, 1); entries.unshift(value); }
      byUnit.set(id, entries);
    }
  };
  const hallPerimeter = (hallId?: string) => {
    const hall = snapshot.buildings.find(building => building.id === hallId);
    return hall ? { x: hall.x, y: hall.y, radius: 650 } : null;
  };
  for (const [id, claim] of Object.entries(memory.unitClaims)) {
    if (claim.kind !== 'expansionMission' && claim.expiresTick < snapshot.tick) continue;
    const defense = DEFENSE.has(claim.kind), clearing = claim.kind === 'creep';
    const perimeter = defense ? hallPerimeter(claim.kind === 'harassSquad' ? memory.harassDefense?.hallId : claim.targetId) : null;
    const clearingTask = memory.v6?.creep?.group.includes(id) ? `camp:${memory.v6.creep.center.x}:${memory.v6.creep.center.y}` : undefined;
    const objective = ['mineRally', 'mineGuard', 'mineLeash', 'expansionGarrison'].includes(claim.kind) ? `defense:${claim.targetId}`
      : ['expansion', 'expansionMission'].includes(claim.kind) ? `expansion:${claim.targetId}`
      : claim.kind === 'attack' ? `attack:${claim.targetId}` : claim.kind === 'creep' && clearingTask ? clearingTask : `claim:${claim.kind}:${claim.targetId}`;
    const claimedTask = task(objective, claim.kind, claim.targetId,
      claim.returning ? 'returning' : claim.arrived ? 'arrived' : 'assigned', `unitClaims.${claim.kind}`,
      defense || clearing || ['attack', 'harass'].includes(claim.kind), clearing, perimeter);
    if (clearing) {
      const target = snapshot.units.find(unit => unit.id === claim.targetId && unit.owner === 'neutral');
      claimedTask.clearingTargetIds = target ? (camps ??= neutralCamps(snapshot))
        .find(camp => camp.creeps.some(unit => unit.id === target.id))?.creeps.map(unit => unit.id) ?? [] : [];
    }
    add([id], claimedTask);
    if (claim.expansionMineId) add([id], task(`expansion:${claim.expansionMineId}`, 'expansion', claim.expansionMineId,
      memory.landExpansion?.stage, 'unitClaims.expansionMineId', true));
  }
  const expansion = memory.landExpansion;
  if (expansion?.combat?.creep) add(expansion.combat.creep.group,
    clearingTask(task(`expansion:${expansion.mineId}`, 'expansion', expansion.mineId, expansion.combat.creep.stage,
      'landExpansion.combat.creep', true, true), expansion.combat.creep), true);
  if (memory.v6?.creep) add(memory.v6.creep.group, clearingTask(task(`camp:${memory.v6.creep.center.x}:${memory.v6.creep.center.y}`,
    'clear-camp', undefined, memory.v6.creep.stage, 'v6.creep', true, true), memory.v6.creep), true);
  if (memory.landAttack) {
    const attack = memory.landAttack;
    add(attack.general.group, task(`attack:${attack.targetId}`, 'attack', attack.targetId,
      attack.paused ?? attack.general.stage ?? 'attack', 'landAttack', true));
    if (attack.camp) add(attack.camp.group, clearingTask(task(`attack:${attack.targetId}`, 'attack', attack.targetId,
      attack.camp.stage, 'landAttack.camp', true, true), attack.camp), true);
  }
  if (memory.v6?.raid) add(memory.v6.raid.unitIds, task(`raid:${memory.v6.raid.targetHallId}`, 'raid', memory.v6.raid.targetHallId,
    memory.v6.raid.phase, 'v6.raid', true));
  if (memory.v6?.closeout) add(memory.v6.closeout.unitIds, task(`closeout:${memory.v6.closeout.targetId}`, 'attack',
    memory.v6.closeout.targetId, 'closeout', 'v6.closeout', true));
  for (const mounted of memory.mounted ?? []) add(mounted.unitIds, mounted.objective.kind === 'camp'
    ? { ...task(`mounted-camp:${mounted.objective.ids.join(',')}`, 'clear-camp', mounted.objective.ids[0], 'mounted', 'mounted', true, true),
      clearingTargetIds: [...mounted.objective.ids] }
    : task(`mounted-raid:${mounted.objective.hallId}`, 'raid', mounted.objective.hallId, 'mounted', 'mounted', true));
  if (memory.support) add(memory.support.unitIds, task(`support:${memory.support.baseId}`, 'defense', memory.support.baseId, 'support', 'support', true));
  for (const [key, value] of Object.entries({ shopping: memory.shopping, shop: memory.v6?.shop,
    loot: memory.loot, mercenaryCourier: memory.mercenaryCourier })) if (value) add([value.unitId],
      task(`errand:${key}:${value.unitId}`, 'errand', undefined, key, key), true);

  const naval = memory.naval;
  for (const [shipId, ferry] of Object.entries(naval?.ferries ?? {})) {
    const passengers = snapshot.units.filter(unit => unit.owner === owner && (unit.deck?.shipId === shipId
      || unit.order.type === 'board' && unit.order.transportId === shipId)).map(unit => unit.id);
    add([shipId, ...ferry.crewIds, ...(ferry.payloadIds ?? []), ...passengers],
      task(`ferry:${shipId}:${ferry.sinceTick}`, 'transport', ferry.targetId, `${ferry.purpose}:${ferry.phase}`, 'naval.ferries'), true);
  }
  for (const [shipId, combat] of Object.entries(naval?.combat ?? {})) add([shipId, ...snapshot.units.filter(unit => unit.deck?.shipId === shipId).map(unit => unit.id)],
    task(`naval-combat:${shipId}`, 'naval-combat', combat.targetId, 'engage', 'naval.combat', true));
  if (naval?.outfit) add([naval.outfit.shipId, ...(naval.outfit.workerId ? [naval.outfit.workerId] : [])],
    task(`outfit:${naval.outfit.shipId}`, 'errand', naval.outfit.shipId, 'outfit', 'naval.outfit'), true);
  for (const conquest of Object.values(naval?.conquests ?? {})) {
    if (conquest.abandonedTick !== undefined || conquest.stage === 'complete') continue;
    // Explicit clearing membership only: do not invent a promise of every soldier on the island to every task.
    if (conquest.combat?.creep) add(conquest.combat.creep.group, clearingTask(task(`island:${conquest.mineId}:${conquest.sinceTick}`, 'island', conquest.mineId,
      conquest.stage, 'naval.conquests.combat.creep', true, true), conquest.combat.creep), true);
  }
  const generalClearingTargets = () => {
    const general = memory.v6?.general, state = memory.v6?.creep, at = general?.target;
    if (!at) return undefined;
    const samePoint = (point: { x: number; y: number }) => Math.hypot(point.x - at.x, point.y - at.y) < 1;
    // V7 stores either the staging point or camp center in general.target.
    if (state && (samePoint(state.staging) || samePoint(state.center))) return targetCamp(state);
    // V6 stores a camp's first home point. Preserve its inferred clearing
    // meaning if old memory has no resolvable target, rather than disabling it.
    return (camps ??= neutralCamps(snapshot)).find(camp => samePoint(camp.center)
      || camp.creeps.some(unit => samePoint({ x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y })))?.creeps.map(unit => unit.id);
  };
  return { byUnit, general: memory.v6?.general, task, hallPerimeter, generalClearingTargets };
}

export function inferDeathAssignment(snapshot: Pick<GameSnapshot, 'tick'>, unit: Pick<Unit, 'id' | 'kind' | 'x' | 'y' | 'order' | 'deck'>, memory: { unitClaims: Record<string, { localRetreat?: unknown; kind: string }> },
  index: Omit<ReturnType<typeof deathTaskIndex>, 'general'> & { general: AiDeathThinkContext['general'] | undefined }, lastOrder: AiIssuedOrder | null): AiDeathAssignment {
  const candidates = [...(index.byUnit.get(unit.id) ?? [])];
  const order = unit.order, general = index.general, claim = memory.unitClaims[unit.id];
  const put = (value: AiDeathTask, first = false) => {
    if (!candidates.some(candidate => candidate.id === value.id)) first ? candidates.unshift(value) : candidates.push(value);
  };
  if (order.type === 'board' && !candidates.some(candidate => candidate.kind === 'transport')) put(index.task(
    `boarding:${order.transportId}`, 'transport', order.transportId, 'boarding', 'order.board'), true);
  if (unit.deck && !candidates.length) put(index.task(`aboard:${unit.deck.shipId}`, 'aboard', unit.deck.shipId, 'aboard', 'unit.deck'));
  if (general && (general.group?.includes(unit.id) || lastOrder?.executor === 'v6General') && unit.kind !== 'worker') {
    const value = index.task(
      ['defend', 'guard'].includes(general.mode) ? `defense:${general.targetHallId ?? 'unknown'}` : general.mode === 'attack'
        ? `attack:${general.targetHallId ?? 'unknown'}` : `general:${general.mode}`, general.mode === 'creep' ? 'clear-camp' : general.mode,
      general.targetHallId, general.stage ?? general.mode, 'v6.general', ['attack', 'defend', 'guard', 'creep'].includes(general.mode),
      general.mode === 'creep', ['defend', 'guard'].includes(general.mode) ? index.hallPerimeter(general.targetHallId) : null);
    if (value.clearing) {
      const targets = index.generalClearingTargets();
      if (targets !== undefined) value.clearingTargetIds = targets;
    }
    put(value);
  }
  if (order.type === 'mine') put(index.task(`mining:${order.resourceId}`, 'mining', order.resourceId, order.phase, 'order.mine'));
  if (order.type === 'build') put(index.task(`build:${order.buildingKind}:${order.x}:${order.y}`, 'construction', undefined, 'build', 'order.build'));
  if (!candidates.length && (order.type === 'attack' || order.type === 'attackMove') && unitMover(unit.kind) === 'sea') put(index.task(
    `naval-field:${unit.id}`, 'naval-combat', order.targetId, 'engage', 'order.attack', true));
  const current = candidates[0] ?? null;
  const emergency = !!claim?.localRetreat || claim?.kind === 'workerSafety' || claim?.kind === 'retreat'
    || order.type === 'move' && order.avoidCombat === true
    || treatmentOrder(lastOrder) && ['move', 'idle', 'hold'].includes(order.type);
  const near = current?.perimeter ? Math.hypot(unit.x - current.perimeter.x, unit.y - current.perimeter.y) <= current.perimeter.radius : undefined;
  return { observedTick: snapshot.tick, task: current, otherTaskCandidates: candidates.slice(1),
    state: emergency ? 'emergency-interruption' : !current ? 'unassigned'
      : ['move', 'board', 'follow'].includes(order.type) ? 'en-route' : near === true || order.type === 'hold' ? 'on-station' : 'assigned',
    stateAttribution: 'inferred', evidence: candidates.map(candidate => candidate.source), plannedBalanceRange: null };
}

/** Serializable retained facts, not policy memory. Only constructed for an active observer. */
export type AiDeathThinkContext = {
  tick: number; owner: PlayerId;
  tasks: [string, AiDeathTask[]][];
  general: Pick<NonNullable<ReturnType<typeof deathTaskIndex>['general']>, 'group' | 'mode' | 'targetHallId' | 'stage'> | null;
  claims: Record<string, { localRetreat?: boolean; kind: string }>;
  generalClearingTargetIds: string[] | null;
  hallPerimeters: [string, NonNullable<AiDeathTask['perimeter']>][];
  priorAttack: string[]; worn: { reason: string; tick: number } | null;
  units: Pick<Unit, 'id' | 'kind' | 'x' | 'y' | 'hp' | 'maxHp' | 'order' | 'deck'>[];
};

export function projectDeathThinkContext(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory): AiDeathThinkContext {
  const index = deathTaskIndex(snapshot, owner, memory), general = index.general;
  const hallPerimeters:AiDeathThinkContext['hallPerimeters']=[];
  const hallId=general&&['defend','guard'].includes(general.mode)?general.targetHallId:undefined;
  const perimeter=hallId?index.hallPerimeter(hallId):null;
  if(hallId&&perimeter)hallPerimeters.push([hallId,perimeter]);
  const ownedUnits=snapshot.units.filter(u=>u.owner===owner&&u.hp>0);
  return structuredClone({ tick: snapshot.tick, owner, tasks: [...index.byUnit],
    general: general ? { mode:general.mode, ...(general.group ? {group:general.group} : {}),
      ...(general.targetHallId ? {targetHallId:general.targetHallId} : {}), ...(general.stage ? {stage:general.stage} : {}) } : null,
    claims: Object.fromEntries(Object.entries(memory.unitClaims).map(([id, claim]) => [id, { kind: claim.kind, localRetreat: !!claim.localRetreat }])),
    hallPerimeters,
    generalClearingTargetIds: general?.mode==='creep' ? index.generalClearingTargets()??null : null,
    priorAttack: memory.landAttack?.general.group ?? memory.v6?.general?.group ?? [],
    worn: memory.landAttackResult ? { tick: memory.landAttackResult.tick, reason: memory.landAttackResult.reason } : null,
    units: ownedUnits.map(({id, kind, x, y, hp, maxHp, order, deck}) =>
      ({id, kind, x, y, hp, maxHp, order, ...(deck ? {deck} : {})})),
  });
}
