/** node --import tsx scripts/painted-card-gpu-proof.mjs [--out path.json] */
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const output=resolve(arg('--out')??'work/painted-card-gpu-proof.json');await mkdir(dirname(output),{recursive:true});const scratch=await mkdtemp('/tmp/card-gpu-proof-');
let server,browser,socket;const errors=[];
try{
 await writeFile(resolve(scratch,'index.html'),`<script type="module" src="/@fs${root}/scripts/painted-card-gpu-fixture.ts"></script>`);
 server=await createServer({configFile:false,root:scratch,server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root,scratch]}}});await server.listen();
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});let serial=0;const pending=new Map();
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timeout);message.error?request.reject(message.error):request.done(message.result);}}if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(arg=>arg.value??arg.description).join(' '));if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),90000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});await command('Runtime.enable',{},sessionId);await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/?${arg('--query')??''}`},sessionId);
 const result=await command('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const deadline=performance.now()+30000;function check(){if(window.cardGpuProof)return window.cardGpuProof().then(resolve,reject);if(performance.now()>deadline)return reject(new Error('Fixture timeout'));setTimeout(check,20)}check()})`,awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
 const proof=result.result.value;await writeFile(output.replace(/\.json$/,'.png'),Buffer.from(proof.image.split(',')[1],'base64'));delete proof.image;
 const passed=errors.length===0&&proof.glError===0&&proof.programs.every(program=>program.runnable)&&proof.report.every(item=>item.maxChannelDifference<=1&&item.referenceVisiblePixels>Math.max(16,1000*proof.settings.zoom**2)&&item.candidateVisiblePixels>Math.max(16,1000*proof.settings.zoom**2));const evidence={...proof,errors,passed,browser:await command('Browser.getVersion')};await writeFile(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));if(!passed)process.exitCode=1;
}finally{socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
