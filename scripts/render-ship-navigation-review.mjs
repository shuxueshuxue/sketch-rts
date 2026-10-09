import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';

// node scripts/render-ship-navigation-review.mjs BEFORE.json AFTER.json [OUTPUT_DIRECTORY]
if (!process.argv[2] || !process.argv[3]) throw new Error('Expected baseline and candidate simulation JSON files');
const out=resolve(process.argv[4]||'docs/reviews/art');
const ids=['attack-crossing','attack-crossing-running','attack-close-parallel','attack-upwind','transport-turn-180','warship-running-turn-180','transport-island','warship-ocean-upwind','warship-long-upwind','board-moving-friendly','transport-short-oblique','carrier-long-upwind','cutter-head-on','warship-crossing-traffic','carrier-parallel-friendly','follow-moving-then-stop','follow-upwind-then-stop'];
const round=(key,value)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*1000000)/1000000:value;
function compact(data,build){return {schema:1,build,ticksPerSecond:data.ticksPerSecond,scenes:data.scenes.filter(s=>ids.includes(s.id)).map(s=>({...s,initialSnapshot:{tick:s.initialSnapshot.tick},hulls:s.hulls.map(h=>({id:h.id,kind:h.kind,profile:{hull:h.profile.hull,length:h.profile.length,beam:h.profile.beam}})),map:{width:s.map.width,height:s.map.height,terrain:s.map.terrain,wind:s.map.wind},routeEvents:s.routeEvents.map(e=>({tick:e.tick,id:e.id,revision:e.revision,route:{points:e.route.points}}))}))}}
const before=compact(JSON.parse(await readFile(resolve(process.argv[2]),'utf8')),'09be683');
const after=compact(JSON.parse(await readFile(resolve(process.argv[3]),'utf8')),'navigation rebuild');
const data={before,after};
const encoded=gzipSync(Buffer.from(JSON.stringify(data,round)),{level:9}).toString('base64');
let html=await readFile(new URL('./ship-navigation-review-viewer.html',import.meta.url),'utf8'),js=await readFile(new URL('./ship-navigation-review-viewer.js',import.meta.url),'utf8');
html=html.replace('<script src="review.js"></script>',`<script type="module">const bytes=Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0));window.NAVIGATION_REVIEW_DATA=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();\n${js}</script>`);
await mkdir(out,{recursive:true});await writeFile(out+'/ship-navigation-comparison.html',html);console.log(JSON.stringify({scenes:before.scenes.map(s=>s.id),bytes:Buffer.byteLength(html)}));
