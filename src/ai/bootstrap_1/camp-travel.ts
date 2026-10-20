import { unitAutoAcquireRadius } from '../../shared/combat-acquisition';
import { UNIT_DEFS } from '../../shared/catalog';
import { detCos, detSin } from '../../shared/det-math';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isOpenGround } from '../../shared/terrain';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { nativeLandRoad } from '../policy/land-road';
import { creepForce, forceFor, CREEP_ASSEMBLED_RANGE, type Camp } from '../policy/v7/creep';
import { neutralCampExposure, type NeutralCampExposureFacts } from '../situation/neutral-camp-exposure';
import { neutralCampPointContacts, neutralCampRouteContacts, type CampContact } from '../situation/neutral-camp-contact';
import type { Subgoal } from '../strategy/types';
import type { NeutralCampExposure } from '../situation/neutral-camp-exposure';
import type { CampObjectivePoint } from '../situation/neutral-camp-objectives';
import { workerExposure, workerExposureRadius } from '../situation/worker-exposure';
import { landDiskRouter } from './threat-roads';
import { bootstrapCampApproach } from './camp-geometry';
import { averagePoint } from '../policy/spatial';
import { armedFoes } from '../policy/armed-foes';
import { isBacklineKind } from '../policy/v6/backline';

type Point = { x: number; y: number };
type Road = NonNullable<ReturnType<typeof nativeLandRoad>>;
const delayValue = (party: readonly Unit[], value?: number) => value ?? GOLD_MINE_RULES.goldPerTrip / GOLD_MINE_RULES.entrySeconds / SIM_TICKS_PER_SECOND
  + party.reduce((sum, member) => sum + UNIT_DEFS[member.kind].cost, 0) / (60 * SIM_TICKS_PER_SECOND);

/** One ETA for waiting on a clearing effect: actual rendezvous, native advance,
 * combat and summon lifetime. An absent staging point means an ongoing march. */
export function campClearanceTicks(snapshot: GameSnapshot, party: readonly Unit[], camp: Camp, staging?: Point): number | null {
  let arriving = party.filter(member => member.kind !== 'worker' && member.attackDamage > 0 && !isBacklineKind(member) && member.hp >= member.maxHp * .35)
    .flatMap(member => {
      const road = nativeLandRoad(snapshot, member, staging ?? camp.center);
      if (!road) return [];
      const ticks = staging ? road.ticks : Math.max(0, road.ticks - member.attackRange / Math.max(1, member.speed) * SIM_TICKS_PER_SECOND);
      return [{ member, ticks }];
    }).sort((a, b) => a.ticks - b.ticks);
  for (;;) {
    const clearing: Unit[] = []; let rendezvous = 0;
    for (const entry of arriving) {
      if (creepForce(clearing, camp) >= forceFor(camp)) break;
      if (entry.member.expiresTick !== undefined && entry.member.expiresTick <= snapshot.tick + entry.ticks) continue;
      clearing.push(entry.member); rendezvous = Math.max(rendezvous, entry.ticks);
    }
    if (creepForce(clearing, camp) < forceFor(camp)) return null;
    const dps = clearing.reduce((sum, member) => sum + member.attackDamage / Math.max(1, member.attackCooldown), 0);
    const advance = staging ? Math.max(0, ...clearing.map(member => {
      const road = nativeLandRoad(snapshot, { ...member, ...staging }, camp.center);
      return road ? Math.max(0, road.ticks - member.attackRange / Math.max(1, member.speed) * SIM_TICKS_PER_SECOND) : Infinity;
    })) : 0;
    const ticks = Math.ceil(rendezvous + advance + camp.creeps.reduce((sum, guard) => sum + guard.hp, 0) / Math.max(.01, dps));
    if (!Number.isFinite(ticks)) return null;
    const expiring = new Set(clearing.filter(member => member.expiresTick !== undefined && member.expiresTick <= snapshot.tick + ticks));
    if (!expiring.size) return ticks;
    // A short-lived surplus summon does not veto an otherwise sufficient host.
    arriving = arriving.filter(entry => !expiring.has(entry.member));
  }
}

/** The same role envelope used by the evacuation veto, over every hostile
 * source. Return only a road that the issued native waypoint legs reproduce. */
