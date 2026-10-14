import { localToWorld, shipProfile, SHIP_CAMERA } from '../shared/ship-geometry';
import { resolveVariant } from '../shared/catalog';
import { mountedWeaponPose, shipMounts } from '../shared/ship-equipment';
import { gangwaySurface, type ShipGangway } from '../shared/ship-gangway';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import type { Corpse, Unit, WorldEffect, WorldItem } from '../shared/types';
import type { UnitModel, PropPainter } from '../story/cast';
import type { UnitActionCue, PropView } from '../story/stage';
import { storyFigure } from './art/story-rig';
import { ellipse, line, polygon, type Point } from './art/kit';
import { projectWorld } from './world3d/projection';
import { drawWarfareEffect } from './warfare-effects';
import { cast, stage, terrainOf, type MenuSceneRun } from './menu-scene-world';

const PIRATES = 'corsairs', GUARD = 'admiralty';
const CX = 2280, CY = 1430, HEADING = -1.42;
const LENGTH = 60;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const eased = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function authoredPath(points: Point[]) {
  const spans = points.slice(1).map((point,i) => Math.hypot(point.x-points[i]!.x,point.y-points[i]!.y));
  const length = spans.reduce((sum,span) => sum+span,0);
  return (progress: number) => {
    let distance=clamp(progress)*length;
    for(let i=0;i<spans.length;i++){
      if(distance<=spans[i]!)return lerp(points[i]!,points[i+1]!,spans[i]!?distance/spans[i]!:1);
      distance-=spans[i]!;
    }
    return points[points.length-1]!;
  };
}
const presentationHeight = (ship: Unit) => shipProfile(ship)!.deckHeight * Math.tan(SHIP_CAMERA.tilt);

/** Scene-local costume: shared authored body, contact poses and weapon sockets. */
function pirateModel(captain = false): UnitModel {
  const paint = storyFigure('footman', {
    appearance: { armor: false, elite: false }, shield: false, headwear: false,
    cloth: captain ? '#4a4a40' : '#83715d', weapon: 'sword',
    detail(b, _rig, part) {
      if (part === 'head') {
        if (captain) {
          polygon(b, [[-9,-37],[-5,-42],[0,-39],[6,-43],[9,-37],[3,-35],[-4,-35]], '#363b36', '#272e2a', .8);
          line(b, [[-7,-38],[-4,-40],[0,-38],[5,-40],[7,-38]], '#b29b65', .8);
          ellipse(b, 1, -37, 1, 1.4, '#d4c9a5');
        } else {
          polygon(b, [[-4,-38],[-2,-40],[2,-39],[5,-36],[2,-34],[-4,-35]], '#9b493a', '#493d30', .65);
          line(b, [[-4,-36],[-8,-33],[-7,-30]], '#9b493a', 2.2);
        }
        line(b, [[1,-34],[4,-34]], '#30342d', 1.3);
      } else if (part === 'body') {
        line(b, [[-6,-10],[6,-10]], '#984d3b', 3);
        line(b, [[-5,-24],[4,-11]], '#3f3e33', 2.1);
      }
    },
  }, captain ? 1.65 : 1.5);
  return { paint, remains: paint.remains, shadow: 'foot' };
}
function guardModel(): UnitModel {
  const paint = storyFigure('footman', { shield: false, weapon: 'sword', headwear: false,
    cloth: '#687e79', appearance: { armor: false, elite: false },
    detail(b, _rig, part) {
      if (part === 'head') {
        polygon(b, [[-7,-36],[-4,-41],[0,-38],[5,-41],[7,-36],[0,-35]], '#3e5553', '#283c35', .75);
        line(b, [[-5,-38],[0,-36],[5,-38]], '#c9ba89', .9);
      } else if (part === 'body') {
        line(b, [[-5,-23],[4,-11]], '#d0c8ab', 2.6);
        for (const y of [-22,-18,-14]) ellipse(b, 1, y, .65, .65, '#d8c8a0');
      }
    },
  }, 1.45);
  return { paint, remains: paint.remains, shadow: 'foot' };
}
function carpenterModel(): UnitModel {
  const paint = storyFigure('worker', { weapon: 'pick', motion: 'work', cloth: '#b79d76',
    detail(b, rig, part) {
      if (part !== 'equipment') return;
      // A small mallet follows the work pose's actual wrist; no floating icon.
      b.save(); b.translate(...rig.wrist); b.rotate(rig.angle);
      line(b, [[0,4],[0,-20]], '#70583a', 2.6);
      polygon(b, [[-10,-25],[11,-25],[11,-17],[-10,-17]], '#77786c', '#343c32', .9);
      line(b, [[-9,-24],[9,-24]], '#c2b79a', 1); b.restore();
    },
  }, 1.45);
  return { paint, remains: paint.remains, shadow: 'foot' };
}

