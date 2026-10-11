import { figureReleaseSocket } from './release-socket';
/** Campaigns author appearance and socket details, never another body/animation
 * implementation. The same composers serve portraits, Canvas and WebGL cards. */
import type { UnitKind } from '../../shared/types';
import type { UnitPainter, UnitRemainsPainter } from '../../story/cast';
import { IDLE_FRAME } from '../unit-animation';
import { paintFigure } from './painted-units';
import { paintCreature, creatureGround, creatureReleaseSocket, type CreaturePresentation } from './painted-creatures';
import { defaultEquipment, sampleFigurePose, type FigurePresentation } from './rig';
import { figures } from './appearance';
import { paintCorpse, type CorpsePresentation } from './corpses';

export type StoryPainter = UnitPainter & { readonly remains: UnitRemainsPainter };
type FigureAppearance = FigurePresentation & { remains?: CorpsePresentation };
type CreatureAppearance = CreaturePresentation & { remains?: CorpsePresentation };

/** Remains retain a muted trace of authored clothing, never a saturated live
 * sprite. Inputs are our authored hex material swatches. */
function quietColor(color: string | undefined) {
  if(!color || !/^#[0-9a-f]{6}$/i.test(color))return '#929082';
  const channels=[1,3,5].map((offset,i)=>Math.round(parseInt(color.slice(offset,offset+2),16)*.35+[146,144,130][i]!*.65));
  return '#'+channels.map(value=>value.toString(16).padStart(2,'0')).join('');
}

/** Only equipment overrides cross a model boundary; costume and anatomy stay authored. */
function gear(override:Pick<FigurePresentation,'weapon'|'shield'|'shieldStyle'>={}){
 return {...(override.weapon?{weapon:override.weapon}:{}),...(override.shield!==undefined?{shield:override.shield}:{}),...(override.shieldStyle?{shieldStyle:override.shieldStyle}:{})};
}
export function storyFigure(kind: UnitKind, presentation: FigureAppearance, size = 1): StoryPainter {
  const appearance={...figures[kind]!,...presentation.appearance};
  const remains:CorpsePresentation={
    anatomy:appearance.mounted?'mounted':'foot', size,
    weapon:presentation.weapon??defaultEquipment(appearance),
    shield:sampleFigurePose(appearance,IDLE_FRAME,presentation).shield,
    ...(presentation.headwear!==undefined?{headwear:presentation.headwear}:{}),
    robe:['priest','mage','witch'].includes(appearance.role),
    cloth:quietColor(presentation.cloth), ...presentation.remains,
  };
  const paint:UnitPainter=(b, team, pose = IDLE_FRAME, facing = 1, override = {}) => {
    b.save();
    // Scaling about the feet preserves ground contact, including small heroes.
    b.translate(0, 17 * (1 - size)); b.scale(size, size);
    paintFigure(b, kind, team, pose, facing, {...presentation,...gear(override)});
    b.restore();
  };
  return Object.assign(paint,{
    release:(pose:import('../unit-animation').UnitAnimationFrame,override:Readonly<FigurePresentation>={})=>figureReleaseSocket(kind,pose,{...presentation,...gear(override)},size),
    remains:((b,_team,override={})=>{const equipment=gear(override);paintCorpse(b,kind,{...remains,...equipment,...(equipment.weapon!==undefined||equipment.shield!==undefined?{shield:sampleFigurePose(appearance,IDLE_FRAME,{...presentation,...equipment}).shield}:{})});}) as UnitRemainsPainter,
  });
}

export function storyCreature(kind: UnitKind, presentation: CreatureAppearance): StoryPainter {
  const remains:CorpsePresentation={cloth:quietColor(presentation.color),...(presentation.size!==undefined?{size:presentation.size}:{}),...presentation.remains};
  const paint:UnitPainter=(b, team, pose = IDLE_FRAME) => {
    b.save(); b.translate(0, 17 - creatureGround(kind, presentation));
    paintCreature(b, kind, team, pose, presentation); b.restore();
  };
  return Object.assign(paint,{release:(pose:import('../unit-animation').UnitAnimationFrame)=>{const socket=creatureReleaseSocket(kind,pose,presentation);return socket?{x:socket.x,y:socket.y+17-socket.ground,ground:17}:undefined;},remains:((b)=>paintCorpse(b,kind,remains)) as UnitRemainsPainter});
}
