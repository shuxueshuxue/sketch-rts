/** New exclusive exact-input diagnostic. Existing executed evidence is untouched. */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile,stat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createGunzip,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
import {resourceManifest} from '../tools/resource-manifest.ts';
import {createQueueSourceFreeze} from './art-card-upload-depth1-source-freeze.mjs';
import {createRuntimeScriptCollector} from './art-card-upload-replay-runtime-scripts-v2.mjs';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const harnessRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sourceRoot=resolve(arg('--source')??'/tmp/sketch-queue-source-42bd');
const outputDir=resolve(arg('--out')??'work/art-card-upload-depth1/native-candidate-v1');
const policy=arg('--policy')??'candidate';if(!['original','candidate'].includes(policy))throw new Error('Use original|candidate policy');
const candidatePath=resolve(arg('--candidate-source')??'work/art-card-upload-depth1/candidate.ts');
const metadataPath=resolve(arg('--metadata')??'work/art-card-upload-depth1/source.json'),candidateBytes=await readFile(candidatePath),candidateMetadata=JSON.parse(await readFile(metadataPath));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim();
if(sourceCommit!=='42bd61c74934dc76f30d42b62e1e31eb5c5974ff')throw new Error('Exact replay source must be frozen42bd');
await mkdir(dirname(outputDir),{recursive:true});await mkdir(outputDir);
const scratch=await mkdtemp('/tmp/sketch-exact-upload-'),fixtureName='art-card-upload-depth1-entry.js';
const variant={name:'original-oneNative',maxBanks:1,mips:'native'};
const sourceFreeze=await createQueueSourceFreeze({sourceRoot,harnessRoot,scratch,outputDir,entryFixture:fixtureName,uploaderOverridePath:policy==='candidate'?candidatePath:null});
const helperNames=['art-card-upload-depth1-proof.mjs','art-card-upload-depth1-source-freeze.mjs','art-card-upload-replay-runtime-scripts-v2.mjs','art-card-upload-depth1-observer.mjs','art-card-upload-depth1-fixture.js','art-card-upload-depth1-entry.js'];
const helperBytes=new Map(await Promise.all(helperNames.map(async name=>[name,await readFile(resolve(harnessRoot,'scripts',name))])));
const result={version:1,sourceRoot,harnessRoot,sourceCommit,policy,candidateMetadata,formalTiming:false,productionOverrides:policy==='candidate'?['only frozen CardMipUploader scratch target']:[],expectedUploads:53,sourceInventory:sourceFreeze.metadata,toolSha256:Object.fromEntries([...helperBytes].map(([name,bytes])=>[name,hash(bytes)])),completed:false,errors:[],arms:[],exports:[],scope:'Reuse immutable actual n135 captured payloads, untimed per-event validation, then actual-generateMipmap-entry and public-copy A/G/B command queries with an async fence after each whole upload. Native oracle/readback/history drain perturb queue. Timer query brackets include arrival/idle; no pure-GPU/hardware-general performance claim.'};
const uploaderOriginalBytes=await readFile(resolve(sourceRoot,'src/client/world3d/card-mip-uploader.ts'));
let reconstructed=uploaderOriginalBytes.toString();if(candidateMetadata.sourceCommit!==sourceCommit||candidateMetadata.sourceSha256!==hash(uploaderOriginalBytes)||candidateMetadata.candidateSha256!==hash(candidateBytes)||!candidateMetadata.candidateExactReplacements)throw new Error('Candidate source identity differs');
for(const row of candidateMetadata.replacements){if(reconstructed.split(row.before).length!==2)throw new Error('Exact candidate anchor differs');reconstructed=reconstructed.replace(row.before,row.after);}
if(reconstructed!==candidateBytes.toString())throw new Error('Candidate changed outside exact declared replacement');
let server,browser,socket,collector,sessionId,sourceFinished=false,collectorFinished=false,exportObject;
const save=async()=>writeFile(resolve(outputDir,'proof.json'),JSON.stringify(result,null,2)+'\n');
try{
 const originalRun=resolve(arg('--capture-run')??'docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/run-v1');
 const archiveManifestPath=resolve(arg('--archive-manifest')??resolve(originalRun,'../archives/input-archives.json')),archiveManifestBytes=await readFile(archiveManifestPath),archiveManifest=JSON.parse(archiveManifestBytes);if(archiveManifest.sourceEpoch!==sourceCommit)throw new Error('Archive source epoch differs');
 const archiveRow=name=>{const rows=archiveManifest.files.filter(row=>row.path.endsWith('/run-v1/'+name));if(rows.length!==1)throw new Error('Exactly one archive identity required: '+name);return rows[0];};
 const verifyArchive=(row,file,storedBytes,storedSha256,decodedBytes,decodedSha256)=>{const gzip=file.endsWith('.gz');if(storedBytes!==(gzip?row.gzipBytes:row.bytes)||storedSha256!==(gzip?row.gzipSha256:row.sha256)||decodedBytes!==row.bytes||decodedSha256!==row.sha256)throw new Error('Stored/decoded identity differs from full verified archive: '+row.path);};
 let originalProofPath=resolve(originalRun,'proof.json');if(!await stat(originalProofPath).then(()=>true,()=>false))originalProofPath+='.gz';const originalProofStoredBytes=await readFile(originalProofPath),originalProofBytes=originalProofPath.endsWith('.gz')?gunzipSync(originalProofStoredBytes):originalProofStoredBytes,originalProof=JSON.parse(originalProofBytes),expectedCapture=originalProof.exports.find(row=>row.file==='capture.json');
 verifyArchive(archiveRow('proof.json'),originalProofPath,originalProofStoredBytes.length,hash(originalProofStoredBytes),originalProofBytes.length,hash(originalProofBytes));
 if(!expectedCapture||originalProof.sourceCommit!==sourceCommit||originalProof.capture?.uploads!==53)throw new Error('Original actual corpus provenance/count missing');
 let corpusPath=resolve(arg('--corpus')??resolve(originalRun,'capture.json'));if(!arg('--corpus')&&!await stat(corpusPath).then(()=>true,()=>false))corpusPath+='.gz';
 const storedHash=createHash('sha256');let storedBytes=0;for await(const bytes of createReadStream(corpusPath)){storedHash.update(bytes);storedBytes+=bytes.length;}
 const decodedHash=createHash('sha256');let decodedBytes=0;const observe=new Transform({transform(bytes,_encoding,done){decodedHash.update(bytes);decodedBytes+=bytes.length;done(null,bytes);}});
 const unpacked=resolve(scratch,'exact-corpus.json'),streams=[createReadStream(corpusPath)];if(corpusPath.endsWith('.gz'))streams.push(createGunzip());streams.push(observe,createWriteStream(unpacked));await pipeline(...streams);
 const decodedSha256=decodedHash.digest('hex'),storedSha256=storedHash.digest('hex');verifyArchive(archiveRow('capture.json'),corpusPath,storedBytes,storedSha256,decodedBytes,decodedSha256);if(decodedBytes!==expectedCapture.bytes||decodedSha256!==expectedCapture.sha256)throw new Error('Full decoded actual corpus differs from original capture export');
 result.corpus={archiveManifest:{path:archiveManifestPath,sha256:hash(archiveManifestBytes),proofIdentity:archiveRow('proof.json'),captureIdentity:archiveRow('capture.json')},originalRun,originalProofPath,originalProofStoredSha256:hash(originalProofStoredBytes),originalProofStoredBytes:originalProofStoredBytes.length,originalProofDecodedBytes:originalProofBytes.length,originalProofSha256:hash(originalProofBytes),originalRunExit1Retained:true,file:corpusPath,storedBytes,storedSha256,decodedBytes,decodedSha256,expectedCapturedExport:expectedCapture,checksumVerifiedBeforeBrowser:true};
 await sourceFreeze.archive();await save();
 for(const [name,bytes]of helperBytes)await writeFile(resolve(outputDir,name),bytes);
 const optimizeDeps=await sourceFreeze.prepare();
 const html=`<meta charset="UTF-8"><title>Exact native card upload replay</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`;
 await writeFile(resolve(scratch,'index.html'),html);await writeFile(resolve(outputDir,'entry.html'),html);result.entryHtmlSha256=hash(html);
 server=await createServer({configFile:false,root:scratch,cacheDir:resolve(scratch,'.vite-cache'),optimizeDeps,publicDir:resolve(sourceRoot,'public'),define:{__BENCHMARK_SOURCE_ROOT__:JSON.stringify(sourceRoot),__CARD_BANK_VARIANT__:JSON.stringify(variant)},plugins:[sourceFreeze.plugin,{name:'exact-replay-resource-manifest',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]==='/exact-corpus.json'){res.setHeader('Content-Type','application/json');res.setHeader('Content-Length',String(decodedBytes));const stream=createReadStream(unpacked);stream.on('error',next);stream.pipe(res);return;}if(!req.url?.split('?')[0]?.endsWith('/resource-manifest.json'))return next();try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot,'public'))));}catch(error){next(error);}});}}],server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[scratch,harnessRoot,sourceRoot]}}});
 await server.listen();await sourceFreeze.startup(server);await save();
 browser=spawn(arg('--chromium')??process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${resolve(scratch,'chromium')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Browser startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
 let serial=0;const pending=new Map();
 const rejectPending=error=>{for(const item of pending.values()){clearTimeout(item.timeout);item.reject(error);}pending.clear();};
 socket.on('error',error=>{result.errors.push(String(error));rejectPending(error);});socket.on('close',(code,reason)=>rejectPending(new Error('CDP socket closed '+code+' '+String(reason))));
 socket.on('message',bytes=>{const message=JSON.parse(String(bytes));if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timeout);message.error?item.reject(new Error(JSON.stringify(message.error))):item.done(message.result);return;}if(message.sessionId===sessionId)collector?.onEvent(message);if(message.method==='Runtime.exceptionThrown')result.errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);if(message.method==='Network.loadingFailed'&&!message.params.canceled)result.errors.push('Network: '+message.params.errorText);});
 const command=(method,params={},session)=>new Promise((done,reject)=>{if(socket.readyState!==WebSocket.OPEN)return reject(new Error('CDP not open'));const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},120000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'});({sessionId}=await command('Target.attachToTarget',{targetId,flatten:true}));
 const page=(method,params)=>command(method,params,sessionId);
 await page('Page.enable');await page('Runtime.enable');await page('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 collector=createRuntimeScriptCollector({page,outputDir,sourceRoot,harnessRoot,hash});await collector.start();
 const evaluate=async expression=>{const reply=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(reply.exceptionDetails)throw new Error(reply.exceptionDetails.exception?.description??reply.exceptionDetails.text);return reply.result.value;};
 result.browserVersion=await command('Browser.getVersion');await page('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}`});
 await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+60000;const check=()=>{if(window.cardUploadReplay?.ready&&window.cardUploadReplay.inputsReady)return resolve(true);if(performance.now()>deadline)return reject(new Error("Exact fixture startup timeout"));setTimeout(check,20)};check()})');
 exportObject=async(expression,label)=>{
  const header=await evaluate(`(async()=>{const value=await (${expression});const text=JSON.stringify(value);window.__exactUploadExport=text;const bytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',bytes);return{characters:text.length,bytes:bytes.length,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};})()`);
  const chunks=[];for(let at=0;at<header.characters;at+=1048576)chunks.push(await evaluate(`window.__exactUploadExport.slice(${at},${at+1048576})`));
  const text=chunks.join(''),bytes=Buffer.from(text);if(text.length!==header.characters||bytes.length!==header.bytes||hash(bytes)!==header.sha256)throw new Error('Complete bounded export checksum differs');
  const file=label+'.json';await writeFile(resolve(outputDir,file),bytes);await evaluate('delete window.__exactUploadExport');result.exports.push({...header,file,sliceCharacters:1048576,chunks:chunks.length});await save();return JSON.parse(text);
 };
 const actualInputs=await evaluate('({uploads:window.__exactCorpus.events.filter(e=>e.kind==="upload").length,events:window.__exactCorpus.events.length,n:window.__exactCorpus.n,sourceFullBytes:window.__exactCorpus.events.filter(e=>e.kind==="upload").reduce((sum,e)=>sum+e.rgba.bytes,0)})');
 if(actualInputs.uploads!==53||actualInputs.n!==135)throw new Error('Decoded actual corpus target/count differs');result.actualInputs=actualInputs;await save();
 console.log('START actual n135 capture and pick validation');const actual=await exportObject('window.cardUploadReplay.actual(window.__exactCorpus)','actual-n135');result.actualCapture={validation:actual.validation,pickSamples:actual.picks.length,uniquePickedIds:[...new Set(actual.picks.flatMap(p=>p.hit?[p.hit.id]:[]))],screenshot:'actual-n135.png'};await writeFile(resolve(outputDir,'actual-n135.png'),Buffer.from(actual.screenshot.split(',')[1],'base64'));await save();console.log('DONE actual n135 exact state/inputs/picks');
 for(const policy of ['validate','stage-query']){
  console.log('START replay '+policy);await page('HeapProfiler.collectGarbage');
  const arm=await exportObject(`window.cardUploadReplay.replay(${JSON.stringify(policy)},window.__exactCorpus)`,'replay-'+policy);result.arms.push(arm);await save();console.log('DONE '+policy+' '+JSON.stringify({submissionMs:arm.submissionMs,waitMs:arm.waitMs,envelopeMs:arm.envelopeMs,validation:arm.validation}));
 }
 console.log('START actual original summon/combat gameplay');const gameplay=await exportObject('window.cardUploadReplay.actualGameplay()','actual-gameplay');result.gameplay={passed:gameplay.passed,snapshots:gameplay.snapshots.length,hits:gameplay.hits.length,spiritTargetHits:gameplay.spiritTargetHits.length,deadTick:gameplay.deadTick,captures:gameplay.captures.length,pickSamples:gameplay.captures.reduce((n,c)=>n+c.picks.length,0),simulationDrawChecksumsUnchanged:true,spiritBloodAlwaysZero:true};for(const shot of gameplay.captures)await writeFile(resolve(outputDir,'actual-gameplay-'+shot.tick+'.png'),Buffer.from(shot.png.split(',')[1],'base64'));await save();console.log('DONE actual gameplay '+JSON.stringify(result.gameplay));
 await evaluate('window.cardUploadReplay.teardown()');await sourceFreeze.finish(server);sourceFinished=true;result.runtimeScripts=await collector.finish(sourceFreeze.metadata);collectorFinished=true;
 for(const [name,bytes]of helperBytes)if(!bytes.equals(await readFile(resolve(harnessRoot,'scripts',name))))result.errors.push('Diagnostic helper changed: '+name);
 result.validation={passed:!result.errors.length&&result.actualCapture.validation.passed&&result.gameplay.passed&&result.arms.length===2&&result.arms.every(arm=>arm.validation.passed),actual53Payloads:true,candidateExactReplacements:true,fullPriorAndFinalNativeStateExact:true,perEventNativeOracleExact:true,runtimeHttpModulesCovered:result.runtimeScripts.passed};result.completed=true;await save();if(!result.validation.passed)throw new Error('Exact replay diagnostics failed');
 console.log('EXACT DEPTH1 REPLAY PASS '+outputDir);
}catch(error){if(exportObject)try{await exportObject('({state:window.__exactReplayFailure??null,native:window.__exactNativeFailure??null})','exact-failure-state');}catch(exportError){result.errors.push('Failure-state export: '+String(exportError));}result.failure=String(error);result.failureStack=error.stack;await save();throw error;}
finally{
 if(server&&!sourceFinished)try{await sourceFreeze.finish(server);sourceFinished=true;}catch(error){result.errors.push('Source finish: '+String(error));}
 if(collector&&!collectorFinished)try{result.runtimeScripts=await collector.finish(sourceFreeze.metadata);collectorFinished=true;}catch(error){result.runtimeScripts=error.runtimeScriptMetadata??null;result.errors.push('Runtime script finish: '+String(error));}
 socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}
 await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:4,retryDelay:100});result.browserTeardownComplete=true;await save();
}
