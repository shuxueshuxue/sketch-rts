import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';

// node --import tsx scripts/browser-runtime-benchmark.mjs --out work/browser-runtime.json
// CHROMIUM_PATH selects an installed Chromium. GPU wall time is not benchmarked.
const arg = key => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(arg('--out') || 'work/browser-runtime.json');
await mkdir(resolve(root, 'work'), { recursive: true });
const scratch = await mkdtemp(resolve(root, 'work/browser-runtime-'));
let server, browser, socket;
const errors = [], failed = [], requests = [], cycles = [], artTrace = [];
let wroteResult = false;

function validate(result) {
  const violations = [];
  const require = (condition, message) => { if (!condition) violations.push(message); };
  const emptyMaps = (owned, label) => {
    for (const [key, count] of Object.entries(owned)) require(count === 0, `${label}: ${key} retains ${count} entries`);
  };
  require(result.errors.length === 0, `Browser errors: ${JSON.stringify(result.errors)}`);
  require(result.failed.length === 0, `Failed network requests: ${JSON.stringify(result.failed)}`);
  require(result.requests.every(request => request.status >= 200 && request.status < 300), 'One or more GLB responses were not successful');
  require(result.cycles.length === 1, 'Expected one diagnostic resource cycle');
  const expected = new Set(result.teardown.expectedModels);
  const httpCounts = {};
  for (const request of result.requests) {
    const match = new URL(request.url).pathname.match(/\/art\/world3d\/(.+)\.glb$/);
    require(Boolean(match), `Unrecognized GLB resource URL: ${request.url}`);
    if (match) httpCounts[match[1]] = (httpCounts[match[1]] || 0) + 1;
  }
  for (const key of expected) {
    require(result.teardown.installedModels[key] === 1, `${key}: model was not installed exactly once`);
    require(httpCounts[key] === 1, `${key}: model did not have exactly one HTTP request`);
  }
  for (const key of Object.keys(result.teardown.installedModels)) require(expected.has(key), `Unexpected installed model ${key}`);
  for (const key of Object.keys(httpCounts)) require(expected.has(key), `Unexpected requested model ${key}`);
  for (const cycle of result.cycles) {
    const label = `Cycle ${cycle.index}`;
    require(cycle.glError === 0, `${label}: WebGL error ${cycle.glError}`);
    require(cycle.contextLost === true, `${label}: disposed renderer still has a live WebGL context`);
    require(cycle.before.selection.instances === 280, `${label}: selected actors did not produce all 280 actual markers`);
    require(cycle.before.owned.selectionHulls === 6 && cycle.before.owned.selectionBatches === 7, `${label}: missing ship hull or surface marker batches`);
    require(cycle.before.owned.gangwaySurfaces === 1, `${label}: real gangway was not drawn`);
    require(cycle.before.selection.depthTest === true && cycle.before.selection.depthWrite === false, `${label}: markers bypass normal depth testing`);
    require(cycle.interactionProofs.length === 12, `${label}: incomplete real-render interaction coverage`);
    for (const zone of ['ground', 'deck', 'hull']) for (const role of ['own', 'ally', 'enemy']) {
      require(cycle.interactionProofs.some(proof => proof.hover?.zone === zone && proof.hover.role === role && proof.hover.selected === false), `${label}: missing hover-only ${role} ${zone} proof`);
    }
    require(cycle.interactionProofs.some(proof => proof.hover?.zone === 'bridge' && proof.hover.selected === false), `${label}: missing hover-only sloped bridge crew proof`);
    for (const proof of cycle.interactionProofs) {
      require(['own', 'ally', 'enemy'].every(role => proof.roles.includes(role)), `${label}: actual marker instances lack relation colors`);
      require(['ground', 'deck', 'hull', 'bridge'].every(zone => proof.zones.includes(zone)), `${label}: actual marker instances lack a floor type`);
    }
    for (const kind of ['materials', 'surfaceGeometry', 'hullGeometry', 'instanceMeshes', 'instanceGeometry']) {
      const count = cycle.markerResourcesAfter[kind];
      require(count?.allocated > 0 && count.disposed === count.allocated && count.live === 0, `${label}: ${kind} has missing or incomplete disposal events`);
    }
    emptyMaps(cycle.after.owned, `${label} layer teardown`);
    require(cycle.after.transforms === 0 && cycle.after.sceneChildren === 0 && cycle.after.selection.instances === 0 && cycle.after.selection.disposed === true, `${label}: retained disposed layer still owns scene state`);
    require(cycle.resources.home.failed === 0 && cycle.resources.match.failed === 0, `${label}: resource loader contains failed entries`);
    require(cycle.resources.retainedRawBytes === 0 && cycle.resources.cacheStats.retainedBytes === 0, `${label}: decoded resources retain raw request bytes`);
    require(cycle.resources.cacheStats.active === 0 && cycle.resources.cacheStats.queued === 0, `${label}: resource requests did not settle`);
  }
  require(result.teardown.retainedDisposedLayers === 1, 'Disposed layer references were not all retained for the release check');
  for (const [index, layer] of result.teardown.ownedMaps.entries()) emptyMaps(layer.owned, `Application teardown layer ${index}`);
  emptyMaps(result.teardown.sharedAfter, 'Application shared-model teardown');
  emptyMaps(result.teardown.resources.owned, 'Application request/decode teardown');
  require(result.teardown.resources.cacheStats.active === 0 && result.teardown.resources.cacheStats.queued === 0, 'Application teardown retains pending resource work');
  require(result.teardown.portraitProviderCleared === true, 'Application teardown retains the installed UI portrait provider');
  return { passed: violations.length === 0, violations, expectedModelCount: expected.size, modelHttpCounts: httpCounts };
}
try {
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Runtime benchmark</title><style>body{margin:0;background:#182526}canvas{display:block;width:1280px;height:720px}</style><canvas id="world"></canvas><script type="module" src="/@fs${root}/scripts/.art-76356-fixture.js"></script>`);
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(root, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(root) },
    plugins: [{name:'art-profile-source',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/src/client/world3d/painted-card-batches.ts'))return {code:"import { ART_TILE_SIZE } from '../art/raster-cache';\nimport * as THREE from 'three';\nimport {SHIP_CAMERA} from '../../shared/ship-geometry';\n\nconst LAYERS=16,PIXEL_BUDGET=12*1024*1024,TILT=Math.tan(SHIP_CAMERA.tilt);\ntype Request={key:string;density:number;paint:(ctx:CanvasRenderingContext2D)=>void;matrix:THREE.Matrix4;id:string;foot:number;tileSize:number};\ntype Card={key:string;page:Page;layer:number;used:number;x:number;y:number;width:number;height:number};\ntype Page={texture:THREE.DataArrayTexture;cards:(Card|undefined)[];geometry:THREE.PlaneGeometry;material:THREE.MeshBasicMaterial;depth:THREE.MeshDepthMaterial;distance:THREE.MeshDistanceMaterial;mesh?:THREE.InstancedMesh;capacity:number;ids:string[];entries:Card[];matrices:THREE.Matrix4[];feet:number[];used:number};\n\n/** Each layer has its own full-resolution mip chain: unlike a packed atlas,\n * filtering cannot borrow another pose's pixels. Stock cutout materials retain\n * Three's color handling, depth and shadow passes. */\nexport function patchCardShader(shader:{vertexShader:string;fragmentShader:string}){\n  shader.vertexShader='attribute float cardLayer;\\nvarying float vCardLayer;\\n'+shader.vertexShader;\n  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\\nvCardLayer = cardLayer;');\n  shader.fragmentShader='precision highp sampler2DArray;\\nvarying float vCardLayer;\\n'+shader.fragmentShader;\n  shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','uniform highp sampler2DArray map;');\n  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');\n}\nfunction configure(material:THREE.Material){material.onBeforeCompile=patchCardShader;material.customProgramCacheKey=()=> 'painted-card-array-v1';}\n\n/** Renderer-owned card cache and batches. Animation/color/facing vary per\n * instance, not per draw call. No canvas, GPU texture or material per soldier. */\nexport class PaintedCardBatches {\n  private pages:Page[]=[];\n  private cards=new Map<string,Card>();\n  private frame=0;\n  private pending:Request[]=[];\n  private rasterizations=0;\n  private copiedLayers=0;\n  private matrix=new THREE.Matrix4();\n  private offset=new THREE.Matrix4();\n  private canvases=new Map<number,HTMLCanvasElement>();\n  constructor(private scene:THREE.Scene,private anisotropy:number){}\n  begin(){this.frame++;this.pending.length=0;for(const page of this.pages){page.ids.length=page.entries.length=page.matrices.length=page.feet.length=0;}}\n  private createPage(width:number,height:number){\n    const texture=new THREE.DataArrayTexture(new Uint8Array(width*height*4*LAYERS),width,height,LAYERS);\n    texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=this.anisotropy;\n    const material=new THREE.MeshBasicMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,toneMapped:false});\n    const depth=new THREE.MeshDepthMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking});\n    const distance=new THREE.MeshDistanceMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide});\n    for(const item of [material,depth,distance])configure(item);\n    const page:Page={texture,cards:new Array(LAYERS),geometry:new THREE.PlaneGeometry(1,1),material,depth,distance,capacity:0,ids:[],entries:[],matrices:[],feet:[],used:this.frame};\n    this.pages.push(page);return page;\n  }\n  private slot(width:number,height:number){\n    let oldest:Card|undefined;\n    for(const page of this.pages){\n      if(page.texture.image.width!==width||page.texture.image.height!==height)continue;\n      for(let layer=0;layer<LAYERS;layer++){\n        const card=page.cards[layer];if(!card)return{page,layer};\n        if(card.used!==this.frame&&(!oldest||card.used<oldest.used))oldest=card;\n      }\n    }\n    // Keep a bounded warm cache, but never evict a card referenced by this\n    // frame. Large visible armies may legitimately exceed the soft budget.\n    if(oldest&&this.stats().pixels>=PIXEL_BUDGET){this.cards.delete(oldest.key);return{page:oldest.page,layer:oldest.layer};}\n    return{page:this.createPage(width,height),layer:0};\n  }\n  add(key:string,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,matrix:THREE.Matrix4,id:string,foot:number,tileSize:number=ART_TILE_SIZE){\n    key=`${key}:${density}:${tileSize}`;\n    const card=this.cards.get(key);\n    // Protect every warm pose used this frame before allocating any new one.\n    // Otherwise one early cache miss can evict a later visible pose, cascading\n    // into a full rerasterization of an army larger than the soft budget.\n    if(card){this.instance(card,matrix,id,foot);return;}\n    this.pending.push({key,density,paint,matrix,id,foot,tileSize});\n  }\n  private instance(card:Card,matrix:THREE.Matrix4,id:string,foot:number){\n    card.used=card.page.used=this.frame;\n    const page=card.page;page.ids.push(id);page.entries.push(card);page.matrices.push(matrix);page.feet.push(foot);\n  }\n  private raster({key,density,paint,matrix,id,foot,tileSize}:Request){\n    let card=this.cards.get(key);\n    if(!card){\n      const size=tileSize*density;\n      let canvas=this.canvases.get(size);if(!canvas){canvas=document.createElement('canvas');canvas.width=canvas.height=size;this.canvases.set(size,canvas);}\n      const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(density,density);ctx.translate(tileSize/2,tileSize/2);paint(ctx);ctx.restore();\n      // This RGBA buffer is also the precise picking mask; do not allocate a\n      // second per-pose alpha image or retain the rasterization canvas.\n      const rgba=ctx.getImageData(0,0,size,size).data;\n      const bounds=(window as any).__artProfileStage?.timed('boundsMs',()=>cardBounds(rgba,size))??cardBounds(rgba,size),{page,layer}=this.slot(bounds.width,bounds.height);\n      const pixels=page.texture.image.data as Uint8Array,base=layer*bounds.width*bounds.height*4,row=bounds.width*4;\n      // Match CanvasTexture's UNPACK_FLIP_Y at upload time, rather than\n      // subtracting interpolated UVs in the fragment shader at cutout edges.\n      const __artCopyStart=performance.now();pixels.fill(0,base,base+bounds.width*bounds.height*4);\n      const copiedWidth=Math.min(bounds.width,size-bounds.left),copiedHeight=Math.min(bounds.height,size-bounds.top);\n      for(let y=0;y<copiedHeight;y++){\n        const source=((bounds.top+y)*size+bounds.left)*4;\n        pixels.set(rgba.subarray(source,source+copiedWidth*4),base+(bounds.height-1-y)*row);\n      }\n      (window as any).__artProfileStage?.add('copyMs',performance.now()-__artCopyStart);page.texture.addLayerUpdate(layer);page.texture.needsUpdate=true;this.rasterizations++;\n      card={key,page,layer,used:this.frame,x:(bounds.left+bounds.width/2)/density-tileSize/2,y:(bounds.top+bounds.height/2)/density-tileSize/2,width:bounds.width/density,height:bounds.height/density};page.cards[layer]=card;this.cards.set(key,card);\n    }\n    this.instance(card,matrix,id,foot);\n  }\n  private compact(){\n    if(this.stats().pixels<=PIXEL_BUDGET)return;\n    const sizes=new Set(this.pages.map(page=>`${page.texture.image.width}:${page.texture.image.height}`));\n    for(const size of sizes){\n      const [width,height]=size.split(':').map(Number) as [number,number];\n      const pages=this.pages.filter(page=>page.texture.image.width===width&&page.texture.image.height===height);\n      const active=pages.flatMap(page=>page.cards.filter((card):card is Card=>Boolean(card&&card.used===this.frame)));\n      const needed=Math.ceil(active.length/LAYERS);\n      // Only repair severe fragmentation, e.g. a large army leaving ten\n      // survivors spread across ten old pages. Do not repack normal animation\n      // churn or briefly exceed the working set's necessary page count.\n      if(!needed||needed*2>pages.length)continue;\n      const moved=new Map<Card,Card>();let destination:Page|undefined;\n      for(let i=0;i<active.length;i++){\n        const old=active[i]!,layer=i%LAYERS;if(layer===0)destination=this.createPage(width,height);\n        const page=destination!,card={...old,page,layer,used:this.frame};\n        const bytes=width*height*4,source=old.page.texture.image.data as Uint8Array;\n        (page.texture.image.data as Uint8Array).set(source.subarray(old.layer*bytes,(old.layer+1)*bytes),layer*bytes);\n        page.texture.addLayerUpdate(layer);page.texture.needsUpdate=true;page.cards[layer]=card;this.cards.set(card.key,card);moved.set(old,card);this.copiedLayers++;\n      }\n      for(const old of pages){\n        for(let i=0;i<old.entries.length;i++){\n          const card=moved.get(old.entries[i]!)!;const page=card.page;\n          page.ids.push(old.ids[i]!);page.entries.push(card);page.matrices.push(old.matrices[i]!);page.feet.push(old.feet[i]!);\n        }\n        this.remove(old);\n      }\n    }\n  }\n  finish(){\n    for(const request of this.pending)this.raster(request);this.pending.length=0;\n    this.compact();\n    for(const page of [...this.pages]){\n      const count=page.ids.length;\n      if(!count){if(page.mesh){page.mesh.count=0;page.mesh.visible=false;}if(this.frame-page.used>120||this.stats().pixels>PIXEL_BUDGET)this.remove(page);continue;}\n      if(count>page.capacity){\n        if(page.mesh){this.scene.remove(page.mesh);page.mesh.dispose();page.geometry.dispose();}\n        page.capacity=2**Math.ceil(Math.log2(count));\n        page.geometry.setAttribute('cardLayer',new THREE.InstancedBufferAttribute(new Float32Array(page.capacity),1).setUsage(THREE.DynamicDrawUsage));\n        const mesh=page.mesh=new THREE.InstancedMesh(page.geometry,page.material,page.capacity);\n        mesh.name='PaintedCards';mesh.castShadow=true;mesh.receiveShadow=true;mesh.customDepthMaterial=page.depth;mesh.customDistanceMaterial=page.distance;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);\n        mesh.userData.ids=page.ids;mesh.userData.paintedHit=(index:number,uv?:{x:number;y:number})=>this.hit(page,index,uv);\n        this.scene.add(mesh);\n      }\n      const mesh=page.mesh!,layers=page.geometry.getAttribute('cardLayer');mesh.count=count;mesh.visible=true;\n      for(let i=0;i<count;i++){\n        const card=page.entries[i]!;\n        this.offset.makeScale(card.width,card.height/TILT,1).setPosition(card.x,(page.feet[i]!-card.y)/TILT,0);\n        mesh.setMatrixAt(i,this.matrix.copy(page.matrices[i]!).multiply(this.offset));\n        layers.setX(i,page.entries[i]!.layer);\n      }\n      layers.needsUpdate=mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();\n    }\n  }\n  private hit(page:Page,index:number,uv?:{x:number;y:number}){\n    const card=page.entries[index];if(!card||!uv)return false;\n    const {width,height}=page.texture.image,x=Math.min(width-1,Math.max(0,Math.floor(uv.x*width))),y=Math.min(height-1,Math.max(0,Math.floor(uv.y*height)));\n    return page.texture.image.data![(card.layer*width*height+y*width+x)*4+3]!>=102;\n  }\n  objects(){return this.pages.flatMap(page=>page.mesh?.visible?[page.mesh]:[]);}\n  // Texture storage estimates only (not total process/GPU memory). GPU mip\n  // allocation uses a complete chain; scratch canvases and instance buffers\n  // are separately owned and released by dispose().\n  stats(){const pixels=this.pages.reduce((n,page)=>n+page.texture.image.width*page.texture.image.height*LAYERS,0);return{pages:this.pages.length,cards:this.cards.size,pixels,cpuBytes:pixels*4,gpuBytes:Math.ceil(pixels*4*4/3),rasterizations:this.rasterizations,copiedLayers:this.copiedLayers};}\n  private remove(page:Page){for(const card of page.cards)if(card&&this.cards.get(card.key)===card)this.cards.delete(card.key);if(page.mesh){this.scene.remove(page.mesh);page.mesh.dispose();}page.geometry.dispose();page.texture.dispose();page.material.dispose();page.depth.dispose();page.distance.dispose();this.pages.splice(this.pages.indexOf(page),1);}\n  dispose(){for(const page of [...this.pages])this.remove(page);this.canvases.clear();this.pending.length=0;}\n}\n\n/** Remove transparent padding, never rescale painted texels. Eight clear texels\n * and an eight-texel aligned origin preserve the useful cutout/mipmap border.\n * Rectangular power-of-two buckets keep array pages shareable across poses. */\nfunction cardBounds(rgba:Uint8ClampedArray,size:number){\n  let left=size,top=size,right=-1,bottom=-1;\n  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(rgba[(y*size+x)*4+3]){\n    if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y;\n  }\n  if(right<left)return{left:0,top:0,width:16,height:16};\n  left=Math.max(0,Math.floor((left-8)/8)*8);top=Math.max(0,Math.floor((top-8)/8)*8);\n  right=Math.min(size-1,right+8);bottom=Math.min(size-1,bottom+8);\n  return{left,top,width:2**Math.ceil(Math.log2(right-left+1)),height:2**Math.ceil(Math.log2(bottom-top+1))};\n}\n",map:null};}},{ name: 'benchmark-resource-manifest', configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next();
      try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(root, 'public')))); } catch (error) { next(error); }
    }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } } });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port');
  browser = spawn(arg('--chromium') || process.env.CHROMIUM_PATH || '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chromium startup exceeded 30 seconds')), 30000);
    browser.once('error', error => { clearTimeout(timeout); reject(error); });
    browser.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chromium exited before DevTools opened (${code})`)); });
    browser.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolveEndpoint(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
  let serial = 0;
  const pending = new Map(), listeners = new Set(), urls = new Map();
  socket.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.id) { const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timeout); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); return; }
    for (const listener of listeners) listener(message);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.args[0]?.value?.startsWith?.('ART ')) { const values=message.params.args.map(arg=>arg.value); console.log(values.join(' ')); if(values[0]==='ART sample')artTrace.push({cycle:values[1],frame:values[2],fencedMs:values[3],submissionMs:values[4]}); } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '));
    if (message.method === 'Network.requestWillBeSent') urls.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.responseReceived' && /\.glb(?:\?|$)/.test(message.params.response.url)) requests.push({ url: message.params.response.url, status: message.params.response.status });
    if (message.method === 'Network.loadingFailed') failed.push({ url: urls.get(message.params.requestId), error: message.params.errorText });
  });
  socket.on('close', () => { for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('DevTools connection closed')); } pending.clear(); });
  const command = (method, params = {}, sessionId) => new Promise((resolveRequest, reject) => {
    const id = ++serial, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools command timed out: ${method}`)); }, 300000);
    pending.set(id, { resolve: resolveRequest, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  await command('Target.activateTarget', { targetId });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const pageCommand = (method, params) => command(method, params, sessionId);
  await pageCommand('Page.enable'); await pageCommand('Runtime.enable'); await pageCommand('Network.enable');
  await pageCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  let loadListener, loadTimeout;
  const loaded = new Promise((resolveLoaded, reject) => {
    loadListener = event => { if (event.method === 'Page.loadEventFired' && event.sessionId === sessionId) resolveLoaded(); };
    listeners.add(loadListener); loadTimeout = setTimeout(() => reject(new Error('Page navigation exceeded 30 seconds')), 30000);
  });
  try { await Promise.all([pageCommand('Page.navigate', { url: `http://127.0.0.1:${address.port}` }), loaded]); }
  finally { clearTimeout(loadTimeout); listeners.delete(loadListener); }
  const evaluate = async expression => {
    const result = await pageCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await evaluate(`new Promise((resolve,reject)=>{const deadline=performance.now()+60000;const check=()=>{if(window.runtimeReview?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error('Fixture initialization timed out'));setTimeout(check,20)};check()})`);
  for (let index = 0; index < 1; index++) {
    await pageCommand("Profiler.enable");await pageCommand("Profiler.setSamplingInterval",{interval:1000});const profileClock=await evaluate("performance.now()");await pageCommand("Profiler.start");
    const cycle = await evaluate(`window.runtimeReview.cycle(${index})`);
    const profile=await pageCommand("Profiler.stop");await writeFile("/workspace/sketch-rts/docs/art/refactor/followup/performance/9de6820-split/cpu-profile.json",JSON.stringify({clockBeforeStartMs:profileClock,...profile}));
    await pageCommand('HeapProfiler.collectGarbage'); cycle.heapAfterGc = await pageCommand('Runtime.getHeapUsage'); cycles.push(cycle); console.log(JSON.stringify({artCycle:index,artTiming:cycle.artTiming?.fullDrawFenced,modes:cycle.artTiming?.renderer?.animationModes,visible:cycle.artTiming?.renderer?.visibleUnitCounts?.at(-1)}));
  }
  const teardown = await evaluate('window.runtimeReview.teardown()'); await pageCommand('HeapProfiler.collectGarbage');
  const sourceFiles = ['scripts/.art-76356-fixture.js', 'scripts/browser-runtime-benchmark.mjs', 'src/client/world3d/world-layer.ts', 'src/client/world3d/selection-markers.ts', 'src/client/world3d/model-library.ts', 'src/client/world3d/model-portraits.ts', 'src/client/resources.ts', 'src/client/main.ts', 'src/client/unit-hover-target.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(resolve(root, file))).digest('hex')])));
  const result = { finalArt: true, finalArtMethod: "Opt-in production combat/projectile trackers in the unchanged static or dynamic WebGL sample loop; measured counter collection runs after fenced timing. Per-cycle renderer.finalArt reports rules/catalog, event coverage, instance exposure and explicit unavailable measurements.", artSourceCommit: "9de6820873367c06401cdfa4d8938aa17e78f199", artScene: "dynamic-1000", artMeasuredUnits: 1000, artMeasuredShips: 0, renderer: 'Chromium SwiftShader', browser: await command('Browser.getVersion'), node: process.version, units: 280, ships: 24, viewport: { width: 1280, height: 720 }, sourceSha256,
    artMethod: 'Each of three layer lifetimes adds 4 warmup and 12 full real WebGL draws (sim ticks 20-31), 36 samples total; too few to infer stable p99; 1000-unit real simulation replay, all selected, deterministic 50ms tick timestamps, 1280x720 DPR1; gl.finish fences software GPU completion. FullDrawFenced includes CPU scene updates, WebGL submission and SwiftShader completion. CpuSubmission excludes finish. No simulation runs in this fixture; do not report these as hardware FPS.', method: 'Three dynamic cycles; ten real-WebGL hover-only cases per cycle for own/ally/enemy ground troops, deck crew and hulls plus sloped bridge crew, with per-instance position/color/height/stroke checks; real full-selection draws before/after CPU samples. 120 fixed-snapshot full-selection and 120 fresh-tick alternating-selection CPU draws per cycle; renderer.render disabled only during CPU timing, excluding GPU work. All disposed layer references retained intentionally to verify explicit release; GC requested through CDP. Teardown follows main.ts layer, request/decode, portrait and shared-model ordering. CPU samples are not device FPS.',
    errors, failed, requests, cycles, teardown, heapAfterTeardown: await pageCommand('Runtime.getHeapUsage') };
  result.validation = validate(result);
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  wroteResult = true;
  if (arg('--screenshot')) { const screenshot = await evaluate('window.runtimeReview.dynamicScreenshot'); await writeFile(resolve(arg('--screenshot')), Buffer.from(screenshot.split(',')[1], 'base64')); }
  if (!result.validation.passed) throw new Error(JSON.stringify(result.validation.violations));
  console.log(JSON.stringify({ output, passed: true, realRenderInteractionCases: cycles.reduce((sum, cycle) => sum + cycle.interactionProofs.length, 0), modelHttpRequests: requests.length, modelsInstalled: cycles.at(-1).after.installedModels, markerResourcesAfter: cycles.map(cycle => cycle.markerResourcesAfter), heapAfterGc: cycles.map(cycle => cycle.heapAfterGc.usedSize), cpu: cycles.map(cycle => ({ static: cycle.staticCpu.meanMs, updated: cycle.updatedCpu.meanMs })) }));
} catch (error) {
  if (!wroteResult) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ validation: { passed: false, violations: [String(error)] }, errors, failed, requests, completedCycles: cycles, artTrace }, null, 2) + '\n');
  }
  throw error;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise(resolveClosed => { browser.once('exit', resolveClosed); setTimeout(resolveClosed, 5000).unref(); }); browser.kill(); await closed;
  }
  await server?.close(); await rm(scratch, { recursive: true, force: true });
}
