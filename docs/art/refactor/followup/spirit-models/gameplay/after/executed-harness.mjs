/** Source-frozen real spirit integration; never overwrite an evidence run.
 * node --import tsx scripts/art-spirit-gameplay-proof.mjs --source ROOT --out NEW/proof.json
 */
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile,symlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
import {resourceManifest} from '../tools/resource-manifest.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),arg=key=>{const i=process.argv.indexOf(key);if(i<0)return undefined;if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw new Error('Missing argument '+key);return process.argv[i+1];};
const source=resolve(arg('--source')??root),out=resolve(arg('--out')??'docs/art/refactor/followup/spirit-models/gameplay/current/proof.json'),folder=dirname(out);
await mkdir(dirname(folder),{recursive:true});await mkdir(folder);
const scratch=await mkdtemp('/tmp/art-spirit-gameplay-'),sha=value=>createHash('sha256').update(value).digest('hex');
const sourceFiles=()=>execFileSync('rg',['--files','src'],{cwd:source,encoding:'utf8'}).trim().split('\n').sort();
const files=sourceFiles(),inputs=new Map(await Promise.all(files.map(async file=>[file,await readFile(resolve(source,file))])));
const manifest=Object.fromEntries([...inputs].map(([file,bytes])=>[file,sha(bytes)]));
const gitHead=()=>execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
const rulesDiff=()=>sha(execFileSync('git',['diff','HEAD','--','src/shared','src/ai','src/server'],{cwd:source}));
const metadata={sourceRoot:source,head:gitHead(),sourceSha256:manifest,
 rulesTrees:Object.fromEntries(['src/shared','src/ai','src/server'].map(path=>[path,execFileSync('git',['rev-parse',`HEAD:${path}`],{cwd:source,encoding:'utf8'}).trim()])),rulesDiffSha256:rulesDiff(),
 clientDiffSha256:sha(execFileSync('git',['diff','HEAD','--','src/client'],{cwd:source})),harnessSha256:sha(await readFile(fileURLToPath(import.meta.url))),startedAt:new Date().toISOString(),
 scope:'Untimed original simulation, production WebGL and Canvas world, real selection and UI/remains routes. Full source byte/SHA snapshots and rule-tree guards; no performance claim.'};
