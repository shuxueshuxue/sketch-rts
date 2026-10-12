import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as after from '../src/client/art/environment';
import { renderWorldEffects } from '../src/client/effect-renderer';
import type { TerrainLandmark, WorldEffect } from '../src/shared/types';
// Temporary baseline modules are removed even when comparison fails. The revision is
// explicit so a later mainline update cannot silently change the comparison.
const baseline = process.argv[2] ?? '9819046b3820c9f843f0d57beaa198e7970fd5a7';
const baselineEnvironment = 'src/client/.baseline-environment.ts';
const baselineEffects = 'src/client/.baseline-effects.ts';
const source = (file:string) => execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'});
const atlas=source('src/client/atlas-art.ts');
const environment=atlas.slice(atlas.indexOf('/** One tree'),atlas.indexOf('export function drawAtlasCamp'))
  .replace('  sprite(c, "gold-mine", point, 1, (b) => {','  const b=c; b.save(); b.translate(point.x,point.y); {')
  .replace('  });\n}', '  } b.restore();\n}');
writeFileSync(baselineEnvironment,'import {type Brush, type Point, ellipse, line, polygon} from "./art/kit";\nimport type {Obstacle,TerrainLandmark} from "../shared/types";\n'+environment);
writeFileSync(baselineEffects,source('src/client/effect-renderer.ts'));
try {
const before=await import('../src/client/.baseline-environment');
const {renderWorldEffects:oldEffects}=await import('../src/client/.baseline-effects');
const kinds: TerrainLandmark['kind'][]=['grove','ridge','ruin','ditch','road','campMark','mineScar','bannerStone','flowers','bush','stump','log','mushrooms','pebbles','bones','reeds','lilies','wreck','campfire','signpost','pillar'];
const cases: {name:string; old:(c:CanvasRenderingContext2D)=>void; next:(c:CanvasRenderingContext2D)=>void}[]=kinds.map(kind=>{const landmark={id:kind,kind,x:0,y:0,size:96,rotation:.7};return{name:kind,old:c=>before.drawAtlasLandmark(c,landmark,{x:160,y:180}),next:c=>after.paintLandmark(c,landmark,{x:160,y:180})};});
for(const kind of ['rocks','gate'] as const)for(const hp of [100,25])for(const angle of [0,.5,1.57]){const obstacle={kind,hp,maxHp:100,radius:60,along:{x:Math.cos(angle),y:Math.sin(angle)}};cases.push({name:`${kind}-${hp}-${angle}`,old:c=>before.drawAtlasObstacle(c,obstacle,{x:160,y:180}),next:c=>after.paintObstacle(c,obstacle,{x:160,y:180})});}
cases.push({name:'mine',old:c=>before.drawAtlasMine(c,{x:160,y:180}),next:c=>{c.translate(160,180);after.paintMine(c);}});
for(const sourceKind of ['archer','summoner','redDragon','thornSlinger','murlocHunter','warship'] as const)for(const life of [.9,.5,.1]){const effects:WorldEffect[]=[{id:'p',type:'projectile',sourceKind,x:210,y:180,fromX:40,fromY:170,toX:230,toY:180,duration:30,remaining:30*life}];const options={effects,worldToScreen:(p:{x:number;y:number})=>p,nearScreen:()=>true};cases.push({name:`${sourceKind}-${life}`,old:ctx=>oldEffects({ctx,...options}),next:ctx=>renderWorldEffects({ctx,...options})});}
for(const type of ['chargeTrail','chargeImpact','chainLightning','heal','summon','curse','storm','guardianField','goldBounty','experienceBurst','flameBurn','stomp','web','bloodlust'] as const)for(const life of [.9,.5,.1]){const effects:WorldEffect[]=[{id:type,type,sourceKind:'knight',x:160,y:160,fromX:40,fromY:170,toX:160,toY:160,duration:30,remaining:30*life}];const options={effects,worldToScreen:(p:{x:number;y:number})=>p,nearScreen:()=>true};cases.push({name:`${type}-${life}`,old:ctx=>oldEffects({ctx,...options}),next:ctx=>renderWorldEffects({ctx,...options})});}
const results=cases.map(test=>{const left=createCanvas(320,320),right=createCanvas(320,320);test.old(left.getContext('2d') as unknown as CanvasRenderingContext2D);test.next(right.getContext('2d') as unknown as CanvasRenderingContext2D);const a=left.data(),b=right.data();let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;return {name:test.name,changedBytes:changed};});
writeFileSync('docs/art/refactor/domain-pixel-parity.json',JSON.stringify({baseline,canvas:'@napi-rs/canvas',size:[320,320],cases:results},null,2)+'\n');
console.log(JSON.stringify({cases:results.length,failures:results.filter(r=>r.changedBytes)}));
if(results.some(r=>r.changedBytes))process.exitCode=1;

} finally { unlinkSync(baselineEnvironment); unlinkSync(baselineEffects); }