export function workerLandDetour(snapshot: GameSnapshot, worker: Unit, goal: Point, foes: readonly (Unit | Building)[]): Road | undefined {
  const direct = nativeLandRoad(snapshot, worker, goal);
  if (!direct) return undefined;
  if (!workerExposure(snapshot, worker, direct.points, { foes, allowDeparture: true }).length) return direct;
  const disks = foes.flatMap(foe => {
    const radius = workerExposureRadius(snapshot, worker, foe);
    return radius > 0 ? [{ x: foe.x, y: foe.y, radius: radius + 24 }] : [];
  });
  const detour = landDiskRouter(snapshot, worker, disks)(goal);
  if (!detour) return undefined;
  const legs = detour.points.slice(1).map((end, index) => nativeLandRoad(snapshot, { ...worker, ...detour.points[index]! }, end));
  if (legs.some(leg => !leg)) return undefined;
  const road: Road = { points: [worker, ...legs.flatMap(leg => leg!.points.slice(1))], ticks: legs.reduce((sum, leg) => sum + leg!.ticks, 0) };
  return workerExposure(snapshot, worker, road.points, { foes, allowDeparture: true }).length ? undefined : road;
}
export type CampTravelPlan = {
  kind: 'direct' | 'exposed' | 'detour' | 'relocate' | 'approach' | 'clear-camp' | 'clear-on-route' | 'unreachable';
  goal: Point; road: Road | null; contacts: readonly CampContact[];
  delayGold: number; exposureGold: number; subgoal: Subgoal | null;
  clearingAlternative?: { contacts: readonly CampContact[]; subgoal: Subgoal; delayGold: number; exposureGold: number };
};
export type CampTravelOptions = {
  parentId: string; party?: readonly Unit[]; facts?: NeutralCampExposureFacts; exemptMemberIds?: ReadonlySet<string>;
  arrivalRange?: number; movingMode?: 'move' | 'attackMove'; arrivalMode?: 'idle' | 'hold' | 'attackMove' | 'move';
  /** Opportunity value of delaying the parent objective, not a fixed detour distance cap. */
  valueGoldPerTick?: number;
  blockingCamps?: ReadonlyMap<NeutralCampExposure, readonly CampObjectivePoint[]>;
  /** A moving parent's look-ahead point, rather than a site to occupy. */
  waypoint?: boolean;
  workerFoes?: readonly (Unit | Building)[];
};

/** A route and an arrival point compete against clearing their blocker. No camp
 * creates an unconditional forbidden zone. A failed detour produces a retained
 * clear-camp prerequisite, with the actual force demand rather than silence.
 */
