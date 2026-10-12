/** Reuse the real Chromium/Vite harness; change only the fixture and reporting. */
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
let runner=await readFile(resolve(here,'painted-card-gpu-proof.mjs'),'utf8');
const imageWrite="await writeFile(output.replace(/\\.json$/,'.png'),Buffer.from(proof.image.split(',')[1],'base64'));delete proof.image;";
const criterion="errors.length===0&&proof.glError===0&&proof.report.every(item=>item.maxChannelDifference<=1)";
if(!runner.includes(imageWrite)||!runner.includes(criterion))throw new Error('Proof harness changed; review raster profile integration');
runner=runner.replaceAll('painted-card-gpu-fixture.ts','art-raster-profile.ts').replaceAll('window.cardGpuProof','window.rasterProfile')
 .replaceAll('work/painted-card-gpu-proof.json','work/art-raster-profile.json').replace(criterion,'errors.length===0');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(here,'..'),encoding:'utf8'}).trim();
runner=runner.replace('const evidence={...proof,errors,passed,','const evidence={...proof,errors,passed,sourceCommit:'+JSON.stringify(sourceCommit)+',');
const sourceDirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:resolve(here,'..'),encoding:'utf8'}).trim().length>0;
runner=runner.replace('sourceCommit:'+JSON.stringify(sourceCommit)+',','sourceCommit:'+JSON.stringify(sourceCommit)+',sourceDirty:'+JSON.stringify(sourceDirty)+',');
const temporary=resolve(here,`.raster-profile-${process.pid}.mjs`);
try {
 await writeFile(temporary,runner);
 const child=spawn(process.execPath,['--import','tsx',temporary,...process.argv.slice(2)],{stdio:'inherit',cwd:resolve(here,'..')});
 process.exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',code=>done(code??1));});
}finally{await unlink(temporary).catch(()=>{});}
