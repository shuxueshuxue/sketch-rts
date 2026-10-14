/** New exclusive exact-input diagnostic. Existing executed evidence is untouched. */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
import {resourceManifest} from '../tools/resource-manifest.ts';
import {createQueueSourceFreeze} from './art-card-upload-replay-source-freeze.mjs';
import {createRuntimeScriptCollector} from './art-card-upload-replay-runtime-scripts.mjs';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=resolve(arg('--source')??'/tmp/sketch-queue-source-42bd');
const outputDir=resolve(arg('--out')??'docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/run-v1');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim();
if(sourceCommit!=='42bd61c74934dc76f30d42b62e1e31eb5c5974ff')throw new Error('Exact replay source must be frozen42bd');
await mkdir(dirname(outputDir),{recursive:true});await mkdir(outputDir);
const scratch=await mkdtemp('/tmp/sketch-exact-upload-'),fixtureName='art-card-upload-replay-entry.js';
const variant={name:'original-oneNative',maxBanks:1,mips:'native'};
const sourceFreeze=await createQueueSourceFreeze({sourceRoot,harnessRoot,scratch,outputDir,entryFixture:fixtureName});
const helperNames=['art-card-upload-replay-proof.mjs','art-card-upload-replay-source-freeze.mjs','art-card-upload-replay-runtime-scripts.mjs','art-card-upload-replay-observer.mjs','art-card-upload-replay-fixture.js','art-card-upload-replay-entry.js'];
const helperBytes=new Map(await Promise.all(helperNames.map(async name=>[name,await readFile(resolve(harnessRoot,'scripts',name))])));
const result={version:1,sourceRoot,harnessRoot,sourceCommit,formalTiming:false,productionOverrides:[],expectedUploads:53,sourceInventory:sourceFreeze.metadata,toolSha256:Object.fromEntries([...helperBytes].map(([name,bytes])=>[name,hash(bytes)])),completed:false,errors:[],arms:[],exports:[],scope:'One non-performance exact actual-input capture, untimed per-event validation, then isolated frame-end/each-layer upload replay. Native oracle/readback/history drain perturb queue. Timer query brackets include arrival/idle; no pure-GPU/hardware-general performance claim.'};
let server,browser,socket,collector,sessionId,sourceFinished=false,collectorFinished=false,exportObject;
const save=async()=>writeFile(resolve(outputDir,'proof.json'),JSON.stringify(result,null,2)+'\n');
try{
 await sourceFreeze.archive();await save();
 for(const [name,bytes]of helperBytes)await writeFile(resolve(outputDir,name),bytes);
 const optimizeDeps=await sourceFreeze.prepare();
 const html=`<meta charset="UTF-8"><title>Exact native card upload replay</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`;
 await writeFile(resolve(scratch,'index.html'),html);await writeFile(resolve(outputDir,'entry.html'),html);result.entryHtmlSha256=hash(html);
 server=await createServer({configFile:false,root:scratch,cacheDir:resolve(scratch,'.vite-cache'),optimizeDeps,publicDir:resolve(sourceRoot,'public'),define:{__BENCHMARK_SOURCE_ROOT__:JSON.stringify(sourceRoot),__CARD_BANK_VARIANT__:JSON.stringify(variant)},plugins:[sourceFreeze.plugin,{name:'exact-replay-resource-manifest',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(!req.url?.split('?')[0]?.endsWith('/resource-manifest.json'))return next();try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot,'public'))));}catch(error){next(error);}});}}],server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[scratch,harnessRoot,sourceRoot]}}});
 await server.listen();await sourceFreeze.startup(server);await save();
 browser=spawn(arg('--chromium')??process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${resolve(scratch,'chromium')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Browser startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
 let serial=0;const pending=new Map();
 const rejectPending=error=>{for(const item of pending.values()){clearTimeout(item.timeout);item.reject(error);}pending.clear();};
 socket.on('error',error=>{result.errors.push(String(error));rejectPending(error);});socket.on('close',(code,reason)=>rejectPending(new Error('CDP socket closed '+code+' '+String(reason))));
 socket.on('message',bytes=>{const message=JSON.parse(String(bytes));if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timeout);message.error?item.reject(new Error(JSON.stringify(message.error))):item.done(message.result);return;}if(message.sessionId===sessionId)collector?.onEvent(message);if(message.method==='Runtime.exceptionThrown')result.errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);if(message.method==='Network.loadingFailed'&&!message.params.canceled)result.errors.push('Network: '+message.params.errorText);});
 const command=(method,params={},session)=>new Promise((done,reject)=>{if(socket.readyState!==WebSocket.OPEN)return reject(new Error('CDP not open'));const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},120000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'});({sessionId}=await command('Target.attachToTarget',{targetId,flatten:true}));
 const page=(method,params)=>command(method,params,sessionId);
 await page('Page.enable');await page('Runtime.enable');await page('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 collector=createRuntimeScriptCollector({page,outputDir,sourceRoot,harnessRoot,hash});await collector.start();
 const evaluate=async expression=>{const reply=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(reply.exceptionDetails)throw new Error(reply.exceptionDetails.exception?.description??reply.exceptionDetails.text);return reply.result.value;};
 result.browserVersion=await command('Browser.getVersion');await page('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}`});
 await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+60000;const check=()=>{if(window.cardUploadReplay?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error("Exact fixture startup timeout"));setTimeout(check,20)};check()})');
 exportObject=async(expression,label)=>{
  const header=await evaluate(`(async()=>{const value=await (${expression});const text=JSON.stringify(value);window.__exactUploadExport=text;const bytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',bytes);return{characters:text.length,bytes:bytes.length,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};})()`);
  const chunks=[];for(let at=0;at<header.characters;at+=1048576)chunks.push(await evaluate(`window.__exactUploadExport.slice(${at},${at+1048576})`));
  const text=chunks.join(''),bytes=Buffer.from(text);if(text.length!==header.characters||bytes.length!==header.bytes||hash(bytes)!==header.sha256)throw new Error('Complete bounded export checksum differs');
  const file=label+'.json';await writeFile(resolve(outputDir,file),bytes);await evaluate('delete window.__exactUploadExport');result.exports.push({...header,file,sliceCharacters:1048576,chunks:chunks.length});await save();return JSON.parse(text);
 };
 console.log('START actual n135 exact capture');
 const corpus=await exportObject('(window.__exactCorpus=await window.cardUploadReplay.capture())','capture');
 if(corpus.events.filter(e=>e.kind==='upload').length!==53)throw new Error('Captured upload count mismatch');
 const imageManifest=[];await mkdir(resolve(outputDir,'rgba'));
 for(const [index,event]of corpus.events.entries())if(event.kind==='upload'){
  const bytes=Buffer.from(event.rgba.base64,'base64'),file=`rgba/event-${index}.bin`;if(bytes.length!==event.rgba.bytes||hash(bytes)!==event.rgba.sha256)throw new Error('Captured RGBA checksum differs');await writeFile(resolve(outputDir,file),bytes);imageManifest.push({index,file,bytes:bytes.length,sha256:hash(bytes),uploader:event.uploader,page:event.page,layer:event.layer,...event.options});
 }
 const prior=[];for(const [name,uploader]of Object.entries(corpus.before.uploaders))for(const [index,scratchState]of uploader.scratches.entries()){
  const bytes=Buffer.from(scratchState.rgba.base64,'base64'),file=`rgba/prior-${name}-${index}.bin`;if(bytes.length!==scratchState.rgba.bytes||hash(bytes)!==scratchState.rgba.sha256)throw new Error('Captured prior RGBA checksum differs');await writeFile(resolve(outputDir,file),bytes);prior.push({uploader:name,key:scratchState.key,file,bytes:bytes.length,sha256:hash(bytes)});
 }
 const png=Buffer.from(corpus.screenshot.split(',')[1],'base64');await writeFile(resolve(outputDir,'n135-untimed.png'),png);
 result.capture={artifact:'capture.json',uploads:imageManifest.length,eventKinds:Object.fromEntries([...new Set(corpus.events.map(e=>e.kind))].map(k=>[k,corpus.events.filter(e=>e.kind===k).length])),rgbaBytes:imageManifest.reduce((sum,e)=>sum+e.bytes,0),priorRgbaBytes:prior.reduce((sum,e)=>sum+e.bytes,0),screenshot:{file:'n135-untimed.png',sha256:hash(png),scope:corpus.screenshotScope},prefix:corpus.prefix,transferDeltas:corpus.transferDeltas};
 await writeFile(resolve(outputDir,'rgba-manifest.json'),JSON.stringify({version:1,sourceCommit,images:imageManifest,prior},null,2)+'\n');await save();console.log('CAPTURE '+JSON.stringify(result.capture));
 for(const policy of ['validate','frame-end','each-layer']){
  console.log('START replay '+policy);await page('HeapProfiler.collectGarbage');
  const arm=await exportObject(`window.cardUploadReplay.replay(${JSON.stringify(policy)},window.__exactCorpus)`,'replay-'+policy);result.arms.push(arm);await save();console.log('DONE '+policy+' '+JSON.stringify({submissionMs:arm.submissionMs,waitMs:arm.waitMs,envelopeMs:arm.envelopeMs,validation:arm.validation}));
 }
 await evaluate('window.cardUploadReplay.teardown()');await sourceFreeze.finish(server);sourceFinished=true;result.runtimeScripts=await collector.finish(sourceFreeze.metadata);collectorFinished=true;
 for(const [name,bytes]of helperBytes)if(!bytes.equals(await readFile(resolve(harnessRoot,'scripts',name))))result.errors.push('Diagnostic helper changed: '+name);
 result.validation={passed:!result.errors.length&&result.arms.length===3&&result.arms.every(arm=>arm.validation.passed),actual53Payloads:true,fullPriorAndFinalNativeStateExact:true,perEventNativeOracleExact:true,runtimeHttpModulesCovered:result.runtimeScripts.passed};result.completed=true;await save();if(!result.validation.passed)throw new Error('Exact replay diagnostics failed');
 console.log('EXACT REPLAY PASS '+outputDir);
}catch(error){if(exportObject)try{await exportObject('({state:window.__exactReplayFailure??null,native:window.__exactNativeFailure??null})','exact-failure-state');}catch(exportError){result.errors.push('Failure-state export: '+String(exportError));}result.failure=String(error);result.failureStack=error.stack;await save();throw error;}
finally{
 if(server&&!sourceFinished)try{await sourceFreeze.finish(server);sourceFinished=true;}catch(error){result.errors.push('Source finish: '+String(error));}
 if(collector&&!collectorFinished)try{result.runtimeScripts=await collector.finish(sourceFreeze.metadata);collectorFinished=true;}catch(error){result.runtimeScripts=error.runtimeScriptMetadata??null;result.errors.push('Runtime script finish: '+String(error));}
 socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}
 await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:4,retryDelay:100});result.browserTeardownComplete=true;await save();
}