export function planCampTravel(snapshot: GameSnapshot, unit: Unit, goal: Point, options: CampTravelOptions): CampTravelPlan {
  goal = { x: goal.x, y: goal.y };
  const facts = options.facts ?? neutralCampExposure(snapshot), party = options.party ?? [unit];
  const direct = nativeLandRoad(snapshot, unit, goal);
  let clearingAlternative: CampTravelPlan['clearingAlternative'];
  const result = (kind: CampTravelPlan['kind'], road: Road | null, contacts: readonly CampContact[], delayGold = 0, exposureGold = 0,
    subgoal: Subgoal | null = null, destination = goal): CampTravelPlan => ({ kind, goal: { x: destination.x, y: destination.y }, road, contacts, delayGold, exposureGold, subgoal,
      ...(clearingAlternative ? { clearingAlternative } : {}) });
  if (!direct) return result('unreachable', null, []);
  const workerFoes = unit.kind === 'worker' ? options.workerFoes
    ?? armedFoes(snapshot, unit.owner, snapshot.teams ? { teams: snapshot.teams } : {}) : [];
  const contactOptions = { facts, ...(options.exemptMemberIds ? { exemptMemberIds: options.exemptMemberIds } : {}),
    movingMode: options.movingMode ?? 'move', arrivalMode: options.arrivalMode ?? 'idle', horizonTicks: 100 } as const;
  const contactsOn = (points: readonly Point[]) => {
    const contacts = [...neutralCampRouteContacts(snapshot, unit, points, contactOptions)];
    if (unit.kind === 'worker') for (const exposure of workerExposure(snapshot, unit, points, { facts, foes: workerFoes, allowDeparture: true })) {
      const camp = facts.camps.find(camp => camp.memberIds.includes(exposure.foe.id));
      if (!camp || camp.memberIds.some(id => options.exemptMemberIds?.has(id))) continue;
      contacts.push({ camp, memberId: exposure.foe.id, reason: 'worker-exposure', ...exposure, arrivalTicks: 0 });
    }
    return contacts;
  };
  const contacts = contactsOn(direct.points.length ? direct.points : [unit, goal])
    .sort((a, b) => a.segment - b.segment || a.arrivalTicks - b.arrivalTicks);
  const roleExposure = (points: readonly Point[]) => unit.kind === 'worker'
    ? workerExposure(snapshot, unit, points, { foes: workerFoes, allowDeparture: true }) : [];
  if (!contacts.length) {
    if (!roleExposure(direct.points).length) return result('direct', direct, contacts);
    const alternative = workerLandDetour(snapshot, unit, goal, workerFoes);
    return alternative ? result('detour', alternative, contacts, Math.max(0, alternative.ticks - direct.ticks) * delayValue(party, options.valueGoldPerTick))
      : result('exposed', direct, contacts, 0, UNIT_DEFS[unit.kind].cost);
  }
  const camps = [...new Set(contacts.map(contact => contact.camp))];
  const partyGold = party.reduce((sum, member) => sum + UNIT_DEFS[member.kind].cost, 0);
  const movingGold = UNIT_DEFS[unit.kind].cost;
  const atRisk = (camp: Camp) => {
    const force = creepForce(party, camp);
    return movingGold * Math.min(1, forceFor(camp) / Math.max(force, .01)) ** 2;
  };
  const exposureGold = Math.max(0, ...camps.map(camp => atRisk(camp.camp)));
  const contactRisk = (contact: CampContact) => {
    if (contact.reason !== 'active-pursuit') return atRisk(contact.camp.camp);
    const member = contact.camp.members.find(member => member.id === contact.memberId)!;
    const homeMargin = Math.max(0, member.pursuitRadius - Math.hypot(contact.point.x - member.home.x, contact.point.y - member.home.y)) / member.pursuitRadius;
    const responseMargin = Math.max(0, member.responseRadius - Math.hypot(contact.point.x - member.responseOrigin.x, contact.point.y - member.responseOrigin.y)) / member.responseRadius;
    const closing = Math.max(0, contact.radius - contact.distance) / Math.max(1, contact.radius);
    return atRisk(contact.camp.camp) * Math.min(homeMargin, responseMargin) * closing * (member.activeTargetId === unit.id ? 1 : .35);
  };
  const observedRisk = (encounters: readonly CampContact[]) => Math.max(0, ...encounters.map(contactRisk));
  // Saturated mine income prices the parent delay; committed troops also have an opportunity cost.
  const delayRate = delayValue(party, options.valueGoldPerTick);
  // A possible pursuit never creates a clearing prerequisite. If a later
  // certain trigger exists, clear that camp rather than the earlier forecast.
  const certain = contacts.filter(contact => contact.reason !== 'active-pursuit');
  const first = (certain.find(contact => options.blockingCamps?.has(contact.camp)) ?? certain[0] ?? contacts[0])!.camp;
  const blockedTargets = options.blockingCamps?.get(first);
  // Clearing is a rendezvous and a fight. Distant soldiers cannot contribute
  // instant damage merely because the parent command lists them.
  const combatants = party.filter(member => member.kind !== 'worker' && member.attackDamage > 0 && !isBacklineKind(member) && member.hp >= member.maxHp * .35);
  const home = snapshot.buildings.find(building => building.owner === unit.owner && building.kind === 'townHall') ?? unit;
  const approach = combatants.length ? bootstrapCampApproach(snapshot, home, [...combatants], first.camp,
    averagePoint(combatants), facts.camps.map(camp => camp.camp)) : undefined;
  const staging = approach?.staging;
  const clearTicks = staging ? campClearanceTicks(snapshot, combatants, first.camp, staging) : null;
  let subgoal: Subgoal = {
    id: `${options.parentId}/clear:${first.memberIds.join(',')}`, parentMethodId: options.parentId, kind: 'clear-camp',
    target: { point: first.camp.center }, demands: [{ kind: 'force', metric: 'camp-force', strength: forceFor(first.camp),
      roles: ['frontline', 'ranged'], at: { point: first.camp.center }, neededByTick: null, permanent: true }], dependsOn: [],
    estimatedTicks: clearTicks, status: clearTicks === null ? 'blocked' : 'proposed',
    reasons: [{ code: 'camp-exposure', detail: '父目标保留；实际行走路线或到岗索敌会触发未清营地，先比较绕行、换点与清营',
      evidence: [{ source: 'neutralCampRouteContacts', tick: snapshot.tick, certainty: 'recorded', detail: contacts.map(contact => contact.reason).join(',') }] }],
  };
  if (blockedTargets?.length) subgoal = { ...subgoal, reasons: [...subgoal.reasons, { code: 'objective-blocking-camp',
    detail: `清营是这些已承诺目标的前置：${blockedTargets.map(target => target.id).join(',')}`,
    evidence: [{ source: 'neutralCampObjectiveBlockers/workerExposure', tick: snapshot.tick, certainty: 'recorded',
      detail: blockedTargets.map(target => target.id).join(',') }] }] };
  const onward = nativeLandRoad(snapshot, { ...unit, x: first.camp.center.x, y: first.camp.center.y }, goal)?.ticks ?? direct.ticks;
  const clearCost = clearTicks === null ? 0 : Math.max(0, clearTicks + onward - direct.ticks) * delayRate;
  const clearingContacts = [...certain.filter(contact => contact.camp === first), ...contacts.filter(contact => contact.camp !== first)];
  if (certain.length) clearingAlternative = { contacts: clearingContacts, subgoal, delayGold: clearCost, exposureGold };
  // An assembled host already walking through this camp need not turn around
  // for a second assembly. Its native attack-move can supply the prerequisite
  // while retaining the march. Price the actual local force, not distant names.
  const considerSweep = options.movingMode === 'attackMove' && certain.length > 0 && certain.every(contact => contact.camp === first);
  const local: Unit[] = [];
  if (considerSweep) for (const member of combatants.filter(member => Math.hypot(member.x - unit.x, member.y - unit.y) <= CREEP_ASSEMBLED_RANGE)
    .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y))) {
    const road = nativeLandRoad(snapshot, member, unit);
    if (!road || road.ticks * member.speed / SIM_TICKS_PER_SECOND > CREEP_ASSEMBLED_RANGE) continue;
    local.push(member);
    if (campClearanceTicks(snapshot, local, first.camp) !== null) break;
  }
  const localDps = local.reduce((sum, member) => sum + member.attackDamage / Math.max(1, member.attackCooldown), 0);
  const fightTicks = Math.ceil(first.camp.creeps.reduce((sum, guard) => sum + guard.hp, 0) / Math.max(.01, localDps));
  const approachTicks = Math.ceil(Math.max(0, Math.hypot(first.camp.center.x - unit.x, first.camp.center.y - unit.y) - unit.attackRange)
    / Math.max(1, unit.speed) * SIM_TICKS_PER_SECOND);
  const sweepTicks = campClearanceTicks(snapshot, local, first.camp);
  const canSweep = considerSweep && sweepTicks !== null;
  const sweep = canSweep ? result('clear-on-route', direct, clearingContacts, Math.max(fightTicks, sweepTicks! - approachTicks) * delayRate,
    movingGold * Math.min(1, forceFor(first.camp) / Math.max(.01, creepForce(local, first.camp))) ** 2,
    { ...subgoal, estimatedTicks: sweepTicks!, status: 'active' }) : undefined;
  if (blockedTargets?.length && certain.some(contact => contact.camp === first))
    return sweep ?? result('clear-camp', direct, clearingContacts, clearCost, exposureGold, subgoal);
  const endpointTriggers = contactsOn([goal]).some(contact => contact.reason !== 'active-pursuit');
  // Transit exposure is a priced alternative. A worker's admission must also
  // agree with its evacuation veto; occupying an exposed post needs clearing.
  const needsClear = endpointTriggers || unit.kind === 'worker' && certain.length > 0;
  let best: CampTravelPlan = needsClear && exposureGold > 0
    ? result('clear-camp', direct, clearingContacts, clearCost, exposureGold, subgoal)
    : result('exposed', direct, contacts, 0, observedRisk(contacts));
  if (sweep) best = sweep;
  // Passing a camp can be cheaper than delaying a high-value objective. Occupying
  // its acquisition zone still needs a clearing prerequisite, not an unsafe post.

  const radius = options.arrivalRange ?? 0;
  const destinations = [goal, ...[radius / 2, radius].filter(value => value > 0).flatMap(r =>
    Array.from({ length: 8 }, (_, index) => ({ x: goal.x + detCos(index * Math.PI / 4) * r, y: goal.y + detSin(index * Math.PI / 4) * r })))];
  const blocking = (encounters: readonly CampContact[], end: Point) => encounters.some(contact => {
    if (contact.reason === 'active-pursuit') return false;
    const member = contact.camp.members.find(member => member.id === contact.memberId)!;
    const start = Math.hypot(unit.x - member.point.x, unit.y - member.point.y);
    // Native departure may already be exposed. A walk which only increases that
    // gap leaves the trigger zone; it does not enter a fresh one.
    return !(start <= contact.radius && contact.distance >= start - 2
      && Math.hypot(end.x - member.point.x, end.y - member.point.y) > start + 10);
  });
  const safeEnds = destinations.filter(point => point.x >= 0 && point.y >= 0 && point.x <= snapshot.map.width && point.y <= snapshot.map.height
    && isOpenGround(snapshot.map, point.x, point.y)
    && !contactsOn([point]).some(contact => contact.reason !== 'active-pursuit') && !roleExposure([point]).length)
    .sort((a, b) => neutralCampPointContacts(snapshot, unit, a, contactOptions).length - neutralCampPointContacts(snapshot, unit, b, contactOptions).length
      || Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y)).slice(0, 4);
  // Cold alert/current-position disks find a detour; pursuit remains a cost in the subsequent contact query.
  const disks = facts.camps.filter(camp => !camp.memberIds.some(id => options.exemptMemberIds?.has(id)))
    .flatMap(camp => camp.members.filter(member => !member.returning).map(member => {
      const guard = camp.camp.creeps.find(guard => guard.id === member.id)!;
      return { ...member.point, radius: Math.max(Math.max(member.alertRadius, unitAutoAcquireRadius(snapshot, unit, options.movingMode ?? 'move')) + unit.radius,
        unit.kind === 'worker' ? workerExposureRadius(snapshot, unit, guard) : 0) + 24 };
    }));
  for (const foe of workerFoes) if (foe.owner !== 'neutral') {
    const radius = workerExposureRadius(snapshot, unit, foe);
    if (radius > 0) disks.push({ x: foe.x, y: foe.y, radius: radius + 24 });
  }
  let router: ReturnType<typeof landDiskRouter> | undefined;
  for (const point of safeEnds) {
    let candidate = nativeLandRoad(snapshot, unit, point);
    if (!candidate) continue;
    let encounters = contactsOn(candidate.points.length ? candidate.points : [unit, point]);
    if (blocking(encounters, point) || roleExposure(candidate.points).length) {
      const detour = (router ??= landDiskRouter(snapshot, unit, disks))(point);
      if (!detour) continue;
      // Check every queued leg against native steering, not just field cells or the straight chord.
      const legs = detour.points.slice(1).map((end, index) => nativeLandRoad(snapshot,
        { ...unit, ...detour.points[index]! }, end));
      if (legs.some(leg => !leg)) continue;
      candidate = { points: [unit, ...legs.flatMap(leg => leg!.points.slice(1))], ticks: legs.reduce((sum, leg) => sum + leg!.ticks, 0) };
      encounters = contactsOn(candidate.points.length ? candidate.points : [unit, point]);
      if (blocking(encounters, point) || roleExposure(candidate.points).length) continue;
    }
    const risk = observedRisk(encounters);
    const delayGold = Math.max(0, candidate.ticks - direct.ticks) * delayRate;
    const bestCost = best.subgoal?.estimatedTicks === null ? Infinity : best.delayGold + best.exposureGold;
    if (delayGold + risk < bestCost) best = result(point === goal ? 'detour' : 'relocate', candidate, encounters, delayGold, risk, null, point);
  }
  // A moving parent's waypoint can cease to exist before a clearing party
  // assembles. When no clearing ETA is funded, make safe progress along the
  // actual road first; only an exhausted approach needs the prerequisite.
  if (options.waypoint && !blockedTargets?.length && best.kind === 'clear-camp' && best.subgoal?.estimatedTicks === null) {
    const prefix: Point[] = [{ x: unit.x, y: unit.y }];
    const clear = (points: Point[]) => !contactsOn(points).some(contact => contact.reason !== 'active-pursuit');
    if (clear(prefix)) for (const end of direct.points.slice(1)) {
      const start = prefix.at(-1)!;
      if (clear([...prefix, end])) { prefix.push(end); continue; }
      let low = 0, high = 1;
      for (let step = 0; step < 8; step++) {
        const middle = (low + high) / 2, point = { x: start.x + (end.x - start.x) * middle, y: start.y + (end.y - start.y) * middle };
        if (clear([...prefix, point])) low = middle; else high = middle;
      }
      const fraction = Math.max(0, low - 32 / Math.max(1, Math.hypot(end.x - start.x, end.y - start.y)));
      if (fraction > 0) prefix.push({ x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction });
      break;
    }
    if (prefix.length > 1 && Math.hypot(prefix.at(-1)!.x - unit.x, prefix.at(-1)!.y - unit.y) > 60) {
      const legs = prefix.slice(1).map((end, index) => nativeLandRoad(snapshot, { ...unit, ...prefix[index]! }, end));
      if (legs.every(leg => leg)) {
        const road: Road = { points: [unit, ...legs.flatMap(leg => leg!.points.slice(1))], ticks: legs.reduce((sum, leg) => sum + leg!.ticks, 0) };
        if (clear(road.points)) return result('approach', road, contactsOn(road.points), 0, 0, null, road.points.at(-1)!);
      }
    }
  }
  return best;
}
