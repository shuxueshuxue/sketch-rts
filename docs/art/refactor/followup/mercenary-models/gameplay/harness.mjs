/** Source-pinned real mercenary hiring/production-renderer integration evidence. */
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
import {resourceManifest} from '../tools/resource-manifest.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const source=resolve(arg('--source')??root),out=resolve(arg('--out')??'docs/art/refactor/followup/mercenary-models/gameplay/proof.json'),folder=dirname(out);
await mkdir(folder,{recursive:true});const scratch=await mkdtemp('/tmp/art-mercenary-gameplay-');
const sha=value=>createHash('sha256').update(value).digest('hex');
const files=execFileSync('rg',['--files','src/client'],{cwd:source,encoding:'utf8'}).trim().split('\n').sort();
const metadata={sourceRoot:source,head:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),
  clientSha256:Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await readFile(resolve(source,file)))]))),
  rulesTrees:Object.fromEntries(['src/shared','src/ai','src/server'].map(path=>[path,execFileSync('git',['rev-parse',`HEAD:${path}`],{cwd:source,encoding:'utf8'}).trim()])),
  rulesDiffSha256:sha(execFileSync('git',['diff','HEAD','--','src/shared','src/ai','src/server'],{cwd:source})),
  clientDiffSha256:sha(execFileSync('git',['diff','HEAD','--','src/client'],{cwd:source})),harnessSha256:sha(await readFile(fileURLToPath(import.meta.url)))};
const original=await readFile(resolve(root,'scripts/art-mercenary-gameplay-fixture.ts'),'utf8');
const fixture=original.replaceAll("from '../src/",`from '/@fs${source}/src/`).replace("from './art-gpu-completion.mjs'",`from '/@fs${root}/scripts/art-gpu-completion.mjs'`).replace(/from '(\/\@fs[^']+\/src\/[^']+)'/g,(_,path)=>`from '${path}.ts'`);
metadata.fixtureSha256=sha(original);await writeFile(resolve(folder,'fixture.ts'),fixture);await writeFile(resolve(scratch,'fixture.ts'),fixture);
let server,browser,socket;const errors=[];
try{
 await writeFile(resolve(scratch,'index.html'),'<script type="module" src="/fixture.ts"></script>');
 server=await createServer({configFile:false,root:scratch,publicDir:resolve(source,'public'),plugins:[{name:'merc-proof-manifest',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url?.split('?')[0]?.endsWith('/resource-manifest.json'))return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await resourceManifest(resolve(source,'public'))));});}}],server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root,source,scratch]}}});await server.listen();
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});let serial=0;const pending=new Map();
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timeout);message.error?request.reject(message.error):request.done(message.result);}}if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.value??a.description).join(' '));if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),300000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});await command('Runtime.enable',{},sessionId);
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}`},sessionId);
 const result=await command('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const deadline=performance.now()+30000;function check(){if(window.combatEffectsProof)return window.combatEffectsProof().then(resolve,reject);if(performance.now()>deadline)return reject(new Error('Fixture timeout'));setTimeout(check,20)}check()})`,awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
 const proof=result.result.value;
 proof.framePngSha256=[];for(let i=0;i<proof.frames.length;i++){const bytes=Buffer.from(proof.frames[i].split(',')[1],'base64'),name=`frame-${String(i).padStart(3,'0')}.png`;await writeFile(resolve(folder,name),bytes);proof.framePngSha256.push(sha(bytes));}
 for(const portrait of proof.portraits)for(const field of ['png','ordinaryPng','bodyPng']){const bytes=Buffer.from(portrait[field].split(',')[1],'base64'),name=`${portrait.kind}-${field}.png`;await writeFile(resolve(folder,name),bytes);portrait[field]={file:name,sha256:sha(bytes)};}
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(proof.fps),'-i',resolve(folder,'frame-%03d.png'),'-c:v','libx264','-pix_fmt','yuv420p',resolve(folder,'gameplay.mp4')]);
 delete proof.frames;const evidence={...proof,source:metadata,errors,browser:await command('Browser.getVersion'),passed:proof.passed&&errors.length===0};
 await writeFile(out,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({out,passed:evidence.passed,sales:evidence.sales,seen:evidence.seen,attacks:evidence.attacks,healSeen:evidence.healSeen,actualDeaths:evidence.actualDeaths.length,picks:evidence.picks,drawMutations:evidence.drawMutations.length,glError:evidence.glError,errors}));if(!evidence.passed)process.exitCode=1;
}finally{socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
