import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { sameGround, walkRoute } from '../../shared/terrain';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { legalBuildPointNear } from '../policy/build-layout';
import { isOpponentOwner } from '../policy/ownership';
import { averagePoint, distance, type Point } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import type { rankV6Goals } from '../policy/v6/economy';
import { combatRating, TOWER_STRENGTH } from '../policy/v6/strength';
import { planAbilityCommands } from '../policy/spell-tactics';

const JOB = 'summonerTowerRush';
const HELPER = 'summonerTowerRushHelper';
const SCREEN = 110;

type Rush = {
  hall: Building;
  army: Unit[];
  casters: Unit[];
  site: Point;
  advance: Point;
  builders: Unit[];
  rising: Building | undefined;
  pending: boolean;
  press: boolean;
};

const combatPower = (units: readonly Unit[]) => units.reduce((total, unit) => total + combatRating(unit), 0);

function endRush(options: AiPolicyContext) {
  options.memory.jobs = options.memory.jobs.filter(job => job.id !== JOB && job.id !== HELPER);
}

/** Keep each mine's five workers; the construction convoy uses the remainder. */
function buildersFor(snapshot: GameSnapshot, owner: PlayerId, point: { x: number; y: number }) {
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck);
  const miners = new Map<string, number>();
  for (const worker of workers) if (worker.order.type === 'mine') miners.set(worker.order.resourceId, (miners.get(worker.order.resourceId) ?? 0) + 1);
  return workers.filter(worker => sameGround(snapshot.map, worker, point) && ['idle', 'mine'].includes(worker.order.type))
    .sort((a, b) => distance(a, point) - distance(b, point))
    .filter(worker => {
      if (worker.order.type !== 'mine') return true;
      const count = miners.get(worker.order.resourceId)!;
      if (count <= GOLD_MINE_RULES.workstations) return false;
      miners.set(worker.order.resourceId, count - 1);
      return true;
    });
}

function rush(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Rush | undefined {
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unitMover(unit.kind) === 'land'
    && !unit.deck && unit.order.type !== 'board');
  const casters = own.filter(unit => UNIT_DEFS[unit.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'summon'));
  const job = options.memory.jobs.find(job => job.id === JOB);
  if (casters.length < 4) { endRush(options); return undefined; }
  const enemyHalls = snapshot.buildings.filter(building => building.kind === 'townHall' && isOpponentOwner(snapshot, owner, building.owner, options));
  const current = enemyHalls.find(hall => job?.kind === hall.id);
  const anchor = [...casters].sort((a, b) => current ? distance(a, current) - distance(b, current)
    : casters.filter(caster => distance(caster, b) <= 350).length - casters.filter(caster => distance(caster, a) <= 350).length)[0]!;
  const host = casters.filter(caster => distance(caster, anchor) <= 350);
  if (host.length < 4) { endRush(options); return undefined; }
  // Fresh recruits travel to the host; they must not pull its center back to the production buildings.
  const center = averagePoint(host);
  const foes = snapshot.units.filter(unit => unit.kind !== 'worker' && isOpponentOwner(snapshot, owner, unit.owner, options));
  const halls = enemyHalls.filter(building => sameGround(snapshot.map, center, building) && distance(center, building) <= 1600);
  const target = halls.find(hall => job?.kind === hall.id) ?? [...halls].sort((a, b) => distance(center, a) - distance(center, b))[0];
  if (!target) { endRush(options); return undefined; }
  const army = own.filter(unit => distance(unit, center) <= 800);
  const opposition = combatPower(foes.filter(unit => distance(unit, center) <= 1100 || distance(unit, target) <= 1100))
    + snapshot.buildings.filter(building => building.complete && building.attackDamage > 0
      && isOpponentOwner(snapshot, owner, building.owner, options) && distance(building, target) <= 800).length * TOWER_STRENGTH;
  const power = combatPower(army);
  const screen = army.filter(unit => unit.kind === 'spirit' && distance(unit, center) <= 500);
  const press = screen.length > 0 && power + TOWER_STRENGTH >= opposition * (job?.kind === target.id ? .85 : 1.1);
  if (!job && screen.length === 0) return undefined;
  // The traveling host holds its tower between waves; home recruits are not its front line.
  const front = screen.length > 0 ? averagePoint(screen) : center;
  const gap = distance(front, target);
  const point = { x: front.x + (center.x - front.x) * SCREEN / Math.max(SCREEN, distance(center, front)),
    y: front.y + (center.y - front.y) * SCREEN / Math.max(SCREEN, distance(center, front)) };
  const site = legalBuildPointNear(snapshot, 'defenseTower', point);
  const builders = buildersFor(snapshot, owner, site);
  const rising = snapshot.buildings.find(building => building.owner === owner && building.kind === 'defenseTower' && !building.complete
    && distance(building, center) <= BUILDING_DEFS.defenseTower.attackRange);
  const pending = snapshot.units.find(unit => unit.owner === owner && unit.order.type === 'build'
    && unit.order.buildingKind === 'defenseTower' && distance(unit.order, center) <= BUILDING_DEFS.defenseTower.attackRange);
  const tower = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'defenseTower'
    && building.complete && distance(building, center) <= building.attackRange)
    .sort((a, b) => distance(a, target) - distance(b, target))[0];
  if (!press && (!job || (!tower && !rising && !pending))) { endRush(options); return undefined; }
  const support = !press && tower ? tower : rising ?? (pending?.order.type === 'build' ? pending.order : tower);
  // The front waits for its builder. A completed tower then covers the next short advance.
  const reach = support === tower && tower ? tower.attackRange * (press ? .6 : .2) : SCREEN;
  const supportGap = support ? distance(support, target) : 0;
  const step = Math.min(reach, supportGap - SCREEN);
  const advance = support ? { x: support.x + (target.x - support.x) * step / supportGap,
    y: support.y + (target.y - support.y) * step / supportGap } : front;
  if (!job && builders.length === 0) return undefined;
  const route = walkRoute(snapshot.map, center, target, 18);
  if (!route || snapshot.units.some(unit => unit.owner === 'neutral' && route.some(point => distance(point, unit) < 300))) {
    endRush(options); return undefined;
  }
  if (gap < SCREEN) { endRush(options); return undefined; }
  if (job) { job.kind = target.id; job.updatedTick = snapshot.tick; }
  else options.memory.jobs.push({ id: JOB, kind: target.id, createdTick: snapshot.tick, updatedTick: snapshot.tick });
  const helperJob = options.memory.jobs.find(job => job.id === HELPER);
  const helper = snapshot.units.find(unit => unit.id === helperJob?.kind && unit.owner === owner && unit.kind === 'worker'
    && !unit.deck && ['idle', 'move', 'repair'].includes(unit.order.type));
  if (helper) builders.unshift(helper);
  if (rising || pending) {
    if (helperJob && builders[0]) { helperJob.kind = builders[0].id; helperJob.updatedTick = snapshot.tick; }
    else if (builders[0]) options.memory.jobs.push({ id: HELPER, kind: builders[0].id, createdTick: snapshot.tick, updatedTick: snapshot.tick });
  } else options.memory.jobs = options.memory.jobs.filter(job => job.id !== HELPER);
  return { hall: target, army, casters, site, advance, builders, rising, pending: pending !== undefined, press };
}

