import { issuePlayerCommand } from '../shared/sim';
import type { UnitKind } from '../shared/types';
import { cast, seeded, stage, terrainOf, type MenuSceneRun } from './menu-scene-world';

type Point = { x: number; y: number };
type Framing = { focus: Point; zoom: number; anchorX: number; anchorY: number };
const ARMY = 'court', HORDE = 'wilds';
const CX = 2140, CY = 1250;

/** An army meets a forest horde in a clearing (see @@@menu-battles). Only the opening is authored: who stands where
 * and where each side marches. The match simulation fights the rest, so walking, targets, hits and deaths are real. */
export function createForestHorde(seed = 1): MenuSceneRun {
  const random = seeded(seed);
  // Each visit's battle differs a little: a soldier a few steps out of line plays out differently.
  const jitter = () => (random() - .5) * 24;
  const pieces = cast();
  const terrain = terrainOf(3800, 2600, (x, y) => {
    const clearing = 335 + Math.sin((x - CX) / 240) * 35;
    if (Math.abs(y - CY) > clearing || Math.abs(x - CX) > 920) return 'T';
    return '.';
  });
  terrain.surfaces = Array.from({length:terrain.cells.length},(_,i)=>{
    const x=(i%terrain.cols+.5)*terrain.cell,y=(Math.floor(i/terrain.cols)+.5)*terrain.cell;
    return Math.abs(y-CY+Math.sin(x/310)*32)<45?'d':'g';
  }).join('');
  // Scenery borders the clearing, leaving the field between the armies open.
  for (const [x, y, scale] of [[-680,-325,1.6],[-470,325,1.8],[390,390,1.5],[660,-330,1.8]] as const)
    pieces.prop('deadTree', CX+x, CY+y, scale);
  for (const [x, y, scale] of [[-600,310,1.5],[-300,-375,1.3],[310,-375,1.6],[660,310,1.5]] as const)
    pieces.prop('stone', CX+x, CY+y, scale);
  pieces.prop('banner', CX-410, CY-280, 1.5);
  pieces.prop('banner', CX-405, CY+292, 1.3);
  pieces.prop('cart', CX-570, CY+255, 1.3);
  pieces.prop('crate', CX-565, CY+286, 1.2);
  pieces.prop('cairn', CX+560, CY-283, 1.5);
  pieces.prop('campfire', CX+575, CY+263, 1, 'out');
  const at = (owner: string, kind: UnitKind, x: number, y: number) => pieces.unit(owner, kind, CX+x+jitter(), CY+y+jitter());
  // The army: a front of footmen and lancers, archers behind, knights on the wings, a priest at the back.
  const frontKinds: UnitKind[] = ['wildling','ogreWarrior','stonebackBrute','rockGolem','venomSpider','ogreLord','wildling','spiderQueen'];
  for (let i=0;i<8;i++) {
    const y=-196+i*56;
    at(ARMY,i%2?'lancer':'footman',-245,y);
    // Uneven ranks and varied silhouettes tell a wild swarm from the soldiers' regular lines.
    at(HORDE,frontKinds[i]!,300+(i*37)%105,y+((i%3)-1)*12);
  }
  for(let i=0;i<6;i++) at(ARMY,'archer',-385-(i%2)*45,-155+i*62);
  at(ARMY,'knight',-420,-280); at(ARMY,'knight',-425,279);
  const priest = at(ARMY,'priest',-440,-30);
  at(ARMY,'footman',-310,30);
  at(HORDE,'graniteGolem',415,-274); at(HORDE,'ancientStag',458,284);
  for(let i=0;i<3;i++) at(HORDE,'thornSlinger',680+(i%2)*46,-154+i*147);
  const mender = at(HORDE,'barkMender',570,40);
  // A reserve of four keeps the two sides even enough that either can win.
  const reserveKinds: UnitKind[] = ['mossGnawer','spiderling','wildling','ogreWarrior'];
  for(let i=0;i<4;i++) at(HORDE,reserveKinds[i]!,510+(i*41)%138,-237+i*150+(i%2?10:-6));
  const game = stage(3800,2600,terrain,[[ARMY,'grove'],[HORDE,'grove']],pieces);
  game.players[ARMY]!.color='#497b75'; game.players[HORDE]!.color='#88765b';
  for(let i=0;i<17;i++)game.map.landmarks.push({id:`forest-edge-${i}`,kind:i%3?'pebbles':'log',
    x:CX-710+(i*137)%1430,y:CY+(i%2?317:-328),size:18+(i%3)*9,rotation:i*.43});
  // The opening orders: each side marches on the other's ground and back again, so nobody left standing idles out of
  // reach of the last of the enemy; its healer follows behind its line.
  const fighters = (owner: string) => game.units.filter(unit => unit.owner === owner && unit.id !== priest && unit.id !== mender).map(unit => unit.id);
  for (const [owner, ahead] of [[ARMY, 1], [HORDE, -1]] as const)
    for (const [leg, x] of [CX+ahead*700, CX-ahead*500, CX+ahead*700, CX].entries())
      issuePlayerCommand(game, owner, { type: 'attackMove', unitIds: fighters(owner), x, y: CY, queued: leg > 0 });
  issuePlayerCommand(game, ARMY, { type: 'move', unitIds: [priest], x: CX-200, y: CY });
  issuePlayerCommand(game, HORDE, { type: 'move', unitIds: [mender], x: CX+200, y: CY });
  // The camera holds the fighting: the middle of everyone still standing (a straggler or a far archer does not pull
  // it out to the map's edge), eased so a death does not jolt the view.
  let held: { x: number; span: number } | undefined;
  return {game,props:pieces.props,battle:{scene:'woods',seed},focus:{x:CX,y:CY},zoom:1,
    frameAt(_second,width,height,snapshot){
      const xs = snapshot.units.filter(unit => unit.hp > 0).map(unit => unit.x).sort((a, b) => a - b);
      const left = xs[Math.floor(xs.length * .1)] ?? CX, right = xs[Math.ceil(xs.length * .9) - 1] ?? CX;
      const target = { x: (left+right)/2, span: Math.min(1150, Math.max(900, right-left+115)) };
      held = held ? { x: held.x+(target.x-held.x)*.04, span: held.span+(target.span-held.span)*.04 } : target;
      return framing(held.x, held.span, width, height);
    },embers:[],glows:[],air:{dusk:.19,mist:'205, 204, 183',mistAlpha:.1,rays:'232, 218, 174',rayAngle:-.4,motes:'fireflies'}};
}

function framing(focusX: number, span: number, width: number, height: number): Framing {
  if(width<700)return{focus:{x:focusX,y:CY-70},zoom:Math.min(width/span,(height*.55)/720),anchorX:.5,anchorY:.3};
  return{focus:{x:focusX,y:CY-5},zoom:Math.min(width*.59/span,height*.79/760),anchorX:.7,anchorY:.52};
}
