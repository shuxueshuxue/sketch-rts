/** Cross-revision correctness only; frozen capture tools and proofs stay untouched.
 * Use --kind camera|merc --before proof.json --after proof.json --out result.json.
 * --oracle-png-root allows exact PNG archive materialization in /tmp without
 * restoring/deleting images in the tracked evidence directories.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {dirname,resolve,basename} from 'node:path';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const upstreamAiSource=arg('--upstream-ai-source');
if(upstreamAiSource&&!/^[0-9a-f]{40}$/.test(upstreamAiSource))throw new Error('--upstream-ai-source requires a full lowercase 40-character commit SHA');
const kind=arg('--kind');
if(!['camera','merc'].includes(kind))throw new Error('Use --kind camera|merc');
const beforePath=resolve(arg('--before')),afterPath=resolve(arg('--after')),output=resolve(arg('--out'));
const oracleRoot=resolve(arg('--oracle-png-root')??dirname(beforePath));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(value,message)=>{if(!value)throw new Error(message);};
const beforeBytes=await readFile(beforePath),afterBytes=await readFile(afterPath);
const before=JSON.parse(beforeBytes),after=JSON.parse(afterBytes),violations=[],facts=[],images=[];
const sourceA=kind==='camera'?before.allClientSourceSha256:before.source.clientSha256;
const sourceB=kind==='camera'?after.allClientSourceSha256:after.source.clientSha256;
const allowedSourceChanges=new Set(['card-pick-mask','painted-card-batches','card-raster-cache','card-mip-uploader'].flatMap(name=>['.ts','.test.ts'].map(suffix=>'src/client/world3d/'+name+suffix)));
const sourceDifferences=[...new Set([...Object.keys(sourceA),...Object.keys(sourceB)])].sort().filter(file=>sourceA[file]!==sourceB[file]).map(file=>({file,before:sourceA[file]??null,after:sourceB[file]??null,allowed:allowedSourceChanges.has(file)}));
for(const change of sourceDifferences)if(!change.allowed)violations.push('Unexpected client source change: '+change.file);
function fact(name,left,right){const identical=JSON.stringify(left)===JSON.stringify(right);facts.push({name,identical,beforeSha256:hash(JSON.stringify(left)??'undefined'),afterSha256:hash(JSON.stringify(right)??'undefined')});if(!identical)violations.push(name+' differs');}
let aiProvenance=null;
function gitValue(args){return execFileSync('git',args,{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function checkRulesProvenance(){
 const actual={};
 for(const [side,proof] of [['before',before],['after',after]]){
  const commit=proof.source.head;
  assert(/^[0-9a-f]{40}$/.test(commit),side+' capture requires a full commit SHA');
  assert(gitValue(['rev-parse','--verify',commit+'^{commit}'])===commit,side+' source must be the named commit object');
  actual[side]={commit,trees:{}};
  for(const directory of ['src/shared','src/server','src/ai']){
   const tree=gitValue(['rev-parse','--verify',commit+':'+directory]);
   actual[side].trees[directory]=tree;
   fact(side+'/rulesTreeMatchesGit/'+directory,proof.source.rulesTrees[directory],tree);
  }
  // Matching nonempty diffs would still be uncommitted rule changes; reject.
  fact(side+'/emptyRulesDiff',proof.source.rulesDiffSha256,hash(''));
 }
 for(const directory of ['src/shared','src/server'])fact('rulesTrees/'+directory,actual.before.trees[directory],actual.after.trees[directory]);
 const changed=actual.before.trees['src/ai']!==actual.after.trees['src/ai'];
 aiProvenance={actual,changed,explicitUpstreamCommit:upstreamAiSource??null,scope:'Only the explicitly identified upstream AI tree may change; shared/server and all captured simulation facts stay strict.'};
 if(changed){
  assert(upstreamAiSource,'AI trees changed: explicit --upstream-ai-source <full commit SHA> is required');
  assert(gitValue(['rev-parse','--verify',upstreamAiSource+'^{commit}'])===upstreamAiSource,'Upstream source must be the named commit object');
  const upstreamTree=gitValue(['rev-parse','--verify',upstreamAiSource+':src/ai']);
  aiProvenance.upstreamAiTree=upstreamTree;
  fact('afterAiTreeMatchesExplicitUpstream',actual.after.trees['src/ai'],upstreamTree);
  try{gitValue(['merge-base','--is-ancestor',upstreamAiSource,after.source.head]);aiProvenance.upstreamIsAfterAncestor=true;}
  catch(error){aiProvenance.upstreamIsAfterAncestor=false;aiProvenance.ancestryError=String(error);violations.push('Explicit upstream AI commit is not an ancestor of the captured after commit');}
 }else fact('rulesTrees/src/ai',actual.before.trees['src/ai'],actual.after.trees['src/ai']);
}
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
function rgbaDifference(before, after) {
  if (before.width !== after.width || before.height !== after.height) return { identical: false, dimensionsEqual: false };
  let changedPixels = 0, changedChannels = 0, maximumChannelDelta = 0, totalAbsoluteDelta = 0;
  for (let i = 0; i < before.rgba.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(before.rgba[i + c] - after.rgba[i + c]);
      if (delta) { changed = true; changedChannels++; totalAbsoluteDelta += delta; maximumChannelDelta = Math.max(maximumChannelDelta, delta); }
    }
    if (changed) changedPixels++;
  }
  return { identical: changedPixels === 0, dimensionsEqual: true, changedPixels, changedChannels, maximumChannelDelta,
    meanAbsoluteChannelDelta: totalAbsoluteDelta / before.rgba.length, beforeRgbaSha256: hash(before.rgba), afterRgbaSha256: hash(after.rgba) };
}
function directions(proof){
 const rows=[];for(const sample of proof.samples){
  if(sample.mode!=='attack'&&sample.mode!=='cast'&&!sample.carry)continue;
  const release=proof.releases.filter(r=>r.sourceId===sample.id&&r.actionTick<=sample.tick).sort((a,b)=>b.actionTick-a.actionTick)[0];
  assert(release,'No real release for an observed action');const dx=release.toX-release.fromX,dy=release.toY-release.fromY;
  const expectedFacing=dx>0?1:-1,expectedAim=Math.round(Math.atan2(dy,Math.abs(dx))*12/Math.PI),actualAim=sample.mode==='attack'||sample.mode==='cast'?sample.aim:sample.carryAim;
  rows.push({capture:sample.capture,tick:sample.tick,kind:sample.kind,mode:sample.mode,releaseId:release.id,expectedFacing,facing:sample.facing,expectedAim,aim:actualAim,carry:sample.carry,matching:expectedFacing===sample.facing&&expectedAim===actualAim});
 }
 return{scope:'Ground-only real release vectors, no height offset. Full original action/carry samples; no animation override.',samples:rows.length,mismatches:rows.filter(row=>!row.matching),rows};
}

async function imagePair(label,nameA,nameB,shaA,shaB){
  try{
    const bytesA=await readFile(resolve(oracleRoot,basename(nameA))),bytesB=await readFile(resolve(dirname(afterPath),basename(nameB)));
    const actualA=hash(bytesA),actualB=hash(bytesB);
    if(actualA!==shaA||actualB!==shaB)violations.push(label+' original encoded PNG checksum mismatch');
    const rgba=rgbaDifference(decodePng(bytesA),decodePng(bytesB));
    images.push({label,beforePngSha256:actualA,afterPngSha256:actualB,pngBytesIdentical:bytesA.equals(bytesB),rgba});
    if(!rgba.identical)violations.push(label+' decoded RGBA differs');
  }catch(error){images.push({label,error:String(error)});violations.push(label+': '+String(error));}
}
try{
 if(kind==='camera'){
  if(!before.completed||!after.completed||!before.validation?.passed||!after.validation?.passed)violations.push('Camera source proof incomplete/invalid');
  for(const field of ['variantHelperSha256','factFixtureSha256','fixtureSha256','harnessSha256','plan','invariants'])fact(field,before[field],after[field]);
  for(const proof of [before,after])if(proof.variant.maxBanks!==1||proof.variant.mips!=='native'||proof.steps.length!==31||proof.errors.length||proof.failed.length)violations.push('Expected valid 31-step native one-bank camera proof');
  fact('initialSnapshot',before.init.snapshotSha256,after.init.snapshotSha256);fact('initialNow',before.init.now,after.init.now);
  fact('orderedStepLabels',before.steps.map(s=>s.label),after.steps.map(s=>s.label));
  for(const a of before.steps){
   const b=after.steps.find(s=>s.label===a.label);
   if(!b){violations.push('Missing camera step '+a.label);continue;}
   for(const field of ['input','view','dpr','innerWindow','physical','snapshotBeforeSha256','snapshotAfterSha256','nowBefore','nowAfter','tick','unchanged','glError','picks'])fact(a.label+'/'+field,a[field],b[field]);
   for(const field of ['actorDrawingBufferRgbaSha256','compositeRgbaSha256'])fact(a.label+'/'+field,a.screenshots[field],b.screenshots[field]);
   for(const type of ['actors','composite'])await imagePair(a.label+'/'+type,a.screenshots[type].path,b.screenshots[type].path,a.screenshots[type].pngSha256,b.screenshots[type].pngSha256);
  }
 }else{
  if(!before.passed||!after.passed||before.glError||after.glError||before.errors.length||after.errors.length)violations.push('Mercenary source proof failed');
  for(const field of ['fixtureSha256','harnessSha256'])fact('source/'+field,before.source[field],after.source[field]);
  checkRulesProvenance();
  for(const field of ['sales','hireSnapshotSha256','snapshotHashes','commands','releases','samples','picks','actualDeaths','seen','healSeen','attacks','drawMutations','fps'])fact(field,before[field],after[field]);
  if(before.framePngSha256.length!==40||after.framePngSha256.length!==40)violations.push('Expected forty mercenary captures');
  for(let i=0;i<40;i++){const name=`frame-${String(i).padStart(3,'0')}.png`;await imagePair(name,name,name,before.framePngSha256[i],after.framePngSha256[i]);}
  fact('portraitKinds',before.portraits.map(p=>p.kind),after.portraits.map(p=>p.kind));
  for(const a of before.portraits){const b=after.portraits.find(p=>p.kind===a.kind);if(!b){violations.push('Missing portrait '+a.kind);continue;}for(const field of ['png','ordinaryPng','bodyPng'])await imagePair(a.kind+'/'+field,a[field].file,b[field].file,a[field].sha256,b[field].sha256);}
  const left=directions(before),right=directions(after);fact('releaseDirections',left,right);
  if(left.samples!==44||right.samples!==44||left.mismatches.length||right.mismatches.length)violations.push('Expected 44 correct release-direction samples');
 }
}catch(error){violations.push(String(error));}
const result={kind,before:{path:beforePath,proofSha256:hash(beforeBytes),commit:kind==='camera'?before.sourceCommit:before.source.head},after:{path:afterPath,proofSha256:hash(afterBytes),commit:kind==='camera'?after.sourceCommit:after.source.head},
 oraclePngRoot:oracleRoot,aiProvenance,allowedSourceChanges:[...allowedSourceChanges],sourceDifferences,facts,images,
 counts:{images:images.length,picks:kind==='camera'?after.steps.reduce((n,s)=>n+s.picks.length,0):after.picks.length},
 validation:{passed:!violations.length,violations},
 method:'Cross-revision correctness, not a same-source timing comparison. Only the four explicitly listed mask/peak/cache/uploader implementation/test module names may differ; upload-region and art are not allowed changes. Mercenary rule metadata is checked against both Git commits. Shared/server trees and empty rulesDiff are strict; an AI tree change requires an explicit full upstream commit whose tree exactly matches the captured after AI and whose commit is an ancestor of after. All captured simulation facts remain strict. Frozen capture harness/facts, all native PNG RGBA channels, alpha-inclusive drawing-buffer hashes for camera, actual production pick results and gameplay facts remain strict. All PNG encoded hashes are checked against original proofs. No tolerance, resizing or Canvas decode. Resource counters are intentionally not asserted equal; optimization may change bookkeeping/cache ownership. Existing camera pick probes are three screen offsets per actor, not an exhaustive transparent-UV suite; independent mask semantics tests cover that separate domain.'};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,passed:result.validation.passed,...result.counts,violations}));if(violations.length)process.exitCode=1;
