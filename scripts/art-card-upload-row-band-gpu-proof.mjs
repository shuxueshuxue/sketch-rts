/** Real WebGL2 proof, never a mock. Run serially with other browser benchmarks.
 * node --import tsx scripts/art-card-upload-row-band-gpu-proof.mjs --source ROOT --out proof.json
 * Add --require-skip for an optimized uploader that must avoid identical uploads.
 * Add --require-tail for the production source-domain/tail options contract.
 */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,normalizePath} from 'vite';
import WebSocket from 'ws';

const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourceRoot=resolve(arg('--source')??'/tmp/sketch-stall-baseline-8345');
const output=resolve(arg('--out')??'work/card-upload-row-band-native/proof.json');
const fixture=resolve(harnessRoot,'scripts/art-card-upload-row-band-gpu-fixture.js');
const scratch=await mkdtemp('/tmp/card-upload-row-band-native-');
const hash=value=>createHash('sha256').update(value).digest('hex');
const policy=arg('--upload-policy')??'original';
if(!['original','candidate'].includes(policy))throw new Error('Use --upload-policy original|candidate');
const originalPath=resolve(arg('--original-source')??'/tmp/card-upload-row-band-original.ts');
const candidatePath=resolve(arg('--candidate-source')??'/tmp/card-upload-row-band-candidate.ts');
const regionPath=resolve(arg('--region-source')??'/tmp/card-upload-row-band-region.ts');
const preparationPath=resolve(arg('--metadata')??'/tmp/card-upload-row-band-source.json');
const currentUploaderPath=resolve(sourceRoot,'src/client/world3d/card-mip-uploader.ts');
const currentRegionPath=resolve(sourceRoot,'src/client/world3d/card-upload-region.ts');
const expectedCommit='8345a0dcfeb96b6777ac3940ec64cba13816c851';
const expected={original:'3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295',candidate:'7523e7c847c159be4d06f08e9b177da75dfa9ea9989c8d6a10d77099c4080e18',region:'25d852a8b6424c81648e93b68db98de1076cee90659d3f2b01cc5b07878c8439'};
const frozenPaths={original:originalPath,candidate:candidatePath,region:regionPath,metadata:preparationPath,driver:fileURLToPath(import.meta.url),fixture};
const frozenBytes=Object.fromEntries(await Promise.all(Object.entries(frozenPaths).map(async([key,path])=>[key,await readFile(path)])));
const before=Object.fromEntries(Object.entries(frozenBytes).map(([key,bytes])=>[key,hash(bytes)]));
const prep=JSON.parse(frozenBytes.metadata);
for(const key of ['original','candidate','region'])if(before[key]!==expected[key])throw new Error('Frozen provider changed: '+key);
if(prep.sourceCommit!==expectedCommit||prep.sourceSha256!==before.original||prep.candidateSha256!==before.candidate||prep.regionSha256!==before.region)throw new Error('Preparation provider identities differ');
if(prep.candidateExactWarmSetupReplacement!==true||frozenBytes.original.toString().split(prep.oldWarmSetup).length!==2||frozenBytes.original.toString().replace(prep.oldWarmSetup,prep.newWarmSetup)!==frozenBytes.candidate.toString())throw new Error('Candidate differs outside warm setup');
if(hash(await readFile(currentUploaderPath))!==before.original||hash(await readFile(currentRegionPath))!==before.region)throw new Error('Frozen source provider/helper mismatch');
if(execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim()!==expectedCommit||execFileSync('git',['diff','HEAD','--','src'],{cwd:sourceRoot}).length||execFileSync('git',['ls-files','--others','--exclude-standard','--','src'],{cwd:sourceRoot}).length)throw new Error('Native proof requires clean frozen 8345 source');
const providerSet=new Set([normalizePath(originalPath),normalizePath(candidatePath)]),resolutionRecords=[],loadRecords=[];
const clean=id=>normalizePath(id.split('?')[0].replace(/^\/@fs(?=\/)/,''));
const resolver={name:'row-band-native-frozen-providers',enforce:'pre',async resolveId(request,importer){
 if(!importer)return null;const from=clean(importer);
 if(providerSet.has(from)&&request==='./card-upload-region'){resolutionRecords.push({request,importer,resolvedId:currentRegionPath,sha256:before.region});return currentRegionPath;}
 if((providerSet.has(from)||from===normalizePath(fixture))&&request==='three'){
  const result=await this.resolve('three',currentUploaderPath,{skipSelf:true});if(!result)throw new Error('Cannot resolve frozen source Three');
  resolutionRecords.push({request,importer,resolvedId:result.id});return result;
 }return null;
},load(id){const path=clean(id);let key;if(path===normalizePath(originalPath))key='original';else if(path===normalizePath(candidatePath))key='candidate';else if(path===normalizePath(currentRegionPath))key='region';else if(path===normalizePath(fixture))key='fixture';
 if(!key)return null;loadRecords.push({path,kind:key,sha256:before[key],servedFromRunStartSnapshot:true});return frozenBytes[key].toString('utf8');}};
