/** node --import tsx scripts/card-context-proof.mjs [--out path.json] */
import {spawn,execFileSync} from 'node:child_process';
import {resourceManifest} from '../tools/resource-manifest.ts';
import {mkdir,mkdtemp,rm,writeFile,appendFile,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const output=resolve(arg('--out')??'docs/art/refactor/followup/browser-stability/run.json');await mkdir(dirname(output),{recursive:true});const scratch=await mkdtemp('/tmp/art-stability-');
let server,browser,socket;const errors=[];
try{
 await writeFile(resolve(scratch,'index.html'),`<script type="module" src="/@fs${root}/scripts/art-stability-fixture.ts"></script>`);
 server=await createServer({configFile:false,root:scratch,publicDir:resolve(root,'public'),plugins:[{name:'proof-manifest',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url?.split('?')[0]?.endsWith('/resource-manifest.json'))return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await resourceManifest(resolve(root,'public'))));});}}],server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root,scratch]}}});await server.listen();
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});let serial=0;const pending=new Map();
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timeout);message.error?request.reject(message.error):request.done(message.result);}}if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(arg=>arg.value??arg.description).join(' '));if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),90000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});await command('Runtime.enable',{},sessionId);await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}`},sessionId);
 const seconds=Number(arg('--seconds')??1800),began=Date.now();
 const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 await evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+60000;function poll(){if(window.artStability)return resolve(true);if(Date.now()>end)return reject(Error('Fixture timeout'));setTimeout(poll,100)}poll()})`);
 const browserVersion=await command('Browser.getVersion');
 await command('Performance.enable',{},sessionId);
 await evaluate(`void window.artStability.run(${seconds})`);
 function processes(){
  const rows=execFileSync('ps',['-eo','pid=,ppid=,rss=,args='],{encoding:'utf8'}).trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);return m?{pid:+m[1],ppid:+m[2],rssKiB:+m[3],kind:m[4].match(/--type=([^ ]+)/)?.[1]??'browser'}:null;}).filter(Boolean);
  const ids=new Set([browser.pid]);let changed=true;while(changed){changed=false;for(const r of rows)if(ids.has(r.ppid)&&!ids.has(r.pid)){ids.add(r.pid);changed=true;}}
  return rows.filter(r=>ids.has(r.pid));
 }
 const log=output.replace(/\.json$/,'.samples.jsonl');let count=0,last;
 await writeFile(log,'');
 while(true){
  const at=Date.now(),state=await evaluate('window.artStability.state()'),proc=processes();
  for(const p of proc){try{const smaps=await readFile(`/proc/${p.pid}/smaps_rollup`,'utf8');p.pssKiB=Number(smaps.match(/^Pss:\s+(\d+)/m)?.[1]);p.privateKiB=[...smaps.matchAll(/^Private_(?:Clean|Dirty):\s+(\d+)/gm)].reduce((n,m)=>n+Number(m[1]),0);}catch{p.pssKiB=null;}}
  const perf=await command('Performance.getMetrics',{},sessionId);
  last={sample:count++,utc:new Date().toISOString(),wallMs:Date.now()-began,samplingWallMs:Date.now()-at,state,processes:proc,rssKiB:proc.reduce((n,p)=>n+p.rssKiB,0),pssKiB:proc.every(p=>p.pssKiB!==null)?proc.reduce((n,p)=>n+p.pssKiB,0):null,metrics:Object.fromEntries(perf.metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','JSEventListeners'].includes(m.name)).map(m=>[m.name,m.value]))};
  await appendFile(log,JSON.stringify(last)+'\n');
  if(count%6===0)console.log(JSON.stringify({sample:count,seconds:Math.round(last.wallMs/1000),rssMiB:last.rssKiB/1024,pssMiB:last.pssKiB/1024,frames:state.frames,stage:state.stage,cards:state.cards?.cards,rasterizations:state.cards?.rasterizations}));
  if(state.stopped&&!state.running)break;
  if(Date.now()-began>(seconds+180)*1000)throw Error('Workload exceeded wall time guard');
  await new Promise(resolve=>setTimeout(resolve,Math.max(1000,10000-(Date.now()-at))));
 }
 const evidence={browser:browserVersion,requestedSeconds:seconds,actualWallMs:Date.now()-began,samples:count,errors,last,passed:errors.length===0&&!last.state.failure&&last.state.stage==='complete',method:'One browser, no forced GC/restarts; production simulation and WorldPresentation. External /proc RSS/PSS and small CDP samples every 10 seconds, streamed to disk. First 10min no renderer reset; next 10min prepare resets; final 10min new presentation lifetime. Real equipment commands, finite troop cohorts, repeated native combat. RSS sum includes shared mappings; PSS reported where permitted. Not hardware GPU memory or whole-app idle test.'};
 await writeFile(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({passed:evidence.passed,samples:count,actualWallMs:evidence.actualWallMs,failure:last.state.failure,errors}));if(!evidence.passed)process.exitCode=1;

}finally{socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
