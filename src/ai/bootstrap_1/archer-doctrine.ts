import type { RaceId } from '../../shared/types';
import type { V6Strategy } from '../policy/v6/doctrine';

export const ARCHER_DOCTRINES = (['grove', 'ember'] as const).map(archerDoctrine);

function archerDoctrine(race: RaceId): V6Strategy {
  const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
  const screen = race === 'grove' ? 'lancer' : 'ashWarden';
  const openingScreen = race === 'grove' ? 'footman' : 'emberRavager';
  const producer = race === 'grove' ? 'stables' : 'cinderSpire';
  return {
    id: race + '-archer-line', race, weight: 1, standIn: shooter, raids: [], opensOnState: true,
    phases: [
      {
        // Two bodies hold the camp and opening skirmish while two shooters deal damage behind them.
        wants: [{ unit: openingScreen, count: 2, priority: 66 }, { unit: shooter, count: 2, priority: 65 }],
        advanceShare: 1, advanceSupply: 1000,
      },
      {
        wants: [
          { unit: shooter, count: 4, priority: 66 },
          { unit: screen, count: 4, priority: 65 },
          { bases: 2, priority: 76 },
          ...(race === 'grove' ? [{ unit: 'horseArcher' as const, count: 3, priority: 59 },
            { upgrade: 'rangeTraining' as const, level: 1, priority: 58 },
            { upgrade: 'speedTraining' as const, level: 1, priority: 57 }] : []),
          { unit: shooter, count: 12, priority: race === 'grove' ? 58 : 60 },
        ],
        advanceShare: 0.75, advanceBases: 2, advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: screen, count: 4, priority: 63 },
          ...(race === 'grove' ? [{ unit: 'horseArcher' as const, count: 3, priority: 59 },
            { upgrade: 'rangeTraining' as const, level: 2, priority: 62 },
            { upgrade: 'speedTraining' as const, level: 1, priority: 61 }] : []),
          { unit: shooter, count: 12, priority: 60 },
          { unit: shooter, count: 24, priority: 56 },
          { building: producer, count: 2, priority: 54 },
          { bases: 3, priority: 50 },
        ],
        advanceShare: 0.75, advanceSupply: 55,
      },
      {
        wants: [
          { unit: screen, count: 4, priority: 63 },
          ...(race === 'grove' ? [{ unit: 'horseArcher' as const, count: 3, priority: 59 },
            { upgrade: 'rangeTraining' as const, level: 2, priority: 62 },
            { upgrade: 'speedTraining' as const, level: 1, priority: 61 }] : []),
          { unit: shooter, count: 28, priority: 52 },
          { bases: 3, priority: 60 },
          { bases: 4, priority: 55 },
        ],
        advanceShare: 1, advanceSupply: 1000,
      },
    ],
  };
}
