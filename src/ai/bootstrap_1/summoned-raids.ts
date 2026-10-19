import { strikeGap, strikeReach } from '../../shared/combat-geometry';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { resolveUnitDamage, unitAttackDamageProfile } from '../../shared/damage';
import { routeArrivals } from '../../shared/route-selection';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { isOpponentOwner } from '../policy/ownership';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { readV6Intel } from '../policy/v6/intel';
import { SUMMONING_UNIT_KINDS } from '../policy/versions';
import { retreatLandRoad } from './safe-land-route';

/** Spend an idle spirit's remaining life on exposed income without marching its permanent host. */
export function summonedMiningRaids(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  if (options.memory.v6?.general?.mode !== 'hold' || options.memory.v6.creep
    || readV6Intel(snapshot, owner, options).intrusion) return [];
  const casters = snapshot.units.filter(unit => unit.owner === owner && SUMMONING_UNIT_KINDS.has(unit.kind) && !unit.deck);
  const attackers = snapshot.units.filter(unit => unit.kind !== 'worker' && unit.attackDamage > 0
    && isOpponentOwner(snapshot, owner, unit.owner, options));
  if (casters.some(caster => attackers.some(foe => strikeGap(foe, caster) <= strikeReach(foe, caster))
    || routeArrivals(snapshot.map, attackers, caster, 'land').some(({ ticks }) => ticks <= abilityCooldown(caster, 'summon')))) return [];
  const workers = snapshot.units.filter(unit => unit.kind === 'worker' && !unit.deck
    && isOpponentOwner(snapshot, owner, unit.owner, options) && ['mine', 'idle'].includes(unit.order.type));
  const towers = snapshot.buildings.filter(building => building.complete && building.attackDamage > 0
    && isOpponentOwner(snapshot, owner, building.owner, options));
  const coverage = [...towers, ...snapshot.units.filter(unit => unit.owner === 'neutral' && unit.attackDamage > 0)];
  const raids = [];
  for (const spirit of snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'spirit'
    && unit.expiresTick !== undefined && !unit.deck && unit.order.type !== 'board')) {
    const target = workers.flatMap(worker => {
      const road = retreatLandRoad(snapshot, spirit, worker, coverage);
      const damage = resolveUnitDamage(snapshot, worker, spirit.attackDamage, unitAttackDamageProfile(snapshot, spirit)).damage;
      if (!road || damage === 0 || snapshot.tick + road.ticks
        + Math.ceil(worker.hp / damage) * spirit.attackCooldown >= spirit.expiresTick!) return [];
      if (strikeGap({ ...spirit, ...road.points[road.points.length - 1]! }, worker) > strikeReach(spirit, worker)) return [];
      return [{ worker, travel: road.ticks }];
    }).sort((a, b) => a.travel - b.travel)[0];
    if (target && towers.every(tower => strikeGap(tower, target.worker) > tower.attackRange + spirit.radius))
      raids.push({ spirit, worker: target.worker });
  }
  return raids;
}

export const summonedRaids: AiScript = {
  id: 'summonedRaids', phase: 'tactics', redirects: 'strategic',
  claimsUnits: (snapshot, owner, options) => new Set(summonedMiningRaids(snapshot, owner, options).map(raid => raid.spirit.id)),
  run: (snapshot, owner, options) => summonedMiningRaids(snapshot, owner, options).flatMap(({ spirit, worker }) =>
    spirit.order.type === 'attack' && spirit.order.targetId === worker.id ? []
      : [{ type: 'attack' as const, unitIds: [spirit.id], targetId: worker.id }]),
};
