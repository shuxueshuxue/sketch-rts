/** Same-scale before/after evidence from both actual production painter routes.
 * This is an art/identity review, not a render-throughput or FPS benchmark. */
import { createCanvas } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { UnitAnimationFrame } from '../src/client/unit-animation';
import type { Brush } from '../src/client/art/kit';

const args = process.argv.slice(2);
const arg = (key: string, fallback: string) => { const at = args.indexOf(key); return at < 0 ? fallback : args[at + 1] ?? fallback; };
const beforeRoot = resolve(arg('--before', '/tmp/sketch-stall-baseline-8345'));
const afterRoot = resolve(arg('--after', '.'));
const out = resolve(arg('--out', 'docs/art/refactor/followup/spirit-redraw'));
const old = await import(pathToFileURL(resolve(beforeRoot, 'src/client/art/painted-creatures.ts')).href);
const next = await import(pathToFileURL(resolve(afterRoot, 'src/client/art/painted-creatures.ts')).href);
const oldCorpse = await import(pathToFileURL(resolve(beforeRoot, 'src/client/art/corpses.ts')).href);
const nextCorpse = await import(pathToFileURL(resolve(afterRoot, 'src/client/art/corpses.ts')).href);
await mkdir(resolve(out, 'frames'), { recursive: true });
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const color = '#477b91';

function subject(b: Brush, painter: typeof next, pose: UnitAnimationFrame, x: number, y: number, scale: number, facing = 1) {
  b.save(); b.translate(x, y); b.scale(scale * facing, scale);
  if (!painter.paintCreature(b, 'spirit', color, pose)) throw new Error('Actual spirit route did not paint');
  b.restore();
}
function paper(w: number, h: number) {
  const canvas = createCanvas(w, h), b = canvas.getContext('2d') as unknown as Brush;
  b.fillStyle = '#d0c7b1'; b.fillRect(0, 0, w, h);
  b.fillStyle = '#343b36'; b.font = '18px sans-serif';
  return { canvas, b };
}
async function save(name: string, canvas: ReturnType<typeof createCanvas>) {
  const bytes = canvas.toBuffer('image/png'); await writeFile(resolve(out, name), bytes);
  return { name, bytes: bytes.length, pngSHA256: sha(bytes), rgbaSHA256: sha(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) };
}

const files: Awaited<ReturnType<typeof save>>[] = [];
{
  const { canvas, b } = paper(1200, 730);
  b.fillText('Spirit redraw / exact same production paint scale and paper / before → after', 24, 29);
  for (let row = 0; row < 2; row++) {
    const painter = row ? next : old, cy = 235 + row * 310;
    b.fillText(row ? 'After: veiled shade' : 'Before: wispy oval', 24, cy - 145);
    for (let i = 0; i < 4; i++) {
      const pose = [{ mode: 'idle', frame: 0 }, { mode: 'walk', frame: 2 }, { mode: 'attack', frame: 0, aim: -4 }, { mode: 'attack', frame: 0, aim: 4 }][i] as UnitAnimationFrame;
      b.fillText(['Idle', 'Float / move', 'Attack up 60°', 'Attack down 60°'][i]!, 145 + i * 270, cy + 82);
      subject(b, painter, pose, 225 + i * 270, cy + 55, 3);
      // A real 1× painted subject is included beside every enlarged drawing.
      subject(b, painter, pose, 315 + i * 270, cy + 45, 1);
    }
  }
  files.push(await save('comparison.png', canvas));
}
{
  const { canvas, b } = paper(1280, 1050);
  b.fillText('Actual revised spirit / three attack variants / three authored target planes / two facings', 20, 29);
  for (let facing = 0; facing < 2; facing++) for (let variant = 0; variant < 3; variant++) for (let column = 0; column < 3; column++) {
    const x = 215 + column * 425, y = 205 + (variant + facing * 3) * 155;
    subject(b, next, { mode: 'attack', frame: 0, variant, aim: [-4, 0, 4][column] }, x, y, 2.1, facing ? -1 : 1);
    b.font = '14px sans-serif'; b.fillText(`${facing ? '←' : '→'} ${['up 60°', 'level', 'down 60°'][column]} / variant ${variant}`, x - 105, y + 49);
  }
  files.push(await save('attack-directions.png', canvas));
}
{
  const { canvas, b } = paper(1280, 580);
  b.fillText('Actual revised spirit / distinct cast gesture / recovery and remains', 20, 29);
  for (let col = 0; col < 6; col++) {
    subject(b, next, { mode: 'attack', frame: col, aim: -4 }, 105 + col * 213, 255, 2.4);
    subject(b, next, { mode: 'cast', frame: col, aim: 4 }, 105 + col * 213, 480, 2.4);
    b.font = '15px sans-serif'; b.fillText(`sample ${col}`, 66 + col * 213, 290);
  }
  files.push(await save('recovery-cast.png', canvas));
}
{
  const { canvas, b } = paper(800, 250);
  b.fillText('Spirit remains / old → new / no physical body or blood added', 20, 29);
  b.save(); b.translate(190, 145); b.scale(5, 5); oldCorpse.paintCorpse(b, 'spirit'); b.restore();
  b.save(); b.translate(590, 145); b.scale(5, 5); nextCorpse.paintCorpse(b, 'spirit'); b.restore();
  files.push(await save('remains.png', canvas));
}

