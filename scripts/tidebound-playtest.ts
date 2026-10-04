import {TideboundCampaign,HERO,PLAYER,ENEMY} from '../src/campaigns/tidebound/campaign';
import {writeFileSync} from 'node:fs';
const run=process.argv[2]??'01';let c=new TideboundCampaign();const samples:unknown[]=[];let refusals:Record<string,number>={};let commands=0;
function command(cmd:Parameters<typeof c.command>[0]){c.command(cmd);commands++;}
const start=performance.now();
for(let i=0;i<12000&&c.state.outcome==='playing';i++){
 if(i%20===0){
  const hero=c.game.units.find(u=>u.id===HERO);if(!hero)break;
  const units=c.game.units.filter(u=>u.owner===PLAYER&&u.kind!=='worker'&&u.kind!=='transport'&&u.kind!=='warship');
  const foes=c.game.units.filter(u=>u.owner===ENEMY&&Math.hypot(u.x-hero.x,u.y-hero.y)<800);
  const target=foes.sort((a,b)=>Math.hypot(a.x-hero.x,a.y-hero.y)-Math.hypot(b.x-hero.x,b.y-hero.y))[0];
  function cast(n:number,x:number,y:number){if(c.state.cooldowns[n]!<=c.game.tick){const r=c.cast(n,x,y);if(r)refusals[r]=(refusals[r]??0)+1;}}
  if(target){cast(0,target.x,target.y);cast(4,target.x,target.y);cast(3,target.x,target.y);}
  if(hero.hp<hero.maxHp*.85||units.some(u=>u.hp<u.maxHp*.6))cast(1,hero.x,hero.y);
  const citadel=c.game.buildings.find(b=>b.id==='citadel');
  const building=c.game.buildings.filter(b=>b.owner===ENEMY&&Math.hypot(b.x-hero.x,b.y-hero.y)<880).sort((a,b)=>(a.id==='citadel'?-1:1)-(b.id==='citadel'?-1:1))[0];
  if(building)cast(2,building.x,building.y);
  if(hero.hp<1800){cast(5,Math.max(2400,hero.x-1200),hero.y);command({type:'move',unitIds:units.map(u=>u.id),x:Math.max(2400,hero.x-900),y:hero.y});}
  else if(i%100===0){
   const port=c.state.ports.filter(p=>p.id!=='east'&&p.id!=='west'&&(p.owner!=='fleet'||p.contested)).sort((a,b)=>Math.hypot(a.x-hero.x,a.y-hero.y)-Math.hypot(b.x-hero.x,b.y-hero.y))[0];
   const dest=citadel&&c.state.ports.filter(p=>p.owner==='fleet').length>=3?citadel:port??citadel??{x:4100,y:4000};
   command({type:'attackMove',unitIds:units.map(u=>u.id),x:dest.x,y:dest.y});
  }
  if(i%400===0){const workers=c.game.units.filter(u=>u.owner===PLAYER&&u.kind==='worker');for(const worker of workers)command({type:'mine',unitIds:[worker.id],resourceId:'expedition-mine'});const r=c.recruit('ballista');if(r)refusals[r]=(refusals[r]??0)+1;}
 }
 if(i===1800&&(run==='03'||run==='08')){const save=JSON.parse(JSON.stringify(c.save()));c=new TideboundCampaign('standard',save);console.log('checkpoint restored at tick',c.game.tick);}
 c.step();
 if(i%1200===1199){const sample={minute:(i+1)/1200,units:c.game.units.length,hero:c.game.units.find(u=>u.id===HERO)?.hp,citadel:c.game.buildings.find(b=>b.id==='citadel')?.hp,ports:c.state.ports.map(p=>[p.id,p.owner,p.contested]),losses:c.state.losses};samples.push(sample);console.log(JSON.stringify(sample));}
}
const result={run,outcome:c.state.outcome,tick:c.game.tick,wallMs:performance.now()-start,commands,casts:c.state.casts,refusals,initial:5047,remaining:c.game.units.length,navy:c.game.units.filter(u=>u.kind==='transport'||u.kind==='warship').map(u=>({owner:u.owner,kind:u.variant,x:u.x,y:u.y,cargo:u.cargo?.length})),state:c.state,samples};
writeFileSync(`docs/reviews/tidebound-round-${run}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({run,outcome:result.outcome,tick:result.tick,wallMs:result.wallMs}));
