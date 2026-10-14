/** Losslessly preserve every proof frame while keeping duplicate raw PNGs out
 * of the repository. Never run compression during performance sampling. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = resolve(process.argv[2] ?? 'docs/art/refactor/followup/viewport-performance/battle');
const proofs = {}, raw = {};
const hash = value => createHash('sha256').update(value).digest('hex');
const canvas = createCanvas(1280, 900), ctx = canvas.getContext('2d');
for (const side of ['before', 'after']) {
  proofs[side] = JSON.parse(await readFile(resolve(root, side, 'proof.json'))); raw[side] = [];
  for (let i = 0; i < proofs[side].framePngSha256.length; i++) {
    const path = resolve(root, side, `frame-${String(i).padStart(3, '0')}.png`), bytes = await readFile(path);
    if (hash(bytes) !== proofs[side].framePngSha256[i]) throw new Error(`Changed original PNG ${side}/${i}`);
    const image = await loadImage(bytes); if (image.width !== 1280 || image.height !== 900) throw new Error('Wrong dimensions');
    ctx.clearRect(0, 0, 1280, 900); ctx.drawImage(image, 0, 0); raw[side].push(hash(ctx.getImageData(0, 0, 1280, 900).data));
  }
}
const rgbaIdentical = JSON.stringify(raw.before) === JSON.stringify(raw.after);
const run = args => new Promise((done, reject) => { const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] }); let error = ''; child.stderr.on('data', chunk => error += String(chunk)); child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(error || `ffmpeg ${code}`))); });
const archives = {};
for (const side of rgbaIdentical ? ['before'] : ['before', 'after']) {
  const file = resolve(root, side, 'all-frames-lossless.mkv');
  await run(['-y', '-framerate', '10', '-i', resolve(root, side, 'frame-%03d.png'), '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgra', '-threads', '1', file]);
  const decoded = await new Promise((done, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const values = []; let current = createHash('sha256'), bytes = 0, error = '';
    child.stdout.on('data', chunk => { let at = 0; while (at < chunk.length) { const count = Math.min(chunk.length - at, 1280 * 900 * 4 - bytes); current.update(chunk.subarray(at, at + count)); bytes += count; at += count; if (bytes === 1280 * 900 * 4) { values.push(current.digest('hex')); current = createHash('sha256'); bytes = 0; } } });
    child.stderr.on('data', chunk => error += String(chunk)); child.once('error', reject); child.once('exit', code => code === 0 && bytes === 0 ? done(values) : reject(new Error(error || 'Incomplete RGBA decode')));
  });
  if (JSON.stringify(decoded) !== JSON.stringify(raw[side])) throw new Error(`Lossless archive pixels mismatch ${side}`);
  const bytes = await readFile(file); archives[side] = { file: `${side}/all-frames-lossless.mkv`, bytes: bytes.length, sha256: hash(bytes), decodedRgbaSha256: decoded, verified: true };
}
if (rgbaIdentical) archives.after = { uses: 'before/all-frames-lossless.mkv', reason: 'Every decoded before/after RGBA frame is identical; the source PNG byte hashes are retained independently in both proof.json files.' };
const result = { width: 1280, height: 900, frames: raw.before.length, rgbaSha256: raw, rgbaIdentical, archives,
  meaning: 'SHA arrays here hash raw RGBA pixels. proof.json hashes original encoded PNG bytes. Re-encoding decoded video pixels as PNG can change encoded-byte hashes while preserving every pixel. FFV1 BGRA archive was decoded to RGBA and checked frame by frame before deleting redundant original frame-NNN PNGs. Selected proof-N.png captures, camera probes and H.264 viewing videos remain.' };
await mkdir(root, { recursive: true }); await writeFile(resolve(root, 'archive.json'), JSON.stringify(result, null, 2) + '\n');
for (const side of ['before', 'after']) for (let i = 0; i < proofs[side].framePngSha256.length; i++) await unlink(resolve(root, side, `frame-${String(i).padStart(3, '0')}.png`));
console.log(JSON.stringify({ root, frames: result.frames, rgbaIdentical, archives: Object.fromEntries(Object.entries(archives).map(([key, value]) => [key, { file: value.file, bytes: value.bytes, verified: value.verified, uses: value.uses }])) }));
