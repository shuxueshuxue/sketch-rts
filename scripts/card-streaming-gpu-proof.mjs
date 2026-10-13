/** Real WebGL2 proof, never a mock. Run serially with other browser benchmarks.
 * node --import tsx scripts/card-streaming-gpu-proof.mjs --source ROOT --out proof.json
 * Add --require-skip for an optimized uploader that must avoid identical uploads.
 * Add --require-tail for the production source-domain/tail options contract.
 */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';

const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourceRoot=resolve(arg('--source')??harnessRoot);
const output=resolve(arg('--out')??'work/card-streaming-gpu-proof.json');
const fixture=resolve(harnessRoot,'scripts/card-streaming-gpu-fixture.js');
const scratch=await mkdtemp('/tmp/card-streaming-gpu-proof-');
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceFiles=['src/client/world3d/card-mip-uploader.ts','src/client/world3d/painted-card-batches.ts'];
const metadata={sourceRoot,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),
 sourceDirty:execFileSync('git',['status','--porcelain'],{cwd:sourceRoot,encoding:'utf8'}),
 sourceSha256:Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))]))),
 harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),fixtureSha256:hash(await readFile(fixture))};
const errors=[],failures=[];let server,browser,socket;
try{
 await mkdir(dirname(output),{recursive:true});
 await writeFile(resolve(scratch,'index.html'),`<meta charset="UTF-8"><title>Full-domain card transfer proof</title><script type="module" src="/@fs${fixture}"></script>`);
 server=await createServer({configFile:false,root:scratch,
  define:{__CARD_STREAMING_SOURCE_ROOT__:JSON.stringify(sourceRoot)},
  server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[harnessRoot,sourceRoot,scratch]}}});
 await server.listen();
 browser=spawn(arg('--chromium')??process.env.CHROMIUM_PATH??'/usr/bin/chromium',
  ['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
   '--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);
  browser.once('error',reject);browser.stderr.on('data',chunk=>{
   const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
   if(match){clearTimeout(timeout);done(match[1]);}
  });
 });
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
 let serial=0;const pending=new Map();
 socket.on('message',data=>{
  const message=JSON.parse(String(data));
  if(message.id){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timeout);
   message.error?request.reject(new Error(JSON.stringify(message.error))):request.done(message.result);return;}
  if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(arg=>arg.value??arg.description).join(' '));
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
  if(message.method==='Network.loadingFailed')failures.push(message.params.errorText);
 });
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{
  const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`));},240000);
  pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
 });
 const {targetId}=await command('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 await command('Runtime.enable',{},sessionId);await command('Network.enable',{},sessionId);
 const requireTail=process.argv.includes('--require-tail');
 await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/?sizes=${arg('--sizes')??'256,320,512,640,704'}&requireTail=${requireTail?'1':'0'}`},sessionId);
 const result=await command('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const deadline=performance.now()+30000;function check(){if(window.cardStreamingProof)return window.cardStreamingProof().then(resolve,reject);if(performance.now()>deadline)return reject(new Error('Fixture timeout'));setTimeout(check,20)}check()})`,awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
 const proof=result.result.value;
 const requireSkip=process.argv.includes('--require-skip');
 const evidence={...metadata,...proof,errors,failures,requireSkip,requireTail,
  browser:await command('Browser.getVersion'),passed:proof.passed&&errors.length===0&&failures.length===0&&(!requireSkip||proof.identicalScratchUploadSkipped)&&(!requireTail||proof.tailPassed)};
 await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({output,passed:evidence.passed,cases:evidence.cases.map(c=>({size:c.size,passed:c.passed,identicalScratchUploadSkipped:c.identicalScratchUploadSkipped})),tails:evidence.tailCases?.map(c=>({size:c.size,baseMip:c.baseMip,passed:c.passed})),context:{lost:evidence.context.lost,restored:evidence.context.restored,size:evidence.context.rebuilt.size,passed:evidence.context.passed},errors,failures}));
 if(!evidence.passed)process.exitCode=1;
}catch(error){
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({...metadata,errors,failures,passed:false,failure:String(error)},null,2)+'\n');throw error;
}finally{
 socket?.close();
 if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}
 await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