const original=await readFile(resolve(root,'scripts/art-spirit-gameplay-fixture.ts'),'utf8');
const fixture=original.replaceAll("from '../src/",`from '/@fs${source}/src/`).replace("from './art-gpu-completion.mjs'",`from '/@fs${root}/scripts/art-gpu-completion.mjs'`).replace(/from '(\/\@fs[^']+\/src\/[^']+)'/g,(_,path)=>`from '${path}.ts'`);
metadata.fixtureSha256=sha(original);metadata.executedFixtureSha256=sha(fixture);metadata.gpuCompletionSha256=sha(await readFile(resolve(root,'scripts/art-gpu-completion.mjs')));
await writeFile(resolve(folder,'executed-harness.mjs'),await readFile(fileURLToPath(import.meta.url)));await writeFile(resolve(folder,'original-fixture.ts'),original);await writeFile(resolve(folder,'fixture.ts'),fixture);await writeFile(resolve(scratch,'fixture.ts'),fixture);
execFileSync('tar',['-czf',resolve(folder,'source.tar.gz'),'-C',source,'src']);metadata.sourceArchive={file:'source.tar.gz',sha256:sha(await readFile(resolve(folder,'source.tar.gz')))};
await writeFile(resolve(folder,'inputs.json'),JSON.stringify(metadata,null,2)+'\n');
let server,browser,socket,evidence,failure;const errors=[],loadingFailures=[],loadedUrls=new Set();
const pending=new Map();let serial=0;
try{
 await symlink(resolve(source,'node_modules'),resolve(scratch,'node_modules'),'dir');
 await writeFile(resolve(scratch,'index.html'),'<script type="module" src="/fixture.ts"></script>');
 server=await createServer({configFile:false,root:scratch,publicDir:resolve(source,'public'),cacheDir:resolve(scratch,'.vite-cache'),optimizeDeps:{include:['three','three/addons/loaders/GLTFLoader.js'],noDiscovery:true},plugins:[{name:'spirit-proof-manifest',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url?.split('?')[0]?.endsWith('/resource-manifest.json'))return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await resourceManifest(resolve(source,'public'))));});}}],server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root,source,scratch]}}});await server.listen();
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timeout);message.error?request.reject(message.error):request.done(message.result);}}if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.value??a.description).join(' '));if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);if(message.method==='Network.responseReceived')loadedUrls.add(message.params.response.url);if(message.method==='Network.loadingFailed')loadingFailures.push(message.params);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),300000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});await command('Runtime.enable',{},sessionId);await command('Network.enable',{},sessionId);
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}`},sessionId);
 const result=await command('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const deadline=performance.now()+30000;function check(){if(window.spiritGameplayProof)return window.spiritGameplayProof().then(resolve,reject);if(performance.now()>deadline)return reject(new Error('Fixture timeout'));setTimeout(check,20)}check()})`,awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
 const proof=result.result.value;proof.framePngSha256=[];
 for(let i=0;i<proof.frames.length;i++){const bytes=Buffer.from(proof.frames[i].split(',')[1],'base64'),name=`frame-${String(i).padStart(3,'0')}.png`;await writeFile(resolve(folder,name),bytes);proof.framePngSha256.push(sha(bytes));}
 for(const item of proof.canvasFrames){const bytes=Buffer.from(item.png.split(',')[1],'base64'),name=`canvas-${String(item.capture).padStart(3,'0')}.png`;await writeFile(resolve(folder,name),bytes);item.png={file:name,sha256:sha(bytes)};}
 for(const portrait of proof.portraits)for(const field of ['png','bodyPng']){const bytes=Buffer.from(portrait[field].split(',')[1],'base64'),name=`${portrait.kind}-${field}.png`;await writeFile(resolve(folder,name),bytes);portrait[field]={file:name,sha256:sha(bytes)};}
 execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(proof.fps),'-i',resolve(folder,'frame-%03d.png'),'-c:v','libx264','-pix_fmt','yuv420p',resolve(folder,'gameplay.mp4')]);
 proof.video={file:'gameplay.mp4',sha256:sha(await readFile(resolve(folder,'gameplay.mp4')))};
 delete proof.frames;await writeFile(resolve(folder,'snapshots.json'),JSON.stringify(proof.snapshots,null,2)+'\n');proof.snapshots={file:'snapshots.json',sha256:sha(await readFile(resolve(folder,'snapshots.json'))),count:proof.snapshots.length};
 const endFiles=sourceFiles(),endManifest=Object.fromEntries(await Promise.all(endFiles.map(async file=>[file,sha(await readFile(resolve(source,file)))])));
 metadata.sourceEndSha256=endManifest;metadata.unchangedSource=JSON.stringify(manifest)===JSON.stringify(endManifest);metadata.unchangedHead=gitHead()===metadata.head;metadata.unchangedRulesDiff=rulesDiff()===metadata.rulesDiffSha256;
 const threeUrls=[...loadedUrls].filter(url=>/three(?:_addons|\.js|_addons_loaders)/.test(url));const threeVersions=[...new Set(threeUrls.map(url=>new URL(url).searchParams.get('v')).filter(Boolean))];
 evidence={...proof,source:metadata,errors,loadingFailures,loadedUrls:[...loadedUrls],threeUrls,threeVersions,browser:await command('Browser.getVersion'),passed:proof.passed&&errors.length===0&&loadingFailures.length===0&&metadata.unchangedSource&&metadata.unchangedHead&&metadata.unchangedRulesDiff&&threeVersions.length===1};
 await writeFile(out,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({out,passed:evidence.passed,summons:proof.summons.length,seen:proof.seen,picks:proof.picks.length,pickFailures:proof.picks.filter(p=>!p.matched),deaths:proof.actualDeaths.length,glError:proof.glError,unchangedSource:metadata.unchangedSource,threeVersions,errors,loadingFailures}));if(!evidence.passed)process.exitCode=1;
}catch(error){failure={name:error.name,message:error.message,stack:error.stack};await writeFile(resolve(folder,'failure.json'),JSON.stringify({failure,source:metadata,errors,loadingFailures,loadedUrls:[...loadedUrls]},null,2)+'\n');throw error;}
finally{for(const request of pending.values())clearTimeout(request.timeout);socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
