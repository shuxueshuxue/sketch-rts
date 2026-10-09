import { coordinateRandom, seedHash } from './environment/noise';
import { seconds } from './time';

export const SPARK_FIRE = { chance: .15, radius: 38, duration: seconds(6), damage: 1, tickEvery: seconds(.5) } as const;

/** Impact-addressed randomness needs no extra replay or savegame state. */
export function sparkIgnites(sourceId: string, targetId: string, tick: number): boolean {
  return coordinateRandom(seedHash(sourceId), tick, seedHash(targetId), 17) < SPARK_FIRE.chance;
}