const painters: Readonly<Record<string, PropPainter>> = {
  'boarding-scar': (b, state) => {
    if (state === 'hidden') return;
    polygon(b, [[-30,-8],[-22,-14],[-13,-9],[-5,-15],[6,-10],[19,-13],[30,-5],[25,1],[31,8],[17,11],[9,15],[-4,11],[-16,14],[-29,8],[-23,0]], '#2c3029', '#a88e62', 1.3);
    for (const i of [-1,0,1]) line(b,[[-30,i*8],[31,i*7-2]],'#b8a078',1.1);
    const boards=state==='patched'?3:state==='plank2'?2:state==='plank1'?1:0;
    for(let i=0;i<boards;i++){
      const y=-11+i*9;
      polygon(b,[[-29,y],[29,y-1],[30,y+7],[-28,y+8]],'#c0a06b','#594b34',1.1);
      line(b,[[-26,y+2],[27,y+1]],'#e0c393',.9);
      for(const x of [-22,21])ellipse(b,x,y+4,1.2,1.2,'#3b4031');
    }
  },
  'boarding-pirate-flag': (b, state) => {
    if (state === 'hidden') return;
    polygon(b, [[0,-8],[52,-4],[48,21],[0,18]], '#343b35', '#252e29', 1);
    line(b, [[15,15],[34,0]], '#cfccb4', 2); line(b, [[15,0],[34,15]], '#cfccb4', 2);
    ellipse(b,25,3,6,6,'#d9d3b9'); polygon(b,[[21,6],[28,6],[27,10],[22,10]],'#d9d3b9','transparent',0);
    ellipse(b,23,2,1.1,1.2,'#343b35'); ellipse(b,28,2,1.1,1.2,'#343b35');
    line(b, [[0,-14],[0,26]], '#624f38', 2);
  },
  'boarding-repair-kit': b => {
    polygon(b,[[-13,-3],[12,-3],[14,9],[-12,10]],'#6f5639','#3a3c2e',1);
    line(b,[[-10,0],[10,0]],'#b09566',1.5);
    polygon(b, [[-17,10],[15,9],[16,13],[-17,14]], '#b39666', '#62523a', .7);
    line(b, [[-16,12],[15,11]], '#c7b187', .8);
  },
};

type CastActor = { unit: Unit; home: Point; ship: Unit; death?: number; end?: Point; delay?: number; arrivalSpan?: number; depart?: (t:number)=>Point; arrive?: (t:number)=>Point };
type TimedEffect = { start: number; span: number; effect: WorldEffect };
type DeckProp = { view: PropView; ship: Unit; at: Point; mast?: boolean };

/** An authored menu tableau, with a finite cast and event list. It never asks
 * match navigation, AI, ship production or combat to advance in the background. */
