import { TideboundCampaign,HERO,PLAYER,ENEMY,ALLY } from '../src/campaigns/tidebound/campaign';
import { BEACON, SEAL, CITADEL, MAGE } from '../src/campaigns/tidebound/world';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
// A deterministic controller issuing ordinary player commands. This is not a browser playthrough.
const output=resolve(process.argv[2]??'docs/reviews');mkdirSync(output,{recursive:true});
const c=new TideboundCampaign(),begun=performance.now();let lastStage=-1,actions=0,returning=false,retreatUntil=0;const stages:unknown[]=[],samples:unknown[]=[];
const act=(id:string)=>{const result=c.missionOrder(id);actions++;return result;};
const cmd=(command:Parameters<typeof c.command>[0])=>{c.command(command);actions++;};
for(let i=0;i<36000&&c.state.outcome==='playing';i++){
 const m=c.state.mission,h=c.game.units.find(u=>u.id===HERO);
 if(m.stage!==lastStage){console.log(JSON.stringify({stage:m.stage,tick:c.game.tick,elapsedMs:performance.now()-begun}));stages.push({stage:m.stage,tick:c.game.tick});lastStage=m.stage;
  if(m.stage===0){act('repairBeacon');cmd({type:'attackMove',unitIds:c.game.units.filter(u=>u.owner===PLAYER&&!['worker','warship','transport'].includes(u.kind)).map(u=>u.id),x:BEACON.x+280,y:BEACON.y-400});}
  if(m.stage===1){act('embark');act('escort');}
  if(m.stage===3)act('landSouth');
  if(m.stage===4)act('escort');
 }
 if(i%20===0&&h){
  const army=c.game.units.filter(u=>u.owner===PLAYER&&!['worker','warship','transport'].includes(u.kind)&&Math.hypot(u.x-h.x,u.y-h.y)<2600);
  const foes=c.game.units.filter(u=>u.owner===ENEMY&&Math.hypot(u.x-h.x,u.y-h.y)<800).sort((a,b)=>Math.hypot(a.x-h.x,a.y-h.y)-Math.hypot(b.x-h.x,b.y-h.y));const target=foes[0];
  if(target){for(const index of [0,4,3]){if(c.state.cooldowns[index]!<=c.game.tick){c.cast(index,target.x,target.y);actions++;}}}
  if(h.hp<h.maxHp*.92||army.some(u=>u.hp<u.maxHp*.7)){if(c.state.cooldowns[1]!<=c.game.tick){c.cast(1,h.x,h.y);actions++;}}
  const fort=c.game.buildings.filter(b=>b.owner===ENEMY&&!b.invulnerable&&Math.hypot(b.x-h.x,b.y-h.y)<850).sort((a,b)=>(a.id==='tide-seal'?-1:0)-(b.id==='tide-seal'?-1:0))[0];
  if(fort&&c.state.cooldowns[2]!<=c.game.tick){c.cast(2,fort.x,fort.y);actions++;}
  if(h.hp<1400&&c.state.cooldowns[5]!<=c.game.tick){c.cast(5,h.x-1000,h.y);actions++;retreatUntil=c.game.tick+1000;}
  if(m.stage===3&&m.mageRescued&&!returning){const refusal=act('landHeart');if(!refusal)returning=true;}
  if(i%100===0&&c.game.tick>=retreatUntil){
   if(m.stage===2){cmd({type:'attackMove',unitIds:army.map(u=>u.id),x:12800,y:4200});if(c.game.tick-m.dispatchTick>=1200)act(c.state.ports[2]!.owner===ALLY?'heart':'south');}
   if(m.stage===3&&!m.mageRescued&&h.y>12500)cmd({type:'attackMove',unitIds:army.map(u=>u.id),x:MAGE.x,y:MAGE.y});
   if(m.stage===3&&h.y>7500&&h.y<11000){const target=m.sealBroken?CITADEL:SEAL;cmd({type:'attackMove',unitIds:army.map(u=>u.id),x:target.x,y:target.y});if(c.game.tick-m.dispatchTick>=1200)act('heart');}
   if(m.stage===4){cmd({type:'attackMove',unitIds:army.map(u=>u.id),x:12800,y:9200});if(c.game.tick-m.dispatchTick>=1200)act('north');}
  }
 }
 c.step();
 if(i%1200===1199){const sample={tick:c.game.tick,stage:c.state.mission.stage,units:c.game.units.length,hero:c.game.units.find(u=>u.id===HERO)?.hp,aboard:c.game.units.some(u=>u.cargo?.some(p=>p.id===HERO)),citadel:c.game.buildings.find(b=>b.id==='citadel')?.hp,seal:c.game.buildings.find(b=>b.id==='tide-seal')?.hp,ports:c.state.ports.map(p=>[p.id,p.owner,p.contested]),hold:c.state.hold,elapsedMs:performance.now()-begun};samples.push(sample);console.log(JSON.stringify(sample));}
}
const report={outcome:c.state.outcome,tick:c.game.tick,stages,actions,elapsedMs:performance.now()-begun,samples,mission:c.state.mission};
writeFileSync(resolve(output,'tidebound-mission-playtest.json'),JSON.stringify(report,null,2));writeFileSync(resolve(output,'tidebound-mission-end-save.json'),JSON.stringify(c.save()));console.log(JSON.stringify({outcome:report.outcome,tick:report.tick,stage:c.state.mission.stage,actions,elapsedMs:report.elapsedMs}));
