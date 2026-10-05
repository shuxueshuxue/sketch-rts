import { UNIT_DEFS, resolveVariant, unitRules } from '../../shared/catalog';
import { createBuilding } from '../../shared/map';
import { createGame, issuePlayerCommand, spawnVariantUnit, stepGame, strikeUnit, addWorldEffect, snapshotGame, restoreSnapshotIntoGame, type Game } from '../../shared/sim';
import { isWalkable, walkableGoal } from '../../shared/terrain';
import { createShop } from '../../shared/shop';
import type { Building, GameCommand, GameSnapshot, Unit, UnitKind } from '../../shared/types';
import { tideboundMap, HOME, BEACON, EMBARK, LANDING, CITADEL, SEAL, MAGE, LANES } from './world';
import { CHAPTERS, initialMission, type MissionState, type MissionObjective } from './mission';
import { carries } from '../../shared/naval';

export const TITLE = '潮汐王座';
export const PLAYER = 'player';
export const ALLY = 'fleet';
export const ENEMY = 'crown';
export const HERO = 'tide-admiral';
export type Side = typeof ALLY | typeof ENEMY;
export const SHIPS = [
 {id:'cutter',name:'巡海快艇',base:'warship',hp:380,speed:12,attackDamage:22,attackRange:400,cost:130,role:'快速截击与侧翼侦察'},
 {id:'frigate',name:'重弩护卫舰',base:'warship',hp:1000,speed:9,attackDamage:75,attackRange:620,cost:280,role:'中程反舰，保护运输线'},
 {id:'bombard',name:'臼炮舰',base:'warship',hp:650,speed:6,attackDamage:180,attackRange:1000,cost:430,role:'远程轰岸，惧怕快艇近身'},
 {id:'fireship',name:'焚潮舰',base:'warship',hp:1200,speed:10,attackDamage:120,attackRange:170,cost:260,role:'近距离破阵，接敌时灼烧周边'},
 {id:'transport',name:'登陆运输舰',base:'transport',hp:1600,speed:10,attackDamage:0,attackRange:0,cost:180,role:'运载八人口，右键登船、D 卸载'},
 {id:'carrier',name:'远洋运兵舰',base:'transport',hp:3000,speed:9,attackDamage:0,attackRange:0,cost:420,role:'运载三十人口，跨岛调动整支分队；需要护航'},
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
 version:1; jobs:{id:string;kind:string;building:string;remaining:number;cost:number}[]; voyages:Record<string,{target:string;stage:string;since:number;crew?:string[];landingX?:number;loadingX?:number;loadingY?:number}>; reserves:string[]; plans:{worker:string;id:string;x:number;y:number}[]; ports:Port[]; defense:Record<string,string>; cooldowns:number[]; outcome:'playing'|'victory'|'defeat';
 phase:number; hold:number; losses:number; peak:number; supply:Record<Side,number>; log:{tick:number;text:string}[];
 builds:number; repairs:number; casts:number; recruits:number; difficulty:'standard'|'veteran';
 mission:MissionState;
};
export type CampaignSave = {version:1;snapshot:GameSnapshot;nextId:number;state:CampaignState};
export class TideboundCampaign {
 game:Game; state:CampaignState;
 constructor(difficulty:'standard'|'veteran'='standard',save?:CampaignSave) {
  this.game=createGame('bareDuel',{players:[PLAYER,ALLY,ENEMY],aiPlayers:[],teams:{[PLAYER]:'league',[ALLY]:'league',[ENEMY]:'crown'}});
  this.game.scriptedVictory=true;
  this.state={version:1,jobs:[],voyages:{},reserves:[],plans:[],ports:[
   {id:'north',name:'北岬船坞',x:12800,y:4200,value:7,owner:null,progress:0,contested:false,captures:0},
   {id:'heart',name:'王座海峡',x:12800,y:9200,value:11,owner:null,progress:0,contested:false,captures:0},
   {id:'south',name:'白盐港',x:12800,y:14200,value:7,owner:null,progress:0,contested:false,captures:0},
   {id:'west',name:'灯塔岛',x:5420,y:9020,value:6,owner:ALLY,progress:-100,contested:false,captures:0},
   {id:'east',name:'黑礁军港',x:20700,y:9200,value:8,owner:ENEMY,progress:100,contested:false,captures:0},
  ],defense:{},cooldowns:[0,0,0,0,0,0],outcome:'playing',phase:0,hold:0,losses:0,peak:0,supply:{[ALLY]:2400,[ENEMY]:2400},log:[],builds:0,repairs:0,casts:0,recruits:0,difficulty,mission:initialMission()};
  if(save){if(save.version!==1||save.state.mission?.revision!==2)throw Error('战役地图已重写，请开始新的远征；旧版存档保留在本机。');restoreSnapshotIntoGame(this.game,save.snapshot,save.nextId);this.state={...this.state,...structuredClone(save.state)};return;}
  this.initialize();
 }
 private initialize(){
  const g=this.game;
  g.units=[];g.buildings=[];g.resources=[];g.mercenaryCamps=[];g.items=[];g.effects=[];g.projectiles=[];g.corpses=[];
  g.map=tideboundMap();g.variants={};
  for(const def of [...SHIPS,...SIEGE])g.variants[`tide/${def.id}`]=resolveVariant({...def,base:def.base as UnitKind,supplyUsed:3,attackCooldown:def.id==='organ'?10:40});
  g.variants['tide/admiral']=resolveVariant({base:'knight',heroic:true,hp:4200,attackDamage:65,attackRange:100,speed:7,regenPerSecond:8});
  g.variants['tide/dragon']=resolveVariant({base:'redDragon',heroic:true,hp:16000,attackDamage:200,attackRange:430,speed:4.5,radius:60,regenPerSecond:5});
  g.variants['tide/archmage']=resolveVariant({base:'witch',heroic:true,hp:6000,attackDamage:110,attackRange:720,speed:6,regenPerSecond:6});
  g.variants['tide/cargo']=resolveVariant({base:'transport',hp:3200,speed:10,attackDamage:0,supplyUsed:0});
  for(const owner of [PLAYER,ALLY,ENEMY])g.players[owner]!.gold=owner===PLAYER?3400:15000;
  const base=this.build(PLAYER,'townHall',HOME.x,HOME.y,'expedition');base.hp=base.maxHp=5000;
  this.build(PLAYER,'barracks',HOME.x-280,HOME.y+290,'expedition-barracks');
  this.build(PLAYER,'workshop',HOME.x+100,HOME.y+320,'expedition-workshop');
  this.build(PLAYER,'sanctum',HOME.x+420,HOME.y+320,'expedition-sanctum');
  const dock=walkableGoal(g.map,EMBARK.x,EMBARK.y);
  this.build(PLAYER,'shipyard',dock.x,dock.y,'expedition-dock');
  for(let i=0;i<20;i++)this.build(PLAYER,'farm',HOME.x-1000+(i%5)*220,HOME.y+650+Math.floor(i/5)*210);
  const beacon=this.build(PLAYER,'defenseTower',BEACON.x,BEACON.y,'tide-beacon');
  Object.assign(beacon,{hp:700,maxHp:1600,attackDamage:0,attackRange:0,radius:45});
  for(const side of [ALLY,ENEMY] as const){
   const bx=side===ALLY?9200:16600;
   for(let lane=0;lane<3;lane++){
    const y=LANES[lane]!;
    const base=this.build(side,'townHall',bx,y,`${side}-base-${lane}`);base.hp=base.maxHp=5000;
    for(let i=0;i<DEFENSES.length;i++)this.addDefense(side,DEFENSES[i]!.id,bx+(side===ALLY?700:-700),y-600+i*240);
    const engineer=g.spawnUnit(side,'worker',bx+160,y+200);engineer.id=`engineer-${side}-${lane}`;
   }
   for(let i=0;i<2490;i++){
    const lane=i%3,k=Math.floor(i/3),y=LANES[lane]!-740+Math.floor(k/35)*64;
    const x=side===ALLY?8800+(k%35)*66:16800-(k%35)*66;
    const at=walkableGoal(g.map,x,y);
    const kinds:UnitKind[]=['footman','footman','lancer','archer','footman','knight','archer','priest','footman','groveWarden'];
    const u=g.spawnUnit(side,kinds[i%10]!,at.x,at.y);
    u.speed*=1.5;u.order={type:'hold',x:at.x,y:at.y};this.state.reserves.push(u.id);
   }
   for(let i=0;i<SHIPS.length;i++)for(let j=0;j<2;j++)this.spawn(side,SHIPS[i]!.id,side===ALLY?8000:17700,6700+i*270+j*110);
   for(let i=0;i<4;i++)this.spawn(side,'carrier',side===ALLY?8500:16900,6500+i*160);
   for(let i=0;i<SIEGE.length;i++)this.spawn(side,SIEGE[i]!.id,side===ALLY?10600:14900,LANES[i%3]!+(i<3?-300:300));
  }
  const citadel=this.build(ENEMY,'townHall',CITADEL.x,CITADEL.y,'citadel');
  Object.assign(citadel,{invulnerable:true,radius:105,hp:18000,maxHp:18000,attackDamage:90,attackRange:620,attackCooldown:30});
  const seal=this.build(ENEMY,'moonWell',SEAL.x,SEAL.y,'tide-seal');Object.assign(seal,{hp:5200,maxHp:5200,attackDamage:0,attackRange:0});
  spawnVariantUnit(g,ENEMY,'tide/dragon',15000,9800,'crown-dragon').order={type:'hold',x:15000,y:9800};
  const mage=spawnVariantUnit(g,ALLY,'tide/archmage',MAGE.x,MAGE.y,'league-mage');mage.hp=900;mage.order={type:'hold',x:MAGE.x,y:MAGE.y};
  spawnVariantUnit(g,PLAYER,'tide/admiral',HOME.x+480,HOME.y-220,HERO);
  for(let i=0;i<18;i++){
   const u=g.spawnUnit(PLAYER,i<6?'worker':i<14?'knight':'priest',HOME.x+280+(i%6)*60,HOME.y-540+Math.floor(i/6)*65);u.speed*=1.65;
  }
  for(let i=0;i<5;i++){
   this.spawn(PLAYER,SHIPS[i]!.id,EMBARK.x+100,EMBARK.y-650+i*200);
   this.spawn(PLAYER,SIEGE[i]!.id,HOME.x-250,HOME.y-600+i*100).speed*=2;
  }
  for(let i=0;i<4;i++)this.spawn(PLAYER,'transport',EMBARK.x+150,EMBARK.y+200+i*150);
  const raiders:string[]=[];
  for(let i=0;i<24;i++){
   const p=walkableGoal(g.map,BEACON.x+280+(i%6)*55,BEACON.y-650+Math.floor(i/6)*65);
   const u=g.spawnUnit(ENEMY,i%5===0?'archer':'footman',p.x,p.y);u.id=`tide-raider-${i}`;u.order={type:'hold',x:p.x,y:p.y};raiders.push(u.id);
  }
  this.state.mission.raiders=raiders;
  g.resources=[{id:'expedition-mine',kind:'goldMine',x:HOME.x-450,y:HOME.y-600,amount:60000},{id:'north-mine',kind:'goldMine',x:10400,y:4600,amount:30000}];
  g.shops=[createShop('harbor-market',HOME.x+500,HOME.y+60),createShop('north-market',10500,4600),createShop('salt-market',11500,14400)];
  for(const u of g.units.filter(u=>u.owner===PLAYER)){
   u.order={type:'hold',x:u.x,y:u.y};if(u.id===HERO)u.autocast={charge:false};
   if(u.kind==='worker')u.order={type:'mine',resourceId:'expedition-mine',phase:'toMine',timer:0};
  }
  this.state.peak=g.units.length;
  this.refreshObjectives();this.note(CHAPTERS[0].line);
 }
 private build(owner:string,kind:Building['kind'],x:number,y:number,id=`tide-building-${this.game.nextId++}`){const b=createBuilding(id,owner,kind,x,y,true);this.game.buildings.push(b);return b;}
 private spawn(owner:string,id:string,x:number,y:number){const sea=SHIPS.some(s=>s.id===id);const p=walkableGoal(this.game.map,x,y,sea?'sea':'land');const u=spawnVariantUnit(this.game,owner,`tide/${id}`,p.x,p.y);if(id==='carrier'){u.cargoCapacity=30;u.radius=42;}return u;}
 private addDefense(owner:string,id:string,x:number,y:number,complete=true){
  const d=DEFENSES.find(d=>d.id===id)!;const b=this.build(owner,id==='ward'?'moonWell':'defenseTower',x,y);
  Object.assign(b,{hp:complete?d.hp:Math.ceil(d.hp*.15),maxHp:d.hp,attackDamage:d.damage,attackRange:d.range,attackCooldown:d.cooldown,complete,buildTime:200,buildProgress:complete?200:0});this.state.defense[b.id]=id;return b;
 }
 note(text:string){this.state.log.push({tick:this.game.tick,text});if(this.state.log.length>32)this.state.log.shift();}
 command(command:GameCommand){if(this.state.outcome!=='playing')return;issuePlayerCommand(this.game,PLAYER,command);}
 recruit(id:string){
  if(this.state.outcome!=='playing')return '战役已经结束';
  const def=[...SHIPS,...SIEGE].find(d=>d.id===id);if(!def)return '未知部队';
  const facilities=this.game.buildings.filter(b=>b.owner===PLAYER&&b.complete&&b.kind===(SHIPS.some(s=>s.id===id)?'shipyard':'workshop'));
  const base=facilities.find(b=>b.id==='tide-forward-workshop')??facilities[0];
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
   if(target){for(const u of g.units)if((u.owner===enemyOwner||(id==='crown-dragon'&&u.owner===PLAYER))&&Math.hypot(u.x-target.x,u.y-target.y)<220)strikeUnit(g,boss,u,id==='crown-dragon'?(s.mission.mageRescued?65:110):120,'spell');addWorldEffect(g,id==='crown-dragon'?'flameBurn':'storm',target.x,target.y,25,{radius:220,owner:boss.owner});}
  }
  for(const b of g.buildings){const type=s.defense[b.id];if(!type||!b.complete)continue;const def=DEFENSES.find(d=>d.id===type)!;if(b.maxHp!==def.hp){b.hp=Math.min(def.hp,b.hp/b.maxHp*def.hp);b.maxHp=def.hp;b.attackDamage=def.damage;b.attackRange=def.range;b.attackCooldown=def.cooldown;}
   if(type==='ward')for(const u of g.units)if(g.teams[u.owner]===g.teams[b.owner]&&Math.hypot(u.x-b.x,u.y-b.y)<280)u.hp=Math.min(u.maxHp,u.hp+7);
   if(type==='flame'&&g.tick%40===0)for(const u of g.units)if(u.owner!=='neutral'&&g.teams[u.owner]!==g.teams[b.owner]&&Math.hypot(u.x-b.x,u.y-b.y)<230)strikeUnit(g,b,u,32,'spell');
  }
  if(g.tick%40===0)for(const ship of g.units.filter(u=>u.variant==='tide/fireship'))for(const foe of g.units)if(g.teams[foe.owner]!==g.teams[ship.owner]&&Math.hypot(foe.x-ship.x,foe.y-ship.y)<155)strikeUnit(g,ship,foe,45,'spell');
  if(g.tick%100===0){this.strategy();this.ferries();}
  if(g.tick%400===0)this.logistics();
  s.peak=Math.max(s.peak,g.units.length);
  this.updateMission();
 }
 private hero(){return this.game.units.find(u=>u.id===HERO)??this.game.units.flatMap(u=>u.cargo??[]).find(u=>u.id===HERO);}
 private say(speaker:string,text:string){this.state.mission.dialogue.push({tick:this.game.tick,speaker,text});if(this.state.mission.dialogue.length>24)this.state.mission.dialogue.shift();this.note(`${speaker}：${text}`);}
 private advance(){
  const m=this.state.mission;m.completed.push(String(m.stage));m.stage++;m.stageTick=this.game.tick;m.portHold=0;this.state.phase=m.stage;
  const chapter=CHAPTERS[m.stage];if(chapter)this.say(chapter.speaker,chapter.line);
  this.game.players[PLAYER]!.gold+=500;m.rewardGold+=500;
  if(m.stage===1){
   m.convoySpawned=true;
   for(let i=0;i<2;i++){
    const ship=this.spawn(ALLY,'transport',EMBARK.x+250,EMBARK.y-300-i*240);ship.variant='tide/cargo';ship.hp=ship.maxHp=3200;ship.speed=10;ship.id=`tide-cargo-${i}`;
    m.cargo.push({id:ship.id,waypoint:0,delivered:false,lost:false});
   }
   for(let i=0;i<4;i++){
    const raider=this.spawn(ENEMY,i%2?'cutter':'frigate',7900+i*90,7800+i*100);raider.id=`convoy-hunter-${i}`;
    raider.order={type:'attack',targetId:m.cargo[i%2]!.id};
   }
   this.release(ALLY,180);this.release(ENEMY,180);
  }
  if(m.stage===4){
   m.finalMobilized=true;
   this.release(ENEMY,100000);this.release(ALLY,100000);
   const ship=this.spawn(ALLY,'transport',17800,11200);ship.id='tide-evacuation';ship.hp=ship.maxHp=4200;ship.speed=11;
   m.evacuation={id:ship.id,waypoint:0,arrived:false,lost:false};
   for(let i=0;i<5;i++){const raider=this.spawn(ENEMY,i%2?'fireship':'frigate',18500+i*80,11200+i*80);raider.order={type:'attack',targetId:ship.id};}
  }
  this.refreshObjectives();
 }
 private updateMission(){
  const g=this.game,s=this.state,m=s.mission;
  const beacon=g.buildings.find(b=>b.id==='tide-beacon'),citadel=g.buildings.find(b=>b.id==='citadel');
  if(!this.hero()||!g.buildings.some(b=>b.id==='expedition')||!beacon){this.finish(false,'统帅、司令部或灯塔已失守。航路中断，远征失败。');return;}
  if(citadel)citadel.invulnerable=!m.sealBroken;
  if(m.stage===0){
   if(g.tick===600)this.say('港务长 · 伊蕾','袭击队正在向灯塔靠拢。让工程队开工，远征军去挡住他们！');
   if(g.tick>=600)for(const id of m.raiders){const u=g.units.find(u=>u.id===id);if(u&&u.order.type==='hold')u.order={type:'attackMove',x:BEACON.x,y:BEACON.y};}
   if(beacon.hp>=beacon.maxHp*.9&&!m.raiders.some(id=>g.units.some(u=>u.id===id)))this.advance();
  }
  if(m.stage>=1){
   const route=[{x:6800,y:7600},{x:7800,y:6600},{x:8800,y:5700},LANDING];
   for(const cargo of m.cargo)this.sailCargo(cargo,route);
   if(m.stage===1){
    if(m.cargo.every(c=>c.lost)){this.finish(false,'两艘粮船均已沉没。北线失去补给，远征无法继续。');return;}
    const landed=g.units.some(u=>u.id===HERO&&u.x>7800&&u.x<14600&&Math.abs(u.y-4200)<1700);
    if(m.cargo.some(c=>c.delivered)&&landed){
     const forward=this.build(PLAYER,'townHall',10200,4750,'tide-forward-base');forward.hp=forward.maxHp=3500;
     this.build(PLAYER,'workshop',10480,4750,'tide-forward-workshop');
     this.state.supply[ALLY]+=1800;this.say('船长 · 赫恩','粮船靠岸了。北岬的工坊和补给站交给你；这里现在可以生产攻城器械。');this.advance();
    }
   }
  }
  if(m.stage>=2&&!m.mageRescued){
   const mage=g.units.find(u=>u.id==='league-mage');
   const rescue=g.units.some(u=>u.owner===PLAYER&&!UNIT_DEFS[u.kind].naval&&Math.hypot(u.x-MAGE.x,u.y-MAGE.y)<400);
   const danger=g.units.some(u=>u.owner===ENEMY&&Math.hypot(u.x-MAGE.x,u.y-MAGE.y)<450);
   if(mage&&rescue&&!danger){
    m.mageRescued=true;mage.owner=PLAYER;mage.hp=mage.maxHp;mage.order={type:'hold',x:mage.x,y:mage.y};
    const dragon=g.units.find(u=>u.id==='crown-dragon');if(dragon){dragon.attackDamage=120;dragon.maxHp=10000;dragon.hp=Math.min(dragon.hp,dragon.maxHp);}
    this.say('大法师 · 瑟芙','龙血的契约已经断了。把你的人展开，不要聚在它的吐息下。我的风暴会为你打开缺口。');g.players[PLAYER]!.gold+=700;m.rewardGold+=700;
   }
  }
  const held=s.ports.filter(p=>['north','heart','south'].includes(p.id)&&p.owner===ALLY&&!p.contested).length;
  if(m.stage===2){m.portHold=held>=2?m.portHold+1:0;if(m.portHold>=30)this.advance();}
  if(m.stage>=3&&!m.sealBroken&&!g.buildings.some(b=>b.id==='tide-seal')){
   m.sealBroken=true;if(citadel)citadel.invulnerable=false;
   this.say('海军议会','潮汐枢纽已毁，结界正在崩解。主力转向王廷堡垒。');
  }
  if(m.stage===3&&m.sealBroken&&!citadel)this.advance();
  if(m.stage===4){
   const evacuation=m.evacuation;
   if(evacuation){this.sailCargo(evacuation,[{x:17300,y:11800},{x:13600,y:11600},{x:9200,y:11600},{x:7100,y:10800},{x:6550,y:9200}]);if(evacuation.delivered)evacuation.arrived=true;}
   if(evacuation?.lost){this.finish(false,'撤离船沉没，最后一批平民没能穿过海峡。');return;}
   s.hold=held>=2?s.hold+1:0;
   if(s.hold>=60&&evacuation?.arrived){this.finish(true,'撤离船已抵达灯塔，诸港仍在我们手中。海峡重获航路。');return;}
  }
  this.refreshObjectives();
 }
 private sailCargo(cargo:{id:string;waypoint:number;delivered?:boolean;lost:boolean},route:readonly {x:number;y:number}[]){
  if(cargo.delivered||cargo.lost)return;
  const ship=this.game.units.find(u=>u.id===cargo.id);if(!ship){cargo.lost=true;this.note('运输船失联：'+cargo.id);return;}
  const target=route[cargo.waypoint];if(!target){cargo.delivered=true;ship.order={type:'hold',x:ship.x,y:ship.y};return;}
  const p=walkableGoal(this.game.map,target.x,target.y,'sea');
  if(Math.hypot(ship.x-p.x,ship.y-p.y)<220){cargo.waypoint++;if(cargo.waypoint>=route.length){cargo.delivered=true;ship.order={type:'hold',x:ship.x,y:ship.y};if(cargo.id.startsWith('tide-cargo')){this.state.supply[ALLY]+=1200;this.game.players[PLAYER]!.gold+=400;this.state.mission.rewardGold+=400;}return;}}
  const next=route[cargo.waypoint];if(next){const goal=walkableGoal(this.game.map,next.x,next.y,'sea');ship.order={type:'move',x:goal.x,y:goal.y};}
 }
 private finish(victory:boolean,text:string){
  this.state.outcome=victory?'victory':'defeat';this.game.match.winner=victory?PLAYER:ENEMY;this.game.match.endedAtTick=this.game.tick;
  if(victory)this.state.mission.completed.push('4');this.say('远征记录',text);this.refreshObjectives();
 }
 private refreshObjectives(){
  const m=this.state.mission,g=this.game,beacon=g.buildings.find(b=>b.id==='tide-beacon');
  const objective=(id:string,title:string,detail:string,done:boolean,point:{x:number;y:number},optional=false):MissionObjective=>({id,title,detail,done,...point,...(optional?{optional:true}:{})});
  let objectives:MissionObjective[]=[];
  if(m.stage===0)objectives=[objective('raiders','清除岸上袭击队',`${m.raiders.filter(id=>g.units.some(u=>u.id===id)).length} 名袭击者仍在岸上`,!m.raiders.some(id=>g.units.some(u=>u.id===id)),BEACON),objective('beacon','修复灯塔至 90%',`完好度 ${Math.round((beacon?.hp??0)/(beacon?.maxHp??1)*100)}% · 选择工程兵右键灯塔`,!!beacon&&beacon.hp>=beacon.maxHp*.9,BEACON)];
  if(m.stage===1)objectives=[objective('convoy','至少护送一艘粮船抵达北岬',`${m.cargo.filter(c=>c.delivered).length}/2 抵达 · ${m.cargo.filter(c=>c.lost).length} 沉没`,m.cargo.some(c=>c.delivered),g.units.find(u=>u.id===m.cargo.find(c=>!c.delivered&&!c.lost)?.id)??LANDING),objective('landing','统帅率远征军登陆北岬', '用登陆舰运兵；在目标岸边卸载',g.units.some(u=>u.id===HERO&&u.x>7800&&u.x<14600&&Math.abs(u.y-4200)<1700),LANDING)];
  if(m.stage===2)objectives=[objective('ports','维持两处海峡港口 30 秒',`${m.portHold}/30 秒 · 港口交战时停止输送补给`,m.portHold>=30,{x:12800,y:9200}),objective('mage','营救白盐港的大法师','远征军接近她并清除附近敌军；削弱巨龙，获得法师',m.mageRescued,MAGE,true)];
  if(m.stage===3)objectives=[objective('seal','摧毁潮汐枢纽','破城符石与攻城器械能打破枢纽，解除堡垒结界',m.sealBroken,SEAL),objective('citadel','摧毁王廷堡垒',m.sealBroken?'结界已解除，协同主力攻城':'结界保护中，先破坏潮汐枢纽',!g.buildings.some(b=>b.id==='citadel'),CITADEL),objective('dragon','击败王廷巨龙','营救法师可以削弱它；重弩堡和床弩克制大型目标',!g.units.some(u=>u.id==='crown-dragon'),g.units.find(u=>u.id==='crown-dragon')??CITADEL,true)];
  if(m.stage===4)objectives=[objective('last-ports','守住两处港口 60 秒',`${this.state.hold}/60 秒`,this.state.hold>=60,{x:12800,y:9200}),objective('evacuation','掩护撤离船抵达灯塔','最后一艘船会沿南侧水道西行，拦截追击舰队',!!m.evacuation?.arrived,this.game.units.find(u=>u.id===m.evacuation?.id)??EMBARK)];
  m.objectives=objectives;
 }
 missionOrder(id:string){
  const g=this.game,m=this.state.mission;if(this.state.outcome!=='playing')return '远征已经结束';
  if(id==='repairBeacon'){
   const beacon=g.buildings.find(b=>b.id==='tide-beacon');if(!beacon)return '灯塔已经失守';if(beacon.hp>=beacon.maxHp)return '灯塔已修复';
   const workers=g.units.filter(u=>u.owner===PLAYER&&u.kind==='worker'&&Math.hypot(u.x-BEACON.x,u.y-BEACON.y)<5000);
   if(!workers.length)return '附近没有工程兵';
   workers.forEach((worker,i)=>{const angle=i/workers.length*Math.PI*2;this.command({type:'move',unitIds:[worker.id],x:BEACON.x+Math.cos(angle)*130,y:BEACON.y+Math.sin(angle)*130});this.command({type:'repair',unitIds:[worker.id],buildingId:beacon.id,queued:true});});return;
  }
  if(id==='escort'){
   const target=m.stage===4?m.evacuation:m.cargo.find(c=>!c.delivered&&!c.lost);if(!target||!g.units.some(u=>u.id===target.id))return '当前没有待护航船只';
   const ships=g.units.filter(u=>u.owner===PLAYER&&u.kind==='warship');if(!ships.length)return '需要战舰才能护航';this.command({type:'follow',unitIds:ships.map(u=>u.id),targetId:target.id});return;
  }
  if(['embark','landNorth','landHeart','landSouth'].includes(id)){
   if(m.stage<1)return '先修复灯塔，打通航路';
   const boats=g.units.filter(u=>u.owner===PLAYER&&u.kind==='transport'&&!this.state.voyages[u.id]);
   const hero=g.units.find(u=>u.id===HERO);
   if(!hero)return '统帅仍在船上，请等待卸载或手动下令';
   const nearby=g.units.filter(u=>u.owner===PLAYER&&!UNIT_DEFS[u.kind].naval&&Math.hypot(u.x-hero.x,u.y-hero.y)<2600);
   const engineers=nearby.filter(u=>u.kind==='worker').slice(0,2);
   const army=[...nearby.filter(u=>u.kind!=='worker'),...engineers].sort((a,b)=>{const priority=(u:Unit)=>u.id===HERO?0:u.id==='league-mage'?1:u.kind==='worker'?2:u.kind==='priest'?3:4;return priority(a)-priority(b);});
   if(!boats.length||!army.length)return '需要后方陆军与空闲登陆舰';
   const remaining=[...army],target=id==='landSouth'?'south':id==='landHeart'?'heart':'north';let boatIndex=0;
   for(const boat of boats){const crew:Unit[]=[];let supply=0;
    for(let i=0;i<remaining.length;){const u=remaining[i]!,cost=unitRules(g,u).supplyUsed;if(supply+cost<=carries(boat)){crew.push(u);supply+=cost;remaining.splice(i,1);}else i++;}
    if(!crew.length)break;
    const slot=boatIndex++;
    this.state.voyages[boat.id]={target,stage:'expedition-loading',since:g.tick,crew:crew.map(u=>u.id),landingX:10000+slot*260};
    this.command({type:'board',unitIds:crew.map(u=>u.id),transportId:boat.id});
    const islandLane=LANES.reduce((a,b)=>Math.abs(a-hero.y)<Math.abs(b-hero.y)?a:b);
    const loading=hero.x<7500?EMBARK:{x:10000+slot*260,y:islandLane+1100};
    const shore=walkableGoal(g.map,loading.x,loading.y,'sea');boat.order={type:'move',x:shore.x,y:shore.y};
   }
   const leader=boats[0];if(leader){const escorts=g.units.filter(u=>u.owner===PLAYER&&u.kind==='warship');if(escorts.length)this.command({type:'follow',unitIds:escorts.map(u=>u.id),targetId:leader.id});}
   return;
  }
  const port=this.state.ports.find(p=>p.id===id&&['north','heart','south'].includes(id));if(!port)return '未知战线';
  if(m.stage<1)return '修复灯塔后，海军议会才会接受调度';
  if(g.tick<m.dispatchTick+1200)return '主力调度尚在冷却';
  if(this.state.supply[ALLY]<400)return '联军补给不足';
  this.state.supply[ALLY]-=400;m.dispatchTick=g.tick;
  const reserve=new Set(this.state.reserves);
  const troops=g.units.filter(u=>u.owner===ALLY&&reserve.has(u.id)&&Math.abs(u.y-port.y)<1800).slice(0,120);
  if(!troops.length){this.state.supply[ALLY]+=400;return '该战线已经没有预备队';}
  const ids=new Set(troops.map(u=>u.id));this.state.reserves=this.state.reserves.filter(id=>!ids.has(id));
  for(const u of troops)u.order={type:'attackMove',x:port.x,y:port.y+(g.nextId++%7-3)*90};
  this.say('海军议会',`${port.name}已收到调度：120 人预备队正在增援。`);
 }
 private release(side:Side,count:number,lane?:number){
  const reserve=new Set(this.state.reserves),ids=new Set<string>();
  for(const u of this.game.units){if(ids.size>=count)break;if(u.owner!==side||!reserve.has(u.id)||(lane!==undefined&&Math.abs(u.y-LANES[lane]!)>1800))continue;
   ids.add(u.id);const y=LANES.reduce((a,b)=>Math.abs(a-u.y)<Math.abs(b-u.y)?a:b);
   u.order={type:'attackMove',x:12800,y:y+(ids.size%7-3)*85};
  }
  this.state.reserves=this.state.reserves.filter(id=>!ids.has(id));
 }
 private strategy(){
  const g=this.game,m=this.state.mission;if(m.stage===0)return;
  const reserve=new Set(this.state.reserves);
  for(const side of [ALLY,ENEMY] as const){
   const units=g.units.filter(u=>u.owner===side&&!reserve.has(u.id)&&u.kind!=='worker'&&!UNIT_DEFS[u.kind].naval&&u.id!=='league-mage');
   for(let lane=0;lane<3;lane++){
    const port=this.state.ports[lane]!,group=units.filter(u=>Math.abs(u.y-port.y)<1800);
    const hostile=g.units.filter(u=>g.teams[u.owner]!==g.teams[side]&&Math.hypot(u.x-port.x,u.y-port.y)<950).length;
    const secure=port.owner===side&&!port.contested;
    // Each island has its own reserve and flank. No orders to march over a channel.
    const target=secure&&group.length>hostile*1.2?(side===ALLY&&m.stage>=3&&lane===1?(m.sealBroken?CITADEL:SEAL):{x:side===ALLY?15700:9800,y:port.y}):port;
    group.forEach((u,i)=>{if(u.order.type==='board'||u.order.type==='follow'||u.order.type==='attack'||(u.order.type==='attackMove'&&u.order.targetId))return;u.order={type:'attackMove',x:target.x,y:target.y+(i%9-4)*90};});
   }
   const ships=g.units.filter(u=>u.owner===side&&u.kind==='warship'&&!u.id.startsWith('convoy-hunter'));
   for(const ship of ships){if(ship.order.type==='attack')continue;const targets=this.state.ports.filter(p=>p.owner!==side||p.contested);
    const target=targets.sort((a,b)=>Math.hypot(ship.x-a.x,ship.y-a.y)-Math.hypot(ship.x-b.x,ship.y-b.y))[0];
    if(target){const p=walkableGoal(g.map,target.x,target.y,'sea');ship.order={type:'attackMove',x:p.x,y:p.y};}
   }
  }
 }
 private ferries(){
  const g=this.game;
  const liveBoats=new Set(g.units.filter(u=>u.kind==='transport').map(u=>u.id));
  for(const id of Object.keys(this.state.voyages))if(!liveBoats.has(id))delete this.state.voyages[id];
  for(const boat of g.units.filter(u=>u.kind==='transport'&&u.variant!=='tide/cargo'&&!u.id.startsWith('tide-evacuation'))){
   let trip=this.state.voyages[boat.id];const side=boat.owner;
   if(side===PLAYER){
    if(!trip)continue;
    if(trip.stage==='expedition-loading'&&((trip.crew?.every(id=>boat.cargo?.some(u=>u.id===id)))||((boat.cargo?.length??0)>0&&g.tick-trip.since>600))){
     const lane=trip.target==='south'?2:trip.target==='heart'?1:0;
     const target={x:trip.landingX??LANDING.x,y:LANES[lane]!+1100};
     issuePlayerCommand(g,PLAYER,{type:'unload',unitIds:[boat.id],x:target.x,y:target.y});trip.stage='expedition-landing';
    }else if(trip.stage==='expedition-landing'&&!boat.cargo?.length){delete this.state.voyages[boat.id];}
    continue;
   }
   if((side!==ALLY&&side!==ENEMY)||this.state.mission.stage<1)continue;
   if(!trip){
    const land=g.units.filter(u=>u.owner===side&&!UNIT_DEFS[u.kind].naval&&u.kind!=='worker'&&!u.variant);
    const lanes=LANES.map((y,index)=>({index,y,troops:land.filter(u=>Math.abs(u.y-y)<1800)}));
    const targets=this.state.ports.slice(0,3).map((port,index)=>{
     const friend=land.filter(u=>Math.hypot(u.x-port.x,u.y-port.y)<1600).length;
     const foe=g.units.filter(u=>g.teams[u.owner]!==g.teams[side]&&Math.hypot(u.x-port.x,u.y-port.y)<1600).length;
     return {port,index,need:(port.owner!==side?500:0)+foe-friend};
    }).sort((a,b)=>b.need-a.need);
    const target=targets[0]!;
    const source=lanes.filter(l=>l.index!==target.index&&l.troops.length>150).sort((a,b)=>b.troops.length-a.troops.length)[0];
    if(!source||target.need<0)continue;
    const loading=walkableGoal(g.map,side===ALLY?10300:15600,source.y+1100,'sea');
    const assigned=new Set(Object.values(this.state.voyages).flatMap(t=>t.crew??[]));
    const crew:Unit[]=[];let population=0;
    for(const u of source.troops.filter(u=>!assigned.has(u.id)).sort((a,b)=>Math.hypot(a.x-loading.x,a.y-loading.y)-Math.hypot(b.x-loading.x,b.y-loading.y))){
     const used=unitRules(g,u).supplyUsed;if(population+used>carries(boat))continue;crew.push(u);population+=used;if(population>=carries(boat)-1)break;
    }
    if(!crew.length)continue;
    trip=this.state.voyages[boat.id]={target:target.port.id,stage:'loading',since:g.tick,crew:crew.map(u=>u.id),loadingX:loading.x,loadingY:loading.y,landingX:side===ALLY?10000+(g.nextId++%6)*220:15100+(g.nextId++%6)*180};
    const ids=new Set(crew.map(u=>u.id));this.state.reserves=this.state.reserves.filter(id=>!ids.has(id));
    issuePlayerCommand(g,side,{type:'board',unitIds:crew.map(u=>u.id),transportId:boat.id});
    boat.order={type:'move',x:loading.x,y:loading.y};
   }
   const port=this.state.ports.find(p=>p.id===trip!.target)!;
   if(trip.stage==='loading'){
    const liveCrew=(trip.crew??[]).filter(id=>g.units.some(u=>u.id===id)||boat.cargo?.some(u=>u.id===id));
    const aboard=boat.cargo??[];
    if((liveCrew.length>0&&liveCrew.every(id=>aboard.some(u=>u.id===id)))||(aboard.length>0&&g.tick-trip.since>1000)){
     issuePlayerCommand(g,side,{type:'unload',unitIds:[boat.id],x:trip.landingX??port.x,y:port.y+1100});trip.stage='landing';
    }else if(!liveCrew.length){delete this.state.voyages[boat.id];}
   }else if(!boat.cargo?.length){delete this.state.voyages[boat.id];}

  }
 }
 private logistics(){
  const g=this.game;if(this.state.mission.stage<1)return;
  for(const side of [ALLY,ENEMY] as const){
   const bases=g.buildings.filter(b=>b.owner===side&&b.kind==='townHall'&&b.complete&&b.id!=='citadel');
   const count=g.units.filter(u=>u.owner===side).length;
   const navy=g.units.filter(u=>u.owner===side&&(u.kind==='warship'||u.kind==='transport'));
   const shipId=SHIPS[Math.floor(g.tick/400)%SHIPS.length]!.id,shipDef=SHIPS.find(d=>d.id===shipId)!;
   if(navy.length<18&&bases.length&&this.state.supply[side]>=shipDef.cost){this.state.supply[side]-=shipDef.cost;this.spawn(side,shipId,side===ALLY?8000:17800,6700);}
   for(let lane=0;lane<3;lane++){
    const port=this.state.ports[lane]!;
    const threat=g.units.filter(u=>g.teams[u.owner]!==g.teams[side]&&Math.hypot(u.x-port.x,u.y-port.y)<1200).length;
    this.release(side,port.owner!==side||threat>60?50:20,lane);
   }
   if(count<2500&&bases.length&&this.state.supply[side]>=180){
    const base=bases[Math.floor(g.tick/400)%bases.length]!;this.state.supply[side]-=180;
    for(let i=0;i<12;i++){const p=walkableGoal(g.map,base.x+(side===ALLY?300:-300)+(i%4)*50,base.y+Math.floor(i/4)*50);const u=g.spawnUnit(side,i%4===0?'archer':'footman',p.x,p.y);u.order={type:'attackMove',x:12800,y:base.y};}
   }
   for(const worker of g.units.filter(u=>u.owner===side&&u.kind==='worker')){
    const hurt=g.buildings.find(b=>b.owner===side&&b.hp<b.maxHp&&Math.hypot(b.x-worker.x,b.y-worker.y)<1000);
    if(hurt){issuePlayerCommand(g,side,{type:'repair',unitIds:[worker.id],buildingId:hurt.id});this.state.repairs++;}
    else if(this.state.supply[side]>250&&g.buildings.filter(b=>b.owner===side&&Math.hypot(b.x-worker.x,b.y-worker.y)<650).length<7){
     const x=worker.x+(side===ALLY?220:-220),y=worker.y+220;
     if(isWalkable(g.map,x,y)&&!g.buildings.some(b=>Math.hypot(b.x-x,b.y-y)<160)){const type=DEFENSES[(g.tick/400|0)%DEFENSES.length]!.id;const built=this.addDefense(side,type,x,y,false);worker.order={type:'repair',buildingId:built.id};this.state.supply[side]-=250;this.state.builds++;}
    }
   }
  }
 }
 save():CampaignSave{return {version:1,snapshot:snapshotGame(this.game),nextId:this.game.nextId,state:structuredClone(this.state)};}
}
