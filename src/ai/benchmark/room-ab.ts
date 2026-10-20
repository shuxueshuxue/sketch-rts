import { MAP_POOL } from '../../shared/map-pool';
import type { AiScriptVersion, BootstrapAiVersion, RaceId } from '../../shared/types';

export const ROOM_AB_MAPS = ['brokenSea', 'greystonePass', 'gullIsland', 'pineshade', 'reedwater', 'ringwater',
  'sapphireArchipelago', 'templeSpring', 'turtleLake', 'twoShores', 'veiledHill'] as const;
export const ROOM_AB_FAMILIES: readonly BootstrapAiVersion[] = ['v9_archer', 'v9_summoner', 'v9_knight'];
export type RoomAbVersion = 'room-baseline-646c' | 'room-current' | AiScriptVersion;
export type RoomAbSeat = { owner: string; side: 'A' | 'B'; brain: RoomAbVersion; family: BootstrapAiVersion; race: RaceId };
export type RoomAbCase = {
  name: string; pair: string; mapId: string; mode: 'ffa' | 'duel'; nativeSeats: number; seed: string; layoutSeed: string;
  rotation: 0 | 1; maxTicks: number; seats: RoomAbSeat[];
};

/** Cohorts are report labels only. Every seat has its own team and a version-neutral owner ID. */
export function roomAbCases(options: {
  a: RoomAbVersion; b: RoomAbVersion; seeds: readonly string[]; minutes: number;
  maps?: readonly string[]; modes?: readonly ('ffa' | 'duel')[];
}): RoomAbCase[] {
  if (!(options.minutes >= 15 && options.minutes <= 40) || !Number.isFinite(options.minutes)) throw new Error('minutes must be between 15 and 40');
  if (!options.seeds.length || new Set(options.seeds).size !== options.seeds.length) throw new Error('Use a nonempty list of distinct seeds');
  const result: RoomAbCase[] = [];
  for (const mapId of options.maps ?? ROOM_AB_MAPS) {
    const map = MAP_POOL.find(map => map.id === mapId);
    if (!map) throw new Error(`Unknown room map ${mapId}`);
    for (const mode of options.modes ?? ['ffa', 'duel']) {
      // The native two-seat room already supplies the auxiliary duel. Do not play it twice.
      if (mode === 'duel' && map.players === 2 && (options.modes ?? ['ffa', 'duel']).includes('ffa')) continue;
      // These named ring/sides layouts require four physical starts. Only islandStarts
      // also has a native two-seat generator; never invent a different map for a duel.
      if (mode === 'duel' && map.players !== 2 && map.layout.idea !== 'islandStarts') continue;
      const count = mode === 'duel' ? 2 : map.players;
      for (const [seedIndex, seed] of options.seeds.entries()) for (const rotation of [0, 1] as const) {
        const pair = `${mode}-${map.id}-s${seedIndex}`;
        const seats = Array.from({ length: count }, (_, index): RoomAbSeat => {
          const side = (index + rotation) % 2 === 0 ? 'A' : 'B';
          return { owner: index === 0 ? 'player' : index === 1 ? 'enemy' : index === 2 ? 'enemy2' : `player-${index + 1}`,
            side, brain: side === 'A' ? options.a : options.b,
            family: ROOM_AB_FAMILIES[(index + seedIndex) % ROOM_AB_FAMILIES.length]!, race: index % 2 === 0 ? 'grove' : 'ember' };
        });
        result.push({ name: `${pair}-r${rotation}`, pair, mapId: map.id, nativeSeats: map.players, seed,
          layoutSeed: `${map.layout.seed}:${seed}`, mode, rotation, maxTicks: Math.round(options.minutes * 1200), seats });
      }
    }
  }
  return result;
}

export type RoomAbSurvival = { owner: string; hasBuildings: boolean; lastBuildingLossTick: number | null };

/** Native victory counts buildings. Surviving seats tie at timeout; equal elimination ticks tie too. */
export function roomAbRanks(seats: readonly RoomAbSurvival[]): Record<string, number> {
  const sorted = [...seats].sort((a, b) => Number(b.hasBuildings) - Number(a.hasBuildings)
    || (b.lastBuildingLossTick ?? Infinity) - (a.lastBuildingLossTick ?? Infinity));
  const ranks: Record<string, number> = {};
  for (let index = 0; index < sorted.length;) {
    let end = index + 1;
    while (end < sorted.length && sorted[end]!.hasBuildings === sorted[index]!.hasBuildings
      && (sorted[index]!.hasBuildings || sorted[end]!.lastBuildingLossTick === sorted[index]!.lastBuildingLossTick)) end++;
    const rank = ((index + 1) + end) / 2;
    for (let k = index; k < end; k++) ranks[sorted[k]!.owner] = rank;
    index = end;
  }
  return ranks;
}
