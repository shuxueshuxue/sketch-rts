import {readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(process.argv[2]),directory=resolve(root,'docs/balance/guardian-scroll-area/browser');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const priorBytes=await readFile(resolve(directory,'manifest-before-browser.json'));
assert.equal(sha(priorBytes),'b65ad68aef5d09793b71a12e78091bf6f390f36576aa62ea65f09db41ec16a9e');
const prior=JSON.parse(priorBytes);
for(const row of prior.files)assert.equal(sha(await readFile(resolve(root,row.path))),row.sha256,row.path);
const proof=JSON.parse(await readFile(resolve(directory,'capture/capture.json'),'utf8'));
assert.equal(proof.captures.length,2);assert.deepEqual(proof.errors,[]);assert.deepEqual(proof.networkFailures,[]);
assert.equal(proof.consoleMessages.filter(row=>row.type==='error').length,0);
assert.equal(sha(await readFile(resolve(directory,'tools/capture-recorded.mjs'))),proof.harnessSha256);
assert.equal(sha(await readFile(resolve(directory,'tools/fixture.mjs'))),proof.fixtureSha256);
assert.equal(sha(await readFile(resolve(directory,'tools/page.html'))),proof.htmlSha256);
const snapshots=[];
for(const [index,capture] of proof.captures.entries()){
  assert.equal(capture.sourceUnchanged,true);assert.deepEqual(capture.start,capture.end);
  const report=capture.report;
  assert.equal(report.radius,index===0?280:180);assert.equal(report.rulesVersion,index===0?2:3);
  assert.equal(report.is3D,true);assert.equal(report.stackVisible,true);assert.equal(report.drawCount,3);
  assert.equal(report.renderer.glError,0);assert.equal(report.renderer.info.frame,3);
  assert(report.renderer.info.calls>0);assert(report.renderer.info.triangles>0);
  assert.equal(report.model.townHallLoaded,true);assert.equal(report.model.modelCache.models,1);assert.equal(report.model.modelCache.pending,0);
  assert.equal(report.snapshotUnchanged,true);assert.equal(report.field.radius,report.radius);
  for(const actor of report.actors)assert.equal(actor.protectedByScroll,index===0||actor.distance===160);
  assert.deepEqual(report.fixture,proof.captures[0].report.fixture);assert.deepEqual(report.view,proof.captures[0].report.view);
  const png=await readFile(resolve(directory,'capture',capture.png));assert.equal(sha(png),capture.pngSha256);
  assert.equal(png.readUInt32BE(16),1280);assert.equal(png.readUInt32BE(20),720);
  const raw=await readFile(resolve(directory,'capture',`${capture.name}-snapshot.json`));assert.equal(sha(raw),capture.snapshotSha256);
  const snapshot=JSON.parse(raw);
  assert.equal(snapshot.tick,0);assert.equal(snapshot.units.length,9);assert.equal(snapshot.buildings.length,1);
  for(const unit of snapshot.units)unit.effects=unit.effects.filter(effect=>effect.type!=='guardian');
  for(const effect of snapshot.effects)if(effect.type==='guardianField')effect.radius=0;
  snapshots.push(snapshot);
}
assert.deepEqual(snapshots[0],snapshots[1]);
// Only the uniquely owned directory from this capture. Chromium was already
// sent SIGTERM by the launcher; its finished writes caused the original race.
const ownedScratch='/workspace/guardian-webgl-sFHqCo';
await rm(ownedScratch,{recursive:true,force:true,maxRetries:8,retryDelay:50});
const result={verified:true,priorManifestSha256:sha(priorBytes),priorEntriesUnchanged:prior.files.length,
  captures:2,viewport:'1280x720',actualWebGL2:true,nativeTownHallModelLoaded:true,
  snapshotEqualApartFromGuardianRecipientsAndFieldRadius:true,simulationTicksRun:0,drawsPerSource:3,
  launcherExitCode:1,launcherFailure:'Owned Chromium temporary-directory cleanup ENOTEMPTY after completed captures; original log retained.',
  artifactVerificationExitCode:0,sourceChanged:false,glErrors:0,browserExceptions:0,consoleErrors:0,networkFailures:0,
  cleanup:{directory:ownedScratch,completed:true},screenshots:proof.captures.map(({name,png,pngSha256})=>({name,png,pngSha256}))};
await writeFile(resolve(directory,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
