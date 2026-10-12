// Run from repository root. Independent diagnostic; never replaces no-GC data.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=readFileSync('scripts/art-canvas-benchmark.ts','utf8');
const path=`scripts/.art-gc-diagnostic-${process.pid}.ts`;
const suffix=`
if(typeof global.gc!=='function')throw new Error('Diagnostic requires --expose-gc');
const gcMemory=[{phase:'after-four-matches-before-gc',memory:process.memoryUsage()}];
for(let pass=1;pass<=2;pass++){
 global.gc();
 await new Promise<void>(done=>setImmediate(done));
 gcMemory.push({phase:'after-gc-'+pass,memory:process.memoryUsage()});
}
const diagnostic={commit:result.commit,method:'Independent diagnostic only: four complete final-art matches with normal automatic GC, then two explicit GC calls separated by setImmediate. Original runs/result remain referenced and used after GC. Cache module remains live. No production code changed. Not an optimization result.',memory:gcMemory,retainedRunCount:runs.length,retainedRenderSamples:runs.reduce((n,r)=>n+r.render.valuesMs.length,0),stateHashes:runs.map(r=>r.stateHashes),cacheAfterGc:(atlasArt as unknown as {canvasArtCacheStats?:()=>unknown}).canvasArtCacheStats?.(),productionSourceSha256:result.sourceSha256};
writeFileSync(resolve(output,'gc-diagnostic.json'),JSON.stringify(diagnostic,null,2)+'\\n');
console.log(JSON.stringify(diagnostic));
`;
const output=process.argv[2]??'work/art-gc-diagnostic';
try{
 writeFileSync(path,source+suffix);
 const run=spawnSync(process.execPath,['--expose-gc','--import','tsx',path,'--final-art','--out',output],{stdio:'inherit'});
 process.exitCode=run.status??1;
}finally{unlinkSync(path);}
