import type { RaceId } from '../../shared/types';
import type { V6Strategy } from '../policy/v6/doctrine';

export const ARCHER_DOCTRINES = (['grove', 'ember'] as const).map(archerDoctrine);

function archerDoctrine(race: RaceId): V6Strategy {
  const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
  const mobile = race === 'grove' ? 'horseArcher' : 'sparkArcher';
  const screen = race === 'grove' ? 'lancer' : 'ashWarden';
  const producer = race === 'grove' ? 'stables' : 'cinderSpire';
  return {
    id: race + '-archer-line', race, weight: 1, standIn: shooter, raids: [], opensOnState: true,
    phases: [
      {
        // Finish the first producer's opening squad before buying a second production chain.
        wants: [{ unit: shooter, count: 4, priority: 66 }],
        advanceShare: 1, advanceSupply: 1000,
      },
      {
        wants: [
          { unit: shooter, count: 4, priority: 66 },
          { unit: screen, count: 4, priority: 65 },
          { bases: 2, priority: 64 },
          { unit: shooter, count: 12, priority: 60 },
        ],
        advanceShare: 0.75, advanceBases: 2, advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: screen, count: 4, priority: 63 },
          { unit: mobile, count: 4, priority: 65 },
          { unit: mobile, count: 12, priority: 56 },
          { building: producer, count: 2, priority: 54 },
          { bases: 3, priority: 50 },
        ],
        advanceShare: 0.75, advanceSupply: 55,
      },
      {
        wants: [
          { unit: screen, count: 4, priority: 63 },
          { unit: mobile, count: 28, priority: 52 },
          { bases: 3, priority: 60 },
          { bases: 4, priority: 55 },
        ],
        advanceShare: 1, advanceSupply: 1000,
      },
    ],
  };
}
