import { unitAutoAcquireRadius } from '../../shared/combat-acquisition';
import { UNIT_DEFS } from '../../shared/catalog';
import { detCos, detSin } from '../../shared/det-math';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { isOpenGround } from '../../shared/terrain';
import type { GameSnapshot, Unit } from '../../shared/types';
import { nativeLandRoad } from '../policy/land-road';
import { creepForce, forceFor, type Camp } from '../policy/v7/creep';
import { neutralCampExposure, type NeutralCampExposureFacts } from '../situation/neutral-camp-exposure';
import { neutralCampPointContacts, neutralCampRouteContacts, type CampContact } from '../situation/neutral-camp-contact';
import type { Subgoal } from '../strategy/types';
import { landDiskRouter } from './threat-roads';

type Point = { x: number; y: number };
type Road = NonNullable<ReturnType<typeof nativeLandRoad>>;
export type CampTravelPlan = {
  kind: 'direct' | 'exposed' | 'detour' | 'relocate' | 'clear-camp' | 'unreachable';
  goal: Point; road: Road | null; contacts: readonly CampContact[];
  delayGold: number; exposureGold: number; subgoal: Subgoal | null;
};
export type CampTravelOptions = {
  parentId: string; party?: readonly Unit[]; facts?: NeutralCampExposureFacts; exemptMemberIds?: ReadonlySet<string>;
  arrivalRange?: number; movingMode?: 'move' | 'attackMove'; arrivalMode?: 'idle' | 'hold' | 'attackMove' | 'move';
  /** Opportunity value of delaying the parent objective, not a fixed detour distance cap. */
  valueGoldPerTick?: number;
};

/** A route and an arrival point compete against clearing their blocker. No camp
 * creates an unconditional forbidden zone. A failed detour produces a retained
 * clear-camp prerequisite, with the actual force demand rather than silence.
 */
