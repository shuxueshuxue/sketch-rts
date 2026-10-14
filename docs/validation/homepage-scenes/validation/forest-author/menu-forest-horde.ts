import { UNIT_DEFS } from '../shared/catalog';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import type { Corpse, Unit, UnitKind, WorldEffect } from '../shared/types';
import type { UnitActionCue } from '../story/stage';
import { cast, stage, terrainOf, type MenuSceneRun } from './menu-scene-world';

type Point = { x: number; y: number };
type Actor = {
  unit: Unit; home: Point; contact: Point; begin: number; end: number;
  target?: Actor; death?: number; ranged?: boolean; charge?: boolean;
};
type TimedEffect = { start: number; span: number; effect: WorldEffect };
type TimedAction = { start: number; cue: UnitActionCue };
const ARMY = 'court', HORDE = 'wilds';
const CX = 2140, CY = 1250, LENGTH = 52;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };

function position(actor: Actor, second: number): Point {
  const time = Math.min(second, actor.death ?? Infinity);
  const t = smooth((time - actor.begin) / (actor.end - actor.begin));
  return { x: actor.home.x + (actor.contact.x - actor.home.x) * t, y: actor.home.y + (actor.contact.y - actor.home.y) * t };
}

/** A finite forest battle cast. Formations and attack beats are authored menu
 * presentation; match AI, navigation, unit rules and combat never run here. */
