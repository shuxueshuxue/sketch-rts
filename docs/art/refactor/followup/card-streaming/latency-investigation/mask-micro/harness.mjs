// Independent diagnostic only. Start only in a coordinator-granted quiet window.
// Reads already captured full RGBA; never draws assets or imports game modules.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import WebSocket from 'ws';

const arg=key=>{const index=process.argv.indexOf(key);return index<0?undefined:process.argv[index+1];};
const here=dirname(fileURLToPath(import.meta.url)),corpusPath=resolve(arg('--corpus')??'docs/art/refactor/followup/card-streaming/latency-investigation/canvas-attribution/corpus-manifest.json');
const output=resolve(arg('--out')??'work/art-card-mask-browser-micro/result.json'),outputDir=dirname(output);
const prototypePath=resolve(arg('--prototype')??'/tmp/card-mask-prototype/pack-mask-prototype.mjs');
const expectedBrowser=arg('--expected-browser')??'Chrome/151.0.7922.173';
const options={rounds:Number(arg('--rounds')??8),repeats:Number(arg('--repeats')??3),denseCutoff:Number(arg('--dense-cutoff')??.5),ringSlots:32};
const engine=arg('--engine')??'both';if(!['both','browser','node'].includes(engine))throw Error('Use --engine both|browser|node');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{await access(output);throw Error('Refusing to overwrite preserved diagnostic '+output);}catch(error){if(error.code!=='ENOENT')throw error;}
if(!Number.isInteger(options.rounds)||options.rounds<8||options.rounds%8!==0||!Number.isInteger(options.repeats)||options.repeats<1||!Number.isFinite(options.denseCutoff)||options.denseCutoff<0||options.denseCutoff>1)throw Error('Invalid micro options: rounds must be a positive multiple of eight');
const corpusBytes=await readFile(corpusPath),manifest=JSON.parse(corpusBytes.toString('utf8'));
if(!Array.isArray(manifest.images)||!manifest.images.length)throw Error('No original RGBA samples in manifest');
const images=[];
for(const row of manifest.images){
 if(![512,704].includes(row.width)||row.height!==row.width||row.sourceSize!==row.width||!/^[a-f0-9]{64}$/.test(row.sha256??'')||typeof row.file!=='string'||row.rowOrientation!=='top-down'||row.maskFlipYForCanvasMiss!==true)throw Error('Expected captured original 512/704 RGBA with orientation and SHA');
 const bytes=await readFile(resolve(dirname(corpusPath),row.file));
 if(bytes.byteLength!==row.width*row.height*4||sha(bytes)!==row.sha256)throw Error('Original RGBA bytes/SHA mismatch '+row.file);
 images.push({...row,name:row.name??row.file,bytes});
}
const sourceFiles={
 '/harness.mjs':await readFile(fileURLToPath(import.meta.url)),
 '/fixture.mjs':await readFile(resolve(here,'art-card-mask-browser-fixture.mjs')),
 '/matrix.mjs':await readFile(resolve(here,'art-card-mask-micro-shared.mjs')),
 '/prototype.mjs':await readFile(prototypePath),
};
const servedSha256=Object.fromEntries(Object.entries(sourceFiles).map(([path,bytes])=>[path,sha(bytes)]));
const config={options,corpusSha256:sha(corpusBytes),servedSha256,images:images.map(({bytes,...row})=>row)};
const sourceRoot=resolve(arg('--source')??resolve(here,'..'));
const maskSource=await readFile(resolve(sourceRoot,'src/client/world3d/card-pick-mask.ts'));
if(manifest.allClientSourceSha256?.['src/client/world3d/card-pick-mask.ts']!==sha(maskSource))throw Error('Reference mask source differs from original captured corpus; use its frozen source root');
await mkdir(outputDir,{recursive:true});
for(const [path,bytes] of Object.entries(sourceFiles))await writeFile(resolve(outputDir,path.slice(1)),bytes,{flag:'wx'});
await writeFile(resolve(outputDir,'corpus-manifest.json'),corpusBytes,{flag:'wx'});
await writeFile(resolve(outputDir,'source-card-pick-mask.ts'),maskSource,{flag:'wx'});
let server,browser,socket,scratch,nextCommandId=0;const pending=new Map();
const errors=[],networkFailures=[],result={
 method:'Same immutable captured Chromium RGBA; independent mask CPU diagnostic, no Canvas drawing, renderer, GPU completion, or game frame timing.',
 engine,corpusPath,sourceRoot,options,corpusSha256:config.corpusSha256,corpusSourceCommit:manifest.sourceCommit,servedSha256,sourceMaskSha256:sha(maskSource),
 retainedSourceRGBABytes:images.reduce((sum,image)=>sum+image.bytes.byteLength,0),
 assetSha256:images.map(({bytes,...row})=>row),
 limitations:['Equal weight per saved asset/sample is not runtime miss-frequency weighting.','Both engines use the same shared protocol and source bytes; compare variants within an engine, not absolute Node/browser speed.','First timed round follows semantic verification and is not renderer/JIT cold startup.','Mask allocation capacity and observed heaps are separate; no forced GC and no tail samples discarded.','No production change or frame-time improvement is implied by this diagnostic.'],
 errors,networkFailures,completed:false,
};
function rejectPending(error){for(const item of pending.values()){clearTimeout(item.timeout);item.reject(error);}pending.clear();}
async function closeBrowser(){
 rejectPending(Error('Mask micro browser closed'));
 if(socket){socket.close();socket=undefined;}
 if(browser?.pid&&browser.exitCode===null&&browser.signalCode===null){
  const process=browser;
  await new Promise((done,reject)=>{
   let finalTimeout;
   const exited=()=>{clearTimeout(timeout);clearTimeout(finalTimeout);done();};
   const timeout=setTimeout(()=>{process.kill('SIGKILL');finalTimeout=setTimeout(()=>{process.removeListener('exit',exited);reject(Error('Chromium shutdown unconfirmed; Node timing refused'));},5000);},5000);
   process.once('exit',exited);process.kill();
  });
 }
 if(browser?.pid&&browser.exitCode===null&&browser.signalCode===null)throw Error('Chromium is still running; refusing to continue');
 if(browser)result.browserExit={exitCode:browser.exitCode,signalCode:browser.signalCode,processStarted:Boolean(browser.pid),confirmed:!browser.pid||browser.exitCode!==null||browser.signalCode!==null};
 browser=undefined;
 if(server){await new Promise(done=>server.close(done));server=undefined;}
 if(scratch){await rm(scratch,{recursive:true,force:true});scratch=undefined;}
}
try{
 if(engine!=='node'){
  scratch=await mkdtemp('/tmp/sketch-mask-micro-');
  const routes=new Map([...Object.entries(sourceFiles),['/corpus-manifest.json',corpusBytes],['/config.json',Buffer.from(JSON.stringify(config))],['/',Buffer.from('<meta charset="UTF-8"><title>Original RGBA mask CPU micro</title><p>No Canvas or WebGL.</p><script type="module" src="/fixture.mjs"></script>')]]);
  images.forEach((image,index)=>routes.set(`/rgba/${index}.bin`,image.bytes));
  server=createServer((request,response)=>{const path=request.url?.split('?')[0];if(path==='/favicon.ico'){response.writeHead(204);response.end();return;}
   const bytes=routes.get(path);if(!bytes){response.writeHead(404);response.end('Not found');return;}
   response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type',path==='/'?'text/html; charset=utf-8':path.endsWith('.mjs')?'text/javascript; charset=utf-8':path.endsWith('.json')?'application/json':'application/octet-stream');response.end(bytes);
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  browser=spawn(arg('--chromium')??process.env.CHROMIUM_PATH??'/usr/bin/chromium',[
   '--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--disable-webgl','--disable-background-timer-throttling','--disable-renderer-backgrounding',
   '--remote-debugging-port=0',`--user-data-dir=${resolve(scratch,'chromium')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Chromium startup timeout')),30000);browser.once('error',error=>{clearTimeout(timeout);reject(error);});browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
  socket=new WebSocket(endpoint);socket.on('error',error=>rejectPending(error));socket.on('close',()=>rejectPending(Error('Mask micro CDP socket closed')));
  await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
  socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timeout);message.error?item.reject(Error(JSON.stringify(message.error))):item.done(message.result);return;}
   if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
   if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(arg=>arg.value??arg.description).join(' '));
   if(message.method==='Network.loadingFailed')networkFailures.push(message.params.errorText);
  });
  const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++nextCommandId,timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},600000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  result.browserVersion=await command('Browser.getVersion');
  if(result.browserVersion.product!==expectedBrowser)throw Error(`Browser identity differs: ${result.browserVersion.product} != ${expectedBrowser}`);
  const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>command(method,params,sessionId);
  await page('Page.enable');await page('Runtime.enable');await page('Network.enable');
  await page('Page.addScriptToEvaluateOnNewDocument',{source:"window.__maskForbiddenContexts=[];const forbid=function(type){window.__maskForbiddenContexts.push(String(type));throw Error('Canvas/WebGL forbidden in mask CPU micro');};HTMLCanvasElement.prototype.getContext=forbid;if(window.OffscreenCanvas)OffscreenCanvas.prototype.getContext=forbid;"});
  const evaluate=async expression=>{const data=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(data.exceptionDetails)throw Error(data.exceptionDetails.exception?.description??data.exceptionDetails.text);return data.result.value;};
  await page('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  await evaluate('new Promise((done,reject)=>{const limit=performance.now()+60000;const check=()=>{if(window.cardMaskMicro?.ready)return done(true);if(performance.now()>limit)return reject(Error("mask fixture init timeout"));setTimeout(check,20);};check();})');
  result.browserHeapBefore=await page('Runtime.getHeapUsage');
  result.browser=await evaluate('window.cardMaskMicro.run()');
  result.browserHeapAfter=await page('Runtime.getHeapUsage');
  if(errors.length||networkFailures.length)throw Error('Browser emitted errors');
  // Node timing begins only after browser/server/process teardown completes.
  await closeBrowser();
 }
 if(engine!=='browser'){
  // Execute the immutable snapshots served to Chromium, not mutable originals.
  const prototype=await import(pathToFileURL(resolve(outputDir,'prototype.mjs')).href);
  const {runMaskMatrix}=await import(pathToFileURL(resolve(outputDir,'matrix.mjs')).href);
  const inputs=images.map(({bytes,...row})=>{const rgba=new Uint8ClampedArray(bytes.byteLength);rgba.set(bytes);return{...row,rgba};});
  result.nodeVersion={node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch};
  result.nodeMemoryBefore=process.memoryUsage();result.node=await runMaskMatrix(prototype,inputs,options);result.nodeMemoryAfter=process.memoryUsage();
  for(const image of inputs)if(sha(image.rgba)!==image.sha256)throw Error('Node source RGBA mutated '+image.name);
 }
 if(result.browser&&result.node){
  if(result.browser.groups.length!==result.node.groups.length||result.browser.retainedFullRGBABytes!==result.node.retainedFullRGBABytes)throw Error('Engine corpus/group mismatch');
  for(let i=0;i<result.browser.groups.length;i++){const left=result.browser.groups[i],right=result.node.groups[i];if(left.name!==right.name||JSON.stringify(left.imageIndices)!==JSON.stringify(right.imageIndices)||JSON.stringify(left.schedule)!==JSON.stringify(right.schedule)||left.allocatedOutputBytesPerSample!==right.allocatedOutputBytesPerSample)throw Error('Engine schedule mismatch '+left.name);}
 }
 result.completed=true;result.validation={passed:true,browserNoContextsRequested:result.browser?result.browser.forbiddenContexts.length===0:null,semanticPass:[result.browser?.semantics.passed,result.node?.semantics.passed].filter(x=>x!==undefined)};
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output,completed:true,images:images.length,browser:result.browser?.groups[0].ratioToReference,node:result.node?.groups[0].ratioToReference}));
}catch(error){result.failure=String(error);await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});throw error;}
finally{await closeBrowser();}