export function planCampTravel(snapshot: GameSnapshot, unit: Unit, goal: Point, options: CampTravelOptions): CampTravelPlan {
  goal = { x: goal.x, y: goal.y };
  const facts = options.facts ?? neutralCampExposure(snapshot), party = options.party ?? [unit];
  const direct = nativeLandRoad(snapshot, unit, goal);
  const result = (kind: CampTravelPlan['kind'], road: Road | null, contacts: readonly CampContact[], delayGold = 0, exposureGold = 0,
    subgoal: Subgoal | null = null, destination = goal): CampTravelPlan => ({ kind, goal: { x: destination.x, y: destination.y }, road, contacts, delayGold, exposureGold, subgoal });
  if (!direct) return result('unreachable', null, []);
  const contactOptions = { facts, ...(options.exemptMemberIds ? { exemptMemberIds: options.exemptMemberIds } : {}),
    movingMode: options.movingMode ?? 'move', arrivalMode: options.arrivalMode ?? 'idle', horizonTicks: 100 } as const;
  const contacts = neutralCampRouteContacts(snapshot, unit, direct.points.length ? direct.points : [unit, goal], contactOptions);
  if (!contacts.length) return result('direct', direct, contacts);
  const camps = [...new Set(contacts.map(contact => contact.camp))];
  const partyGold = party.reduce((sum, member) => sum + UNIT_DEFS[member.kind].cost, 0);
  const atRisk = (camp: Camp) => {
    const force = creepForce(party, camp);
    return partyGold * Math.min(1, forceFor(camp) / Math.max(force, .01)) ** 2;
  };
  const exposureGold = Math.max(0, ...camps.map(camp => atRisk(camp.camp)));
  // Saturated mine income prices the parent delay; committed troops also have an opportunity cost.
  const delayRate = options.valueGoldPerTick ?? GOLD_MINE_RULES.goldPerTrip / GOLD_MINE_RULES.entrySeconds / SIM_TICKS_PER_SECOND
    + partyGold / (60 * SIM_TICKS_PER_SECOND);
  const first = [...contacts].sort((a, b) => a.segment - b.segment || a.arrivalTicks - b.arrivalTicks)[0]!.camp;
  const clearingForce = creepForce(party, first.camp);
  const dps = party.filter(member => member.kind !== 'worker').reduce((sum, member) => sum + member.attackDamage / Math.max(1, member.attackCooldown), 0);
  const clearTicks = clearingForce >= forceFor(first.camp)
    ? Math.ceil(first.camp.creeps.reduce((sum, guard) => sum + guard.hp, 0) / Math.max(.01, dps)) : null;
  const subgoal: Subgoal = {
    id: `${options.parentId}/clear:${first.memberIds.join(',')}`, parentMethodId: options.parentId, kind: 'clear-camp',
    target: { point: first.camp.center }, demands: [{ kind: 'force', metric: 'camp-force', strength: forceFor(first.camp),
      roles: ['frontline', 'ranged'], at: { point: first.camp.center }, neededByTick: null, permanent: true }], dependsOn: [],
    estimatedTicks: clearTicks, status: clearTicks === null ? 'blocked' : 'proposed',
    reasons: [{ code: 'camp-exposure', detail: '父目标保留；实际行走路线或到岗索敌会触发未清营地，先比较绕行、换点与清营',
      evidence: [{ source: 'neutralCampRouteContacts', tick: snapshot.tick, certainty: 'recorded', detail: contacts.map(contact => contact.reason).join(',') }] }],
  };
  const clearCost = (clearTicks ?? 15 * SIM_TICKS_PER_SECOND) * delayRate;
  let best: CampTravelPlan = neutralCampPointContacts(snapshot, unit, goal, contactOptions).length
    ? result('clear-camp', direct, contacts, clearCost, exposureGold, subgoal)
    : result('exposed', direct, contacts, 0, exposureGold);
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
    && !neutralCampPointContacts(snapshot, unit, point, contactOptions).some(contact => contact.reason !== 'active-pursuit'))
    .sort((a, b) => neutralCampPointContacts(snapshot, unit, a, contactOptions).length - neutralCampPointContacts(snapshot, unit, b, contactOptions).length
      || Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y)).slice(0, 4);
  // Cold alert/current-position disks find a detour; pursuit remains a cost in the subsequent contact query.
  const disks = facts.camps.filter(camp => !camp.memberIds.some(id => options.exemptMemberIds?.has(id)))
    .flatMap(camp => camp.members.filter(member => !member.returning).map(member => ({ ...member.point, radius: Math.max(member.alertRadius, unitAutoAcquireRadius(snapshot, unit, options.movingMode ?? 'move')) + unit.radius + 24 })));
  let router: ReturnType<typeof landDiskRouter> | undefined;
  for (const point of safeEnds) {
    let candidate = nativeLandRoad(snapshot, unit, point);
    if (!candidate) continue;
    let encounters = neutralCampRouteContacts(snapshot, unit, candidate.points.length ? candidate.points : [unit, point], contactOptions);
    if (blocking(encounters, point)) {
      const detour = (router ??= landDiskRouter(snapshot, unit, disks))(point);
      if (!detour) continue;
      // Check every queued leg against native steering, not just field cells or the straight chord.
      const legs = detour.points.slice(1).map((end, index) => nativeLandRoad(snapshot,
        { ...unit, ...detour.points[index]! }, end));
      if (legs.some(leg => !leg)) continue;
      candidate = { points: [unit, ...legs.flatMap(leg => leg!.points.slice(1))], ticks: legs.reduce((sum, leg) => sum + leg!.ticks, 0) };
      encounters = neutralCampRouteContacts(snapshot, unit, candidate.points.length ? candidate.points : [unit, point], contactOptions);
      if (blocking(encounters, point)) continue;
    }
    const risk = encounters.length ? Math.max(...encounters.map(contact => atRisk(contact.camp.camp))) * .25 : 0;
    const delayGold = Math.max(0, candidate.ticks - direct.ticks) * delayRate;
    if (delayGold + risk < best.delayGold + best.exposureGold) best = result(point === goal ? 'detour' : 'relocate', candidate, encounters, delayGold, risk, null, point);
  }
  return best;
}
