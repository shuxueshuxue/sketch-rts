#!/usr/bin/env node
// Evidence preservation only. No rendering, simulation, or production acceptance test.
// --archive [--prune] | --verify | --materialize --out /tmp/new-directory
// Run from repository root. FFmpeg is required; materialization writes raw RGBA,
// never claims to reconstruct the original PNG encoding/encoded-byte SHA.
import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const modes = ['--archive', '--verify', '--materialize'].filter(x => args.includes(x));
assert.equal(modes.length, 1, 'Choose exactly one of --archive, --verify, --materialize');
const mode = modes[0];
const outAt = args.indexOf('--out');
const out = outAt < 0 ? null : path.resolve(args[outAt + 1] ?? '');
const known = new Set([...modes, '--prune', '--out', ...(outAt < 0 ? [] : [args[outAt + 1]])]);
assert(args.every(x => known.has(x)), 'Unknown argument');
assert(!args.includes('--prune') || mode === '--archive', '--prune requires --archive');
assert.equal(Boolean(out), mode === '--materialize', '--out is required only for --materialize');
const root = path.resolve('docs/art/refactor/followup/card-streaming/mip-residency');
const reference = path.resolve('docs/art/refactor/followup/viewport-performance/battle');
const captures = ['battle-after', 'battle-order-sort']; // Deliberately excludes bank-order.
const manifestPath = path.join(root, 'diagnostic-frame-archive.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const filename = index => `frame-${String(index).padStart(3, '0')}.png`;
const relative = target => path.relative(root, target).split(path.sep).join('/');
const hashFile = async file => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const exists = async file => { try { await stat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const atomicJson = async (file, value) => {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(tmp, file);
};

// Decode the exact PNG samples without Canvas premultiplication/unpremultiplication.
function decodePng(bytes) {
  assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'PNG signature');
  let width, height, channels, ended = false;
  const chunks = [];
  for (let at = 8; at < bytes.length;) {
    assert(at + 12 <= bytes.length, 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
    assert(at + length + 12 <= bytes.length, 'Truncated PNG data');
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      assert.equal(length, 13); width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.equal(data[10], 0); assert.equal(data[11], 0); assert.equal(data[12], 0);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : undefined;
      assert(channels, 'Only noninterlaced 8-bit RGB/RGBA PNG supported');
    }
    assert(type !== 'tRNS', 'RGB transparency requires another explicit decoder');
    if (type === 'IDAT') chunks.push(data);
    at += length + 12;
    if (type === 'IEND') { assert.equal(at, bytes.length); ended = true; break; }
  }
  assert(ended && width && height && channels);
  const stride = width * channels, encoded = inflateSync(Buffer.concat(chunks));
  assert.equal(encoded.length, height * (stride + 1));
  const rows = Buffer.alloc(stride * height), rgba = Buffer.alloc(width * height * 4);
  const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y && x<=z ? a : y<=z ? b : c; };
  for (let y=0; y<height; y++) {
    const input=y*(stride+1), filter=encoded[input], row=y*stride;
    assert(filter <= 4, 'PNG filter');
    for (let x=0; x<stride; x++) {
      const a=x>=channels ? rows[row+x-channels] : 0, b=y ? rows[row+x-stride] : 0, c=y && x>=channels ? rows[row+x-stride-channels] : 0;
      const pred=filter===0 ? 0 : filter===1 ? a : filter===2 ? b : filter===3 ? Math.floor((a+b)/2) : paeth(a,b,c);
      rows[row+x]=(encoded[input+1+x]+pred)&255;
    }
    for (let x=0; x<width; x++) {
      const from=row+x*channels, to=(y*width+x)*4;
      rgba[to]=rows[from]; rgba[to+1]=rows[from+1]; rgba[to+2]=rows[from+2]; rgba[to+3]=channels===4 ? rows[from+3] : 255;
    }
  }
  return { width, height, rgba };
}

const archiveBytes = await readFile(path.join(reference, 'archive.json'));
const archive = JSON.parse(archiveBytes), stored = archive.archives.before;
assert.equal(archive.frames, 80); assert.equal(archive.width, 1280); assert.equal(archive.height, 900);
assert(stored.verified); assert.equal(stored.file, 'before/all-frames-lossless.mkv');
assert.deepEqual(stored.decodedRgbaSha256, archive.rgbaSha256.before);
const movie = path.join(reference, stored.file);
assert.equal(await hashFile(movie), stored.sha256, 'Reference container SHA');
const frameBytes = archive.width * archive.height * 4;
const proofs = {};
for (const capture of captures) {
  const bytes = await readFile(path.join(root, capture, 'proof.json'));
  const proof = JSON.parse(bytes);
  assert.equal(proof.framePngSha256.length, archive.frames);
  assert.equal(proof.simSnapshotHashes.length, archive.frames);
  proofs[capture] = { proof, sha256: sha(bytes) };
}
const provenance = { archiveJson: relative(path.join(reference, 'archive.json')), archiveJsonSha256: sha(archiveBytes), container: relative(movie), containerSha256: stored.sha256 };
let manifest;
if (mode === '--archive' && !(await exists(manifestPath))) {
  manifest = { version: 1, width: archive.width, height: archive.height, frames: archive.frames, reference: provenance,
    meaning: 'Lossless RGBA reconstruction; original PNG byte hashes are provenance, not a claim that removed PNG encodings can be reproduced. Negative diagnostic frames retain their original PNG bytes. Original proofs and failed comparisons remain unchanged.', captures: {} };
  for (const capture of captures) manifest.captures[capture] = { proofSha256: proofs[capture].sha256, differences: [], entries: [] };
} else {
  manifest = JSON.parse(await readFile(manifestPath));
  assert.equal(manifest.version, 1); assert.equal(manifest.width, archive.width); assert.equal(manifest.height, archive.height); assert.equal(manifest.frames, archive.frames);
  assert.deepEqual(manifest.reference, provenance);
  assert.deepEqual(Object.keys(manifest.captures), captures);
  for (const capture of captures) { assert.equal(manifest.captures[capture].proofSha256, proofs[capture].sha256); assert.equal(manifest.captures[capture].entries.length, archive.frames); }
}
const preparing = manifest.captures[captures[0]].entries.length === 0;
if (out) { await mkdir(out); for (const capture of captures) await mkdir(path.join(out, capture)); }
const child = spawn('ffmpeg', ['-v','error','-threads','1','-i',movie,'-map','0:v:0','-f','rawvideo','-pix_fmt','rgba','-threads','1','pipe:1'], { stdio: ['ignore','pipe','pipe'] });
let stderr = '', childError;
child.stderr.on('data', data => { stderr = (stderr + data).slice(-16384); });
const finished = new Promise(resolve => { child.on('error', e => { childError=e; resolve(-1); }); child.on('close', resolve); });
let pending = Buffer.alloc(0), index = 0;
try {
  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      const raw = pending.subarray(0, frameBytes); pending = pending.subarray(frameBytes);
      assert(index < archive.frames, 'Unexpected extra FFV1 frame');
      const rawSha = sha(raw);
      assert.equal(rawSha, archive.rgbaSha256.before[index], `Reference RGBA frame ${index}`);
      for (const capture of captures) {
        const record = manifest.captures[capture], proof = proofs[capture].proof;
        const png = path.join(root, capture, filename(index));
        let entry = record.entries[index], pixels = raw;
        if (preparing || (await exists(png))) {
          const bytes = await readFile(png);
          assert.equal(sha(bytes), proof.framePngSha256[index], `${capture} original encoded SHA frame ${index}`);
          const decoded = decodePng(bytes);
          assert.equal(decoded.width, archive.width); assert.equal(decoded.height, archive.height);
          pixels = decoded.rgba;
        } else assert.equal(entry?.storage, 'reference', 'Missing exceptional PNG');
        const pixelSha = sha(pixels), different = !pixels.equals(raw);
        if (preparing) {
          entry = { index, originalPng: filename(index), originalEncodedSha256: proof.framePngSha256[index], rgbaSha256: pixelSha,
            simSnapshotHash: proof.simSnapshotHashes[index], storage: different ? 'exception' : 'reference', referenceIndex: index };
          record.entries.push(entry); if (different) record.differences.push(index);
        } else {
          assert.equal(entry.index,index); assert.equal(entry.referenceIndex,index); assert.equal(entry.originalPng,filename(index));
          assert.equal(entry.originalEncodedSha256,proof.framePngSha256[index]); assert.deepEqual(entry.simSnapshotHash,proof.simSnapshotHashes[index]);
          assert.equal(entry.rgbaSha256,pixelSha); assert.equal(entry.storage,different ? 'exception' : 'reference');
        }
        if (out) await writeFile(path.join(out, capture, `frame-${String(index).padStart(3,'0')}.rgba`), pixels, { flag:'wx' });
      }
      index++;
    }
  }
  assert.equal(await finished,0,`FFmpeg failed: ${childError ?? stderr}`);
  assert.equal(pending.length,0); assert.equal(index,archive.frames);
} catch (error) { child.kill('SIGKILL'); await finished; throw error; }
for (const capture of captures) {
  const record = manifest.captures[capture];
  assert.deepEqual(record.differences,record.entries.filter(x=>x.storage==='exception').map(x=>x.index));
}
// No source deletion occurs before ALL original pixels and ALL reference frames verify.
if (preparing) await atomicJson(manifestPath, manifest);
let removedBytes=0, removedFiles=0;
if (mode==='--archive' && args.includes('--prune')) {
  // Recheck all remaining source bytes before first unlink. A interrupted prune can resume.
  const removable=[];
  for (const capture of captures) for (const entry of manifest.captures[capture].entries) {
    const file=path.join(root,capture,entry.originalPng);
    if (await exists(file)) {
      const bytes=await readFile(file); assert.equal(sha(bytes),entry.originalEncodedSha256);
      if(entry.storage==='reference') removable.push({file,bytes:bytes.length,sha256:entry.originalEncodedSha256});
    } else assert.equal(entry.storage,'reference');
  }
  for(const item of removable) { assert.equal(await hashFile(item.file),item.sha256); await unlink(item.file); removedBytes+=item.bytes; removedFiles++; }
}
if(out) await atomicJson(path.join(out,'materialization.json'), { complete:true, format:'raw RGBA8, top-to-bottom rows, no row padding', width:archive.width,height:archive.height,
  sourceManifest:manifestPath, sourceManifestSha256:await hashFile(manifestPath), captures:manifest.captures,
  meaning:'Raw bytes match the manifest RGBA SHA. Original PNG encoded SHA is provenance only; any later PNG encoding must not be claimed byte-identical.' });
console.log(JSON.stringify({operation:mode, preservationVerified:true, frames:index, differences:Object.fromEntries(captures.map(c=>[c,manifest.captures[c].differences])), removedFiles,removedBytes,
  meaning:'Evidence integrity only; historical pixel differences remain failures, not production acceptance.'},null,2));