// Exercise the exact decoded pixels consumed by source masks: frame 5 aliases
// idle; all stock idle-sharing pairs remain pixel-identical at both densities
// and facings. No mock draw, rounded coordinates, alpha-only hash or tolerance.
const comparisons: unknown[] = [];
function raster(painter: typeof next, pose: UnitAnimationFrame, density: number, facing: number) {
  const canvas = createCanvas(176 * density, 176 * density), b = canvas.getContext('2d') as unknown as Brush;
  subject(b, painter, pose, 88 * density, 106 * density, density, facing);
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}
for (const density of [2, 4]) for (const facing of [-1, 1]) {
  for (const pair of [[0, 4], [1, 3], [5, 7]]) {
    const a = raster(next, { mode: 'idle', frame: pair[0]! }, density, facing), z = raster(next, { mode: 'idle', frame: pair[1]! }, density, facing);
    const changed = a.reduce((n, value, i) => n + Number(value !== z[i]), 0);
    comparisons.push({ kind: 'idle-alias', pair, density, facing, changedChannels: changed, aSHA256: sha(a), bSHA256: sha(z) });
    if (changed) throw new Error(`Broken spirit idle alias: ${pair}/${density}/${facing}`);
  }
  const ready = raster(next, { mode: 'idle', frame: 0 }, density, facing);
  for (const mode of ['attack', 'cast'] as const) for (let aim = -6; aim <= 6; aim++) for (let variant = 0; variant < (mode === 'attack' ? 3 : 1); variant++) {
    const pixels = raster(next, { mode, frame: 5, aim, variant }, density, facing);
    const changed = ready.reduce((n, value, i) => n + Number(value !== pixels[i]), 0);
    comparisons.push({ kind: 'ready-alias', mode, aim, variant, density, facing, changedChannels: changed, idleSHA256: sha(ready), actionSHA256: sha(pixels) });
    if (changed) throw new Error(`Broken spirit ready alias: ${mode}/${aim}/${variant}/${density}/${facing}`);
  }
}

// Before/after clips use the same frames and dimensions. Attack starts at the
// actual contact sample, then recovers; this does not invent a pre-hit windup.
const videoFrames = [];
for (let i = 0; i < 108; i++) {
  const { canvas, b } = paper(1280, 720);
  const group = Math.floor(i / 36), phase = i % 36, mode = phase < 8 ? 'idle' : phase < 20 ? 'attack' : phase < 28 ? 'walk' : 'cast';
  const frame = mode === 'idle' ? phase : mode === 'attack' ? Math.min(5, Math.floor((phase - 8) / 2)) : mode === 'walk' ? phase - 20 : Math.min(5, phase - 28);
  b.fillText(`Spirit / actual painters / ${mode} ${frame} / variant ${group} / contact → recovery`, 20, 29);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const x = 214 + col * 426, y = 275 + row * 320;
    subject(b, row ? next : old, { mode, frame, variant: group, aim: [-4, 0, 4][col] }, x, y, 3.2, group === 1 ? -1 : 1);
    b.font = '17px sans-serif'; b.fillText(`${row ? 'After' : 'Before'} / ${['↑ 60°', '→ level', '↓ 60°'][col]}`, x - 85, y + 65);
  }
  videoFrames.push(await save(`frames/${String(i).padStart(3, '0')}.png`, canvas));
}
const sourceFiles = ['src/client/art/painted-creatures.ts', 'src/client/art/creature-painters.ts', 'src/client/art/creature-poses.ts', 'src/client/art/painted-spirit.ts', 'src/client/art/corpses.ts', 'src/client/art/motion.ts', 'src/client/art/appearance.ts', 'src/client/art/action-direction.ts'];
async function source(root: string) {
  const hashes: Record<string, string | null> = {};
  for (const file of sourceFiles) {
    try { hashes[file] = sha(await readFile(resolve(root, file))); } catch { hashes[file] = null; }
  }
  const git = (command: string[]) => execFileSync('git', ['-C', root, ...command], { encoding: 'utf8' }).trim();
  return { root, head: git(['rev-parse', 'HEAD']), sharedTree: git(['rev-parse', 'HEAD:src/shared']), serverTree: git(['rev-parse', 'HEAD:src/server']), sourceHashes: hashes };
}
await writeFile(resolve(out, 'painter-proof.json'), JSON.stringify({ method: 'Two real paintCreature production entrypoints, unchanged input scenes, Napi Canvas full RGBA comparisons; no simulation or performance claim.', before: await source(beforeRoot), after: await source(afterRoot), files, video: { fps: 18, durationSeconds: 6, width: 1280, height: 720, frames: videoFrames }, identityComparisons: comparisons, passed: true }, null, 2) + '\n');
console.log(JSON.stringify({ out, imageFiles: files.length, videoFrames: videoFrames.length, identityComparisons: comparisons.length, passed: true }));
