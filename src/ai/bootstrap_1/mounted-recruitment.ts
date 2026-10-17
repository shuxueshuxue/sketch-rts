import { createUnit } from '../../shared/map';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { landSpawnPoint } from '../../shared/production-spawn';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isOpponentOwner } from '../policy/ownership';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import type { V6Want } from '../policy/v6/doctrine';
import { neutralCamps } from '../policy/v7/creep';
import { nextMountedCamp, nextMountedRaid } from './mounted-tasks';
import { mountedThreatReach } from './mounted-micro';
import { mountedFieldTargets } from './mounted-field';
import { armedFoes, retreatLandTravelTicks } from './safe-land-route';

/** Fund one independent scout when its real factory exit can serve an admitted sortie. */
export function mountedRecruitment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): V6Want[] {
  if (snapshot.players[owner]!.race !== 'grove' || activeMiningBaseCount(snapshot, owner) < 2) return [];
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.expiresTick === undefined);
  if (own.filter(unit => unit.kind !== 'worker' && !unit.deck).length < 6) return [];
  if (own.some(unit => unit.kind === 'horseArcher')) return [
    { upgrade: 'rangeTraining', level: 1, priority: 58 }, { upgrade: 'speedTraining', level: 1, priority: 57 },
  ];
  if (snapshot.buildings.some(building => building.owner === owner && building.queue.some(job => job.unitKind === 'horseArcher'))) return [];
  const camps = neutralCamps(snapshot);
  const occupied = new Set(options.memory.mounted?.flatMap(task => task.objective.kind === 'camp' ? task.objective.ids : []));
  const foes = armedFoes(snapshot, owner, options);
  const towers = foes.filter((foe): foe is Building => !('order' in foe) && foe.complete
    && isOpponentOwner(snapshot, owner, foe.owner, options));
  const defenders = foes.filter((foe): foe is Unit => 'order' in foe && !foe.deck
    && isOpponentOwner(snapshot, owner, foe.owner, options));
  for (const producer of snapshot.buildings.filter(building => building.owner === owner && building.complete && building.kind === 'stables')) {
    // Native unupgraded recruit stats and the actual factory exit form a conservative task estimate.
    const probe = createUnit('mounted-recruitment-probe', owner, 'horseArcher', producer.x, producer.y);
    const spawn = landSpawnPoint(snapshot, producer, probe);
    if (!spawn) continue;
    Object.assign(probe, spawn);
    if (nextMountedRaid(snapshot, owner, probe, towers, defenders, options)) return [{ unit: 'horseArcher', count: 1, priority: 59 }];
    for (const target of mountedFieldTargets(snapshot, owner, probe, new Set(), options)) if (target.speed < probe.speed
      && mountedThreatReach(snapshot, target, probe, probe.attackCooldown) < probe.attackRange) {
      return [{ unit: 'horseArcher', count: 1, priority: 59 }];
    }
    const camp = nextMountedCamp(snapshot, probe, camps, occupied);
    if (!camp || options.memory.v6?.creep && distance(options.memory.v6.creep.center, camp.center) <= options.memory.v6.creep.reach) continue;
    if (!snapshot.resources.some(mine => mine.amount > 0 && distance(mine, camp.center) <= GOLD_MINE_RULES.baseRange
      && !mineClaimedByAlly(snapshot, owner, mine, options))) continue;
    const clearTicks = camp.creeps.reduce((ticks, creep) => ticks + creep.hp * probe.attackCooldown / probe.attackDamage, 0);
    const ids = new Set(camp.creeps.map(creep => creep.id));
    if (camp.creeps.every(creep => creep.speed < probe.speed && mountedThreatReach(snapshot, creep, probe, clearTicks) < probe.attackRange)
      && retreatLandTravelTicks(snapshot, probe, camp.center, foes.filter(foe => !ids.has(foe.id))) !== undefined) {
      return [{ unit: 'horseArcher', count: 1, priority: 59 }];
    }
  }
  return [];
}
