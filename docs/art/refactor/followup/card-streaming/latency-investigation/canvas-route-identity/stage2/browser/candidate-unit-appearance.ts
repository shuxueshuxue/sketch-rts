import { IDLE_FRAME } from '../unit-animation';
/** Reads existing equipment state; never changes combat rules or simulation data. */
import { activeItem } from '../../shared/equipment';
import type { GameSnapshot, Unit, UnitKind, RaceId, Corpse } from '../../shared/types';
import { UNIT_CARDS } from '../content/units';
import type { CorpsePresentation } from './corpses';
import { figures } from './appearance';
import { equipmentForKind, sampleFigurePose, type FigurePresentation } from './rig';

// Only these internally constructed, immutable catalog profiles have the
// stock painter's proven identities. A custom copy is still a custom input.
const CATALOG_PRESENTATIONS = new WeakSet<Readonly<FigurePresentation>>();
function catalogPresentation(presentation:FigurePresentation):Readonly<FigurePresentation> {
  const result=Object.freeze(presentation);CATALOG_PRESENTATIONS.add(result);return result;
}
export function isCatalogPresentation(presentation:Readonly<FigurePresentation>):boolean {
  return CATALOG_PRESENTATIONS.has(presentation);
}
const DEFAULT = catalogPresentation({});
const EMBER_PRIEST = catalogPresentation({ appearance:Object.freeze({ember:true}), cloth:'#a78265' });
const EMBER_SUMMONER = catalogPresentation({ appearance:Object.freeze({ember:true}), cloth:'#704b3e' });
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
/** Historical records without equipment facts keep their original defaults. */
export function corpseAppearanceFor(snapshot:Pick<GameSnapshot,'players'>,unit:Pick<Corpse,'kind'|'owner'> & Partial<Pick<Corpse,'equipmentCaptured'|'rightItemKind'|'weaponKind'|'leftItemKind'|'ownerRace'>> & {variant?:string|undefined}):Readonly<CorpsePresentation> {
  const race=unit.ownerRace??snapshot.players[unit.owner]?.race;
  const base=(unit.kind==='priest'||unit.kind==='summoner')&&race==='ember'?EMBER_REMAINS:DEFAULT_REMAINS;
  if(!unit.equipmentCaptured||(!figures[unit.kind]&&!unit.variant))return base;
  // A campaign's issued base kit is its authored costume, not a request to
  // replace its bespoke weapon with the simulation base unit's default.
  const source=unit.rightItemKind==='issuedWeapon'&&unit.weaponKind&&!(unit.variant&&unit.weaponKind===unit.kind)?equipmentForKind(unit.weaponKind):undefined;
  const weapon=unit.rightItemKind==='greatSword'?'greatSword':source;
  const shield=weapon==='greatSword'?false:unit.leftItemKind==='roundShield'?true:undefined;
  const visibleShield=!unit.variant&&figures[unit.kind]&&(weapon||shield!==undefined)?sampleFigurePose(figures[unit.kind]!,IDLE_FRAME,{...(weapon?{weapon}:{}),...(shield!==undefined?{shield}:{})}).shield:shield;
  return {...base,...(weapon?{weapon}:{}),...(visibleShield!==undefined?{shield:visibleShield,...(shield?{shieldStyle:'round' as const}:{})}:{})};
}
const PRESENTATIONS = new Map<string, Readonly<FigurePresentation>>();
export function appearanceFor(snapshot: Pick<GameSnapshot, 'items'> & Partial<Pick<GameSnapshot,'players'>>, unit: Unit): Readonly<FigurePresentation> {
  if (!figures[unit.kind]&&!unit.variant) return DEFAULT;
  const base=appearanceForKind(unit.kind,snapshot.players?.[unit.owner]?.race);
  const right = activeItem(snapshot, unit, 'right');
  const left = activeItem(snapshot, unit, 'left');
  const source = right?.kind === 'issuedWeapon' && right.weaponKind && !(unit.variant&&right.weaponKind===unit.kind) ? equipmentForKind(right.weaponKind) : undefined;
  const weapon = right?.kind === 'greatSword' ? 'greatSword' : source;
  const shield = weapon === 'greatSword' ? false : left?.kind === 'roundShield' ? true : undefined;
  if (!weapon && shield === undefined) return base;
  const key = `${unit.kind}:${base===DEFAULT?'base':'ember'}:${weapon ?? ''}:${shield ?? ''}`;
  let result = PRESENTATIONS.get(key);
  if (!result) { result = catalogPresentation({ ...base, ...(weapon ? { weapon } : {}), ...(shield !== undefined ? { shield,...(shield?{shieldStyle:'round' as const}:{}) } : {}) }); PRESENTATIONS.set(key, result); }
  return result;
}
const DETAIL_IDS = new WeakMap<NonNullable<FigurePresentation['detail']>,number>();
let nextDetailId=1;
export function appearanceKey(presentation: Readonly<FigurePresentation> = DEFAULT): string {
  const appearance=presentation.appearance;
  let detail=0;
  if(presentation.detail){detail=DETAIL_IDS.get(presentation.detail)??nextDetailId++;DETAIL_IDS.set(presentation.detail,detail);}
  return `${presentation.weapon??''}:${presentation.shieldStyle??''}:${presentation.shield===undefined?'':Number(presentation.shield)}:${presentation.motion??''}:${presentation.cloth??''}:${presentation.headwear??''}:${appearance?.role??''}:${appearance?.weapon??''}:${appearance?.armor??''}:${appearance?.elite??''}:${appearance?.mounted??''}:${appearance?.ember??''}:${detail}`;
}
