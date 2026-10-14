/** Offline four-arm complete-frame comparison. Never selects/promotes a policy. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ai=process.argv.indexOf('--arms'),oi=process.argv.indexOf('--out');
if(ai<0||oi<0||process.argv.slice(ai+1,ai+5).length!==4)throw new Error('Use --arms A1/raw.json B1/raw.json B2/raw.json A2/raw.json --out comparison.json');
const paths=process.argv.slice(ai+1,ai+5).map(p=>resolve(p)),output=resolve(process.argv[oi+1]);
if(paths.some(p=>p===output))throw new Error('Output must not be an input');
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const violations=[],checks=[],resourceDifferences=[],excludedTimingValues=[],images=[],inputs=[],lifetimes=[];
function check(ok,label,detail){checks.push({label,passed:!!ok,...(detail===undefined?{}:{detail})});if(!ok)violations.push(label);}
function compare(a,b,label){check(equal(a,b),label);}
function flatten(x,p='',out={}){if(x&&typeof x==='object'){out[p+'#structure']=Array.isArray(x)?{arrayLength:x.length}:{keys:Object.keys(x).sort()};for(const [k,v]of Object.entries(x))flatten(v,p?p+'.'+k:k,out);}else out[p]=x;return out;}
// Exact path whitelist, not a broad suffix filter. Unknown differences fail.
const timingPaths=new Set(['submissionMs','completeWallMs','cards.rasterWorkWallMs','cards.gpuTransferSubmissionWallMs','cards.rasterCache.workMs','cards.rasterCache.avoidedPaintMs',...['paintMs','readbackMs','cacheMs','pickMaskMs','rowFlipMs','slotMs'].map(k=>'cards.rasterStages.'+k)]);
function resources(a,b,label){const x=flatten(a),y=flatten(b);for(const path of new Set([...Object.keys(x),...Object.keys(y)])){if(timingPaths.has(path)){excludedTimingValues.push({label,path,reference:x[path]??null,actual:y[path]??null,reason:'Explicit measured wall-time field; all non-time counters remain strict.'});continue;}if(!equal(x[path],y[path]))resourceDifferences.push({label,path,reference:x[path]??null,actual:y[path]??null});}check(!resourceDifferences.some(d=>d.label===label),label+' non-time resource identity');}
function stats(v){if(!v.length)return{samples:0};if(v.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0))throw new Error('Invalid sample');const s=[...v].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor(s.length*p))];return{samples:v.length,meanMs:v.reduce((a,b)=>a+b,0)/v.length,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:s.at(-1),over50:v.filter(x=>x>50).length,over16_67:v.filter(x=>x>1000/60).length,rawValuesMs:v};}
const archivePath=(folder,name)=>{const p=resolve(folder,name);if(!p.startsWith(folder+'/'))throw new Error('Archive path escapes arm');return p;};
async function verifyFile(folder,file,expected,label){const bytes=await readFile(archivePath(folder,file));check(hash(bytes)===expected,label);return bytes;}
function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature');
  let width, height, channels, bitDepth, interlace; const chunks = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8), data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8];
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : undefined; interlace = data[12];
    }
    if (type === 'IDAT') chunks.push(data);
    at += length + 12;
    if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || !channels || interlace !== 0 || !width || !height) throw new Error('PNG decoder expects noninterlaced 8-bit RGB/RGBA');
  const encoded = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  if (encoded.length !== height * (stride + 1)) throw new Error('Unexpected PNG scanline size');
  const scanlines = Buffer.alloc(stride * height), rgba = Buffer.alloc(width * height * 4);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const input = y * (stride + 1), filter = encoded[input], row = y * stride;
    if (filter > 4) throw new Error(`Unsupported PNG filter ${filter}`);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? scanlines[row + x - channels] : 0, b = y ? scanlines[row + x - stride] : 0,
        c = y && x >= channels ? scanlines[row + x - stride - channels] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      scanlines[row + x] = (encoded[input + 1 + x] + prediction) & 255;
    }
    for (let x = 0; x < width; x++) {
      const from = row + x * channels, to = (y * width + x) * 4;
      rgba[to] = scanlines[from]; rgba[to + 1] = scanlines[from + 1]; rgba[to + 2] = scanlines[from + 2]; rgba[to + 3] = channels === 4 ? scanlines[from + 3] : 255;
    }
  }
  return { width, height, rgba };
}

let thrown=null;const arms=[];
try{
 for(let i=0;i<4;i++){
  const bytes=await readFile(paths[i]),r=JSON.parse(bytes),folder=dirname(paths[i]),name=['A1','B1','B2','A2'][i],policy=['original','candidate','candidate','original'][i];arms.push({r,folder,name,policy});inputs.push({name,path:paths[i],sha256:hash(bytes),bytes:bytes.length});
  const u=r.uploadIsolation,inv=u.sourceInventory;
  check(r.completed===true&&r.validation?.passed===true&&!r.errors?.length&&!r.failed?.length,name+' completed without errors');
  check(u.policy===policy&&!u.pilot,name+' declared policy');
  check(r.sourceCommit==='42bd61c74934dc76f30d42b62e1e31eb5c5974ff'&&u.expectedSourceCommit===r.sourceCommit,name+' frozen42bd');
  compare({repeats:r.repeats,counts:r.counts,cpu:r.cpuFrames,real:r.realFrames,paced:r.paced,scene:r.scene},{repeats:2,counts:[0],cpu:60,real:12,paced:true,scene:'mixed'},name+' exact schedule header');
  compare(r.simulation,[],name+' simulation excluded');
  for(const k of ['currentSourceStayedFrozen','baselineSourceStayedFrozen','candidateSourceStayedFrozen','baselineRegionStayedFrozen','candidateRegionStayedFrozen','sourceMetadataStayedFrozen'])check(u[k]===true,name+' '+k);
  check(inv.sourceStayedFrozen&&inv.helpersStayedFrozen,name+' inventory frozen');compare(inv.sourceSha256,inv.finalSourceSha256,name+' initial final fullsrc');compare(r.allClientSourceSha256,u.finalClientSourceSha256,name+' initial final client');
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),tree=execFileSync('git',['ls-tree','-r',r.sourceCommit,'src'],{cwd:repo,encoding:'utf8'}),blobs=Object.fromEntries(tree.trim().split('\n').map(line=>{const[h,f]=line.split('\t');return[f,h.split(' ')[2]];}));
  compare(inv.gitSourceBlobSha1,blobs,name+' immutable Git blobs');compare(Object.keys(inv.sourceSha256).sort(),Object.keys(blobs).sort(),name+' complete tracked source set');
  compare(inv.sourcePublicTree,execFileSync('git',['rev-parse',r.sourceCommit+':public'],{cwd:repo,encoding:'utf8'}).trim(),name+' public Git tree');
  for(const row of [...inv.sourceSnapshots,...inv.helperSnapshots]){const b=await verifyFile(folder,row.snapshot,row.sha256,name+' snapshot '+row.snapshot);if(row.relativePath){check(createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex')===blobs[row.relativePath],name+' Git source '+row.relativePath);check(hash(b)===inv.sourceSha256[row.relativePath],name+' source map '+row.relativePath);}}
  const archivedModules=new Map([...inv.sourceSnapshots,...inv.helperSnapshots].map(x=>[x.path,x.sha256]));
  check(inv.loadedModules.length>0&&inv.moduleGraph.length>0,name+' actual source/helper graph present');
  for(const row of inv.loadedModules)check(row.frozenRunStartBytes&&row.sha256===archivedModules.get(row.path),name+' loaded module '+row.path);
  for(const row of u.loadedUploaderModules){const expected=row.kind==='unchanged-region'?u.dependencies.currentRegionSha256:row.path===u.originalSource?u.baselineUploaderSha256:row.path===u.candidateSource?u.candidateUploaderSha256:null;check(expected&&row.servedFromRunStartSnapshot&&row.sha256===expected,name+' loaded provider '+row.path);}
  check([u.originalSource,u.candidateSource].every(path=>u.loadedUploaderModules.some(x=>x.kind==='uploader'&&x.path===path)),name+' balanced provider loads');
  await verifyFile(folder,'harness.mjs',r.harnessSha256,name+' harness bytes');
  for(const[file,expected]of [['source-snapshot/baseline-card-mip-uploader.ts',u.baselineUploaderSha256],['source-snapshot/candidate-card-mip-uploader.ts',u.candidateUploaderSha256],['source-snapshot/current-card-upload-region.ts',u.dependencies.currentRegionSha256],['candidate-source-metadata.json',u.sourceMetadataSha256],['upload-loader.js',u.loaderSha256]])await verifyFile(folder,file,expected,name+' provider/helper '+file);
  check(u.baselineUploaderSha256===u.currentUploaderSha256&&u.currentUploaderSha256===u.corpusUploaderSha256,name+' original matches current');check(u.actualProviderSha256===(policy==='original'?u.baselineUploaderSha256:u.candidateUploaderSha256),name+' actual selected provider');
  check(u.resolveRecords.length>0&&u.resolveRecords.every(x=>x.providerSha256===u.actualProviderSha256&&x.resolvedId===u.actualProviderPath),name+' provider resolve evidence');
  check(inv.thirdPartyModules.every(x=>x.unchangedAtFinish),name+' third party immutable');
  const dep=inv.dependencyPreparation;check(dep.stayedStable,name+' optimized deps stable');
  compare({...dep.startup,label:null},{...dep.finish,label:null},name+' startup finish dependency metadata');
  for(const state of[dep.startup,dep.finish]){check(state.optimizationComplete&&!state.discovered.length,name+' optimizer complete');for(const row of[...state.entries,...state.chunks]){const b=await verifyFile(folder,row.snapshot,row.sha256,name+' optimized bundle '+row.name);check(b.length===row.bytes,name+' optimized bundle bytes');}}
  compare(inv.sameContextThreeResolvedIds,[dep.startup.entries.find(e=>e.name==='three').resolvedId],name+' canonical Three full query');
  if(i){const base=arms[0].r;for(const k of['sourceCommit','allClientSourceSha256','harnessSha256','factFixtureSha256','variantHelperSha256','viewportMetadataSha256','fixtureSha256','entryFixtureSha256','variant','viewport'])compare(r[k],base[k],name+' cross '+k);for(const k of['sourceMetadata','sourceMetadataSha256','baselineUploaderSha256','candidateUploaderSha256','currentUploaderSha256','currentBatchesSha256','currentMaskSha256','currentCacheSha256','loaderSha256'])compare(u[k],base.uploadIsolation[k],name+' cross isolation '+k);compare(inv.sourceSha256,base.uploadIsolation.sourceInventory.sourceSha256,name+' cross fullsource');}
  check(r.cycles.length===2,name+' two lifetimes');
  for(const [ci,c]of r.cycles.entries()){
   const label=name+'/life'+ci,ref=arms[0].r.cycles[0];check(c.cycle===ci&&c.hiddenCount===0&&c.visibleCount===100&&c.totalUnits===100&&c.glError===0&&c.disposed===true,label+' frame facts and disposal');
   compare(c.cpu.sampleTicks,Array.from({length:60},(_,j)=>Math.floor((114+j)/3)),label+' all sample clocks');
   check(c.cpu.valuesMs.length===60&&c.real.completeWallValuesMs.length===12&&c.real.submitValuesMs.length===12&&c.real.completion.length===12&&c.real.intervalsMs.length===11,label+' sample counts');
   check(c.real.completion.every(x=>[37146,37148].includes(x.status)&&Number.isFinite(x.waitMs)),label+' successful GPU fences');
   compare(c.pixelProof,ref.pixelProof,label+' full raw facts');compare(c.assetCoverage,ref.assetCoverage,label+' complete asset coverage');compare(c.device,ref.device,label+' same renderer environment');
   check(hash(JSON.stringify(c.pixelProof))===c.pixelProofSha256,label+' fact hash');check(hash(JSON.stringify({units:c.pixelProof.visibleUnitFacts,effects:c.pixelProof.visibleEffectFacts,tick:c.pixelProof.tick}))===c.capturedVisibleSnapshotSha256,label+' visible snapshot hash');
   for(const phase of['before','empty','returned']){resources(ref[phase],c[phase],label+'/'+phase);compare(c.uploadPolicyResources[phase],c[phase].cards,label+' duplicated raw counters '+phase);}
   compare(Object.keys(c.screenshots).sort(),['battlefield','empty','returned'],label+' screenshot set');
   for(const phase of['battlefield','empty','returned']){
    const shot=c.screenshots[phase],encoded=await verifyFile(folder,shot.path,shot.sha256,label+' encoded PNG '+phase),decoded=decodePng(encoded),rgbaSha256=hash(decoded.rgba);
    const key='A1/life0/'+phase,reference=images.find(x=>x.label===key),record={label:label+'/'+phase,encodedSha256:hash(encoded),width:decoded.width,height:decoded.height,rgbaSha256,reference:key};
    if(reference)check(record.width===reference.width&&record.height===reference.height&&rgbaSha256===reference.rgbaSha256,label+' strict decoded RGBA '+phase);images.push(record);
   }
   lifetimes.push({arm:name,policy,cycle:ci,device:c.device,heapAfterGc:c.heapAfterGc,resources:{before:c.before,empty:c.empty,returned:c.returned},cpu:c.cpu,real:c.real});
  }
 }
}catch(error){thrown={message:String(error),stack:error.stack};violations.push('Analyzer could not finish: '+String(error));}
const summaries={};
for(const policy of['original','candidate']){const lives=lifetimes.filter(l=>l.policy===policy),values=fn=>lives.flatMap(fn);summaries[policy]={lifetimes:lives.length,cpuNoRender:stats(values(l=>l.cpu.valuesMs)),realComplete:stats(values(l=>l.real.completeWallValuesMs)),realSubmission:stats(values(l=>l.real.submitValuesMs)),fenceWall:stats(values(l=>l.real.completion.map(x=>x.waitMs))),frameStartIntervals:stats(values(l=>l.real.intervalsMs)),coldFirstRealComplete:stats(values(l=>l.real.completeWallValuesMs.slice(0,1))),remainingRealComplete:stats(values(l=>l.real.completeWallValuesMs.slice(1))),coldFirstSubmission:stats(values(l=>l.real.submitValuesMs.slice(0,1))),remainingSubmission:stats(values(l=>l.real.submitValuesMs.slice(1))),completionPollCall:stats(values(l=>l.real.completion.map(x=>x.pollCallMs))),completionYield:stats(values(l=>l.real.completion.map(x=>x.yieldedWallMs)))};if(lives.length)check(summaries[policy].cpuNoRender.samples===240&&summaries[policy].realComplete.samples===48,policy+' all-policy samples');}
const deltas=Object.fromEntries(Object.keys(summaries.original).filter(k=>summaries.original[k]?.samples&&summaries.candidate[k]?.samples).map(k=>[k,{meanDifferenceMs:summaries.candidate[k].meanMs-summaries.original[k].meanMs,meanPercentChange:summaries.original[k].meanMs?100*(summaries.candidate[k].meanMs/summaries.original[k].meanMs-1):null}]));
const report={version:1,passed:!violations.length,violations,thrown,inputs,analyzerSha256:hash(await readFile(fileURLToPath(import.meta.url))),checks,resourceTimeWhitelist:[...timingPaths],excludedTimingValues,resourceDifferences,images,lifetimes,summaries,deltas,scope:'Four-arm A1/B1/B2/A2 same-source presentation experiment on the recorded Chromium/SwiftShader backend; no hardware-GPU generalization, no promotion threshold. Every original sample retained. Main aggregates include first cold jump n480; separate cold/remaining groups do not replace them. CPU samples disable renderer.render, so are not full frames. Real submission contains Canvas and WebGL CPU work; fence wait and complete wall include driver backpressure, GPU completion and polling/event-loop scheduling, not pure GPU duration. Full/world-layer/Canvas timers must not be added as independent costs. Simulation is not executed; raw presentation facts are compared. Actual picking/native full mip correctness require separate proofs. Heap samples are explicit post-GC browser retention, not total/process/native GPU memory. Resource ownership/counters remain unfiltered except enumerated wall-time paths; all differences are visible and fail strict identity. 24 decoded PNGs are each checked against A1 life0 same phase (21 non-self comparisons). Small 48-sample per-policy p99 is descriptive, not a stable tail estimate. Source/optimized bundle snapshots are not transformed-runtime execution coverage.'};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,violations,output}));if(!report.passed)process.exitCode=1;
