/** Strict native GPU color/alpha/depth/distance bank batching proof. */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=resolve(arg('--source')??harnessRoot);
const output=resolve(arg('--out')??'work/card-bank-gpu-proof.json'),fixture=resolve(harnessRoot,'scripts/card-bank-gpu-fixture.js');
const scratch=await mkdtemp('/tmp/card-bank-gpu-proof-'),hash=value=>createHash('sha256').update(value).digest('hex');
const sourceFiles=['src/client/world3d/card-bank-shader.ts','src/client/world3d/painted-card-batches.ts','src/client/world3d/card-mip-uploader.ts'];
const metadata={sourceRoot,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),
 sourceDirty:execFileSync('git',['status','--porcelain'],{cwd:sourceRoot,encoding:'utf8'}),
 sourceSha256:Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,hash(await readFile(resolve(sourceRoot,f)))]))),
 harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),fixtureSha256:hash(await readFile(fixture))};
const errors=[],failures=[];let server,browser,socket;
try{
 await mkdir(dirname(output),{recursive:true});await writeFile(resolve(scratch,'index.html'),`<meta charset="UTF-8"><title>Ordered native array banks</title><script type="module" src="/@fs${fixture}"></script>`);
 server=await createServer({configFile:false,root:scratch,define:{__CARD_STREAMING_SOURCE_ROOT__:JSON.stringify(sourceRoot)},server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[harnessRoot,sourceRoot,scratch]}}});await server.listen();
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',c=>{const m=String(c).match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timeout);done(m[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});let serial=0;const pending=new Map();
 socket.on('message',data=>{const m=JSON.parse(String(data));if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timeout);m.error?p.reject(new Error(JSON.stringify(m.error))):p.done(m.result);return;}
  if(m.method==='Runtime.consoleAPICalled'){const values=m.params.args.map(a=>a.value??a.description);if(m.params.type==='error')errors.push(values.join(' '));else if(values[0]?.startsWith?.('CARD-BANK '))console.log(values.join(' '));}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);if(m.method==='Network.loadingFailed')failures.push(m.params.errorText);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`));},600000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});await command('Runtime.enable',{},sessionId);await command('Network.enable',{},sessionId);
 await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/?banks=${arg('--banks')??'1,2,8,9,16'}&modes=${arg('--modes')??'opaque,opacity,rgba'}&cases=${arg('--cases')??9}&start=${arg('--start-case')??0}`},sessionId);
 const result=await command('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const deadline=performance.now()+30000;function check(){if(window.cardBankProof)return window.cardBankProof().then(resolve,reject);if(performance.now()>deadline)return reject(new Error('Fixture timeout'));setTimeout(check,20)}check()})`,awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
 const proof=result.result.value;for(const {name,image} of proof.screenshots)await writeFile(resolve(dirname(output),`${name}.png`),Buffer.from(image.split(',')[1],'base64'));proof.screenshots=proof.screenshots.map(({name})=>({path:`${name}.png`}));
 const evidence={...metadata,...proof,errors,failures,browser:await command('Browser.getVersion'),passed:proof.passed&&errors.length===0&&failures.length===0};await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({output,passed:evidence.passed,rows:evidence.rows.length,mismatches:evidence.rows.filter(r=>!r.passed).map(r=>({config:r.config.name,banks:r.requestedBankCount,mode:r.mode,ordered:r.ordered,passes:r.reports.map(p=>({pass:p.pass,color:p.color,shadow:p.shadow}))})),errors,failures}));if(!evidence.passed)process.exitCode=1;
}catch(error){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({...metadata,errors,failures,passed:false,failure:String(error)},null,2)+'\n');throw error;}
finally{socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