export function createPirateBoarding(): MenuSceneRun {
  const pieces = cast();
  const aId = pieces.unit(PIRATES, 'shipOfTheLine', CX, CY + 340);
  const bId = pieces.unit(GUARD, 'shipOfTheLine', CX, CY - 340);
  const game = stage(4300, 2900, terrainOf(4300, 2900, () => '~'), [[PIRATES,'grove'],[GUARD,'grove']], pieces);
  game.map.wind = { direction: Math.PI / 2, speed: 36 };
  game.players[PIRATES]!.color = '#856144'; game.players[GUARD]!.color = '#4f8581';
  const a = game.units.find(u => u.id === aId)!, b = game.units.find(u => u.id === bId)!;
  const normal = { x: -Math.sin(HEADING), y: Math.cos(HEADING) };
  a.x = CX + normal.x * 340; a.y = CY + normal.y * 340;
  b.x = CX - normal.x * 340; b.y = CY - normal.y * 340;
  const ships = [a,b];
  for (const ship of ships) {
    ship.deckScale = 2.5;
    ship.sailing = { heading: HEADING, speed: 0, load: 0, balance: 0, velocityX: 0, velocityY: 0,
      sail: { angle: -.3, billow: .2, set: .24, mode: 'idle' } };
    ship.fittings = [];
    ship.radius = shipProfile(ship)!.length / 2;
    ship.shipSizeVersion = 1;
  }
  const models = new Map<string, UnitModel>([
    ['menu/pirate', pirateModel()], ['menu/pirate-captain', pirateModel(true)],
    ['menu/marine', guardModel()], ['menu/carpenter', carpenterModel()],
  ]);
  game.variants = Object.fromEntries([...models.keys()].map(id => [id, resolveVariant({base:id === 'menu/carpenter' ? 'worker' : 'footman'})]));
  game.items = [];
  const guns: WorldItem[] = [];
  for (const ship of ships) for (const mount of shipMounts(ship)) {
    const item: WorldItem = { id: `menu-gun-${ship.id}-${mount.id}`, kind: 'shipCannon', x: ship.x, y: ship.y,
      shipId: ship.id, mountId: mount.id, durability: 90, cooldownRemaining: 0, facing: HEADING + mount.bearing };
    guns.push(item); game.items.push(item);
    ship.fittings = [...ship.fittings!, { ...mount, accepts: [...mount.accepts], id: item.id }];
  }
  const actors: CastActor[] = [];
  const actor = (ship: Unit, variant: string, at: Point, death?: number, end?: Point, delay = 0): CastActor => {
    const unit = game.spawnUnit(ship.owner, variant === 'menu/carpenter' ? 'worker' : 'footman', ship.x, ship.y);
    unit.variant = variant; unit.radius = 15;
    unit.deck = { shipId: ship.id, ...at }; unit.order = { type: 'idle' };
    const result = { unit, home: at, ship, ...(death === undefined ? {} : { death }), ...(end ? { end } : {}), delay };
    actors.push(result); return result;
  };
  const boarders: CastActor[] = [];
  for (let i = 0; i < 8; i++) boarders.push(actor(a, i === 0 ? 'menu/pirate-captain' : 'menu/pirate',
    { x: 90 - i * 64, y: i===7?90:70 }, undefined,
    { x: (i<4?[-250,0,160,280]:[-200,-100,55,110])[i%4]!, y: i < 4 ? 45 : -65 }, i * 1.35));
  for(const crew of boarders){
    crew.depart=authoredPath([crew.home,{x:90,y:70},{x:90,y:-155}]);
    crew.arrive=authoredPath([{x:90,y:155},{x:90,y:90},{x:crew.end!.x,y:90},crew.end!]);
    crew.arrivalSpan=(65+Math.abs(crew.end!.x-90)+Math.abs(crew.end!.y-90))/100;
  }
  actor(a,'menu/pirate',{x:170,y:-85}); actor(a,'menu/pirate',{x:300,y:-60});
  const defenders: CastActor[] = [];
  const deaths = [2.88,3.22,8.06,8.4,38.2,40,41.8];
  const defenderHomes=[{x:-222,y:90},{x:-96,y:90},{x:30,y:90},{x:150,y:90},{x:-250,y:0},
    {x:0,y:0},{x:160,y:0},{x:280,y:0},{x:-100,y:-20},{x:110,y:-20}];
  for (let i = 0; i < 10; i++) defenders.push(actor(b,'menu/marine',
    defenderHomes[i]!, deaths[i],
    i >= 4 ? defenderHomes[i]:undefined));
  for(const crew of defenders)if(crew.end)crew.arrive=()=>crew.end!;
  const workers = [actor(b,'menu/carpenter',{x:-155,y:130}),actor(b,'menu/carpenter',{x:85,y:120}),actor(b,'menu/carpenter',{x:330,y:-20})];
  // Crew creation adds their normal carried equipment. Guns retain only their
  // mounts; local models author costume and handheld gear through storyFigure.
  const allUnits = [...game.units];
  const corpses: { start: number; corpse: Corpse }[] = actors.filter(actor => actor.death !== undefined).map(actor => ({
    start: actor.death!, corpse: { id: `menu-remains-${actor.unit.id}`, unitId: actor.unit.id, kind: actor.unit.kind,
      ...(actor.unit.variant ? {variant: actor.unit.variant} : {}), owner: actor.unit.owner, x: 0, y: 0, radius: actor.unit.radius,
      diedAtTick: Math.round(actor.death! * SIM_TICKS_PER_SECOND), deck: {shipId:actor.ship.id,...(actor.end ?? actor.home)} },
  }));
  game.corpses = [];
  const deckProps: DeckProp[] = [];
  const prop = (kind: string, ship: Unit, at: Point, state?: string, mast = false) => {
    const view = pieces.prop(kind,0,0,1,state); deckProps.push({view,ship,at,mast}); return view;
  };
  const scars = [prop('boarding-scar',b,{x:-155,y:90},'hidden'),prop('boarding-scar',b,{x:85,y:80},'hidden')];
  for (const worker of workers.slice(0,2)) prop('boarding-repair-kit',b,{x:worker.home.x-22,y:worker.home.y-25});
  prop('boarding-pirate-flag',a,{x:-30,y:0},undefined,true);
  const prizeFlag = prop('boarding-pirate-flag',b,{x:-30,y:0},'hidden',true);
  const bridge: ShipGangway = { targetId: b.id, phase: 'deploying', sourceAnchor: {x:90,y:-155}, targetAnchor:{x:90,y:155},
    width:48, initialSpan:134, initialHeadingDelta:0, hp:60, readyAtTick:520, cooldownUntilTick:0 };
  const events: TimedEffect[] = [];
  const effect = (start: number, span: number, facts: Omit<WorldEffect,'id'|'remaining'|'duration'>) => {
    events.push({start,span,effect:{...facts,id:`menu-boarding-effect-${events.length}`,remaining:span*SIM_TICKS_PER_SECOND,duration:span*SIM_TICKS_PER_SECOND}});
  };
  // The actual mounted muzzle and deck height are the visual source of every
  // ball; broadside sequence is authored once, never appended every frame.
  const volleyTimes = [2.2,6.7];
  const aimedGuns = guns.filter(item => item.shipId === a.id && item.mountId?.startsWith('port'));
  for (const base of volleyTimes) for (const [i, item] of aimedGuns.entries()) {
    const start = base + i * .34;
    const pose = mountedWeaponPose(a,item)!;
    const targetLocal = {x:shipMounts(a).find(m => m.id === item.mountId)!.x,y:130};
    // Ships are in their opening stations for both salvos. Aiming uses the
    // local mount station, preserving the parallel battery's contact points.
    const target = localToWorld(b,targetLocal);
    const source = pose.muzzle;
    effect(start,.8,{type:'muzzleFlash',x:source.x,y:source.y,fromX:source.x,fromY:source.y,fromHeight:pose.height,
      toX:target.x,toY:target.y,toHeight:shipProfile(b)!.deckHeight,sourceKind:a.kind,sourceId:a.id,itemId:item.id,owner:PIRATES,attackKind:'cannon'});
    effect(start,.68,{type:'siegeBolt',x:target.x,y:target.y,fromX:source.x,fromY:source.y,fromHeight:pose.height,
      toX:target.x,toY:target.y,toHeight:shipProfile(b)!.deckHeight,sourceKind:a.kind,sourceId:a.id,itemId:item.id,owner:PIRATES,attackKind:'cannon'});
    effect(start+.68,.8,{type:'siegeImpact',x:target.x,y:target.y-presentationHeight(b),radius:38,owner:PIRATES});
  }
  let actionCues: UnitActionCue[] = [];
  const floorPoint = (unit: Unit, ship: Unit, local: Point) => {
    unit.deck!.shipId = ship.id; unit.deck!.x = local.x; unit.deck!.y = local.y;
    Object.assign(unit,localToWorld(ship,local));
  };
  const script: MenuSceneRun['script'] = (_game, second) => {
    const time = Math.max(0,second % LENGTH);
    game.tick = Math.floor(time * SIM_TICKS_PER_SECOND);
    const closure = eased((time-18)/6);
    const separation = 680 + (444-680)*closure;
    const half = separation / 2, nx=-Math.sin(HEADING),ny=Math.cos(HEADING);
    a.x=CX+nx*half; a.y=CY+ny*half;
    b.x=CX-nx*half; b.y=CY-ny*half;
    a.owner=PIRATES; b.owner=time>=45?PIRATES:GUARD;
    for(const ship of ships){ship.sailing!.sail!.set=.55-.5*eased((time-17)/6);ship.sailing!.sail!.billow=.2;}
    if(time>=24)a.sailing!.gangway=bridge;else delete a.sailing!.gangway;
    bridge.phase=time>=26?'ready':'deploying';
    // Both parallel hulls stop before the gangway appears; their shared real
    // anchors supply supported deck-to-deck movement without a route search.
    game.units.length=0;
    for (const unit of allUnits) game.units.push(unit);
    actionCues=[];
    for(const cast of actors){
      const {unit,home,ship,death}=cast;
      unit.hp=unit.maxHp; unit.owner=ship===a?PIRATES:GUARD; delete unit.gangway; unit.order={type:'idle'};
      let parent=ship,at=home;
      if(boarders.includes(cast)){
        const crossAt=28.3+(cast.delay??0),travel=(Math.hypot(90-home.x,70-home.y)+225)/80,t=time-crossAt;
        const source={x:90,y:-155};
        if(t < -travel)at=home;
        else if(t<0)at=cast.depart!((t+travel)/travel);
        else if(t<2.3){
          const progress=clamp(t/2.3); const surface=gangwaySurface(a,b);
          at=source; unit.gangway={sourceId:a.id,targetId:b.id,t:progress,lateral:0};
          if(surface)Object.assign(unit,lerp(surface.source,surface.target,progress));
        }else{parent=b;at=cast.arrive!((t-2.3)/cast.arrivalSpan!);}
      }else if(ship===b&&cast.end)at=cast.arrive!(eased((time-29)/3));
      if(cast===workers[1])at=time<25?lerp(home,{x:85,y:70},eased((time-23)/2)):
        lerp({x:85,y:70},{x:40,y:70},eased((time-25)/1.5));
      floorPoint(unit,parent,at);
      if(unit.gangway){const surface=gangwaySurface(a,b);if(surface)Object.assign(unit,lerp(surface.source,surface.target,unit.gangway.t));}
      if(death!==undefined&&time>=death){unit.hp=0;continue;}
      if(parent===b&&time>=45&&!workers.includes(cast)){unit.owner=PIRATES;unit.order={type:'idle'};}
    }
    for(const cast of actors){
      const {unit}=cast;
      const fighting=unit.hp>0&&unit.deck?.shipId===b.id&&time>=34&&time<43.5&&cast.end&&!unit.gangway
        &&(cast.ship!==a||time>=28.3+(cast.delay??0)+2.3+cast.arrivalSpan!);
      if(fighting){
        let other:CastActor|undefined,gap=90;
        for(const candidate of unit.owner===PIRATES?defenders:boarders){
          if(candidate.unit.hp<=0||candidate.unit.deck?.shipId!==b.id||candidate.unit.gangway)continue;
          const distance=Math.hypot(unit.x-candidate.unit.x,unit.y-candidate.unit.y);
          if(distance<gap){other=candidate;gap=distance;}
        }
        if(other){
          unit.order={type:'attack',targetId:other.unit.id};
          const beat=34.4+(cast.delay??0)%1.2+Math.floor((time-34.4-(cast.delay??0)%1.2)/1.15)*1.15;
          if(beat<=time&&time-beat<1)actionCues.push({unitId:unit.id,mode:'attack',tick:Math.floor(beat*SIM_TICKS_PER_SECOND),fromX:unit.x,fromY:unit.y,toX:other.unit.x,toY:other.unit.y,fromHeight:shipProfile(b)!.deckHeight+18,toHeight:shipProfile(b)!.deckHeight+18});
        }
      }
    }
    // Only live cast enters the snapshot. Deaths have separately owned deck
    // remains, so wounded sailors do not revive beneath the victors' feet.
    for(let i=game.units.length-1;i>=0;i--)if(game.units[i]!.hp<=0)game.units.splice(i,1);
    game.corpses!.length=0;
    for(const corpse of corpses)if(time>=corpse.start)game.corpses!.push(corpse.corpse);
    game.effects.length=0;
    for(const event of events){const age=time-event.start;if(age>=0&&age<event.span){event.effect.remaining=(event.span-age)*SIM_TICKS_PER_SECOND;game.effects.push(event.effect);}}
    if(time>=10&&time<23)for(const [i,worker] of workers.entries()){
      worker.unit.order={type:'repairShip',targetId:b.id};
      const age=(time-10+i*.21)%.7;
      if(age<.65)game.effects.push({id:`menu-mallet-${worker.unit.id}-${Math.floor((time-10+i*.21)/.7)}`,type:'repair',x:worker.unit.x,y:worker.unit.y,
        unitId:worker.unit.id,fromX:b.x,fromY:b.y,duration:13,remaining:(.65-age)*SIM_TICKS_PER_SECOND});
    }
    b.hp=b.maxHp*(time<3?1:time<10?.63:time<23?.63+.25*eased((time-10)/12):.88);
    scars[0]!.state=time<3?'hidden':time<11.5?'broken':time<14?'plank1':time<16?'plank2':'patched';
    scars[1]!.state=time<8.4?'hidden':time<15?'broken':time<17.5?'plank1':time<20?'plank2':'patched';
    prizeFlag.state=time>=45?'raised':'hidden';
    for(const entry of deckProps){
      const world=localToWorld(entry.ship,entry.at);
      entry.view.x=world.x;entry.view.y=world.y-presentationHeight(entry.ship)-(entry.mast?shipProfile(entry.ship)!.mastHeight*Math.tan(SHIP_CAMERA.tilt):0);
    }
    for(const item of guns){const ship=item.shipId===a.id?a:b;item.x=ship.x;item.y=ship.y;}
  };
  script(game,0);
  return {
    game,props:[],presentation:true,length:LENGTH,stillSecond:38,
    focus:{x:CX,y:CY-150},zoom:.7,script,models:variant=>models.get(variant),painters,actions:()=>actionCues,
    frameAt(second,width,height){
      const t=second%LENGTH;
      const closeup=eased((t-22)/6);
      const repair=eased((t-9)/3.5)*(1-eased((t-15.5)/3));
      const workA=localToWorld(b,workers[0]!.home),workB=localToWorld(b,workers[1]!.home);
      const repairFocus={x:(workA.x+workB.x)/2,y:(workA.y+workB.y)/2-presentationHeight(b)};
      if(width<700){
        return {focus:lerp({x:CX,y:CY-175},repairFocus,repair*.75),zoom:Math.min(width/1220,height/1900)*(1+closeup*.3+repair*.18),anchorX:.5,anchorY:.31};
      }
      const zoom=Math.min((width*.56)/1220,(height*.88)/1280)*(1+closeup*.15+repair*.32);
      return {focus:lerp({x:CX,y:CY-150},repairFocus,repair),zoom,anchorX:.74,anchorY:.51};
    },
    foreground(ctx,view){
      for(const {view:prop} of deckProps){
        if(prop.state==='hidden')continue;
        const at=projectWorld(view,prop);ctx.save();ctx.translate(at.x,at.y);ctx.scale(view.zoom??1,view.zoom??1);
        painters[prop.kind]?.(ctx,prop.state);ctx.restore();
      }
      // These reuse the game's cannon ink. The finite smoke puffs and ball
      // trails stay legible over the deck and rig instead of being depth-hidden.
      for(const effect of game.effects)if(['muzzleFlash','siegeBolt','siegeImpact'].includes(effect.type))
        drawWarfareEffect(ctx,effect,point=>projectWorld(view,point),()=>true);
      for(const pulse of game.effects){
        if(pulse.type!=='repair')continue;
        const worker=workers.find(crew=>crew.unit.id===pulse.unitId);
        if(!worker||worker===workers[2])continue;
        const age=(pulse.duration-pulse.remaining)/SIM_TICKS_PER_SECOND;
        if(age<.2||age>.5)continue;
        const progress=(age-.2)/.3,contact=localToWorld(b,{x:worker.home.x,y:worker.home.y-35});
        const floor=shipProfile(b)!.deckHeight;
        ctx.save();ctx.globalAlpha=1-progress;
        // Four light wood chips lift at the mallet's contact and fall back to
        // this moving deck. Their age comes from the actual repair stroke.
        for(let i=0;i<4;i++){
          const world={x:contact.x+(i-1.5)*5+progress*(i%2?1:-1)*(8+i*3),y:contact.y+progress*(i%2?7:-7)};
          const at=projectWorld(view,world,floor+Math.max(0,22+35*progress-70*progress*progress));
          line(ctx,[[at.x-2,at.y-1],[at.x+2,at.y+1]],i%2?'#dbbf86':'#b9925d',1.3);
        }
        if(progress<.18){
          const at=projectWorld(view,contact,floor+22);
          for(let i=0;i<5;i++){
            const a=i*Math.PI*2/5;
            line(ctx,[[at.x+Math.cos(a)*2,at.y+Math.sin(a)*2],[at.x+Math.cos(a)*6,at.y+Math.sin(a)*6]],'#e3c693',1.1);
          }
        }
        ctx.restore();
      }
    },
    embers:[],glows:[],air:{dusk:.12,mist:'103, 127, 124',mistAlpha:.13,rays:'212, 193, 145',rayAngle:-.16,motes:'glints'},
  };
}
