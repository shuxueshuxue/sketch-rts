/** Crop the original generated paintings into bounded runtime images and a review sheet. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artDirectory = path.join(root, 'public/art/abilities');
const reviewDirectory = path.join(root, 'assets/abilities');
const skills = [
  ['heal', 'Heal', 'magic'], ['summon', 'Summon', 'magic'], ['curse', 'Curse', 'magic'],
  ['emberMend', 'Ember Mend', 'magic'], ['cinderSoul', 'Cinder Soul', 'magic'],
  ['ashCurse', 'Ash Curse', 'magic'], ['charge', 'Charge', 'physical'],
  ['stomp', 'Stomp', 'physical'], ['bloodlust', 'Bloodlust', 'magic'], ['web', 'Web', 'magic'],
  ['pinningBolt', 'Pinning Bolt', 'physical'], ['incendiaryFlume', 'Burning Oil', 'physical'],
  ['veteranResilience', 'Battle Hardened', 'physical'], ['veteranMobility', 'Swift Movement', 'physical'],
  ['veteranCommand', 'Coordinated Assault', 'physical'], ['veteranVigilance', 'Watchful Company', 'physical'],
  ['veteranRally', 'Rallying Cry', 'physical'], ['veteranPhalanx', 'Hold the Line', 'physical'],
  ['veteranSteadyAim', 'Steady Aim', 'physical'], ['veteranMarch', 'March Leader', 'physical'],
  ['veteranHealingWave', 'Restoring Wave', 'magic'], ['veteranInnerFire', 'Inner Fire', 'magic'],
  ['veteranRenewal', 'Renewing Presence', 'magic'], ['veteranSiegeDrill', 'Rangefinding', 'physical'],
  ['veteranEndurance', 'Enduring Recovery', 'physical'],
];
const statuses = [
  ['guardianScroll', 'Guardian Ward', 'magic'], ['statusSlow', 'Slowed', 'physical'],
  ['statusPoison', 'Poisoned', 'magic'], ['statusStun', 'Stunned', 'physical'],
];
const sources = [
  { file: 'skills-source.webp', columns: [0, 251, 503, 753, 1003, 1254], rows: [0, 240, 485, 724, 957, 1254], icons: skills },
  { file: 'statuses-source.webp', columns: [0, 627, 1254], rows: [0, 587, 1254], icons: statuses },
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(artDirectory, { recursive: true });
await mkdir(reviewDirectory, { recursive: true });
const icons = [];
const provenance = [];
for (const source of sources) {
  const bytes = await readFile(path.join(reviewDirectory, source.file));
  const image = await loadImage(bytes);
  if (image.width !== 1254 || image.height !== 1254) throw new Error(`${source.file}: expected inspected 1254 x 1254 source`);
  provenance.push({ file: source.file, sha256: digest(bytes), width: image.width, height: image.height,
    columns: source.columns, rows: source.rows });
  for (const [index, [id, label, family]] of source.icons.entries()) {
    const column = index % (source.columns.length - 1);
    const row = Math.floor(index / (source.columns.length - 1));
    // The generated atlas is not a mathematical grid. These inspected boundaries keep adjacent paintings out.
    const sx = source.columns[column] + 2;
    const sy = source.rows[row] + 2;
    const sw = source.columns[column + 1] - source.columns[column] - 4;
    const sh = source.rows[row + 1] - source.rows[row] - 4;
    const canvas = createCanvas(128, 128);
    const context = canvas.getContext('2d');
    context.fillStyle = '#0b1521';
    context.fillRect(0, 0, 128, 128);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // Preserve the painted proportions, including the slightly taller last row; no subject is stretched.
    const scale = Math.min(128 / sw, 128 / sh);
    const width = sw * scale;
    const height = sh * scale;
    context.drawImage(image, sx, sy, sw, sh, (128 - width) / 2, (128 - height) / 2, width, height);
    const output = await canvas.encode('webp', 86);
    const filename = `${id}.webp`;
    await writeFile(path.join(artDirectory, filename), output);
    icons.push({ id, label, family, file: `art/abilities/${filename}`, width: 128, height: 128,
      bytes: output.length, sha256: digest(output), source: source.file, crop: { x: sx, y: sy, width: sw, height: sh }, canvas });
  }
}

const sheet = createCanvas(1100, 1460);
const context = sheet.getContext('2d');
context.fillStyle = '#101923';
context.fillRect(0, 0, sheet.width, sheet.height);
context.fillStyle = '#ecdfc8';
context.font = 'bold 25px sans-serif';
context.fillText('Painted RTS abilities and statuses', 22, 38);
context.font = '15px sans-serif';
context.fillStyle = '#aab5bf';
context.fillText('25 unique skills + 4 status icons. Actual runtime WebP shown at 128, 48 and 24 px.', 22, 66);
for (const [index, icon] of icons.entries()) {
  const x = (index % 5) * 220 + 18;
  const y = Math.floor(index / 5) * 225 + 96;
  const runtime = await loadImage(await readFile(path.join(root, 'public', icon.file)));
  context.fillStyle = '#1b2734';
  context.fillRect(x - 7, y - 7, 206, 211);
  context.drawImage(runtime, x, y, 128, 128);
  context.drawImage(runtime, x + 140, y, 48, 48);
  context.drawImage(runtime, x + 152, y + 65, 24, 24);
  context.fillStyle = '#ecdfc8';
  context.font = 'bold 14px sans-serif';
  context.fillText(icon.label, x, y + 154, 192);
  context.fillStyle = '#9bafbf';
  context.font = '12px sans-serif';
  context.fillText(icon.id, x, y + 174, 192);
  context.fillText(`${icon.family} / ${(icon.bytes / 1024).toFixed(1)} KiB`, x, y + 194, 192);
}
await writeFile(path.join(reviewDirectory, 'ability-icons-review.webp'), await sheet.encode('webp', 87));
const manifest = {
  formatVersion: 1, generatedWith: 'image_gen', createdOn: '2026-10-09',
  description: 'Original generated miniature paintings, cropped without repainting; physical skills in steel, wood and leather, magic in vivid jewel colors.',
  sourceImages: provenance, output: { count: icons.length, size: 128, format: 'webp', quality: 86,
    totalBytes: icons.reduce((sum, icon) => sum + icon.bytes, 0), runtimePath: 'public/art/abilities',
    reviewSheet: 'ability-icons-review.webp' }, icons: icons.map(({ canvas, ...icon }) => icon),
};
await writeFile(path.join(reviewDirectory, 'ability-icons.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Exported ${icons.length} icons, ${manifest.output.totalBytes} runtime bytes.\n`);
