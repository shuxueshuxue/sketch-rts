import { UNIT_DEFS, resolveVariant } from '../../shared/catalog';
import { createBuilding } from '../../shared/map';
import { createGame, issuePlayerCommand, spawnVariantUnit, stepGame, strikeUnit, addWorldEffect, snapshotGame, restoreSnapshotIntoGame, type Game } from '../../shared/sim';
import { isWalkable, walkableGoal } from '../../shared/terrain';
import { createShop } from '../../shared/shop';
import type { Building, GameCommand, GameSnapshot, Unit, UnitKind } from '../../shared/types';

export const TITLE = '潮汐王座';
export const PLAYER = 'player';
export const ALLY = 'fleet';
export const ENEMY = 'crown';
export const HERO = 'tide-admiral';
export type Side = typeof ALLY | typeof ENEMY;
export const SHIPS = [
 {id:'cutter',name:'巡海快艇',base:'warship',hp:190,speed:5.2,attackDamage:15,attackRange:350,cost:130,role:'快速截击与侧翼侦察'},
 {id:'frigate',name:'重弩护卫舰',base:'warship',hp:540,speed:3.2,attackDamage:55,attackRange:520,cost:280,role:'中程反舰，保护运输线'},
 {id:'bombard',name:'臼炮舰',base:'warship',hp:320,speed:2.1,attackDamage:140,attackRange:850,cost:430,role:'远程轰岸，惧怕快艇近身'},
 {id:'fireship',name:'焚潮舰',base:'warship',hp:750,speed:3.8,attackDamage:100,attackRange:125,cost:260,role:'近距离破阵，接敌时灼烧周边'},
 {id:'transport',name:'登陆运输舰',base:'transport',hp:650,speed:3.5,attackDamage:0,attackRange:0,cost:180,role:'运载八人口，右键登船、D 卸载'},
] as const;
export const SIEGE = [
 {id:'ram',name:'铁甲冲车',base:'golem',hp:1300,speed:1.8,attackDamage:95,attackRange:75,cost:300,role:'重甲接近城门，承受箭雨'},
 {id:'ballista',name:'床弩',base:'archer',hp:260,speed:2,attackDamage:90,attackRange:650,cost:240,role:'精准打击大型目标'},
 {id:'mortar',name:'重型投石机',base:'golem',hp:380,speed:1.5,attackDamage:160,attackRange:800,cost:380,role:'抛射破墙，缓慢且脆弱'},
 {id:'organ',name:'连弩车',base:'archer',hp:300,speed:2.5,attackDamage:35,attackRange:420,cost:260,role:'压制密集步兵，快速连射'},
 {id:'sapper',name:'破城术士',base:'witch',hp:200,speed:3.1,attackDamage:65,attackRange:300,cost:220,role:'机动攻坚，诅咒守军'},
] as const;
export const DEFENSES = [
 {id:'watch',name:'石砌箭塔',hp:950,damage:24,range:520,cooldown:22,cost:150,role:'低价覆盖，持续防御'},
 {id:'lance',name:'重弩堡',hp:1100,damage:140,range:640,cooldown:75,cost:320,role:'克制巨兽与重舰，怕人海'},
 {id:'flame',name:'炼火堡',hp:850,damage:25,range:230,cooldown:18,cost:250,role:'近程群伤，守住狭口'},
 {id:'mortar',name:'岸防炮台',hp:800,damage:175,range:880,cooldown:110,cost:410,role:'超远程反舰与反攻城，近战薄弱'},
 {id:'wall',name:'海堤路障',hp:1500,damage:0,range:0,cooldown:30,cost:80,role:'低成本封路，迫使敌军改道或破拆'},
 {id:'ward',name:'庇护圣所',hp:1250,damage:0,range:280,cooldown:30,cost:280,role:'治疗驻军，必须配合火力'},
] as const;
export const RELICS = [
 {name:'雷霆权杖',key:'1',cooldown:22,range:850,radius:230,description:'目标区域落雷，重创密集敌军'},
 {name:'潮汐圣印',key:'2',cooldown:30,range:800,radius:300,description:'恢复目标区域友军生命'},
 {name:'破城符石',key:'3',cooldown:35,range:900,radius:150,description:'摧毁目标附近的防御工事'},
 {name:'寒潮之眼',key:'4',cooldown:32,range:850,radius:330,description:'冰封敌军，打断敌方推进'},
 {name:'龙焰契约',key:'5',cooldown:50,range:850,radius:300,description:'大范围龙焰，燃尽敌军'},
 {name:'归航罗盘',key:'6',cooldown:40,range:1800,radius:210,description:'将英雄及附近远征军撤至目标陆地'},
] as const;
export type Port = {id:string;name:string;x:number;y:number;value:number;owner:Side|null;progress:number;contested:boolean;captures:number};
export type CampaignState = {
 version:1; jobs:{id:string;kind:string;building:string;remaining:number;cost:number}[]; voyages:Record<string,{target:string;stage:string;since:number}>; reserves:string[]; plans:{worker:string;id:string;x:number;y:number}[]; ports:Port[]; defense:Record<string,string>; cooldowns:number[]; outcome:'playing'|'victory'|'defeat';
 phase:number; hold:number; losses:number; peak:number; supply:Record<Side,number>; log:{tick:number;text:string}[];
 builds:number; repairs:number; casts:number; recruits:number; difficulty:'standard'|'veteran';
};
export type CampaignSave = {version:1;snapshot:GameSnapshot;nextId:number;state:CampaignState};
export class TideboundCampaign {
 game:Game; state:CampaignState;
 constructor(difficulty:'standard'|'veteran'='standard',save?:CampaignSave) {
  this.game=createGame('bareDuel',{players:[PLAYER,ALLY,ENEMY],aiPlayers:[],teams:{[PLAYER]:'league',[ALLY]:'league',[ENEMY]:'crown'}});
  this.game.scriptedVictory=true;
  this.state={version:1,jobs:[],voyages:{},reserves:[],plans:[],ports:[
   {id:'north',name:'北岬船坞',x:3800,y:1600,value:3,owner:null,progress:0,contested:false,captures:0},
   {id:'heart',name:'王座海峡',x:4100,y:4000,value:5,owner:null,progress:0,contested:false,captures:0},
   {id:'south',name:'白盐港',x:3800,y:6400,value:3,owner:null,progress:0,contested:false,captures:0},
   {id:'west',name:'灯塔岛',x:1250,y:4000,value:4,owner:ALLY,progress:-100,contested:false,captures:0},
   {id:'east',name:'黑礁军港',x:6950,y:4000,value:4,owner:ENEMY,progress:100,contested:false,captures:0},
  ],defense:{},cooldowns:[0,0,0,0,0,0],outcome:'playing',phase:0,hold:0,losses:0,peak:0,supply:{[ALLY]:2400,[ENEMY]:2400},log:[],builds:0,repairs:0,casts:0,recruits:0,difficulty};
  if(save){if(save.version!==1)throw Error('不兼容的战役存档');restoreSnapshotIntoGame(this.game,save.snapshot,save.nextId);this.state={...this.state,...structuredClone(save.state)};return;}
  this.initialize();
 }
 private initialize(){
  const g=this.game;g.units=[];g.buildings=[];g.resources=[];g.mercenaryCamps=[];g.items=[];g.effects=[];g.projectiles=[];g.corpses=[];
  g.map={id:'bareDuel',name:TITLE,width:8192,height:8192,landmarks:[]};
  const cells:string[]=[];
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
   const px=x*64+32,py=y*64+32;
   const islands=[{x:4100,y:1600,rx:2200,ry:1000},{x:4100,y:4000,rx:2200,ry:1000},{x:4100,y:6400,rx:2200,ry:1000},{x:800,y:4000,rx:650,ry:680},{x:7400,y:4000,rx:620,ry:690}];
   const d=Math.min(...islands.map(i=>((px-i.x)/i.rx)**2+((py-i.y)/i.ry)**2));
   const ford=(Math.abs(px-3100)<170||Math.abs(px-5100)<170)&&py>1500&&py<6500;
   cells.push(d<.82?'.':d<1.08||ford?',':'~');
  }
  g.map.terrain={cell:64,cols:128,rows:128,cells:cells.join('')};
  for(let i=0;i<150;i++) {const x=2200+(i*379%3800),y=600+(i*617%6900);if(isWalkable(g.map,x,y))g.map.landmarks.push({id:`rock-${i}`,kind:i%3?'pebbles':'reeds',x,y,size:20+i%24,rotation:i});}
  g.variants={};
  for(const def of [...SHIPS,...SIEGE])g.variants[`tide/${def.id}`]=resolveVariant({...def,base:def.base as UnitKind,supplyUsed:3,attackCooldown:def.id==='organ'?10:40});
  g.variants['tide/admiral']=resolveVariant({base:'knight',heroic:true,hp:4200,attackDamage:65,attackRange:100,speed:4.1,regenPerSecond:8});
  g.variants['tide/dragon']=resolveVariant({base:'redDragon',heroic:true,hp:14000,attackDamage:180,attackRange:350,speed:2.8,radius:60,regenPerSecond:5});
  g.variants['tide/archmage']=resolveVariant({base:'witch',heroic:true,hp:2400,attackDamage:95,attackRange:580,speed:2.8});
  for(const owner of [PLAYER,ALLY,ENEMY])g.players[owner]!.gold=owner===PLAYER?2200:10000;
  const base=this.build(PLAYER,'townHall',2550,3950,'expedition');base.hp=base.maxHp=3500;
  this.build(PLAYER,'barracks',2500,4200);this.build(PLAYER,'workshop',2750,4240);this.build(PLAYER,'sanctum',2770,3950);
  this.build(PLAYER,'shipyard',2120,3960);for(let i=0;i<12;i++)this.build(PLAYER,'farm',2300+(i%4)*120,4300+Math.floor(i/4)*120);
  for(const side of [ALLY,ENEMY] as const){
   const bx=side===ALLY?2450:5700;
   for(let lane=0;lane<3;lane++){
    this.build(side,'townHall',bx,1600+lane*2400,`${side}-base-${lane}`);
    for(let i=0;i<DEFENSES.length;i++)this.addDefense(side,DEFENSES[i]!.id,bx+(side===ALLY?220:-220),1200+lane*2400+i*170);
    const engineer=g.spawnUnit(side,'worker',bx+100,1550+lane*2400);engineer.id=`engineer-${side}-${lane}`;
   }
   for(let i=0;i<2490;i++){
    const lane=i%3,k=Math.floor(i/3),x=side===ALLY?2450+Math.floor(k/38)*37:5750-Math.floor(k/38)*37,y=950+lane*2400+(k%38)*35;
    const kinds:UnitKind[]=['footman','footman','lancer','archer','footman','knight','archer','priest','footman','groveWarden'];
    const u=g.spawnUnit(side,kinds[i%10]!,x,y);if(i<450)u.order={type:'attackMove',x:side===ALLY?4500:3700,y};else {u.order={type:'hold',x,y};this.state.reserves.push(u.id);}
   }
   for(let i=0;i<SHIPS.length;i++)for(let j=0;j<2;j++)this.spawn(side,SHIPS[i]!.id,side===ALLY?1600:6600,3000+i*390+j*95);
   for(let i=0;i<SIEGE.length;i++)this.spawn(side,SIEGE[i]!.id,side===ALLY?3100:5200,1400+i*1200);
  }
  const citadel=this.build(ENEMY,'townHall',5960,4000,'citadel');citadel.radius=85;citadel.hp=citadel.maxHp=10000;citadel.attackDamage=65;citadel.attackRange=460;citadel.attackCooldown=30;
  spawnVariantUnit(g,ENEMY,'tide/dragon',5400,4100,'crown-dragon');spawnVariantUnit(g,ALLY,'tide/archmage',3250,4000,'league-mage');
  spawnVariantUnit(g,PLAYER,'tide/admiral',2920,3900,HERO);
  for(let i=0;i<18;i++)g.spawnUnit(PLAYER,i<6?'worker':i<13?'knight':'priest',2800+i%6*42,3650+Math.floor(i/6)*45);
  for(let i=0;i<5;i++){this.spawn(PLAYER,SHIPS[i]!.id,1700,3600+i*150);this.spawn(PLAYER,SIEGE[i]!.id,2700,3550+i*85);}
  g.resources=[{id:'expedition-mine',kind:'goldMine',x:2330,y:3600,amount:40000}];
  g.shops=[createShop('harbor-market',2680,3740)];
  for(const u of g.units.filter(u=>u.owner===PLAYER)){u.order={type:'hold',x:u.x,y:u.y};if(u.id===HERO)u.autocast={charge:false};if(u.kind==='worker')u.order={type:'mine',resourceId:'expedition-mine',phase:'toMine',timer:0};}
  this.state.peak=g.units.length;this.note('联军已在三处海峡接敌。你指挥远征队，主力由海军议会调度。夺取港口可维持补给。');
 }
 private build(owner:string,kind:Building['kind'],x:number,y:number,id=`tide-building-${this.game.nextId++}`){const b=createBuilding(id,owner,kind,x,y,true);this.game.buildings.push(b);return b;}
 private spawn(owner:string,id:string,x:number,y:number){const sea=SHIPS.some(s=>s.id===id);const p=walkableGoal(this.game.map,x,y,sea?'sea':'land');return spawnVariantUnit(this.game,owner,`tide/${id}`,p.x,p.y);}
 private addDefense(owner:string,id:string,x:number,y:number,complete=true){
  const d=DEFENSES.find(d=>d.id===id)!;const b=this.build(owner,id==='ward'?'moonWell':'defenseTower',x,y);
  Object.assign(b,{hp:complete?d.hp:Math.ceil(d.hp*.15),maxHp:d.hp,attackDamage:d.damage,attackRange:d.range,attackCooldown:d.cooldown,complete,buildTime:200,buildProgress:complete?200:0});this.state.defense[b.id]=id;return b;
 }
 note(text:string){this.state.log.push({tick:this.game.tick,text});if(this.state.log.length>32)this.state.log.shift();}
 command(command:GameCommand){if(this.state.outcome!=='playing')return;issuePlayerCommand(this.game,PLAYER,command);}
 recruit(id:string){
  if(this.state.outcome!=='playing')return '战役已经结束';
  const def=[...SHIPS,...SIEGE].find(d=>d.id===id);if(!def)return '未知部队';
  const base=this.game.buildings.find(b=>b.owner===PLAYER&&b.complete&&b.kind===(SHIPS.some(s=>s.id===id)?'shipyard':'workshop'));
  if(!base)return '需要完工的船坞或工坊';if(this.game.players[PLAYER]!.gold<def.cost)return '黄金不足';
  if(this.game.players[PLAYER]!.supplyUsed+this.state.jobs.length*3+3>this.game.players[PLAYER]!.supplyCap)return '人口不足：请修建更多农场';
  if(this.game.units.filter(u=>u.owner===PLAYER).length+this.state.jobs.length>=100)return '远征队达到 100 单位上限';
  this.game.players[PLAYER]!.gold-=def.cost;this.state.jobs.push({id:`commission-${this.game.nextId++}`,kind:id,building:base.id,remaining:240,cost:def.cost});return undefined;
 }
 cancelRecruit(id:string){const job=this.state.jobs.find(j=>j.id===id);if(!job)return;this.game.players[PLAYER]!.gold+=job.cost;this.state.jobs=this.state.jobs.filter(j=>j.id!==id);}
 fortify(id:string,x:number,y:number){
  const d=DEFENSES.find(d=>d.id===id);if(!d)return '未知工事';
  const worker=this.game.units.find(u=>u.owner===PLAYER&&u.kind==='worker'&&Math.hypot(u.x-x,u.y-y)<250);
  if(!worker)return '工程兵须在目标 250 范围内';if(!isWalkable(this.game.map,x,y))return '工事必须位于陆地';
  if(this.game.buildings.some(b=>Math.hypot(b.x-x,b.y-y)<b.radius+70))return '建筑位置被占用';
  if(this.game.players[PLAYER]!.gold<d.cost)return '黄金不足';this.state.plans=this.state.plans.filter(p=>p.worker!==worker.id);this.state.plans.push({worker:worker.id,id,x,y});worker.order={type:'move',x,y};return undefined;
 }
 cast(index:number,x:number,y:number){
  const relic=RELICS[index],hero=this.game.units.find(u=>u.id===HERO);if(!relic||!hero)return '统帅已阵亡';
  if(this.state.outcome!=='playing')return '战役已经结束';if(this.state.cooldowns[index]!>this.game.tick)return '遗物尚在冷却';
  if(Math.hypot(x-hero.x,y-hero.y)>relic.range)return '目标超出遗物射程';
  if(index===5&&!isWalkable(this.game.map,x,y))return '罗盘需要可登陆的陆地';
  this.state.cooldowns[index]=this.game.tick+relic.cooldown*20;this.state.casts++;
  const foes=this.game.units.filter(u=>u.owner===ENEMY&&Math.hypot(u.x-x,u.y-y)<relic.radius);
  if(index===0||index===4)for(const u of foes)strikeUnit(this.game,hero,u,index===0?280:420,'spell');
  if(index===1)for(const u of this.game.units)if(u.owner!==ENEMY&&u.owner!=='neutral'&&Math.hypot(u.x-x,u.y-y)<relic.radius)u.hp=Math.min(u.maxHp,u.hp+380);
  if(index===2)for(const b of this.game.buildings)if(b.owner===ENEMY&&Math.hypot(b.x-x,b.y-y)<relic.radius)strikeUnit(this.game,hero,b,1700,'spell');
  if(index===3)for(const u of foes){u.effects.push({type:'stun',remaining:100});}
  if(index===5){const units=this.game.units.filter(u=>u.owner===PLAYER&&u.kind!=='warship'&&u.kind!=='transport'&&Math.hypot(u.x-hero.x,u.y-hero.y)<relic.radius);for(let i=0;i<units.length;i++){const p=walkableGoal(this.game.map,x+(i%6)*38,y+Math.floor(i/6)*38);Object.assign(units[i]!,p);units[i]!.order={type:'hold',x:p.x,y:p.y};}}
  addWorldEffect(this.game,index===0?'chainLightning':index===1?'heal':index===3?'stomp':index===4?'flameBurn':'guardianField',x,y,22,{radius:relic.radius,owner:PLAYER});return undefined;
 }
 step(){
  if(this.state.outcome!=='playing')return;
  const population=()=>this.game.units.reduce((n,u)=>n+1+(u.cargo?.length??0),0);const before=population();stepGame(this.game);this.state.losses+=Math.max(0,before-population());
  if(this.game.tick%20===0)this.update();
 }
 private update(){
  const g=this.game,s=this.state;
  const busy=new Set<string>();s.jobs=s.jobs.filter(job=>{const building=g.buildings.find(b=>b.id===job.building);if(!building)return false;if(busy.has(job.building))return true;busy.add(job.building);job.remaining-=20;if(job.remaining>0)return true;this.spawn(PLAYER,job.kind,building.x-100,building.y-100);s.recruits++;return false;});
  s.plans=s.plans.filter(plan=>{
   const worker=g.units.find(u=>u.id===plan.worker);if(!worker)return false;
   const gap=Math.hypot(worker.x-plan.x,worker.y-plan.y);
   if(gap>85)return worker.order.type==='move'&&worker.order.x===plan.x&&worker.order.y===plan.y;
   const def=DEFENSES.find(d=>d.id===plan.id)!;
   if(g.buildings.some(b=>Math.hypot(b.x-plan.x,b.y-plan.y)<b.radius+50))return false;
   if(g.players[PLAYER]!.gold<def.cost)return true;
   g.players[PLAYER]!.gold-=def.cost;const b=this.addDefense(PLAYER,plan.id,plan.x,plan.y,false);worker.order={type:'repair',buildingId:b.id};s.builds++;return false;
  });
  for(const p of s.ports){
   let ally=0,enemy=0;for(const u of g.units)if(u.hp>0&&Math.hypot(u.x-p.x,u.y-p.y)<400){if(u.owner===ENEMY)enemy++;else if(u.owner===ALLY||u.owner===PLAYER)ally++;}
   p.contested=ally>0&&enemy>0;
   if(!p.contested&&(ally||enemy)){p.progress=Math.max(-100,Math.min(100,p.progress+(enemy?1:-1)*Math.min(10,2+(enemy||ally))));const own=p.progress<=-100?ALLY:p.progress>=100?ENEMY:p.owner;if(own!==p.owner){p.owner=own;p.captures++;this.note(`${p.name}已被${own===ALLY?'联军':'王廷'}占领，补给航线改变。`);}}
   if(p.owner&&!p.contested)s.supply[p.owner]+=p.value;
  }
  g.players[PLAYER]!.gold+=s.ports.filter(p=>p.owner===ALLY&&!p.contested).length*2;
  // These powers are local and counterable: spreading the line and attacking the caster matters.
  if(g.tick%80===0)for(const id of ['crown-dragon','league-mage']){
   const boss=g.units.find(u=>u.id===id);if(!boss)continue;
   const enemyOwner=id==='crown-dragon'?ALLY:ENEMY;
   const target=g.units.find(u=>(u.owner===enemyOwner||(id==='crown-dragon'&&u.owner===PLAYER))&&Math.hypot(u.x-boss.x,u.y-boss.y)<650);
   if(target){for(const u of g.units)if((u.owner===enemyOwner||(id==='crown-dragon'&&u.owner===PLAYER))&&Math.hypot(u.x-target.x,u.y-target.y)<220)strikeUnit(g,boss,u,id==='crown-dragon'?110:85,'spell');addWorldEffect(g,id==='crown-dragon'?'flameBurn':'storm',target.x,target.y,25,{radius:220,owner:boss.owner});}
  }
  for(const b of g.buildings){const type=s.defense[b.id];if(!type||!b.complete)continue;const def=DEFENSES.find(d=>d.id===type)!;if(b.maxHp!==def.hp){b.hp=Math.min(def.hp,b.hp/b.maxHp*def.hp);b.maxHp=def.hp;b.attackDamage=def.damage;b.attackRange=def.range;b.attackCooldown=def.cooldown;}
   if(type==='ward')for(const u of g.units)if(g.teams[u.owner]===g.teams[b.owner]&&Math.hypot(u.x-b.x,u.y-b.y)<280)u.hp=Math.min(u.maxHp,u.hp+7);
   if(type==='flame'&&g.tick%40===0)for(const u of g.units)if(u.owner!=='neutral'&&g.teams[u.owner]!==g.teams[b.owner]&&Math.hypot(u.x-b.x,u.y-b.y)<230)strikeUnit(g,b,u,32,'spell');
  }
  if(g.tick%40===0)for(const ship of g.units.filter(u=>u.variant==='tide/fireship'))for(const foe of g.units)if(g.teams[foe.owner]!==g.teams[ship.owner]&&Math.hypot(foe.x-ship.x,foe.y-ship.y)<155)strikeUnit(g,ship,foe,45,'spell');
  if(g.tick%100===0){this.strategy();this.ferries();}
  if(g.tick%400===0)this.logistics();
  s.peak=Math.max(s.peak,g.units.length);
  const citadel=g.buildings.find(b=>b.id==='citadel');const ports=s.ports.filter(p=>p.owner===ALLY&&!p.contested).length;
  const phase=!citadel?2:ports>=3?1:0;if(phase>s.phase){s.phase=phase;this.note(phase===1?'三座港口接通。突破王廷堡垒，摧毁王座。':'王座已陷落。控制至少三港，守住最后 60 秒。');}
  if(!citadel&&ports>=3)s.hold++;else s.hold=0;
  if(s.hold>=60){s.outcome='victory';g.match.winner=PLAYER;g.match.endedAtTick=g.tick;this.note('潮汐王座：远征胜利。海峡航路重归自由诸港。');}
  if(!g.units.some(u=>u.id===HERO)||!g.buildings.some(b=>b.id==='expedition')){s.outcome='defeat';g.match.winner=ENEMY;g.match.endedAtTick=g.tick;this.note('远征失败。统帅与远征司令部必须存活。可读取自动存档重新组织攻势。');}
 }
 private strategy(){
  const g=this.game;
  for(const side of [ALLY,ENEMY] as const){
   const ports=this.state.ports.filter(p=>p.id!=='west'&&p.id!=='east');
   const reserve=new Set(this.state.reserves);const units=g.units.filter(u=>u.owner===side&&!reserve.has(u.id)&&u.kind!=='worker'&&!u.variant?.includes('transport'));
   for(let lane=0;lane<3;lane++){
    const port=ports[lane]!;
    const group=units.filter(u=>u.x>1800&&u.x<6500&&Math.abs(u.y-port.y)<1150&&u.kind!=='warship'&&u.kind!=='transport');
    const threat=g.units.filter(u=>u.owner!==side&&g.teams[u.owner]!==g.teams[side]&&Math.hypot(u.x-port.x,u.y-port.y)<650).length;
    const pressure=group.length>threat*.85;
    // A secured flank releases its field army to the weakest sea crossing.
    // This responds to live ownership/threat, rather than a scripted minute marker.
    const relief=port.owner===side&&threat<12?ports.filter(p=>p.id!==port.id&&(p.owner!==side||p.contested)).sort((a,b)=>
     (a.owner===side?0:100)+(a.contested?30:0)-((b.owner===side?0:100)+(b.contested?30:0))||Math.hypot(port.x-a.x,port.y-a.y)-Math.hypot(port.x-b.x,port.y-b.y))[0]:undefined;
    const x=relief?.x??(port.owner===side&&pressure?(side===ALLY?5450:2600):port.x),y=relief?.y??port.y;
    for(const u of group){if(u.order.type==='attack'||(u.order.type==='attackMove'&&u.order.targetId))continue;u.order={type:'attackMove',x,y};}
   }
   // Fleet control scores the two remote ports by ownership and local hostile presence.
   for(const u of units.filter(u=>u.kind==='warship')){
    const targets=this.state.ports.filter(p=>p.id==='west'||p.id==='east');
    const target=targets.sort((a,b)=>(a.owner===side?10000:0)+Math.hypot(u.x-a.x,u.y-a.y)-(b.owner===side?10000:0)-Math.hypot(u.x-b.x,u.y-b.y))[0]!;
    const p=walkableGoal(g.map,target.x,target.y,'sea');if(u.order.type!=='attack')u.order={type:'attackMove',x:p.x,y:p.y};
   }
  }
 }
 private ferries(){
  const g=this.game;
  for(const boat of g.units.filter(u=>u.kind==='transport'&&(u.owner===ALLY||u.owner===ENEMY))){
   const side=boat.owner as Side;
   let trip=this.state.voyages[boat.id];
   if(!trip){
    const target=this.state.ports.filter(p=>(p.id==='west'||p.id==='east')&&p.owner!==side)[0];
    if(!target)continue;
    trip=this.state.voyages[boat.id]={target:target.id,stage:'loading',since:g.tick};
   }
   const port=this.state.ports.find(p=>p.id===trip.target)!;
   if(trip.stage==='loading'){
    if((boat.cargo?.length??0)>=3||((boat.cargo?.length??0)>0&&g.tick-trip.since>600)){
     issuePlayerCommand(g,side,{type:'unload',unitIds:[boat.id],x:port.x,y:port.y});trip.stage='landing';continue;
    }
    const shore=walkableGoal(g.map,side===ALLY?2050:6250,4000,'sea');
    if(Math.hypot(boat.x-shore.x,boat.y-shore.y)>60){boat.order={type:'move',x:shore.x,y:shore.y};continue;}
    const crew=g.units.filter(u=>u.owner===side&&u.kind==='footman'&&u.order.type!=='board').sort((a,b)=>Math.hypot(a.x-boat.x,a.y-boat.y)-Math.hypot(b.x-boat.x,b.y-boat.y)).slice(0,4-(boat.cargo?.length??0));
    for(const u of crew){this.state.reserves=this.state.reserves.filter(id=>id!==u.id);issuePlayerCommand(g,side,{type:'board',unitIds:[u.id],transportId:boat.id});}
   }else if(!boat.cargo?.length){delete this.state.voyages[boat.id];}
  }
 }
 private logistics(){
  const g=this.game;
  for(const side of [ALLY,ENEMY] as const){
   const bases=g.buildings.filter(b=>b.owner===side&&b.kind==='townHall'&&b.complete);
   const count=g.units.filter(u=>u.owner===side).length;
   const navy=g.units.filter(u=>u.owner===side&&(u.kind==='warship'||u.kind==='transport'));
   const shipId=navy.some(u=>u.kind==='transport')?SHIPS[Math.floor(g.tick/400)%4]!.id:'transport';
   const shipDef=SHIPS.find(d=>d.id===shipId)!;
   if(navy.length<8&&bases.length&&this.state.supply[side]>=shipDef.cost){this.state.supply[side]-=shipDef.cost;this.spawn(side,shipId,side===ALLY?2050:6250,4000);}

   const live=new Map(g.units.map(u=>[u.id,u]));let committed=0;this.state.reserves=this.state.reserves.filter(id=>{const u=live.get(id);if(!u)return false;if(u.owner===side&&committed<90){u.order={type:'attackMove',x:4100,y:u.y};committed++;return false;}return true;});
   if(count<2500&&bases.length&&this.state.supply[side]>=180){
    const base=bases[(g.tick/400)%bases.length|0]!;this.state.supply[side]-=180;
    for(let i=0;i<12;i++){const u=g.spawnUnit(side,i%4===0?'archer':'footman',base.x+(side===ALLY?130:-130)+(i%4)*35,base.y+Math.floor(i/4)*40);u.order={type:'attackMove',x:4100,y:base.y};}
   }
   for(const worker of g.units.filter(u=>u.owner===side&&u.kind==='worker')){
    const hurt=g.buildings.find(b=>b.owner===side&&b.hp<b.maxHp&&Math.hypot(b.x-worker.x,b.y-worker.y)<550);
    if(hurt){issuePlayerCommand(g,side,{type:'repair',unitIds:[worker.id],buildingId:hurt.id});this.state.repairs++;}
    else if(this.state.supply[side]>250&&g.buildings.filter(b=>b.owner===side&&Math.hypot(b.x-worker.x,b.y-worker.y)<500).length<6){
     const x=worker.x+(side===ALLY?130:-130),y=worker.y+100;if(isWalkable(g.map,x,y)&&!g.buildings.some(b=>Math.hypot(b.x-x,b.y-y)<110)){const built=this.addDefense(side,'watch',x,y,false);worker.order={type:'repair',buildingId:built.id};this.state.supply[side]-=150;this.state.builds++;}
    }
   }
  }
 }
 save():CampaignSave{return {version:1,snapshot:snapshotGame(this.game),nextId:this.game.nextId,state:structuredClone(this.state)};}
}
