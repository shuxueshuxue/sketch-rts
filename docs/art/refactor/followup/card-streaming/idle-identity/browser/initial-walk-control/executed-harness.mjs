/** node scripts/art-idle-browser-identity-proof.mjs [--source ROOT] [--out PATH] */
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile,appendFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=resolve(arg('--source')??harnessRoot);
const output=resolve(arg('--out')??'docs/art/refactor/followup/card-streaming/idle-identity/browser/proof.json'),outputDir=dirname(output);
const fixturePath=resolve(harnessRoot,'scripts/art-idle-browser-identity-fixture.js');
const tracePath=resolve(harnessRoot,'docs/art/refactor/followup/card-streaming/idle-identity/extra-states.json');
const traceStates=JSON.parse(await readFile(tracePath,'utf8')),hash=value=>createHash('sha256').update(value).digest('hex');
const sourceFiles=execFileSync('rg',['--files','src/client/art'],{cwd:sourceRoot,encoding:'utf8'}).trim().split('\n').filter(file=>file.endsWith('.ts')&&!file.endsWith('.test.ts')).sort();
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))])));
const metadata={sourceRoot,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),
  sourcePainterSha256:await hashes(),harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),fixtureSha256:hash(await readFile(fixturePath)),traceStatesSha256:hash(await readFile(tracePath))};
await mkdir(outputDir,{recursive:true});
await writeFile(resolve(outputDir,'executed-fixture.js'),await readFile(fixturePath));
await writeFile(resolve(outputDir,'executed-harness.mjs'),await readFile(fileURLToPath(import.meta.url)));
const log=resolve(outputDir,basename(output,'.json')+'.log');await writeFile(log,'');
const scratch=await mkdtemp('/tmp/idle-browser-identity-');
const cgroup='/sys/fs/cgroup';
const memoryEvents=()=>Object.fromEntries(readFileSync(`${cgroup}/memory.events`,'utf8').trim().split('\n').map(line=>{const [key,value]=line.split(' ');return[key,Number(value)];}));
const memory={samplePeriodMs:100,samples:0,initialCgroupMemoryBytes:Number(readFileSync(`${cgroup}/memory.current`,'utf8')),peakSampledCgroupMemoryBytes:0,memoryLimitBytes:Number(readFileSync(`${cgroup}/memory.max`,'utf8')),eventsBefore:memoryEvents(),scope:'Entire test-run cgroup including baseline processes; not isolated process RSS, game memory, a GPU metric or a performance benchmark.'};
memory.peakSampledCgroupMemoryBytes=memory.initialCgroupMemoryBytes;
const sampler=setInterval(()=>{memory.samples++;memory.peakSampledCgroupMemoryBytes=Math.max(memory.peakSampledCgroupMemoryBytes,Number(readFileSync(`${cgroup}/memory.current`,'utf8')));},memory.samplePeriodMs);
const errors=[],loadingFailures=[],loadedModules=new Set();let server,browser,socket,evidence,failure;
const startedAt=new Date().toISOString();
try{
  await writeFile(resolve(scratch,'index.html'),`<meta charset="UTF-8"><title>Exact stock idle Canvas identity</title><script type="module" src="/@fs${fixturePath}"></script>`);
  server=await createServer({configFile:false,root:scratch,define:{__IDLE_IDENTITY_SOURCE_ROOT__:JSON.stringify(sourceRoot)},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[scratch,harnessRoot,sourceRoot]}}});await server.listen();
  const chromium=arg('--chromium')??process.env.CHROMIUM_PATH??'/usr/bin/chromium';
  const browserArgs=['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--disable-background-timer-throttling','--disable-renderer-backgrounding','--remote-debugging-port=0',`--user-data-dir=${resolve(scratch,'profile')}`,'about:blank'];
  browser=spawn(chromium,browserArgs,{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
  socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
  let serial=0;const pending=new Map();
  socket.on('message',data=>{
    const message=JSON.parse(String(data));
    if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timeout);message.error?request.reject(new Error(JSON.stringify(message.error))):request.done(message.result);}return;}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
    if(message.method==='Network.loadingFailed')loadingFailures.push(message.params.errorText);
    if(message.method==='Network.requestWillBeSent')loadedModules.add(message.params.request.url);
    if(message.method==='Runtime.consoleAPICalled'){
      const text=message.params.args.map(arg=>arg.value??arg.description).join(' ');
      if(message.params.type==='error')errors.push(text);
      if(text.startsWith('IDLE_IDENTITY ')){console.log(text);appendFile(log,text+'\n').catch(error=>errors.push(String(error)));}
    }
  });
  const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`));},900000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params={})=>command(method,params,sessionId);
  await page('Runtime.enable');await page('Network.enable');
  await page('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}`});
  const result=await page('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const deadline=performance.now()+30000;function check(){if(window.idleBrowserIdentityProof)return window.idleBrowserIdentityProof(${JSON.stringify(traceStates)}).then(resolve,reject);if(performance.now()>deadline)return reject(new Error('Fixture init timeout'));setTimeout(check,20)}check()})`,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
  const proof=result.result.value;
  evidence={...metadata,startedAt,...proof,browser:await command('Browser.getVersion'),browserLaunch:{executable:chromium,args:browserArgs.filter(arg=>!arg.startsWith('--user-data-dir'))},errors,loadingFailures,loadedModules:[...loadedModules].sort()};
  if(evidence.loadedModules.some(url=>url.includes('/src/client/world3d/')||url.includes('/src/client/world-layer')))errors.push('Renderer/cache module loaded into independent Canvas proof.');
}catch(error){failure=String(error);evidence={...metadata,startedAt,completed:false,passed:false,errors,loadingFailures,failure};}
finally{
  socket?.close();
  if(browser&&browser.exitCode===null){const closed=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await closed;}
  await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  clearInterval(sampler);memory.eventsAfter=memoryEvents();memory.finalCgroupMemoryBytes=Number(readFileSync(`${cgroup}/memory.current`,'utf8'));
}
evidence.completedAt=new Date().toISOString();evidence.testRunCgroupMemory=memory;
evidence.sourcePainterSha256After=await hashes();evidence.sourcePaintersUnchanged=JSON.stringify(evidence.sourcePainterSha256)===JSON.stringify(evidence.sourcePainterSha256After);
evidence.passed=!!evidence.passed&&errors.length===0&&loadingFailures.length===0&&evidence.sourcePaintersUnchanged&&memory.eventsBefore.oom_kill===memory.eventsAfter.oom_kill;
await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({output,completed:evidence.completed,passed:evidence.passed,totals:evidence.totals,memory,errors,loadingFailures,failure}));
if(!evidence.passed)process.exitCode=1;
