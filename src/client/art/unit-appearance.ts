/** Reads existing equipment state; never changes combat rules or simulation data. */
import { activeItem } from '../../shared/equipment';
import type { GameSnapshot, Unit, UnitKind, RaceId } from '../../shared/types';
import { UNIT_CARDS } from '../content/units';
import type { CorpsePresentation } from './corpses';
import { figures } from './appearance';
import { equipmentForKind, type FigurePresentation } from './rig';

const DEFAULT: Readonly<FigurePresentation> = Object.freeze({});
const EMBER_PRIEST: Readonly<FigurePresentation> = Object.freeze({ appearance:Object.freeze({ember:true}), cloth:'#a78265' });
const EMBER_SUMMONER: Readonly<FigurePresentation> = Object.freeze({ appearance:Object.freeze({ember:true}), cloth:'#704b3e' });
const EMBER_REMAINS: Readonly<CorpsePresentation> = Object.freeze({ robe:true, cloth:'#928174' });
const DEFAULT_REMAINS: Readonly<CorpsePresentation> = Object.freeze({});
/** Shared roles follow their owner; all other silhouettes retain authored identity. */
export function unitArtFaction(kind:UnitKind,race?:RaceId) {
  return (kind==='priest'||kind==='summoner')&&race ? race : UNIT_CARDS[kind].art.faction;
}
export function appearanceForKind(kind:UnitKind,race?:RaceId):Readonly<FigurePresentation> {
  if(race!=='ember')return DEFAULT;
  return kind==='priest'?EMBER_PRIEST:kind==='summoner'?EMBER_SUMMONER:DEFAULT;
}
/** A corpse retains owner identity without inventing a historical equipment snapshot. */
export function corpseAppearanceFor(snapshot:Pick<GameSnapshot,'players'>,unit:Pick<Unit,'kind'|'owner'>):Readonly<CorpsePresentation> {
  return (unit.kind==='priest'||unit.kind==='summoner')&&snapshot.players[unit.owner]?.race==='ember'?EMBER_REMAINS:DEFAULT_REMAINS;
}
const PRESENTATIONS = new Map<string, Readonly<FigurePresentation>>();
export function appearanceFor(snapshot: Pick<GameSnapshot, 'items'> & Partial<Pick<GameSnapshot,'players'>>, unit: Unit): Readonly<FigurePresentation> {
  if (!figures[unit.kind]) return DEFAULT;
  const base=appearanceForKind(unit.kind,snapshot.players?.[unit.owner]?.race);
  const right = activeItem(snapshot, unit, 'right');
  const left = activeItem(snapshot, unit, 'left');
  const source = right?.kind === 'issuedWeapon' && right.weaponKind ? equipmentForKind(right.weaponKind) : undefined;
  const weapon = right?.kind === 'greatSword' ? 'greatSword' : source;
  const shield = weapon === 'greatSword' ? false : left?.kind === 'roundShield' ? true : undefined;
  if (!weapon && shield === undefined) return base;
  const key = `${unit.kind}:${base===DEFAULT?'base':'ember'}:${weapon ?? ''}:${shield ?? ''}`;
  let result = PRESENTATIONS.get(key);
  if (!result) { result = Object.freeze({ ...base, ...(weapon ? { weapon } : {}), ...(shield !== undefined ? { shield } : {}) }); PRESENTATIONS.set(key, result); }
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
