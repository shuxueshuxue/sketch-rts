import { UNIT_DEFS } from '../../shared/catalog';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { sameGround, walkingDistance } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { resolveAiCommandIntent } from '../policy/commands';
import { averagePoint, distance } from '../policy/spatial';
import { isBacklineKind } from '../policy/v6/backline';
import { readV6Intel, type V6Intel, type V6Intrusion } from '../policy/v6/intel';
import { planV6Army } from '../policy/v6/general';
import { planV6CloseoutArmy } from '../policy/v6/closeout';
import { strengthOf, TOWER_STRENGTH } from '../policy/v6/strength';
import { planV8Charge } from '../policy/v8/charge';
import type { AiPolicyContext, AiScript } from '../policy/types';

type Detachment = { hall: Building; attackers: Unit[]; crew: Unit[] };

function miningRaids(snapshot: GameSnapshot, intel: V6Intel) {
  const foes = intel.enemies.flatMap(enemy => enemy.army);
  const aimedAt = (unit: Unit, hall: Building) => unit.order.type === 'attack' && unit.order.targetId === hall.id
    || unit.order.type === 'attackMove' && distance(unit.order, hall) <= hall.radius + 80;
  return intel.ownHalls.map(hall => ({ hall,
    attackers: foes.filter(unit => sameGround(snapshot.map, unit, hall)
      && (distance(unit, hall) < 650 || aimedAt(unit, hall) && distance(unit, hall) < 1800
        || intel.intrusion !== undefined && distance(intel.intrusion.building, hall) <= GOLD_MINE_RULES.baseRange
          && intel.intrusion.attackers.includes(unit))),
  })).filter(raid => raid.attackers.length > 0)
    .sort((a, b) => Number(b.attackers.some(unit => aimedAt(unit, b.hall))) - Number(a.attackers.some(unit => aimedAt(unit, a.hall)))
      || strengthOf(b.attackers) - strengthOf(a.attackers));
}

/** A mine raid beyond its local defense takes priority over an outpost's battle. */
export function uncoveredMiningRaid(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): V6Intrusion | undefined {
  const intel = readV6Intel(snapshot, owner, options), guard = detachment(snapshot, owner, options);
  return uncoveredRaid(snapshot, intel, guard);
}

function uncoveredRaid(snapshot: GameSnapshot, intel: V6Intel, guard: Detachment | undefined): V6Intrusion | undefined {
  for (const { hall, attackers } of miningRaids(snapshot, intel)) {
    if (!snapshot.resources.some(mine => mine.amount > 0 && distance(mine, hall) <= GOLD_MINE_RULES.baseRange)
      || guard && attackers.every(unit => guard.attackers.includes(unit))) continue;
    const cover = intel.ownTowers.filter(tower => distance(tower, hall) <= tower.attackRange)
      .reduce((power, tower) => power + TOWER_STRENGTH * tower.hp / tower.maxHp, 0);
    const threat = strengthOf(attackers);
    if (threat > cover) return { building: hall, attackers, threat };
  }
  return undefined;
}

function detachment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Detachment | undefined {
  const intel = readV6Intel(snapshot, owner, options);
  const raids = miningRaids(snapshot, intel);
  const pool = intel.army.filter(unit => !unit.deck && unit.hp >= unit.maxHp * .6
    && !['board', 'cast', 'charge'].includes(unit.order.type));
  for (const { hall, attackers } of raids) {
    const nearby = pool.filter(unit => sameGround(snapshot.map, unit, hall) && distance(unit, hall) < 1300
      && (unit.expiresTick === undefined || unit.expiresTick > snapshot.tick + SIM_TICKS_PER_SECOND * walkingDistance(snapshot.map, unit, hall)! / unit.speed))
      .sort((a, b) => distance(a, hall) - distance(b, hall));
    const fighters = nearby.filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
    const crew = fighters.filter(unit => unit.attackRange <= 80).slice(0, 2);
    if (attackers.some(unit => unit.expiresTick !== undefined)) {
      const dispeller = nearby.find(unit => UNIT_DEFS[unit.kind].abilities.includes('curse'));
      if (dispeller) crew.push(dispeller);
    }
    const cover = intel.ownTowers.filter(tower => attackers.some(unit => distance(tower, unit) <= tower.attackRange))
      .reduce((power, tower) => power + TOWER_STRENGTH * tower.hp / tower.maxHp, 0);
    for (const fighter of fighters) {
      if (crew.length >= 3 && strengthOf(crew) + cover >= strengthOf(attackers) * 1.25) break;
      if (!crew.includes(fighter)) crew.push(fighter);
    }
    // A detachment must cover its raid and leave a larger army for the other front.
    if (crew.length < 3 || strengthOf(crew) + cover < strengthOf(attackers) * 1.25
      || strengthOf(crew) > intel.power * .55) continue;
    return { hall, attackers, crew };
  }
}

export const mineDefense: AiScript = {
  id: 'mineDefense', phase: 'tactics',
  claimsUnits: mineGuardUnitIds,
  run(snapshot, owner, options): GameCommand[] {
    const guard = detachment(snapshot, owner, options);
    if (!guard) return [];
    const crewIds = new Set(guard.crew.map(unit => unit.id));
    const charges = planV8Charge(snapshot, owner, options).filter(command => command.type === 'cast' && crewIds.has(command.unitId));
    const charging = new Set(charges.flatMap(command => command.type === 'cast' ? [command.unitId] : []));
    const threat = averagePoint(guard.attackers), gap = distance(threat, guard.hall);
    const post = { x: guard.hall.x + (threat.x - guard.hall.x) * Math.min(1, 200 / gap),
      y: guard.hall.y + (threat.y - guard.hall.y) * Math.min(1, 200 / gap) };
    const moving = guard.crew.filter(unit => {
      if (charging.has(unit.id)) return false;
      const order = unit.order;
      if (order.type === 'attackMove' && distance(order, post) < 80) return false;
      if (order.type === 'idle' && distance(unit, post) < 80) return false;
      if (order.type === 'attack' && snapshot.units.some(target => target.id === order.targetId && distance(target, post) < 450)) return false;
      return true;
    });
    return [...charges, ...(moving.length ? [resolveAiCommandIntent(snapshot, owner,
      { type: 'attackMove', unitIds: moving.map(unit => unit.id), ...post }, options)] : [])];
  },
};

export function mineGuardUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return new Set(detachment(snapshot, owner, options)?.crew.map(unit => unit.id));
}

export function planBootstrapGeneral(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  return planV6Army(snapshot, owner, options, mainArmyIntel(snapshot, owner, options));
}

export function planBootstrapCloseout(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  return planV6CloseoutArmy(snapshot, owner, options, mainArmyIntel(snapshot, owner, options));
}

function mainArmyIntel(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): V6Intel {
  const intel = readV6Intel(snapshot, owner, options), guard = detachment(snapshot, owner, options);
  const crew = new Set(guard?.crew.map(unit => unit.id));
  const army = intel.army.filter(unit => !crew.has(unit.id));
  const covered = guard && intel.intrusion && distance(intel.intrusion.building, guard.hall) < 600
    && intel.intrusion.attackers.every(unit => guard.attackers.includes(unit));
  const { armyCenter, intrusion, ...world } = intel;
  const main: V6Intel = { ...world, army, power: strengthOf(army) };
  if (army.length) main.armyCenter = averagePoint(army);
  const raid = uncoveredRaid(snapshot, intel, guard);
  if (raid) main.intrusion = raid;
  else if (intrusion && !covered) main.intrusion = intrusion;
  return main;
}
