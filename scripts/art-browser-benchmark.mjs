/** Extend the existing real WebGL resource benchmark without modifying production code.
 * node --import tsx scripts/art-browser-benchmark.mjs --out work/art-browser.json --screenshot work/art-browser.png
 * Six independent layer lifetimes; 12 warmup + 60 full-WebGL draws each.
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const scripts=dirname(fileURLToPath(import.meta.url));
const dynamic=process.argv.includes('--dynamic');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(scripts,'..'),encoding:'utf8'}).trim();
const allUnits=process.argv.includes('--all-units');
const token=`.art-${process.pid}`;
const fixturePath=resolve(scripts,`${token}-fixture.js`),runnerPath=resolve(scripts,`${token}-runner.mjs`);
let fixture=await readFile(resolve(scripts,'browser-runtime-fixture.js'),'utf8');
if (allUnits) {
 const line="const kinds = ['shipOfTheLine', 'warship', 'transport', 'cutter', 'carrier', 'bombardShip'];";
 fixture=fixture.replace(line, line+"\nconst allLandKinds = Object.keys((await import(/* @vite-ignore */ `${source}/src/shared/catalog.ts`)).UNIT_DEFS).filter(kind => !geometry.shipProfile({kind}));");
 fixture=fixture.replace("['archer', 'footman', 'worker', 'priest'][i % 4]","allLandKinds[i % allLandKinds.length]");
}
if(dynamic)fixture=fixture.replace('window.runtimeReview = {', (await readFile(resolve(scripts,'art-dynamic-fixture.js'),'utf8'))+'\nwindow.runtimeReview = {');
const anchor='    const renderer = layer.renderer, realRender = renderer.render;';
if(!fixture.includes(anchor))throw new Error('Upstream fixture changed: review art benchmark integration');
fixture=fixture.replace(anchor,`${anchor}
    const artSamples = [], artSubmitSamples = [], artVisible = [], artModes = {}, artFrameIntervals = []; let artPreviousFrame;
    const artSavedFrame = {...frame};
    ${dynamic ? "frame.facing=new facing.UnitFacingTracker();frame.animation=new animation.UnitAnimationTracker();frame.motion=new motion.UnitMotionSmoother();frame.view={x:700,y:500,width:1280,height:720,zoom:.75};" : ''}
    // Fixed snapshot and deterministic timestamps. gl.finish fences each sample;
    // this measures software GPU completion, not desktop presentation cadence.
    for (let n = ${dynamic ? -4 : -12}; n < ${dynamic ? 12 : 60}; n++) {
      ${dynamic ? "const raf=await new Promise(resolve=>requestAnimationFrame(resolve));if(n>0&&artPreviousFrame!==undefined)artFrameIntervals.push(raf-artPreviousFrame);artPreviousFrame=raf;if(n%4===0)console.log(\"ART frame\",index,n);" : ""}
      frame.now = (${dynamic ? 'n + 19' : 'Math.max(0,n)'}) * ${dynamic ? 50 : '1000 / 60'};
      ${dynamic ? "frame.snapshot=dynamicSnapshots[n+19];frame.selectedIds=new Set(frame.snapshot.units.map(u=>u.id));const byId=new Map(frame.snapshot.units.map(u=>[u.id,u]));frame.facing.update(frame.snapshot.units,id=>byId.get(id));" : ''}
      const at = performance.now(); ${dynamic ? "frame.animation.update(frame.snapshot,frame.now);frame.motion.update(frame.snapshot,frame.now);" : ""} layer.draw(frame);
      const submitted = performance.now(); gl.finish();
      if (n >= 0) { artSubmitSamples.push(submitted-at); artSamples.push(performance.now()-at); ${dynamic ? "artVisible.push(frame.snapshot.units.filter(u=>u.x>=frame.view.x&&u.x<=frame.view.x+frame.view.width/frame.view.zoom&&u.y>=frame.view.y&&u.y<=frame.view.y+frame.view.height/frame.view.zoom).length);for(const u of frame.snapshot.units){const mode=frame.animation.frame(u,frame.now).mode;artModes[mode]=(artModes[mode]??0)+1;}console.log(\"ART sample\",index,n,artSamples.at(-1),artSubmitSamples.at(-1));" : ""} }
    }
    const artInfo = { frameIntervalsMs: artFrameIntervals, visibleUnitCounts: artVisible, animationModes: artModes, memory: {...renderer.info.memory}, render: {...renderer.info.render}, cards: typeof layer.cardStats === 'function' ? layer.cardStats() : layer.cardStats ?? null };
    ${dynamic ? "if(index===5)window.runtimeReview.dynamicScreenshot=canvas.toDataURL('image/png');" : ''}
    Object.assign(frame,artSavedFrame);`);