export function createForestHorde(): MenuSceneRun {
  const pieces = cast();
  const terrain = terrainOf(3800, 2600, (x, y) => {
    const clearing = 335 + Math.sin((x - CX) / 240) * 35;
    if (Math.abs(y - CY) > clearing || Math.abs(x - CX) > 920) return 'T';
    return Math.abs(y - CY + Math.sin(x / 310) * 32) < 45 ? '.' : ',';
  });
  // Scenery borders the movement lanes, leaving weapons and large bodies a
  // clear contact area. No trees or rocks are placed in the authored routes.
  for (const [x, y, scale] of [[-680,-325,1.6],[-470,325,1.8],[390,335,1.5],[660,-330,1.8]] as const)
    pieces.prop('deadTree', CX+x, CY+y, scale);
  for (const [x, y, scale] of [[-600,310,1.5],[-300,-320,1.3],[310,-325,1.6],[660,310,1.5]] as const)
    pieces.prop('stone', CX+x, CY+y, scale);
  pieces.prop('banner', CX-410, CY-280, 1.5);
  pieces.prop('banner', CX-405, CY+292, 1.3);
  pieces.prop('cart', CX-570, CY+255, 1.3);
  pieces.prop('crate', CX-565, CY+286, 1.2);
  pieces.prop('cairn', CX+560, CY-283, 1.5);
  pieces.prop('campfire', CX+575, CY+263, 1, 'out');
  const seeds: { id: string; home: Point; contact: Point; begin: number; end: number; ranged?: boolean; charge?: boolean; death?: number }[] = [];
  const seed = (owner: string, kind: UnitKind, home: Point, contact: Point, begin = 1, end = 9, extras: Partial<Pick<Actor,'ranged'|'charge'|'death'>> = {}) => {
    const worldHome = {x: CX+home.x, y: CY+home.y};
    const id = pieces.unit(owner, kind, worldHome.x, worldHome.y);
    seeds.push({id, home: worldHome, contact: {x:CX+contact.x,y:CY+contact.y}, begin, end, ...extras});
    return id;
  };
  const lineIds: string[] = [], monsterIds: string[] = [];
  const frontKinds: UnitKind[] = ['wildling','ogreWarrior','stonebackBrute','rockGolem','venomSpider','ogreLord','wildling','spiderQueen'];
  for (let i=0;i<8;i++) {
    const y=-196+i*56;
    lineIds.push(seed(ARMY,i%2?'lancer':'footman',{x:-245,y},{x:i%2?-38:-30,y},1,9,
      i===1?{death:31.6}:i===6?{death:35.4}:{}));
    // Uneven approaches, varied silhouettes and slightly staggered front feet
    // distinguish a wild swarm from the soldiers' regular ranks.
    monsterIds.push(seed(HORDE,frontKinds[i]!,{x:300+(i*37)%105,y:y+((i%3)-1)*12},
      {x:i===5?28:i===3?24:22,y:y+(i%2?8:-5)},3+i*.16,12.5+i*.12,
      i===0?{death:17.6}:i===4?{death:24.6}:i===6?{death:29.2}:{}));
  }
  const archerIds: string[] = [];
  for(let i=0;i<6;i++) archerIds.push(seed(ARMY,'archer',{x:-385-(i%2)*45,y:-155+i*62},
    {x:-220-(i%2)*38,y:-155+i*62},2.2,7.8,{ranged:true}));
  const knightIds = [
    seed(ARMY,'knight',{x:-420,y:-280},{x:-34,y:-278},7.5,14,{charge:true}),
    seed(ARMY,'knight',{x:-425,y:279},{x:-36,y:278},8,14.5,{charge:true}),
  ];
  seed(ARMY,'priest',{x:-440,y:-30},{x:-325,y:-30},3,8);
  seed(ARMY,'footman',{x:-365,y:30},{x:-133,y:31},3,9);
  const largeIds = [
    seed(HORDE,'graniteGolem',{x:415,y:-274},{x:33,y:-274},5.5,14),
    seed(HORDE,'ancientStag',{x:458,y:284},{x:31,y:279},6,14.5),
  ];
  const slingerIds: string[] = [];
  for(let i=0;i<3;i++) slingerIds.push(seed(HORDE,'thornSlinger',{x:535+(i%2)*46,y:-154+i*147},
    {x:204+(i%2)*44,y:-154+i*147},4,13,{ranged:true}));
  seed(HORDE,'barkMender',{x:570,y:40},{x:303,y:35},5,14);
  const reserveKinds: UnitKind[] = ['mossGnawer','spiderling','wildling','ogreWarrior','mossGnawer','venomSpider','wildling','spiderling'];
  for(let i=0;i<8;i++) {
    const y=-237+i*65+(i%2?10:-6);
    seed(HORDE,reserveKinds[i]!,{x:510+(i*41)%138,y},
      {x:112+(i*43)%92,y},5+i*.13,14+i*.17, i===2?{death:8.15}:i===5?{death:10.35}:{});
  }
  const game = stage(3800,2600,terrain,[[ARMY,'grove'],[HORDE,'grove']],pieces);
  game.players[ARMY]!.color='#497b75'; game.players[HORDE]!.color='#88765b';
  const actors: Actor[] = seeds.map(seed => ({...seed,unit:game.units.find(unit=>unit.id===seed.id)!}));
  for(const actor of actors)actor.unit.aim={x:actor.unit.x+(actor.unit.owner===ARMY?100:-100),y:actor.unit.y,anchorX:actor.unit.x,anchorY:actor.unit.y,tracking:false,updatedTick:0};
  const byId = new Map(actors.map(actor=>[actor.unit.id,actor]));
  const lines=lineIds.map(id=>byId.get(id)!), fronts=monsterIds.map(id=>byId.get(id)!);
  const knights=knightIds.map(id=>byId.get(id)!), heavies=largeIds.map(id=>byId.get(id)!);
  for(let i=0;i<lines.length;i++){lines[i]!.target=fronts[i]!;fronts[i]!.target=lines[i]!;}
  for(let i=0;i<knights.length;i++){knights[i]!.target=heavies[i]!;heavies[i]!.target=knights[i]!;}
  const archers=archerIds.map(id=>byId.get(id)!), slingers=slingerIds.map(id=>byId.get(id)!);
  for(let i=0;i<archers.length;i++)archers[i]!.target=fronts[(i+2)%fronts.length]!;
  for(let i=0;i<slingers.length;i++)slingers[i]!.target=lines[i*3]!;
  // Authored casualties get one explicit fatal contact at their own death
  // time. Biological / mechanical metadata stays faithful to the catalogue.
  const effects: TimedEffect[] = [], actions: TimedAction[] = [];
  const add = (start:number,span:number,facts:Omit<WorldEffect,'id'|'duration'|'remaining'>) => {
    effects.push({start,span,effect:{...facts,id:`menu-forest-effect-${effects.length}`,duration:span*SIM_TICKS_PER_SECOND,remaining:span*SIM_TICKS_PER_SECOND}});
  };
  const release = (actor:Actor,target:Actor,start:number,flight:number,fatal=false) => {
    if(start<0 || start>=(actor.death??Infinity) || start+flight>(target.death??Infinity)+1e-8)return;
    const from=position(actor,start),to=position(target,start+flight),tick=Math.floor(start*SIM_TICKS_PER_SECOND);
    const cue:UnitActionCue={unitId:actor.unit.id,mode:'attack',tick,fromX:from.x,fromY:from.y,toX:to.x,toY:to.y,fromHeight:18,toHeight:20};
    actions.push({start,cue});
    if(flight>0)add(start,flight,{type:'projectile',x:to.x,y:to.y,fromX:from.x,fromY:from.y,toX:to.x,toY:to.y,
      fromHeight:18,toHeight:20,owner:actor.unit.owner,sourceKind:actor.unit.kind,sourceId:actor.unit.id,
      actionMode:'attack',actionTick:tick,attackKind:actor.unit.kind==='archer'?'arrow':'stone'});
    add(start+flight,.65,{type:'hit',x:to.x,y:to.y,fromX:from.x,fromY:from.y,owner:actor.unit.owner,unitId:target.unit.id,
      sourceId:actor.unit.id,sourceKind:actor.unit.kind,damage:actor.unit.attackDamage,targetKind:target.unit.kind,
      targetMaxHp:target.unit.maxHp,targetRadius:target.unit.radius,targetUnitClass:UNIT_DEFS[target.unit.kind].unitClass,
      targetHpAfter:fatal?0:Math.max(actor.unit.attackDamage*3,target.unit.maxHp*.6)});
  };
  // The opening volley is readable before the melee joins. Later archery and
  // sling beats support the line, without spawning unbounded projectile AI.
  for(const base of [5.7,8.7,16.5,22.5,28.5,37])for(const [i,actor] of archers.entries())
    release(actor,actor.target!,base+i*.1,.55);
  for(const base of [15.2,21.3,27.4,34.3,40])for(const [i,actor] of slingers.entries())
    release(actor,actor.target!,base+i*.22,.65);
  for(const [i,actor] of [...lines,...fronts,...knights,...heavies].entries()) {
    const begin=Math.max(actor.end,actor.target!.end)+.35+i%4*.16;
    const period=actor.unit.kind==='graniteGolem'?2.3:actor.unit.kind==='ogreLord'?1.9:1.55+i%3*.13;
    for(let beat=begin;beat<43;beat+=period)release(actor,actor.target!,beat,0);
  }
  for(const victim of actors.filter(actor=>actor.death!==undefined)) {
    const attacker=victim.target??archers[victim.unit.kind==='venomSpider'?3:0]!;
    release(attacker,victim,victim.death!-(attacker.ranged?.55:0),attacker.ranged?.55:0,true);
  }
  const remains = actors.filter(actor=>actor.death!==undefined).map(actor => {
    const at=position(actor,actor.death!);
    const corpse:Corpse={id:`menu-forest-remains-${actor.unit.id}`,unitId:actor.unit.id,kind:actor.unit.kind,owner:actor.unit.owner,
      x:at.x,y:at.y,radius:actor.unit.radius,diedAtTick:Math.round(actor.death!*SIM_TICKS_PER_SECOND),
      equipmentCaptured:true,rightItemKind:'issuedWeapon',weaponKind:actor.unit.kind,ownerRace:'grove',
      ...(actor.unit.kind==='footman'?{leftItemKind:'roundShield' as const}:{})};
    return {start:actor.death!,corpse};
  });
  game.corpses=[];
  for(let i=0;i<17;i++)game.map.landmarks.push({id:`forest-edge-${i}`,kind:i%3?'pebbles':'log',
    x:CX-710+(i*137)%1430,y:CY+(i%2?317:-328),size:18+(i%3)*9,rotation:i*.43});
  const cues:UnitActionCue[]=[];
  const script:MenuSceneRun['script']=(_game,second)=>{
    const time=Math.max(0,second%LENGTH);
    game.tick=Math.floor(time*SIM_TICKS_PER_SECOND);
    game.units.length=0;
    for(const actor of actors){
      const {unit}=actor,at=position(actor,time);
      unit.x=at.x;unit.y=at.y;unit.hp=unit.maxHp;
      if(time>=(actor.death??Infinity)){unit.hp=0;continue;}
      const target=actor.target,active=target&&time<(target.death??Infinity)&&time<43;
      if(active){
        unit.order=actor.charge&&time>=actor.begin&&time<actor.end
          ?{type:'charge',targetId:target.unit.id,resume:{type:'idle'}}
          :{type:'attack',targetId:target.unit.id};
        // Aim maintains the opposing army's opening leftward facing, even
        // before displacement or the first release initializes its tracker.
        const aim=position(target,time);
        Object.assign(unit.aim!,{x:aim.x,y:aim.y,anchorX:unit.x,anchorY:unit.y,updatedTick:game.tick});
      }else{
        unit.order={type:'hold',x:unit.x,y:unit.y};
        Object.assign(unit.aim!,{x:unit.x+(unit.owner===ARMY?100:-100),y:unit.y,anchorX:unit.x,anchorY:unit.y,updatedTick:game.tick});
      }
      game.units.push(unit);
    }
    game.effects.length=0;
    for(const event of effects){const age=time-event.start;if(age>=0&&age<event.span){event.effect.remaining=(event.span-age)*SIM_TICKS_PER_SECOND;game.effects.push(event.effect);}}
    cues.length=0;
    for(const action of actions)if(time>=action.start&&time-action.start<.5)cues.push(action.cue);
    game.corpses!.length=0;
    for(const event of remains)if(time>=event.start)game.corpses!.push(event.corpse);
  };
  script(game,0);
  return {game,props:pieces.props,presentation:true,length:LENGTH,stillSecond:16.7,focus:{x:CX,y:CY},zoom:1,script,actions:()=>cues,
    frameAt(second,width,height){
      const close=smooth((second%LENGTH-3)/9),span=1160-260*close;
      if(width<700)return{focus:{x:CX+45-55*close,y:CY-70},zoom:Math.min(width/span,(height*.55)/720),anchorX:.51,anchorY:.3};
      return{focus:{x:CX+30-50*close,y:CY-5},zoom:Math.min(width*.59/span,height*.79/760),anchorX:.71,anchorY:.52};
    },embers:[],glows:[],air:{dusk:.19,mist:'205, 204, 183',mistAlpha:.1,rays:'232, 218, 174',rayAngle:-.4,motes:'fireflies'}};
}
