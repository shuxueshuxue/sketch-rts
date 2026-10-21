import type { GameSnapshot } from '../../shared/types';
import { EXPANSION_GUARD_RANGE } from '../policy/v7/creep';
import { distance } from '../policy/spatial';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import type { Target } from './types';

export function strategicTargetCamp(snapshot: GameSnapshot, target: Target, facts = neutralCampExposure(snapshot)) {
  return facts.camps.find(exposure => distance(exposure.camp.center, target.point) <= EXPANSION_GUARD_RANGE)?.camp;
}