export const summonerTowerRush: AiScript = {
  id: JOB, phase: 'tactics',
  claimsUnits(snapshot, owner, options) {
    const plan = rush(snapshot, owner, options);
    return new Set(plan ? [...plan.casters.map(unit => unit.id), ...plan.army.filter(unit => !UNIT_DEFS[unit.kind].weapon).map(unit => unit.id),
      ...(plan.rising || plan.pending ? plan.builders.slice(0, 1).map(worker => worker.id) : [])] : []);
  },
  run(snapshot, owner, options) {
    const plan = rush(snapshot, owner, options);
    if (!plan) return [];
    const commands: GameCommand[] = [];
    const gap = distance(plan.advance, plan.hall);
    const post = { x: plan.advance.x + (plan.advance.x - plan.hall.x) * SCREEN / gap,
      y: plan.advance.y + (plan.advance.y - plan.hall.y) * SCREEN / gap };
    for (const caster of plan.casters) if (distance(caster, post) > 70) commands.push({ type: 'move', unitIds: [caster.id], ...post });
    for (const soldier of plan.army.filter(unit => !plan.casters.includes(unit) && !UNIT_DEFS[unit.kind].weapon)) {
      if (soldier.order.type !== 'attackMove' || distance(soldier.order, plan.advance) > 70) {
        commands.push({ type: 'attackMove', unitIds: [soldier.id], ...plan.advance });
      }
    }
    if (plan.rising && plan.builders[0]) commands.push({ type: 'repair', unitIds: [plan.builders[0].id], buildingId: plan.rising.id });
    else if (plan.pending && plan.builders[0]) commands.push({ type: 'move', unitIds: [plan.builders[0].id], ...post });
    return commands;
  },
};

export function towerRushEngaged(options: AiPolicyContext) {
  return options.memory.jobs.some(job => job.id === JOB);
}

/** This host advances behind towers rather than waiting for the general's separate assault pulse. */
export const towerRushAbilities: AiScript = {
  id: 'abilities', phase: 'tactics',
  run(snapshot, owner, options) {
    const general = options.memory.v6?.general;
    return planAbilityCommands(snapshot, owner, towerRushEngaged(options) && general?.stage === 'gather'
      ? { ...options, memory: { ...options.memory, v6: { ...options.memory.v6, general: { ...general, stage: 'strike' } } } }
      : options);
  },
};

export function towerRushConstructionCrew(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const plan = towerRushEngaged(options) ? rush(snapshot, owner, options) : undefined;
  return plan && (plan.pending || plan.rising) ? 2 : 1;
}

/** A normal priced construction goal shares the candidate's single purchase budget. */
export function towerRushGoal(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReturnType<typeof rankV6Goals>[number] | undefined {
  const plan = rush(snapshot, owner, options);
  if (!plan || !plan.press || plan.rising || plan.builders.length === 0
    || snapshot.units.some(unit => unit.owner === owner && unit.order.type === 'build')
    || snapshot.buildings.some(building => building.owner === owner && building.kind === 'defenseTower' && distance(building, plan.site) < 220)
    || !isBuildPlacementClear(snapshot, 'defenseTower', plan.site)) return undefined;
  return { id: JOB, priority: 86, cost: BUILDING_DEFS.defenseTower.cost, save: true,
    issue: builders => {
      if (builders.size > 0) return undefined;
      builders.add(plan.builders[0]!.id);
      return { type: 'build', unitId: plan.builders[0]!.id, buildingKind: 'defenseTower', ...plan.site };
    } };
}
