import type { GameSnapshot, PlayerId } from '../../shared/types';
import { strikeGap } from '../../shared/combat-geometry';
import { unitMover } from '../../shared/catalog';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { groundThreatWithin } from '../policy/ground-threat';
import type { Point } from '../../shared/ship-geometry';
import { strengthOf } from '../policy/v6/strength';
import { distance } from '../policy/spatial';
import { mineClaimedByAlly } from '../policy/mine-claims';
import type { AiPolicyContext } from '../policy/types';
import { chooseV9ExpansionMine, mineGuards, type V6Intel } from '../policy/v6/intel';
import { v6ExpansionPoint } from '../policy/v6/economy';
import { isReservedBuilder } from '../policy/world-model';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { armedFoes, retreatLandTravelTicks } from './safe-land-route';
import { availableV6Army } from '../policy/v6/general';
import { isBacklineKind } from '../policy/v6/backline';
import { creepForce, forceFor, neutralCamps, EXPANSION_GUARD_RANGE } from '../policy/v7/creep';

/** Share land and naval ownership facts before applying the common expansion geometry. */
export function bootstrapExpansionMine(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, options: AiPolicyContext) {
  const task = options.memory.landExpansion;
  const committed = task && ['assemble', 'clear', 'escort'].includes(task.stage)
    ? snapshot.resources.find(mine => mine.id === task.mineId && mine.amount > 0
      && snapshot.buildings.every(building => building.kind !== 'townHall' || Math.hypot(building.x - mine.x, building.y - mine.y) > 340)
      && !mineClaimedByAlly(snapshot, owner, mine, options)) : undefined;
  if (committed) return committed;
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck
    && !isReservedBuilder(snapshot, owner, unit));
  const foes = armedFoes(snapshot, owner, options);
  // Secure the nearby natural before sending the first economy on a long land detour.
  const opening = intel.ownHalls.length === 1 && activeMiningBaseCount(snapshot, owner) === 1;
  const camps = neutralCamps(snapshot), front = availableV6Army(snapshot, options, intel)
    .filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
  return chooseV9ExpansionMine(snapshot, intel, snapshot.resources.filter(mine => !mineClaimedByAlly(snapshot, owner, mine, options)),
    (intel, point, range) => enemyExpansionPower(snapshot, intel, point, range), mine => {
      if (opening) return 0;
      if (mineGuards(snapshot, mine).length > 0) {
        const camp = camps.find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE);
        // After the natural, prefer a mine the escort can clear now over waiting for a larger army at a stronger camp.
        return camp && creepForce(front, camp) < forceFor(camp) ? 2 : 1;
      }
      const point = v6ExpansionPoint(snapshot, owner, mine);
      return isBuildPlacementClear(snapshot, 'townHall', point)
        && workers.some(worker => retreatLandTravelTicks(snapshot, worker, point, foes) !== undefined) ? 0 : 3;
    });
}

/** Direct fire is physical; a land army outside firing range must actually walk to this expansion. */
export function enemyExpansionPower(snapshot: GameSnapshot, intel: V6Intel, point: Point, range: number) {
  return intel.enemies.reduce((power, enemy) => power + strengthOf(enemy.army.filter(unit => {
    // Fleet and deck threat retains its existing sea perimeter; land roads cannot model sailing or unloading.
    if (unitMover(unit.kind) === 'sea' || unit.deck) return strikeGap(unit, point) <= Math.max(range, unit.attackRange);
    return groundThreatWithin(snapshot, unit, point, range);
  })), 0);
}
