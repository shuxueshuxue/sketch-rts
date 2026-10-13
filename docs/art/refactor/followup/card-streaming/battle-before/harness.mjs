/** Adapt the existing real guard/blood simulation proof without changing its
 * commands, tick order, 80 captures, or production source. Run only after the
 * formal viewport sampling window has closed. */
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(arg('--source') ?? root), output = resolve(arg('--out') ?? 'docs/art/refactor/followup/viewport-performance/battle/after/proof.json');
await mkdir(dirname(output), { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const sourceTrees = Object.fromEntries(['src/shared', 'src/ai', 'src/server'].map(path => [path, execFileSync('git', ['rev-parse', `HEAD:${path}`], { cwd: sourceRoot, encoding: 'utf8' }).trim()]));
const upstreamFixture = await readFile(resolve(root, 'scripts/art-guard-blood-fixture.ts'), 'utf8');
let fixture = upstreamFixture.replaceAll("from '../src/", `from '/@fs${sourceRoot}/src/`).replace("from './art-gpu-completion.mjs'", `from '/@fs${root}/scripts/art-gpu-completion.mjs'`);
fixture = fixture.replace(/from '(\/\@fs[^']+\/src\/[^']+)'/g, (_, path) => `from '${path}.ts'`);
const replace = (from, to) => { if (!fixture.includes(from)) throw new Error('Guard fixture anchor changed: ' + from); fixture = fixture.replace(from, to); };
replace(' let bodyTransfer=false,', ` const simSnapshotHashes:string[]=[],viewportProbes:object[]=[];
 const factHash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const rawComposite=()=>{const c=document.createElement('canvas');c.width=1280;c.height=900;const b=c.getContext('2d')!;for(const layer of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!layer.parentElement?.hidden)b.drawImage(layer,0,0,1280,900);b.drawImage(canvas,0,0);return c.toDataURL('image/png');};
 let bodyTransfer=false,`);
replace('  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;', '  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;simSnapshotHashes.push(await factHash(frame.snapshot));');
replace('  await waitForArtGpuCompletion(gl);', `  await waitForArtGpuCompletion(gl);
  if(i===1){
   const originalView=frame.view,originalPng=rawComposite(),trackerDrops=combat.frame(frame.now).droplets.length;
   const layer=(presentation as unknown as {layer:{combatStats:()=>unknown}}).layer;
   const battlefieldInk=layer.combatStats();
   frame.view={...originalView,x:24000,y:24000};presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);
   const emptyInk=layer.combatStats(),emptyPng=rawComposite(),emptyTrackerDrops=combat.frame(frame.now).droplets.length;
   frame.view=originalView;presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);
   viewportProbes.push({frame:i,tick:game.tick,now:frame.now,trackerDrops,emptyTrackerDrops,battlefieldInk,emptyInk,returnedInk:layer.combatStats(),originalPng,emptyPng,returnedPng:rawComposite(),simHashBefore:simSnapshotHashes.at(-1),simHashAfter:await factHash(snapshotGame(game)),scope:'Same simulation tick, snapshot and clock. Probe performs two extra presentation draws and zero simulation steps. Starts while the first real lethal-hit drops are airborne.'});
  }`);
replace(' return{frames,fps:10,', ' return{frames,fps:10,simSnapshotHashes,viewportProbes,');
const token = `.art-viewport-battle-${process.pid}`, fixturePath = resolve(root, 'scripts', `${token}-fixture.ts`), runnerPath = resolve(root, 'scripts', `${token}-runner.mjs`);
const meta = { sourceRoot, sourceCommit, sourceTrees, upstreamFixtureSha256: hash(upstreamFixture), generatedFixtureSha256: hash(fixture), normalizedFixtureSha256: hash(fixture.replaceAll(`/@fs${sourceRoot}/src/`, '/@fs__SOURCE_ROOT__/src/')), scope: 'Original production guard/blood simulation proof plus per-frame simulated facts hashes and one same-clock camera probe. No battle rules, commands, tick order, original capture schedule or artwork replaced.' };
await writeFile(resolve(dirname(output), 'fixture.ts'), fixture);
let runner = await readFile(resolve(root, 'scripts/combat-effects-proof.mjs'), 'utf8');
runner = runner.replace('fs:{allow:[root,scratch]}', `fs:{allow:[root,scratch,${JSON.stringify(sourceRoot)}]}`);
runner = runner.replace(' const proof=result.result.value;', ` const proof=result.result.value;
 const viewportProbeImages=[];
 for(let index=0;index<(proof.viewportProbes?.length??0);index++){
  const probe=proof.viewportProbes[index],imageEvidence={};
  for(const name of ['originalPng','emptyPng','returnedPng']){const bytes=Buffer.from(probe[name].split(',')[1],'base64'),path=output.replace(/\\.json$/,\`-probe-\${index}-\${name}.png\`);await writeFile(path,bytes);imageEvidence[name]={path,sha256:createHash('sha256').update(bytes).digest('hex')};delete probe[name];}
  probe.images=imageEvidence;probe.returnPngIdentical=imageEvidence.originalPng.sha256===imageEvidence.returnedPng.sha256;probe.simulationUnchanged=probe.simHashBefore===probe.simHashAfter;viewportProbeImages.push(imageEvidence);
 }
 proof.viewportProbeImages=viewportProbeImages;`);
// Preserve all 80 PNGs, so a mismatching hash can be investigated pixel by pixel.
runner = runner.replace("resolve(scratch,`frame-${String(i).padStart(3,'0')}.png`)", "resolve(dirname(output),`frame-${String(i).padStart(3,'0')}.png`)");
runner = runner.replace("resolve(scratch,'frame-%03d.png')", "resolve(dirname(output),'frame-%03d.png')");
runner = runner.replace(' const evidence={...proof,errors,', ` const evidence={...proof,viewportSource:${JSON.stringify(meta)},errors,`);
// Print a compact diagnostic; the complete proof remains in the JSON artifact.
runner = runner.replace('console.log(JSON.stringify(evidence));', 'console.log(JSON.stringify({output,passed:evidence.passed,source:evidence.viewportSource.sourceCommit,frameCount:evidence.framePngSha256.length,simulatedFrames:evidence.simSnapshotHashes.length,probe:evidence.viewportProbes}));');
await writeFile(resolve(dirname(output), 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)));
try {
  await writeFile(fixturePath, fixture); await writeFile(runnerPath, runner);
  const child = spawn(process.execPath, ['--import', 'tsx', runnerPath, '--fixture', `scripts/${token}-fixture.ts`, '--out', output, '--timeout-ms', '300000'], { cwd: root, stdio: 'inherit' });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  if (code !== 0) process.exitCode = code ?? 1;
} finally { await unlink(fixturePath).catch(() => {}); await unlink(runnerPath).catch(() => {}); }
