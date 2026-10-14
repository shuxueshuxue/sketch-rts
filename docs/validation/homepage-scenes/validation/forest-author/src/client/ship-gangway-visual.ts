import { gangwayPointOnSurface, type GangwaySurface } from '../shared/ship-gangway';
import { shipProfile } from '../shared/ship-geometry';
import type { Unit } from '../shared/types';

/** Crew standing in the gap follows both displayed hull poses. Its retained
 * deck parent is for combat and payload accounting, not the bridge position. */
export function gangwayCrewVisualPose(unit: Unit, ships: ReadonlyMap<string, Unit>, surfaces: ReadonlyMap<string, GangwaySurface>): { x: number; y: number; height: number } | undefined {
  if (!unit.gangway) return undefined;
  const source = ships.get(unit.gangway.sourceId), target = ships.get(unit.gangway.targetId);
  const surface = surfaces.get(unit.gangway.sourceId);
  if (!source || !target || source.sailing?.gangway?.targetId !== target.id || surface?.phase !== 'ready') return undefined;
  const point = gangwayPointOnSurface(unit.gangway, surface);
  const a = shipProfile(source)!.deckHeight, b = shipProfile(target)!.deckHeight;
  return { ...point, height: a + (b - a) * unit.gangway.t };
}
