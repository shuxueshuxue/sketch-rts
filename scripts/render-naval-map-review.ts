import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { drawMinimapMap, drawStartMarks } from '../src/client/minimap-art';
import { setScratchCanvasFactory } from '../src/client/art/scratch-canvas';
import type { GameSnapshot } from '../src/shared/types';
import type { GeneratedMap } from '../src/shared/generated-map';
import type { PoolMap } from '../src/shared/map-pool';

// Rebuild both maps from their source rather than checking in large terrain JSON.
// npx tsx scripts/render-naval-map-review.ts --baseline-ref 7bd93bb
// npx tsx scripts/render-naval-map-review.ts --baseline-path ../baseline --after-repo . --output work/maps.png
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string,string>();
for (let i=2; i<process.argv.length; i+=2) {
  const key = process.argv[i]!, value = process.argv[i+1];
  if (!['--baseline-ref','--baseline-path','--after-repo','--output'].includes(key) || !value) throw new Error(`Expected --baseline-ref REV or --baseline-path REPO, optional --after-repo REPO and --output PNG; got ${key}`);
  args.set(key,value);
}
if (args.has('--baseline-ref') === args.has('--baseline-path')) throw new Error('Provide exactly one of --baseline-ref REV or --baseline-path REPO');
const afterRepository = resolve(args.get('--after-repo') ?? repository);
let temporary: string | undefined;
let beforeRepository: string;
if (args.has('--baseline-path')) beforeRepository = resolve(args.get('--baseline-path')!);
else {
  const scratch = join(repository,'work');
  mkdirSync(scratch,{recursive:true});
  temporary = mkdtempSync(join(scratch,'naval-map-baseline-'));
  beforeRepository = temporary;
  const archive = execFileSync('git',['archive',args.get('--baseline-ref')!,'src'],{cwd:afterRepository,maxBuffer:64*1024*1024});
  execFileSync('tar',['-x','-C',temporary],{input:archive});
  writeFileSync(join(temporary,'package.json'),JSON.stringify({type:'module'}));
  symlinkSync(join(afterRepository,'node_modules'),join(temporary,'node_modules'),'dir');
}

type ReviewMap = GeneratedMap & {id:string;name:string;players:string[]};
async function layouts(repo:string): Promise<ReviewMap[]> {
  const module = (path:string) => import(pathToFileURL(join(repo,'src',path)).href);
  const [{generateMap},{MAP_POOL},{createRoom,roomToGameSetup}] = await Promise.all([
    module('shared/generated-map.ts'),module('shared/map-pool.ts'),module('shared/rooms.ts'),
  ]);
  return (MAP_POOL as PoolMap[]).map(spec => {
    const room = createRoom({id:`review-${spec.id}`,host:{id:'host',name:'Host'},mapId:spec.id,humanCount:1,aiCount:spec.players-1});
    const {options} = roomToGameSetup(room);
    return {id:spec.id,name:spec.name.en,players:options.players,...generateMap(spec.layout,options.players,options.teams)};
  });
}

try {
  const [before,after] = await Promise.all([layouts(beforeRepository),layouts(afterRepository)]);
  const changed = after.filter(map => {
    const old = before.find(old => old.id === map.id);
    return old && (old.size !== map.size || old.terrain.cells !== map.terrain.cells);
  });
  if (!changed.length) throw new Error('No changed named maps between the baseline and candidate');
  setScratchCanvasFactory((w,h) => createCanvas(w,h) as unknown as HTMLCanvasElement);
  const panel=372, top=92, rowHeight=432;
  const canvas=createCanvas(panel*4+96,top+Math.ceil(changed.length/2)*rowHeight+48),ctx=canvas.getContext('2d');
  ctx.fillStyle='#121e23';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#e8ede5';ctx.font='bold 26px sans-serif';ctx.fillText('Naval map spacing review',24,36);
  ctx.fillStyle='#a9c2c9';ctx.font='16px sans-serif';ctx.fillText('Terrain cell = 32; bases, mining and building sizes stay in game units. Before / After',24,64);
  for (const [i,map] of changed.entries()) {
    const old=before.find(old=>old.id===map.id)!;
    const x=24+(i%2)*(panel*2+24),y=top+Math.floor(i/2)*rowHeight;
    for (const [j,version] of [old,map].entries()) {
      const px=x+j*panel;
      ctx.fillStyle='#e8ede5';ctx.font='bold 16px sans-serif';ctx.fillText(`${version.name} — ${j===0?'Before':'After'}`,px,y+20);
      ctx.fillStyle='#9fb7b4';ctx.font='14px sans-serif';ctx.fillText(`${version.size} × ${version.size}  |  ${version.resources.length} mines`,px,y+43);
      const snapshot={map:{id:version.id,name:version.name,width:version.size,height:version.size,landmarks:version.landmarks,terrain:version.terrain},players:{},units:version.units,buildings:version.buildings,resources:version.resources,mercenaryCamps:version.mercenaryCamps,items:version.items,sites:version.sites,obstacles:version.obstacles} as unknown as GameSnapshot;
      const rect={x:px,y:y+56,width:panel-10,height:panel-10};
      drawMinimapMap(ctx as unknown as CanvasRenderingContext2D,snapshot,rect);
      drawStartMarks(ctx as unknown as CanvasRenderingContext2D,snapshot,rect,version.players);
    }
    const water=(version:ReviewMap)=>[...version.terrain.cells].filter(tile=>tile==='~').length*version.terrain.cell**2;
    console.log(JSON.stringify({id:map.id,beforeSize:old.size,afterSize:map.size,deepWaterAreaRatio:Number((water(map)/water(old)).toFixed(2)),mines:map.resources.length}));
  }
  const output=resolve(args.get('--output') ?? join(repository,'assets/naval-runtime/larger-seas-before-after.png'));
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,canvas.toBuffer('image/png'));
  console.log(output);
} finally {
  if(temporary)rmSync(temporary,{recursive:true,force:true});
}