fixture=fixture.replace('index, homeMs, matchMs, staticCpu:', 'index, homeMs, matchMs, artTiming: { fullDrawFenced: summarize(artSamples), cpuSubmission: summarize(artSubmitSamples), fullDrawValuesMs: artSamples, submissionValuesMs: artSubmitSamples, renderer: artInfo, simulationMs: 0, snapshotReused: true }, staticCpu:');
if(dynamic)fixture=fixture.replace('simulationMs: 0, snapshotReused: true','simulationMs: 0, snapshotReused: false, replay: dynamicProof');
let runner=await readFile(resolve(scripts,'browser-runtime-benchmark.mjs'),'utf8');
runner=runner.replace('const errors = [], failed = [], requests = [], cycles = [];','const errors = [], failed = [], requests = [], cycles = [], artTrace = [];');
runner=runner.replace('completedCycles: cycles','completedCycles: cycles, artTrace');
runner=runner.replace("if (message.method === 'Runtime.exceptionThrown')","if (message.method === 'Runtime.consoleAPICalled' && message.params.args[0]?.value?.startsWith?.('ART ')) { const values=message.params.args.map(arg=>arg.value); console.log(values.join(' ')); if(values[0]==='ART sample')artTrace.push({cycle:values[1],frame:values[2],fencedMs:values[3],submissionMs:values[4]}); } if (message.method === 'Runtime.exceptionThrown')");
runner=runner.replace('cycles.push(cycle);', 'cycles.push(cycle); console.log(JSON.stringify({artCycle:index,artTiming:cycle.artTiming?.fullDrawFenced,modes:cycle.artTiming?.renderer?.animationModes,visible:cycle.artTiming?.renderer?.visibleUnitCounts?.at(-1)}));');
runner=runner.replaceAll('scripts/browser-runtime-fixture.js',`scripts/${token}-fixture.js`);
runner=runner.replace("method: 'Six cycles;", "artMethod: 'Each of six layer lifetimes adds 12 warmup and 60 full real WebGL draws; fixed 280-unit snapshot, identical selection, deterministic timestamps, 1280x720 DPR1; gl.finish fences software GPU completion. FullDrawFenced includes CPU scene updates, WebGL submission and SwiftShader completion. CpuSubmission excludes finish. No simulation runs in this fixture; do not report these as hardware FPS.', method: 'Six cycles;");
runner=runner.replace("const result = { renderer:", `const result = { artSourceCommit: ${JSON.stringify(sourceCommit)}, artScene: ${JSON.stringify(dynamic ? 'dynamic-1000' : allUnits ? 'all-land-kinds-280' : 'naval-280')}, artMeasuredUnits: ${dynamic ? 1000 : 280}, artMeasuredShips: ${dynamic ? 0 : 24}, renderer:`);
if(dynamic){
 runner=runner.replace('Each of six layer lifetimes adds 12 warmup and 60 full real WebGL draws','Each of three layer lifetimes adds 4 warmup and 12 full real WebGL draws (sim ticks 20-31), 36 samples total; too few to infer stable p99').replace("method: 'Six cycles;","method: 'Three dynamic cycles;");
 fixture=fixture.replaceAll('index === 5','index === 2').replaceAll('index===5','index===2');
 runner=runner.replace('}, 90000);','}, 300000);');
 runner=runner.replace('index < 6','index < 3').replace('result.cycles.length === 6','result.cycles.length === 3').replace('Expected all six resource cycles','Expected all three dynamic resource cycles').replace('retainedDisposedLayers === 6','retainedDisposedLayers === 3');
 runner=runner.replace('window.runtimeReview.lastScreenshot','window.runtimeReview.dynamicScreenshot');
 runner=runner.replace('fixed 280-unit snapshot, identical selection, deterministic timestamps','1000-unit real simulation replay, all selected, deterministic 50ms tick timestamps');
}
try {
 await writeFile(fixturePath,fixture);await writeFile(runnerPath,runner);
 const child=spawn(process.execPath,['--import','tsx',runnerPath,...process.argv.slice(2).filter(value => value !== '--all-units' && value !== '--dynamic')],{stdio:'inherit',cwd:resolve(scripts,'..')});
 const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done);});
 if(code!==0)process.exitCode=code??1;
}finally{await Promise.all([unlink(fixturePath).catch(()=>{}),unlink(runnerPath).catch(()=>{})]);}
