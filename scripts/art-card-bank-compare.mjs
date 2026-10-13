import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const beforePath = resolve(arg('--before')), afterPath = resolve(arg('--after'));
const output = resolve(arg('--out') ?? 'work/card-bank-comparison.json');
const kind = arg('--kind') ?? 'viewport';
if (!['viewport','battle'].includes(kind)) throw new Error('Use --kind viewport|battle');
const hiddenSelection=arg('--hidden')?.split(',').map(Number);
if(hiddenSelection&&(kind!=='viewport'||!hiddenSelection.length||hiddenSelection.some(n=>!Number.isInteger(n)||n<0)||new Set(hiddenSelection).size!==hiddenSelection.length))throw new Error('--hidden selects distinct nonnegative viewport populations');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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

const before = JSON.parse(await readFile(beforePath,'utf8')), after = JSON.parse(await readFile(afterPath,'utf8'));
const a = kind === 'battle' ? before.viewportSource : before, b = kind === 'battle' ? after.viewportSource : after;
const violations = [], images = [], facts = [];
if (a.sourceCommit !== b.sourceCommit || a.sourceGitDiffSha256 !== b.sourceGitDiffSha256 || JSON.stringify(a.allClientSourceSha256) !== JSON.stringify(b.allClientSourceSha256)) violations.push('Configurations must use the same frozen client source');
if (a.variantHelperSha256 !== b.variantHelperSha256) violations.push('Variant setup helper differs');
if (kind === 'viewport') {
  for (const key of ['harnessSha256','entryFixtureSha256','factFixtureSha256','viewportMetadataSha256','scene','paced','repeats','cpuFrames','realFrames']) if (a[key] !== b[key]) violations.push(`Different ${key}`);
  for (const key of ['viewport','browserVersion']) if (JSON.stringify(a[key])!==JSON.stringify(b[key]))violations.push(`Different ${key}`);
  if(!hiddenSelection&&JSON.stringify(a.counts)!==JSON.stringify(b.counts))violations.push('Different counts');
  if(hiddenSelection&&hiddenSelection.some(n=>!a.counts.includes(n)||!b.counts.includes(n)))violations.push('Selected population is missing from an original source run');
  if (!before.completed || !after.completed || !before.validation?.passed || !after.validation?.passed) violations.push('Incomplete or invalid source proof');
  for(const [label,run] of [['reference',before],['candidate',after]]){
    const expectedKeys=run.counts.flatMap(count=>Array.from({length:run.repeats},(_,cycle)=>`${count}/${cycle}`)).sort();
    const actualKeys=run.cycles.map(c=>`${c.hiddenCount}/${c.cycle}`).sort();
    if(JSON.stringify(expectedKeys)!==JSON.stringify(actualKeys))violations.push(`Unexpected lifetime grid: ${label}`);
    for(const cycle of run.cycles){
      if(cycle.before.cards.maxTextureBanks!==run.variant.maxBanks)violations.push(`Actual bank count differs from configuration: ${label}`);
      if(!cycle.variantSetups?.every(s=>s.maxBanks===run.variant.maxBanks&&s.mips===run.variant.mips&&s.cardMaxBanks===run.variant.maxBanks&&s.remainsMaxBanks===run.variant.maxBanks&&s.cardPages===0&&s.cardChunks===0&&s.remainsPages===0&&s.remainsChunks===0&&s.outsideMeasuredDraws))violations.push(`Invalid pre-draw variant setup: ${label}`);
    }
  }
} else {
  if (a.upstreamFixtureSha256 !== b.upstreamFixtureSha256 || a.normalizedFactProgramSha256 !== b.normalizedFactProgramSha256) violations.push('Battle fact program differs');
  if (!before.passed || !after.passed) violations.push('Battle self-validation failed');
  if (hash(await readFile(resolve(dirname(beforePath),'harness.mjs'))) !== hash(await readFile(resolve(dirname(afterPath),'harness.mjs')))) violations.push('Battle harness differs');
}
async function imagePair(label, pathA, pathB, expectedA, expectedB) {
  const aa = await readFile(pathA), bb = await readFile(pathB), shaA = hash(aa), shaB = hash(bb);
  if (shaA !== expectedA || shaB !== expectedB) violations.push(`Stored PNG checksum changed: ${label}`);
  const result = {label,beforePngSha256:shaA,afterPngSha256:shaB};
  if (shaA === shaB) result.rgba = {identical:true,changedPixels:0,changedChannels:0,maximumChannelDelta:0,method:'Byte-identical PNG is sufficient for exact decoded-pixel equality'};
  else result.rgba = rgbaDifference(decodePng(aa),decodePng(bb));
  if (!result.rgba.identical) violations.push(`RGBA differs: ${label}`);
  images.push(result);
}
if (kind === 'viewport') {
  const selectedBefore=hiddenSelection?before.cycles.filter(c=>hiddenSelection.includes(c.hiddenCount)):before.cycles;
  const selectedAfter=hiddenSelection?after.cycles.filter(c=>hiddenSelection.includes(c.hiddenCount)):after.cycles;
  if (selectedBefore.length !== selectedAfter.length) violations.push('Cycle count differs');
  for (const cycle of selectedBefore) {
    const match = after.cycles.find(x => x.hiddenCount === cycle.hiddenCount && x.cycle === cycle.cycle);
    if (!match) {violations.push('Missing matching cycle');continue;}
    const sameFacts = cycle.pixelProofSha256 === match.pixelProofSha256;
    if(JSON.stringify(cycle.device)!==JSON.stringify(match.device))violations.push(`Different device ${cycle.hiddenCount}/${cycle.cycle}`);
    if(JSON.stringify(cycle.cpu.sampleTicks)!==JSON.stringify(match.cpu.sampleTicks))violations.push(`Different sample ticks ${cycle.hiddenCount}/${cycle.cycle}`);
    for(const [field,count] of [['valuesMs',before.cpuFrames],['layerValuesMs',before.cpuFrames],['canvasValuesMs',before.cpuFrames]])if(cycle.cpu[field].length!==count||match.cpu[field].length!==count)violations.push(`Wrong ${field} sample count ${cycle.hiddenCount}/${cycle.cycle}`);
    for(const field of ['completeWallValuesMs','submitValuesMs'])if(cycle.real[field].length!==before.realFrames||match.real[field].length!==before.realFrames)violations.push(`Wrong ${field} sample count ${cycle.hiddenCount}/${cycle.cycle}`);
    facts.push({hiddenCount:cycle.hiddenCount,cycle:cycle.cycle,sameFacts});
    if (!sameFacts) violations.push('Viewport facts differ');
    for (const [name,png] of Object.entries(cycle.screenshots)) {
      const other = match.screenshots[name];
      if(!other){violations.push(`Missing screenshot ${cycle.hiddenCount}/${cycle.cycle}/${name}`);continue;}
      await imagePair(`${cycle.hiddenCount}/${cycle.cycle}/${name}`,resolve(dirname(beforePath),png.path),resolve(dirname(afterPath),other.path),png.sha256,other.sha256);
    }
  }
} else {
  if (before.framePngSha256.length !== after.framePngSha256.length || before.simSnapshotHashes.length !== after.simSnapshotHashes.length) violations.push('Battle frame count differs');
  for (let i=0;i<before.framePngSha256.length;i++) {
    const sameFacts = before.simSnapshotHashes[i] === after.simSnapshotHashes[i];facts.push({frame:i,sameFacts});
    if (!sameFacts) violations.push(`Battle snapshot differs at frame ${i}`);
    const filename=`frame-${String(i).padStart(3,'0')}.png`;
    await imagePair(`frame-${i}`,resolve(dirname(beforePath),filename),resolve(dirname(afterPath),filename),before.framePngSha256[i],after.framePngSha256[i]);
  }
}
const result = {kind,sourceCommit:a.sourceCommit,before:beforePath,after:afterPath,beforeVariant:a.variant,afterVariant:b.variant,
  selectedHiddenCounts:hiddenSelection??(kind==='viewport'?a.counts:undefined),originalCounts:kind==='viewport'?{before:a.counts,after:b.counts}:undefined,
  method:'Same frozen production client, fact program and helper/harness; only explicit bank/mip configuration differs. Stable production snapshot order is the oracle. Legacy cache-dependent occlusion is historical failed evidence, not a claim of zero legacy-image change. Exact PNG verification with strict decoded RGBA comparison on any encoded mismatch; no tolerance.',
  images,facts,validation:{passed:!violations.length,violations}};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,images:images.length,facts:facts.length,passed:result.validation.passed,violations}));
if(violations.length)process.exitCode=1;
