/** Independent test-only one-bank gradient attribution. Never edits source. */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=resolve(arg('--source')??harnessRoot),output=resolve(arg('--out')??'docs/art/refactor/followup/card-streaming/bank-order/grad-diagnostic/raw.json');
const fixture=resolve(harnessRoot,'scripts/card-grad-diagnostic-fixture.js'),scratch=await mkdtemp('/tmp/card-grad-diagnostic-'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['src/client/world3d/card-bank-shader.ts','src/client/world3d/painted-card-batches.ts','src/client/world3d/card-mip-uploader.ts','src/client/art/painted-units.ts','src/client/art/painted-creatures.ts'];
const metadata={sourceRoot,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),sourceSha256:Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))]))),harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),fixtureSha256:hash(await readFile(fixture))};
const errors=[],failures=[],cycles=[];let server,browser,socket;
try{
 await mkdir(dirname(output),{recursive:true});await writeFile(resolve(scratch,'index.html'),`<meta charset="UTF-8"><title>One-bank implicit vs explicit gradients</title><script type="module" src="/@fs${fixture}"></script>`);
 server=await createServer({configFile:false,root:scratch,define:{__CARD_GRAD_SOURCE_ROOT__:JSON.stringify(sourceRoot)},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[harnessRoot,sourceRoot,scratch]}}});await server.listen();
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});let serial=0;const pending=new Map();
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timeout);message.error?item.reject(new Error(JSON.stringify(message.error))):item.done(message.result);return;}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(x=>x.value??x.description).join(' '));if(message.method==='Network.loadingFailed')failures.push(message.params.errorText);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`));},600000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});await command('Runtime.enable',{},sessionId);await command('Network.enable',{},sessionId);
 await command('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}`},sessionId);
 const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+30000;const check=()=>{if(window.cardGradDiagnostic?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error("Fixture timeout"));setTimeout(check,20)};check()})');
 const options={baseMip:Number(arg('--base-mip')??1),frames:Number(arg('--frames')??12),warmup:Number(arg('--warmup')??6)},arms=['implicit','grad','grad','implicit'];
 for(const [index,arm] of arms.entries()){
  console.log(`CARD-GRAD start ${index} ${arm}`);const cycle=await evaluate(`window.cardGradDiagnostic.cycle(${JSON.stringify(arm)},${index},${JSON.stringify(options)})`);cycles.push(cycle);
  await writeFile(output,JSON.stringify({...metadata,options,order:arms,cycles,errors,failures,completed:false},null,2)+'\n');if(!cycle.passed)throw new Error(`Invalid diagnostic cycle ${index}`);
  console.log(JSON.stringify({index,arm,completeWall:cycle.completeWall,submission:cycle.submission,completionWait:cycle.completionWait,passed:cycle.passed}));
 }
 const afterHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))]))),sourceUnchanged=JSON.stringify(afterHashes)===JSON.stringify(metadata.sourceSha256);
 const result={...metadata,options,order:arms,cycles,errors,failures,sourceUnchanged,browser:await command('Browser.getVersion'),completed:true,passed:sourceUnchanged&&errors.length===0&&failures.length===0&&cycles.every(c=>c.passed),scope:'Independent sampler microdiagnostic, not the frozen formal game benchmark or FPS. ABBA across four independently disposed/recreated WebGLRenderer lifetimes. Strict raw color/depth/distance RGBA comparison is completed before sampling; compilation/setup/readback/hash/disposal excluded from timing. No source/helper/formal harness is modified.'};
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,passed:result.passed,sourceUnchanged}));if(!result.passed)process.exitCode=1;
}catch(error){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({...metadata,cycles,errors,failures,completed:false,passed:false,failure:String(error)},null,2)+'\n');throw error;}
finally{socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
