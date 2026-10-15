import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { sameGround } from '../../shared/terrain';
import type { GameCommand } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AiScript } from '../policy/types';
import { mainlandCareAssignments, patientRendezvousCommands } from './land-recovery';
import { mountedEscape, mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { retreatLandRoad } from './safe-land-route';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';

/** Home-ground patients rendezvous with an existing medic while expeditions and camps keep their own care. */
export const mobileCare: AiScript = {
  id: 'mobileCare', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => {
    const care = mainlandCareAssignments(snapshot, owner, options);
    return new Set([...(care?.recovering ?? []), ...(care?.unmedicated ?? [])].map(({ patient }) => patient.id));
  },
  run(snapshot, owner, options): GameCommand[] {
    const care = mainlandCareAssignments(snapshot, owner, options);
    if (!care) return [];
    return [...care.recovering.flatMap(({ patient, healer, foes, medics }) => patientRendezvousCommands(snapshot, [{ patient, healer }], foes, medics)),
      ...care.unmedicated.map(({ patient, cover }): GameCommand => {
        const threats = care.foes.filter(foe => sameGround(snapshot.map, patient, foe)
          && distance(patient, foe) <= mountedThreatReach(snapshot, foe, patient, THINK_TICKS)
            + ('speed' in foe ? foe.speed : 0) * (THINK_TICKS + 2) / SIM_TICKS_PER_SECOND);
        if (distance(patient, cover) > MOVE_ORDER_ARRIVAL_RANGE && retreatLandRoad(snapshot, patient, cover, care.foes))
          return { type: 'move', unitIds: [patient.id], ...cover, avoidCombat: true };
        return threats.length ? mountedEscape(snapshot, patient, threats, 0, cover, true)
          : { type: 'holdPosition', unitIds: [patient.id] };
      })];
  },
};
