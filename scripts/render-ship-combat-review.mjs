import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// node scripts/render-ship-combat-review.mjs BEFORE.json AFTER.json [OUTPUT_DIRECTORY]
if (!process.argv[2] || !process.argv[3]) throw new Error('Expected baseline and candidate JSON files');
const out = resolve(process.argv[4] || 'docs/reviews/assets/ship-combat-v2');
const ids = ['bow-mutual-far','bow-mutual-close','crossing','upwind','battery-crossing','battery-beam','mortar-crossing','mortar-close','flame-crossing','moving-crew','channel-three-v-three','upwind-warship-700','upwind-warship-1500','long-queued-corners','long-island-corner','cruise-180-2200'];
const round = (_key, value) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
function compact(data, build) {
  return { schema: data.schema, build, ticksPerSecond: data.ticksPerSecond, scenes: data.scenes.filter(s => ids.includes(s.id)).map(s => ({
    id:s.id,label:s.label,category:s.category,focusId:s.focusId,targetId:s.targetId,goal:s.goal,corners:s.corners,
    initialSnapshot:{tick:s.initialSnapshot.tick},
    map:{width:s.map.width,height:s.map.height,terrain:s.map.terrain,wind:s.map.wind},
    hulls:s.hulls.map(h=>({id:h.id,kind:h.kind,profile:{hull:h.profile.hull,length:h.profile.length,beam:h.profile.beam}})),
    frames:s.frames.map(f=>({tick:f.tick,projectiles:f.projectiles,ships:f.ships.map(({sail,velocityX,velocityY,orderQueue,...u})=>u)})),
    routeEvents:s.routeEvents.map(e=>({tick:e.tick,id:e.id,route:e.route?{points:e.route.points}:null})),
    events:s.events,metrics:s.metrics
  })) };
}
const beforeText = await readFile(resolve(process.argv[2]), 'utf8');
const afterText = await readFile(resolve(process.argv[3]), 'utf8');
const data = { before: compact(JSON.parse(beforeText), 'e721bd4'), after: compact(JSON.parse(afterText), '海战与航路修正') };
const encoded = gzipSync(Buffer.from(JSON.stringify(data, round)), { level: 9 }).toString('base64');
const js = await readFile(new URL('./ship-combat-review-viewer.js', import.meta.url), 'utf8');
let html = await readFile(new URL('./ship-combat-review-viewer.html', import.meta.url), 'utf8');
html = html.replace('<script src="review.js"></script>', `<script type="module">const bytes=Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0));window.NAVIGATION_REVIEW_DATA=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();\n${js}</script>`);
await mkdir(out, { recursive: true });
await writeFile(out + '/comparison.html', html);
const sha = text => createHash('sha256').update(text).digest('hex');
const metadata = {baseline:'e721bd4',beforeSha256:sha(beforeText),afterSha256:sha(afterText),artifactSha256:sha(html),bytes:Buffer.byteLength(html),scenes:data.before.scenes.map(s=>s.id)};
await writeFile(out+'/data-provenance.json',JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify(metadata));
