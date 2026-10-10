/** Assemble hand-authored paths and material gradients into bounded SVG icons. No raster conversion. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { magicIcons } from '../assets/abilities/svg-sources/magic.mjs';
import { physicalIcons } from '../assets/abilities/svg-sources/physical.mjs';
import { statusIcons } from '../assets/abilities/svg-sources/status.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artDirectory = path.join(root, 'public/art/abilities');
const reviewDirectory = path.join(root, 'assets/abilities');
const skills = [
  ['heal', 'Heal', 'magic', '#64cb93'], ['summon', 'Summon', 'magic', '#64cedc'],
  ['curse', 'Curse', 'magic', '#b580e3'], ['emberMend', 'Ember Mend', 'magic', '#ea9b52'],
  ['cinderSoul', 'Cinder Soul', 'magic', '#ec8953'], ['ashCurse', 'Ash Curse', 'magic', '#b697ce'],
  ['charge', 'Charge', 'physical'], ['stomp', 'Stomp', 'physical'],
  ['bloodlust', 'Bloodlust', 'magic', '#d46a78'], ['web', 'Web', 'magic', '#acba8b'],
  ['pinningBolt', 'Pinning Bolt', 'physical'], ['incendiaryFlume', 'Burning Oil', 'physical', '#c68b57'],
  ['veteranResilience', 'Battle Hardened', 'physical'], ['veteranMobility', 'Swift Movement', 'physical'],
  ['veteranCommand', 'Coordinated Assault', 'physical'], ['veteranVigilance', 'Watchful Company', 'physical'],
  ['veteranRally', 'Rallying Cry', 'physical'], ['veteranPhalanx', 'Hold the Line', 'physical'],
  ['veteranSteadyAim', 'Steady Aim', 'physical'], ['veteranMarch', 'March Leader', 'physical'],
  ['veteranHealingWave', 'Restoring Wave', 'magic', '#71d6b5'],
  ['veteranInnerFire', 'Inner Fire', 'magic', '#d29be3'],
  ['veteranRenewal', 'Renewing Presence', 'magic', '#77cc89'],
  ['veteranSiegeDrill', 'Rangefinding', 'physical'], ['veteranEndurance', 'Enduring Recovery', 'physical'],
  ['guardianScroll', 'Guardian Ward', 'magic', '#92ce99'], ['statusSlow', 'Slowed', 'physical'],
  ['statusPoison', 'Poisoned', 'magic', '#9dc56e'], ['statusStun', 'Stunned', 'physical'],
];
const bodies = { ...magicIcons, ...physicalIcons, ...statusIcons };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const linear = (id, a, b, c) => `<linearGradient id="${id}" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="${a}"/><stop offset=".48" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;

function artwork(id, accent = '#a48b67') {
  const body = bodies[id];
  if (!body) throw new Error(`Missing hand-authored body: ${id}`);
  const gradients = {
    steel: linear('steel', '#e2e4d5', '#879ca4', '#394952'),
    bronze: linear('bronze', '#f0d7a0', '#bc8f50', '#654526'),
    leather: linear('leather', '#b68a61', '#76513b', '#3f302b'),
    wood: linear('wood', '#d0b280', '#987149', '#513c2c'),
    bone: linear('bone', '#f5ebc9', '#d6c396', '#a58859'),
    green: linear('green', '#e0f3a3', '#62cb8e', '#196450'),
    aqua: linear('aqua', '#d4f3ef', '#68c8d5', '#285a92'),
    violet: linear('violet', '#e0b8f3', '#a36ed2', '#442663'),
    flame: linear('flame', '#fff4b2', '#f7bd51', '#b64938'),
    ruby: linear('ruby', '#f4b895', '#d95165', '#651a35'),
    halo: `<radialGradient id="halo"><stop stop-color="${accent}" stop-opacity=".55"/><stop offset=".65" stop-color="${accent}" stop-opacity=".18"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`,
    magicGlow: `<radialGradient id="magicGlow"><stop stop-color="#f3f3c9"/><stop offset=".35" stop-color="${accent}" stop-opacity=".8"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`,
  };
  const used = [...new Set([...body.matchAll(/url\(#([\w-]+)\)/g)].map(match => match[1]))];
  for (const ref of used) if (!gradients[ref]) throw new Error(`${id}: unsupported paint ${ref}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<defs><radialGradient id="ground" cx=".48" cy=".38" r=".8"><stop stop-color="${accent}" stop-opacity=".28"/><stop offset="1" stop-color="#101920"/></radialGradient>${linear('edge', '#b9a07b', '#655846', '#403d34')}${used.map(ref => gradients[ref]).join('')}</defs>
<path d="M12 3 C37 2 91 2 116 4 Q124 5 125 14 L125 114 Q125 124 114 125 L14 125 Q3 124 3 113 L3 15 Q3 5 12 3Z" fill="#11191f"/>
<path d="M12 6 L116 6 Q122 7 122 14 L122 114 Q121 121 114 122 L14 122 Q7 121 6 113 L6 15 Q6 8 12 6Z" fill="url(#ground)" stroke="url(#edge)" stroke-width="2.2"/>
<path d="M15 10 L43 10 M10 16 L10 42 M114 118 L89 118 M118 115 L118 90" stroke="#d6c19b" stroke-opacity=".32" stroke-width="1.2" fill="none"/>
<g stroke="#101820" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body.trim()}</g>
</svg>
`;
}

await mkdir(artDirectory, { recursive: true });
await mkdir(reviewDirectory, { recursive: true });
if (Object.keys(bodies).length !== skills.length) throw new Error('Unused or missing authored icon');
const icons = [];
for (const [id, label, family, accent] of skills) {
  const svg = artwork(id, accent);
  if (/<(?:image|foreignObject|script|filter|text|use)\b|(?:data:|https?:|base64|\bon\w+=)/i.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''))) {
    throw new Error(`${id}: runtime SVG must contain self-contained vector artwork`);
  }
  const bytes = Buffer.from(svg);
  const filename = `${id}.svg`;
  if (bytes.length >= 10_000) throw new Error(`${id}: exceeds individual runtime budget`);
  await writeFile(path.join(artDirectory, filename), bytes);
  icons.push({ id, label, family, file: `art/abilities/${filename}`, width: 128, height: 128,
    bytes: bytes.length, sha256: digest(bytes), source: `svg-sources/${id in statusIcons ? 'status' : id in magicIcons ? 'magic' : 'physical'}.mjs` });
}
// Historical UI acceptance screenshots remain evidence of the earlier tested interface.
for (const file of await readdir(artDirectory)) if (path.extname(file) === '.webp') await rm(path.join(artDirectory, file));
for (const file of ['skills-source.webp', 'statuses-source.webp', 'ability-icons-review.webp']) {
  await rm(path.join(reviewDirectory, file), { force: true });
}

const sheet = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="1490" viewBox="0 0 1120 1490">',
  '<path d="M0 0H1120V1490H0Z" fill="#111b24"/>',
  '<g font-family="sans-serif"><text x="22" y="36" fill="#efdfc5" font-size="25" font-weight="bold">Hand-authored RTS ability and status SVGs</text>',
  '<text x="22" y="63" fill="#a8b9c4" font-size="15">29 distinct drawings. Actual runtime paths at 128, 48 and 24 pixels; no embedded raster images.</text></g>',
];
for (const [index, icon] of icons.entries()) {
  const x = (index % 5) * 224 + 18;
  const y = Math.floor(index / 5) * 229 + 95;
  sheet.push(`<path d="M${x - 6} ${y - 6}h207v213h-207Z" fill="#1c2934"/>`);
  const raw = await readFile(path.join(root, 'public', icon.file), 'utf8');
  for (const [size, dx, dy] of [[128, 0, 0], [48, 140, 0], [24, 152, 66]]) {
    const prefix = `${icon.id}-${size}-`;
    const inner = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
      .replace(/id="([\w-]+)"/g, (_, id) => `id="${prefix}${id}"`)
      .replace(/url\(#([\w-]+)\)/g, (_, id) => `url(#${prefix}${id})`);
    sheet.push(`<svg x="${x + dx}" y="${y + dy}" width="${size}" height="${size}" viewBox="0 0 128 128">${inner}</svg>`);
  }
  sheet.push(`<g font-family="sans-serif"><text x="${x}" y="${y + 155}" fill="#efdfc5" font-size="14" font-weight="bold">${escape(icon.label)}</text><text x="${x}" y="${y + 175}" fill="#a8b9c4" font-size="11.5">${icon.id}</text><text x="${x}" y="${y + 195}" fill="#a8b9c4" font-size="12">${icon.family} / ${(icon.bytes / 1024).toFixed(1)} KiB SVG</text></g>`);
}
sheet.push('</svg>');
await writeFile(path.join(reviewDirectory, 'ability-icons-review.svg'), `${sheet.join('\n')}\n`);
const sourceFiles = ['magic', 'physical', 'status'].map(name => `svg-sources/${name}.mjs`);
const manifest = {
  formatVersion: 2, authoredWith: 'hand-authored SVG paths and material gradients', updatedOn: '2026-10-10',
  description: 'Independent hand-authored vector drawings. Physical skills use steel, wood, leather and brass; magic uses jewel colors and bounded radial gradients. No raster images, auto-tracing, fonts or external resources.',
  sources: await Promise.all(sourceFiles.map(async file => { const bytes = await readFile(path.join(reviewDirectory, file)); return { file, bytes: bytes.length, sha256: digest(bytes) }; })),
  output: { count: icons.length, size: 128, format: 'svg', totalBytes: icons.reduce((sum, icon) => sum + icon.bytes, 0),
    runtimePath: 'public/art/abilities', reviewSheet: 'ability-icons-review.svg' }, icons,
};
if (manifest.output.totalBytes >= 200_000) throw new Error('SVG set exceeds runtime budget');
await writeFile(path.join(reviewDirectory, 'ability-icons.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Assembled ${icons.length} hand-authored SVG icons, ${manifest.output.totalBytes} runtime bytes.\n`);
