/** Diagnostic-only frozen production graph; no frame or content override. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,symlink,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {normalizePath} from 'vite';
const hash=v=>createHash('sha256').update(v).digest('hex'),clean=id=>normalizePath(id.split('?')[0].replace(/^\/@fs(?=\/)/,''));
export async function createQueueSourceFreeze({sourceRoot,harnessRoot,scratch,outputDir,entryFixture,observerPath=null}){
 const commit=execFileSync('git',['rev-parse','42bd^{commit}'],{cwd:sourceRoot,encoding:'utf8'}).trim();
 const verifyClean=()=>execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim()===commit&&!execFileSync('git',['diff','HEAD','--','src','public'],{cwd:sourceRoot}).length&&!execFileSync('git',['ls-files','--others','--exclude-standard','--','src'],{cwd:sourceRoot}).length;
 if(!verifyClean())throw new Error('Queue diagnosis requires clean frozen42bd source');
 const files=execFileSync('git',['ls-files','src'],{cwd:sourceRoot,encoding:'utf8'}).trim().split('\n').sort();
 const sources=new Map(await Promise.all(files.map(async file=>[normalizePath(resolve(sourceRoot,file)),await readFile(resolve(sourceRoot,file))])));
 const gitTree=execFileSync('git',['ls-tree','-r',commit,'src'],{cwd:sourceRoot,encoding:'utf8'}).trim().split('\n');const gitBlobs=Object.fromEntries(gitTree.map(line=>{const [header,file]=line.split('\t');return[file,header.split(' ')[2]];}));
 if(JSON.stringify(Object.keys(gitBlobs).sort())!==JSON.stringify(files))throw new Error('Tracked source inventory differs from frozen Git tree');
 for(const [path,bytes]of sources){const file=path.slice(normalizePath(sourceRoot).length+1),blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');if(blob!==gitBlobs[file])throw new Error('Source bytes differ from Git blob: '+file);}
 const helperNames=['art-card-upload-replay-entry-v4.js','art-card-upload-replay-fixture-v4.js','art-card-upload-replay-observer-v4.mjs','art-card-bank-variant.js','art-gpu-completion.mjs'];
 const helpers=new Map(await Promise.all(helperNames.map(async name=>[normalizePath(resolve(harnessRoot,'scripts',name)),await readFile(resolve(harnessRoot,'scripts',name))])));
 const metadata={version:2,gitSourceBlobSha1:gitBlobs,expectedCommit:commit,sourceSha256:Object.fromEntries([...sources].map(([p,b])=>[p.slice(normalizePath(sourceRoot).length+1),hash(b)])),sourcePublicTree:execFileSync('git',['rev-parse','HEAD:public'],{cwd:sourceRoot,encoding:'utf8'}).trim(),sourceSnapshots:[],helperSnapshots:[],resolveRecords:[],loadedModules:[],thirdPartyModules:[],moduleGraph:[],dependencyPreparation:{include:['three','three/addons/loaders/GLTFLoader.js'],noDiscovery:true,protocol:'explicit-startup-three-gltf-v2-captured',beforeBrowserLaunch:true}};
 const thirdParty=new Map(),contextImporter=resolve(sourceRoot,'src/client/world3d/card-mip-uploader.ts');
 const plugin={name:'frozen42bd-queue-diagnostic-source',enforce:'pre',async resolveId(request,importer){
  if(!importer)return null;const from=clean(importer);
  if(!from.startsWith(normalizePath(sourceRoot)+'/src/')&&!from.startsWith(normalizePath(scratch)+'/')&&!helpers.has(from))return null;
  const result=await this.resolve(request,request==='three'?contextImporter:importer,{skipSelf:true});metadata.resolveRecords.push({request,importer,resolvedId:result?.id??null,purpose:request==='three'?'current-context-public-three':'original-module-dependency'});return result;
 },async load(id){const path=clean(id),bytes=observerPath!==null&&path===normalizePath(observerPath)?helpers.get(normalizePath(resolve(harnessRoot,'scripts/art-card-upload-replay-observer.mjs'))):sources.get(path)??helpers.get(path);
  if(bytes){metadata.loadedModules.push({id,path,sha256:hash(bytes),frozenRunStartBytes:true,kind:sources.has(path)?'production-source':'diagnostic-or-original-helper'});return bytes.toString('utf8');}
  if(path.startsWith(normalizePath(sourceRoot)+'/src/'))throw new Error('Source outside frozen tracked inventory: '+path);
  if((path.includes('/node_modules/')||path.includes('/.vite-cache/'))&&/\.(?:m?js)$/.test(path))try{thirdParty.set(path,{id,path,sha256:hash(await readFile(path))});}catch{}
  return null;
 }};
 async function archive(){for(const [collection,key,prefix]of [[sources,'sourceSnapshots','complete-source-snapshot'],[helpers,'helperSnapshots','runtime-helper-snapshots']])for(const [path,bytes]of collection){const file=collection===sources?path.slice(normalizePath(sourceRoot).length+1):path.split('/').at(-1),snapshot=prefix+'/'+file;await mkdir(dirname(resolve(outputDir,snapshot)),{recursive:true});await writeFile(resolve(outputDir,snapshot),bytes);metadata[key].push({path,relativePath:collection===sources?file:undefined,sha256:hash(bytes),snapshot});}}
 async function dependencies(server,label){const optimizer=server.environments?.client?.depsOptimizer,expected=metadata.dependencyPreparation.include;
  if(!optimizer||!optimizer.options.noDiscovery||JSON.stringify(optimizer.options.include)!==JSON.stringify(expected))throw new Error('Queue explicit optimizer policy differs');
  const meta=optimizer.metadata;if(Object.keys(meta.discovered).length||JSON.stringify(Object.keys(meta.optimized).sort())!==JSON.stringify([...expected].sort()))throw new Error('Queue startup dependency batch incomplete');
  const entries=[],chunks=[];for(const [kind,collection,rows]of [['optimized',meta.optimized,entries],['chunks',meta.chunks,chunks]])for(const [name,info]of Object.entries(collection)){if(info.processing)throw new Error('Dependency still processing');const bytes=await readFile(info.file),sha256=hash(bytes),snapshot='optimized-dependency-snapshots/'+sha256+'.js';await mkdir(dirname(resolve(outputDir,snapshot)),{recursive:true});await writeFile(resolve(outputDir,snapshot),bytes);rows.push({name,kind,file:info.file,source:info.src??null,browserHash:info.browserHash,fileHash:info.fileHash??null,resolvedId:optimizer.getOptimizedDepId(info),bytes:bytes.length,sha256,snapshot});}
  return{label,hash:meta.hash,lockfileHash:meta.lockfileHash,configHash:meta.configHash,browserHash:meta.browserHash,entries,chunks,discovered:[],optimizationComplete:true};
 }
 async function prepare(){await symlink(resolve(sourceRoot,'node_modules'),resolve(scratch,'node_modules'),'dir');return{include:[...metadata.dependencyPreparation.include],noDiscovery:true};}
 async function startup(server){const started=performance.now(),optimizer=server.environments?.client?.depsOptimizer,expected=metadata.dependencyPreparation.include;metadata.dependencyPreparation.startupWait={started,polls:0,waitMs:0};for(;;){if(!optimizer)throw new Error('No client optimizer');const m=optimizer.metadata,ready=!Object.keys(m.discovered).length&&JSON.stringify(Object.keys(m.optimized).sort())===JSON.stringify([...expected].sort())&&Object.values(m.optimized).every(info=>!info.processing);if(ready)break;if(performance.now()-started>60000)throw new Error('Completed startup optimization timeout');metadata.dependencyPreparation.startupWait.polls++;await new Promise(resolve=>setTimeout(resolve,10));}metadata.dependencyPreparation.startupWait.waitMs=performance.now()-started;metadata.dependencyPreparation.startup=await dependencies(server,'before-browser-launch');}
 async function finish(server){metadata.finalSourceSha256=Object.fromEntries(await Promise.all(files.map(async file=>[file,hash(await readFile(resolve(sourceRoot,file)))])));metadata.sourceStayedFrozen=verifyClean()&&JSON.stringify(metadata.sourceSha256)===JSON.stringify(metadata.finalSourceSha256);metadata.helpersStayedFrozen=true;for(const [path,bytes]of helpers)if(!bytes.equals(await readFile(path)))metadata.helpersStayedFrozen=false;
  metadata.thirdPartyModules=await Promise.all([...thirdParty.values()].map(async row=>({...row,unchangedAtFinish:hash(await readFile(row.path))===row.sha256})));
  metadata.moduleGraph=[...server.moduleGraph.idToModuleMap.values()].map(m=>({id:m.id,url:m.url,importers:[...m.importers].map(i=>i.id),dependencies:[...m.importedModules].map(i=>i.id)}));metadata.sameContextThreeResolvedIds=[...new Set(metadata.resolveRecords.filter(r=>r.request==='three').map(r=>r.resolvedId))];metadata.dependencyPreparation.finish=await dependencies(server,'after-final-draw');const stable=x=>JSON.stringify({...x,label:undefined});metadata.dependencyPreparation.stayedStable=stable(metadata.dependencyPreparation.startup)===stable(metadata.dependencyPreparation.finish);
  if(!metadata.sourceStayedFrozen||!metadata.helpersStayedFrozen||metadata.thirdPartyModules.some(r=>!r.unchangedAtFinish)||!metadata.dependencyPreparation.stayedStable||metadata.sameContextThreeResolvedIds.length!==1||metadata.sameContextThreeResolvedIds[0]!==metadata.dependencyPreparation.startup.entries.find(r=>r.name==='three')?.resolvedId)throw new Error('Queue source/helper/optimizer/full Three identity changed');
 }
 return{metadata,plugin,archive,prepare,startup,finish};
}
