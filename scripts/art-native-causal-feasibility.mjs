/** Read-only stock Chromium capability probe. No game, WebGL or trace workload. */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import WebSocket from 'ws';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const out=resolve(arg('--out')??'work/art-native-causal-feasibility/stock-browser-v1');await mkdir(dirname(out),{recursive:true});await mkdir(out,{recursive:false});
const tmp=await mkdtemp('/tmp/sketch-native-capability-');
const args=['--headless','--remote-debugging-port=0','--no-first-run','--no-default-browser-check',`--user-data-dir=${tmp}`,'about:blank'];
const result={version:1,scope:'Capability inspection only, private new about:blank browser. No game/simulation/WebGL upload, trace recording, sampling, process-memory read, installation or permission change.',browser:'/usr/bin/chromium',args,temporaryProfile:tmp,browserStarted:false,protocolAvailable:false,completed:false,sandboxDisablingFlags:false,errors:[],fullNativeCausalChainAvailable:false,fullNativeCausalReproductionAttempted:false};
let browser,socket,stderr='',stdout='',browserExit,finished=false;
const save=()=>writeFile(resolve(out,'proof.json'),JSON.stringify(result,null,2)+'\n');
const executed=await readFile(new URL(import.meta.url));await writeFile(resolve(out,'executed-capability.mjs'),executed);result.executedScriptSha256=createHash('sha256').update(executed).digest('hex');await save();
try{
 browser=spawn(result.browser,args,{stdio:['ignore','pipe','pipe']});
 browser.stdout.on('data',b=>{stdout+=String(b);});browser.stderr.on('data',b=>{stderr+=String(b);});browser.on('exit',(code,signal)=>{browserExit={code,signal};});
 const endpoint=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Ordinary sandboxed startup timed out after 20s')),20000);browser.once('error',e=>{clearTimeout(timer);reject(e);});browser.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error('Ordinary sandboxed startup exited '+code+'/'+signal));});browser.stderr.on('data',b=>{const match=String(b).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);done(match[1]);}});});
 result.browserStarted=true;result.devToolsEndpoint=endpoint;
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
 let serial=0;const pending=new Map();socket.on('message',bytes=>{const m=JSON.parse(String(bytes));if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.done(m.result);});
 const command=(method,params={})=>new Promise((done,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP capability timeout '+method));},10000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 result.browserVersion=await command('Browser.getVersion');result.categories=await command('Tracing.getCategories');result.processInfo=await command('SystemInfo.getProcessInfo');
 const port=new URL(endpoint).port,response=await fetch('http://127.0.0.1:'+port+'/json/protocol');if(!response.ok)throw new Error('Protocol HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer());await writeFile(resolve(out,'actual-cdp-protocol.json'),bytes);result.protocol={httpStatus:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const schema=JSON.parse(bytes),trace=schema.domains.find(d=>d.domain==='Tracing');result.tracingProtocol={commands:trace?.commands,types:trace?.types};result.nativeSamplingCategoryCandidates=result.categories.categories.filter(c=>/cpu_profiler|stack|sample|memory-infra|gpu|command_buffer/i.test(c));
 result.protocolAvailable=true;result.noTraceAttemptReason='The installed browser has no matching native debug/type symbols or native debugger, and the reviewed stock trace sites do not log the allocation identity chain. Listing sampling categories is not evidence of native caller/locals or causal mapping.';
 result.completed=true;finished=true;await command('Browser.close').catch(()=>{});
}catch(e){result.capabilityFailure=String(e);result.capabilityFailureStack=e.stack;result.completed=true;finished=true;}
finally{
 socket?.close();if(browser&&!browserExit&&browser.exitCode===null&&browser.signalCode===null){let timer;const closed=new Promise(done=>{browser.once('exit',done);timer=setTimeout(done,3000);});browser.kill();await closed;clearTimeout(timer);}
 result.browserExit=browserExit??{code:browser?.exitCode??null,signal:browser?.signalCode??null};result.stdoutFile='browser-stdout.log';result.stderrFile='browser-stderr.log';await writeFile(resolve(out,'browser-stdout.log'),stdout);await writeFile(resolve(out,'browser-stderr.log'),stderr);result.browserTeardownComplete=true;await rm(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:100});result.temporaryProfileRemoved=true;await save();
}
console.log(JSON.stringify({completed:result.completed,browserStarted:result.browserStarted,protocolAvailable:result.protocolAvailable,sandboxDisablingFlags:false,capabilityFailure:result.capabilityFailure??null,causalReproductionAttempted:false,output:out}));