await mkdir(dirname(dirname(output)),{recursive:true});await mkdir(dirname(output));
await mkdir(resolve(dirname(output),'source-snapshot'));
for(const [key,bytes]of Object.entries(frozenBytes))await writeFile(resolve(dirname(output),'source-snapshot',key+({driver:'.mjs',fixture:'.js',metadata:'.json'}[key]??'.ts')),bytes);
const sourceFiles=['src/client/world3d/card-mip-uploader.ts','src/client/world3d/painted-card-batches.ts'];
const metadata={uploadPolicy:policy,frozenPaths,inputSha256:before,preparedMetadata:prep,sourceRoot,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),
 sourceDirty:execFileSync('git',['status','--porcelain'],{cwd:sourceRoot,encoding:'utf8'}),
 sourceSha256:Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))]))),
 harnessSha256:hash(await readFile(fileURLToPath(import.meta.url))),fixtureSha256:hash(await readFile(fixture))};
const errors=[],failures=[];let server,browser,socket;
try{
 await mkdir(dirname(output),{recursive:true});
 await symlink(resolve(sourceRoot,'node_modules'),resolve(scratch,'node_modules'),'dir');
 await writeFile(resolve(scratch,'index.html'),`<meta charset="UTF-8"><title>Full-domain card transfer proof</title><script type="module" src="/@fs${fixture}"></script>`);
 server=await createServer({configFile:false,root:scratch,cacheDir:resolve(scratch,'.vite-cache'),plugins:[resolver],optimizeDeps:{include:['three','three/addons/loaders/GLTFLoader.js'],noDiscovery:true},
  define:{__CARD_STREAMING_SOURCE_ROOT__:JSON.stringify(sourceRoot),__CARD_UPLOAD_ORIGINAL_SOURCE__:JSON.stringify(originalPath),__CARD_UPLOAD_CANDIDATE_SOURCE__:JSON.stringify(candidatePath),__CARD_UPLOAD_POLICY__:JSON.stringify(policy)},
  server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[harnessRoot,sourceRoot,scratch,dirname(originalPath),dirname(candidatePath),dirname(regionPath)]}}});
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
 const after=Object.fromEntries(await Promise.all(Object.entries(frozenPaths).map(async([key,path])=>[key,hash(await readFile(path))])));
 const inputsUnchanged=Object.keys(before).every(key=>before[key]===after[key]);
 const threeIds=[...new Set(resolutionRecords.filter(r=>r.request==='three').map(r=>r.resolvedId))];
 const allThreeImports=resolutionRecords.filter(r=>r.request==='three');
 const threeIdentity=threeIds.length===1&&[originalPath,candidatePath,fixture].every(path=>allThreeImports.some(r=>clean(r.importer)===normalizePath(path)));
 const sourceAfter=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))])));
 const sourceUnchanged=Object.keys(sourceAfter).every(file=>sourceAfter[file]===metadata.sourceSha256[file])&&execFileSync('git',['diff','HEAD','--','src'],{cwd:sourceRoot}).length===0;
 const evidence={...metadata,...proof,resolutionRecords,loadRecords,inputSha256After:after,inputsUnchanged,threeIdentity,threeIds,sourceSha256After:sourceAfter,sourceUnchanged,errors,failures,requireSkip,requireTail,
  browser:await command('Browser.getVersion'),passed:inputsUnchanged&&sourceUnchanged&&threeIdentity&&proof.passed&&errors.length===0&&failures.length===0&&(!requireSkip||proof.identicalScratchUploadSkipped)&&(!requireTail||proof.tailPassed)};
 await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({output,passed:evidence.passed,cases:evidence.cases.map(c=>({size:c.size,passed:c.passed,identicalScratchUploadSkipped:c.identicalScratchUploadSkipped})),tails:evidence.tailCases?.map(c=>({size:c.size,baseMip:c.baseMip,passed:c.passed})),context:{lost:evidence.context.lost,restored:evidence.context.restored,size:evidence.context.rebuilt.size,passed:evidence.context.passed},errors,failures}));
 if(!evidence.passed)process.exitCode=1;
}catch(error){
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({...metadata,resolutionRecords,loadRecords,errors,failures,passed:false,failure:String(error)},null,2)+'\n');throw error;
}finally{
 socket?.close();
 if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}
 await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
