import { createUnit } from '../../shared/map';
import { landSpawnPoint } from '../../shared/production-spawn';
import { sameGround, walkableGoal } from '../../shared/terrain';
import { combatCapability } from '../../shared/combat-capabilities';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { isEnemyOwner } from '../policy/ownership';
import { safeLandTravelTicks } from './safe-land-route';

type Options = Pick<AiPolicyContext, 'teams'> & { memory?: AiPolicyContext['memory'] };
const fireCache = new WeakMap<GameSnapshot, Map<PlayerId, Set<string>>>();

/** Do not refill a post while its workers are being evacuated, or recruit a
 * civilian directly into observed weapon coverage. Paid queues stay intact. */
export function unsafeWorkerHalls(snapshot: GameSnapshot, owner: PlayerId, options: Options): Set<string> {
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall');
  let byOwner = fireCache.get(snapshot);
  if (!byOwner) { byOwner = new Map(); fireCache.set(snapshot, byOwner); }
  let exposed = byOwner.get(owner);
  if (!exposed) {
    exposed = new Set();
    const foes = [...snapshot.units, ...snapshot.buildings].filter(unit => unit.hp > 0
      && isEnemyOwner(snapshot, owner, unit.owner, options) && combatCapability(snapshot, unit).armed);
    if (foes.length) for (const hall of halls) {
      const probe = createUnit('worker-spawn-safety-probe', owner, 'worker', hall.x, hall.y);
      const spawn = landSpawnPoint(snapshot, hall, probe);
      // Temporary crowding is not evidence of enemy fire. Preserve the
      // ordinary queue's ability to wait for physical spawn space.
      if (!spawn) continue;
      Object.assign(probe, spawn);
      if (safeLandTravelTicks(snapshot, probe, probe, foes) === undefined) exposed.add(hall.id);
    }
    byOwner.set(owner, exposed);
  }
  const unsafe = new Set(exposed);
  // Memory can acquire an evacuation during this think; only immutable
  // world/weapon queries above are cached.
  const evacuations = Object.values(options.memory?.naval?.ferries ?? {})
    .filter(mission => mission.purpose === 'evacuate' && mission.phase !== 'return');
  for (const hall of halls) if (evacuations.some(mission => Math.hypot(mission.from.x - hall.x, mission.from.y - hall.y) < 800
    && sameGround(snapshot.map, walkableGoal(snapshot.map, mission.from.x, mission.from.y, 'land'), hall))) unsafe.add(hall.id);
  return unsafe;
}
