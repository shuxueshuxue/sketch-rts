/** Reads existing equipment state; never changes combat rules or simulation data. */
import { activeItem } from '../../shared/equipment';
import type { GameSnapshot, Unit } from '../../shared/types';
import { figures } from './appearance';
import { equipmentForKind, type FigurePresentation } from './rig';

const DEFAULT: Readonly<FigurePresentation> = Object.freeze({});
const PRESENTATIONS = new Map<string, Readonly<FigurePresentation>>();
export function appearanceFor(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit): Readonly<FigurePresentation> {
  if (!figures[unit.kind]) return DEFAULT;
  const right = activeItem(snapshot, unit, 'right');
  const left = activeItem(snapshot, unit, 'left');
  const source = right?.kind === 'issuedWeapon' && right.weaponKind ? equipmentForKind(right.weaponKind) : undefined;
  const weapon = right?.kind === 'greatSword' ? 'greatSword' : source;
  const shield = weapon === 'greatSword' ? false : left?.kind === 'roundShield' ? true : undefined;
  if (!weapon && shield === undefined) return DEFAULT;
  const key = `${weapon ?? ''}:${shield ?? ''}`;
  let result = PRESENTATIONS.get(key);
  if (!result) { result = Object.freeze({ ...(weapon ? { weapon } : {}), ...(shield !== undefined ? { shield } : {}) }); PRESENTATIONS.set(key, result); }
  return result;
}
const DETAIL_IDS = new WeakMap<NonNullable<FigurePresentation['detail']>,number>();
let nextDetailId=1;
export function appearanceKey(presentation: Readonly<FigurePresentation> = DEFAULT): string {
  const appearance=presentation.appearance;
  let detail=0;
  if(presentation.detail){detail=DETAIL_IDS.get(presentation.detail)??nextDetailId++;DETAIL_IDS.set(presentation.detail,detail);}
  return `${presentation.weapon??''}:${presentation.shield===undefined?'':Number(presentation.shield)}:${presentation.motion??''}:${presentation.cloth??''}:${presentation.headwear??''}:${appearance?.role??''}:${appearance?.weapon??''}:${appearance?.armor??''}:${appearance?.elite??''}:${appearance?.mounted??''}:${appearance?.ember??''}:${detail}`;
}
