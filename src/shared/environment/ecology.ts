import type { CampHabitat } from '../camps';
import type { Terrain } from '../terrain';
import type { TerrainLandmark } from '../types';
import { clamp01, environmentField, sampleEnvironment, type EnvironmentSample } from './fields';

type Range = readonly [low: number, optimum: number, high: number];
type Niche = Partial<Record<keyof EnvironmentSample, Range>>;
/** A species tolerance curve. Multiple limiting factors multiply; one unsuitable factor can exclude it. */
export function suitability(environment: EnvironmentSample, niche: Niche): number {
  let result = 1;
  for (const key of Object.keys(niche) as (keyof EnvironmentSample)[]) {
    const [low, optimum, high] = niche[key]!, value = environment[key];
    const t = clamp01(value < optimum ? (value - low) / (optimum - low) : (high - value) / (high - optimum));
    result *= t * t * (3 - 2 * t);
  }
  return result;
}

export const VEGETATION_NICHES: readonly { kind: TerrainLandmark['kind']; niche: Niche; cells: string; density: number }[] = [
  { kind: 'reeds', cells: '.,m', density: .8, niche: { water: [.45, 1, 1.1], moisture: [.6, .95, 1.1] } },
  { kind: 'lilies', cells: ',', density: .32, niche: { temperatureC: [8, 24, 36], salinity: [-.1, 0, .2], moisture: [.65, 1, 1.1] } },
  { kind: 'mushrooms', cells: '.', density: .55, niche: { temperatureC: [2, 19, 31], canopy: [.3, .85, 1.2], moisture: [.45, .8, 1.1] } },
  { kind: 'log', cells: '.', density: .2, niche: { canopy: [.4, .9, 1.2] } },
  { kind: 'stump', cells: '.', density: .18, niche: { canopy: [.3, .75, 1.2] } },
  { kind: 'flowers', cells: '.', density: .32, niche: { temperatureC: [4, 22, 36], fertility: [.4, .72, 1.1], canopy: [-.1, 0, .6], salinity: [-.1, 0, .4] } },
  { kind: 'bush', cells: '.', density: .48, niche: { moisture: [.25, .55, .9], fertility: [.3, .65, 1.1], canopy: [-.2, .25, .9] } },
  { kind: 'pebbles', cells: '.,', density: .35, niche: { rockiness: [.15, .8, 1.1] } },
];

/** Existing creep families keep their RTS camp budgets, but use the same environment as plants and ground. */
const CAMP_NICHES: Record<CampHabitat, Niche> = {
  water: { water: [.35, .9, 1.2], moisture: [.55, .9, 1.1] },
  hill: { rockiness: [.15, .8, 1.2] },
  forest: { canopy: [.15, .8, 1.2], moisture: [.25, .7, 1.1] },
  open: { canopy: [-.15, 0, .8], rockiness: [-.15, 0, .8], water: [-.2, .1, .85] },
};
export function ecologicalHabitat(terrain: Terrain, x: number, y: number): CampHabitat {
  const environment = sampleEnvironment(environmentField(terrain), x, y);
  const habitats = Object.keys(CAMP_NICHES) as CampHabitat[];
  return habitats.reduce((best, habitat) => suitability(environment, CAMP_NICHES[habitat]) > suitability(environment, CAMP_NICHES[best]) ? habitat : best, 'open');
}

/** Continuous ground weights, not a winner-takes-all biome stamp. */
export function groundCover(environment: Pick<EnvironmentSample, 'fertility' | 'salinity' | 'rockiness'>) {
  const sand = environment.salinity * (1 - environment.fertility) * .9;
  const gravel = environment.rockiness * .55;
  const growth = clamp01((environment.fertility - .25) / .45);
  const grass = growth * growth * (3 - 2 * growth) * (1 - sand) * (1 - gravel);
  const earth = Math.max(0, 1 - grass - sand - gravel);
  const total = grass + sand + gravel + earth;
  return { grass: grass / total, sand: sand / total, gravel: gravel / total, earth: earth / total };
}
