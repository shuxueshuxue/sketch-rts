import { BUILDING_DEFS, healingBuildingKindForRace, isHealingBuildingKind } from '../../shared/catalog';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { routeArrivals } from '../../shared/route-selection';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import { legalBuildPointNear } from '../policy/build-layout';
import { averagePoint, distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { recoveryPatients } from './medical-recovery';
import { mountedThreatReach } from './mounted-micro';

/** A settled island needs reachable care; mainland and deck medics cannot heal it by walking. */
export function colonyRecoveryGoals(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const own = snapshot.buildings.filter(building => building.owner === owner);
  const halls = own.filter(building => building.kind === 'townHall' && building.complete);
  const home = halls[0];
  const patients = recoveryPatients(snapshot, owner);
  const kind = healingBuildingKindForRace(snapshot.players[owner]!.race);
  const threats = [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
  return halls.filter(hall => home && !sameGround(snapshot.map, hall, home)
    && patients.some(patient => sameGround(snapshot.map, patient, hall))
    && !own.some(post => isHealingBuildingKind(post.kind) && post.hp > 0 && sameGround(snapshot.map, post, hall)))
    .flatMap(hall => {
      const local = patients.filter(patient => sameGround(snapshot.map, patient, hall));
      const site = legalBuildPointNear(snapshot, kind, averagePoint(local));
      const body = { ...site, radius: BUILDING_DEFS[kind].radius };
      if (!sameGround(snapshot.map, site, hall) || !isBuildPlacementClear(snapshot, kind, site)
        || threats.some(foe => distance(foe, site) <= mountedThreatReach(snapshot, foe, body, 0))) return [];
      const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck
        && unit.carryingGold === 0 && (unit.order.type === 'idle' || unit.order.type === 'mine')
        && options.memory.unitClaims[unit.id]?.kind !== 'build' && options.memory.unitClaims[unit.id]?.kind !== 'retreat');
      const builder = routeArrivals(snapshot.map, workers, site, 'land')[0]?.unit;
      if (!builder) return [];
      return [{ id: `colony:recovery:${hall.id}`, priority: 67, cost: BUILDING_DEFS[kind].cost, save: true,
        issue: (used: Set<string>): GameCommand | undefined => {
          if (used.size || snapshot.units.some(unit => unit.owner === owner && unit.order.type === 'build'
            && unit.order.buildingKind === kind)) return undefined;
          used.add(builder.id);
          return { type: 'build', unitId: builder.id, buildingKind: kind, ...site };
        } }];
    });
}
