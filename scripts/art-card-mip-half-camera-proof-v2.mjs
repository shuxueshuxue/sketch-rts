import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';
import { createMipHalfProviders, prepareMipHalfDependencyRoot, mipHalfOptimizeDepsV2 } from './art-card-mip-half-provider-v2.mjs';

const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gateMode=arg('--mode')??'candidate';
if(!['reference','production','candidate'].includes(gateMode))throw new Error('Use --mode reference|production|candidate');
const maxBanks = Number(arg('--max-banks') ?? 1), mipMode = arg('--mips') ?? 'native';
if(maxBanks!==1||mipMode!=='native')throw new Error('Half-margin proof keeps production one-bank implicit sampling; residency is selected by complete gate providers only');
if (!Number.isInteger(maxBanks) || maxBanks < 1 || maxBanks > 8 || !['native', 'full'].includes(mipMode)) throw new Error('Use --max-banks 1..8 and --mips native|full');
const variant = { name: arg('--variant') ?? `mip-half-${gateMode}`, maxBanks, mips: mipMode,
  ordering: 'production stable snapshot ordering', referenceOverrides: mipMode === 'full' ? ['residentMip returns 0'] : [] };
const fixtureName = 'art-card-bank-camera-fixture.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const zooms = [.35, .65, .75, 1, 1.5, 2];
const plan = [];
for (const dpr of [1, 2]) for (const [width, height] of [[1280, 720], [640, 360]]) for (const zoom of zooms) {
  plan.push({ label: `dpr-${dpr}-${width}x${height}-zoom-${String(zoom).replace('.', 'p')}`, width, height, zoom, dpr });
}
plan.push(
  { label: 'camera-battlefield', width: 1280, height: 720, zoom: .75, dpr: 1 },
  { label: 'camera-empty', width: 1280, height: 720, zoom: .75, dpr: 1, empty: true },
  { label: 'camera-returned-first', width: 1280, height: 720, zoom: .75, dpr: 1 },
  { label: 'promotion-high-initial', width: 1280, height: 720, zoom: 2, dpr: 1 },
  { label: 'promotion-low', width: 1280, height: 720, zoom: .75, dpr: 1 },
  { label: 'promotion-high-first', width: 1280, height: 720, zoom: 2, dpr: 1 },
  { label: 'promotion-high-repeat', width: 1280, height: 720, zoom: 2, dpr: 1 },
);

// Decode the browser's native PNG pixels without a Canvas premultiply /
// unpremultiply round trip. Browser captures are noninterlaced 8-bit RGB/RGBA.
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
async function compareProofs(beforePath, afterPath) {
  const before = JSON.parse(await readFile(beforePath, 'utf8')), after = JSON.parse(await readFile(afterPath, 'utf8'));
  const results = [], violations = [], matched = new Set();
  if (!before.completed || !after.completed || !before.validation?.passed || !after.validation?.passed) violations.push('A source proof is incomplete or invalid');
  for(const [label,proof] of [['before',before],['after',after]]){
    const gate=proof.gateIsolation;
    if(!gate?.sourceStayedFrozen||!gate?.candidateStayedFrozen||!gate?.helpersStayedFrozen||!gate?.dependencyPreparation?.stayedStable||!gate?.candidateExactSingleExpressionDifference||gate?.sameContextThreeResolvedIds?.length!==1||!gate?.runtime?.balancedCompleteProvidersLoadedBeforeInit||gate?.runtime?.perFrameOverrides)violations.push(label+' gate/module isolation invalid');
  }
  if(!['reference','production'].includes(before.gateIsolation?.mode)||after.gateIsolation?.mode!=='candidate')violations.push('Compare full-reference or production-native against candidate-half-native');
  if(before.providerHelperSha256!==after.providerHelperSha256||before.parentHarnessSha256!==after.parentHarnessSha256||JSON.stringify(before.gateIsolation?.sourceSha256)!==JSON.stringify(after.gateIsolation?.sourceSha256)||before.gateIsolation?.sourcePublicTree!==after.gateIsolation?.sourcePublicTree)violations.push('Provider helper or frozen full source/public differs');
  if (before.variantHelperSha256 !== after.variantHelperSha256 || before.factFixtureSha256 !== after.factFixtureSha256 || before.fixtureSha256 !== after.fixtureSha256 || before.harnessSha256 !== after.harnessSha256) violations.push('Before/after fixture or harness differs');
  if (before.sourceCommit !== after.sourceCommit || before.sourceGitDiffSha256 !== after.sourceGitDiffSha256 || JSON.stringify(before.allClientSourceSha256) !== JSON.stringify(after.allClientSourceSha256)) violations.push('Bank/mip configurations must use the same frozen production client source');
  if (before.init.snapshotSha256 !== after.init.snapshotSha256 || before.init.now !== after.init.now) violations.push('Before/after initial held facts or clock differ');
  for (const a of before.steps) {
    const b = after.steps.find(step => step.label === a.label);
    if (!b) { violations.push(`Missing after step ${a.label}`); continue; }
    matched.add(a.label);
    const item = { label: a.label, inputEqual: JSON.stringify(a.input) === JSON.stringify(b.input),
      factsEqual: a.snapshotBeforeSha256 === b.snapshotBeforeSha256 && a.snapshotAfterSha256 === b.snapshotAfterSha256,
      clockEqual: a.nowBefore === b.nowBefore && a.nowAfter === b.nowAfter,
      picksEqual: JSON.stringify(a.picks) === JSON.stringify(b.picks),
      actorDrawingBufferEqual: a.screenshots.actorDrawingBufferRgbaSha256 === b.screenshots.actorDrawingBufferRgbaSha256,
      compositeCaptureEqual: a.screenshots.compositeRgbaSha256 === b.screenshots.compositeRgbaSha256, images: {} };
    for (const type of ['actors', 'composite']) {
      const aa = decodePng(await readFile(resolve(dirname(beforePath), a.screenshots[type].path))),
        bb = decodePng(await readFile(resolve(dirname(afterPath), b.screenshots[type].path)));
      item.images[type] = rgbaDifference(aa, bb);
      if (!item.images[type].identical) violations.push(`${a.label} ${type} pixels differ`);
    }
    for (const key of ['inputEqual', 'factsEqual', 'clockEqual', 'picksEqual', 'actorDrawingBufferEqual', 'compositeCaptureEqual']) {
      if (!item[key]) violations.push(`${a.label} ${key} failed`);
    }
    results.push(item);
  }
  if (matched.size !== after.steps.length) violations.push('After proof has additional or duplicate steps');
  return { before: beforePath, after: afterPath, beforeVariant: before.variant, afterVariant: after.variant,beforeGateMode:before.gateIsolation?.mode,afterGateMode:after.gateIsolation?.mode, beforeCommit: before.sourceCommit, afterCommit: after.sourceCommit,
    steps: results, validation: { passed: !violations.length, violations },
    method: 'Strict per-channel RGBA comparison of native-resolution browser PNGs using a noninterlaced PNG decoder, plus SHA equality of untouched WebGL readPixels drawing-buffer RGBA, browser composite RGBA, authoritative held snapshots, clocks and production alpha-mask picking probes. No tolerance or downsampling.' };
}
const compareBefore = arg('--compare'), compareAfter = arg('--with');
if (compareBefore && compareAfter) {
  const output = resolve(arg('--out') ?? 'work/card-mip-camera-comparison.json');
  const result = await compareProofs(resolve(compareBefore), resolve(compareAfter));
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, passed: result.validation.passed, steps: result.steps.length, violations: result.validation.violations }));
  if (!result.validation.passed) process.exitCode = 1;
} else {
  const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? `docs/art/refactor/followup/card-streaming/stall-followup/mip-half-camera-v2/${gateMode}/proof.json`);
  const outputDir = dirname(output);
  await mkdir(dirname(outputDir),{recursive:true});await mkdir(outputDir); // Never overwrite previous evidence.
  const scratch = await mkdtemp('/tmp/sketch-card-mip-half-camera-v2-');
  let gateProviders;
  const providerHelperBytes=await readFile(resolve(harnessRoot,'scripts/art-card-mip-half-provider-v2.mjs'));
  const parentHarnessBytes=await readFile(resolve(harnessRoot,'scripts/art-card-bank-camera-proof.mjs'));
  const candidateSource=resolve(arg('--candidate-source')??'/tmp/card-mip-half-margin-candidate.ts');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const clientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
  const sourceGitDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot }));
  const allClientSourceSha256 = Object.fromEntries(await Promise.all(clientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
  const factFixture = await readFile(resolve(harnessRoot, 'scripts/art-card-mip-camera-fixture.js'));
  const fixtureBytes = await readFile(resolve(harnessRoot, 'scripts', fixtureName)), harnessBytes = await readFile(fileURLToPath(import.meta.url));
  const steps = [], errors = [], failed = []; let server, browser, socket, init;
  const writeOutput = async extra => {
    await mkdir(outputDir, { recursive: true });
    await writeFile(output, JSON.stringify({ gateIsolation:gateProviders?.metadata,providerHelperSha256:hash(providerHelperBytes),parentHarnessSha256:hash(parentHarnessBytes), variant, variantHelperSha256: hash(variantHelper), factFixtureSha256: hash(factFixture), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }),
      sourceGitDiffSha256, allClientSourceSha256, fixtureName, fixtureSha256: hash(fixtureBytes), harnessSha256: hash(harnessBytes),
      plan, init, steps, errors, failed, ...extra }, null, 2) + '\n');
  };
  try {
    gateProviders=await createMipHalfProviders({sourceRoot,harnessRoot,candidateSource,mode:gateMode,scratch,outputDir});
    await gateProviders.archive();
    await writeFile(resolve(outputDir,'provider-helper.mjs'),providerHelperBytes);
    await writeFile(resolve(outputDir,'parent-camera-harness.mjs'),parentHarnessBytes);
    await mkdir(outputDir, { recursive: true }); await writeFile(resolve(outputDir, 'camera-fixture.js'), fixtureBytes); await writeFile(resolve(outputDir, 'camera-harness.mjs'), harnessBytes); await writeFile(resolve(outputDir, 'bank-variant.js'), variantHelper); await writeFile(resolve(outputDir, 'camera-facts.js'), factFixture);
    await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Card mip camera correctness</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`);
    const dependencyRoot=await prepareMipHalfDependencyRoot(scratch,sourceRoot);
    server = await createServer({ configFile: false, root: scratch, optimizeDeps:mipHalfOptimizeDepsV2(), publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant) },
      plugins: [gateProviders.plugin, { name: 'mip-camera-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot,...gateProviders.allowed] } } });
    await server.listen();
    await gateProviders.inspectStartup(server,dependencyRoot);
    await writeOutput({completed:false,dependencyPreparationComplete:true});
    const address = server.httpServer.address();
    browser = spawn(arg('--chromium') ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((done, reject) => { const timeout = setTimeout(() => reject(new Error('Chromium startup timeout')), 30000); browser.once('error', reject); browser.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); done(match[1]); } }); });
    socket = new WebSocket(endpoint); await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
    let serial = 0; const pending = new Map();
    socket.on('message', data => {
      const message = JSON.parse(String(data));
      if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.done(message.result); return; }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method === 'Network.loadingFailed') failed.push(message.params.errorText);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    });
    const command = (method, params = {}, sessionId) => new Promise((done, reject) => { const id = ++serial, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 600000); pending.set(id, { done, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' }), { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => command(method, params, sessionId);
    const evaluate = async expression => { const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
    await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
    await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url: `http://127.0.0.1:${address.port}` });
    await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+60000;const check=()=>{if(window.mipCameraReview?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error("Camera fixture init timeout"));setTimeout(check,20)};check()})');
    const browserVersion = await command('Browser.getVersion');
    await gateProviders.inspectRuntime(evaluate);
    init = await evaluate('window.mipCameraReview.init()');
    if(init.variantSetups.some(setup=>setup.mips!=='native'||setup.maxBanks!==1))throw new Error('Original bank helper changed sampling or residency method');
    await writeOutput({ browserVersion, completed: false });
    for (const item of plan) {
      console.log(`CAMERA ${sourceCommit.slice(0, 8)} ${item.label}`);
      await page('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: item.dpr, mobile: false });
      const result = await evaluate(`window.mipCameraReview.step(${JSON.stringify(item)})`);
      const images = result.screenshots;
      for (const [type, key] of [['actors', 'actorsPng'], ['composite', 'compositePng']]) {
        const bytes = Buffer.from(images[key].split(',')[1], 'base64'), filename = `${item.label}-${type}.png`;
        const decoded = decodePng(bytes);
        if (decoded.width !== result.physical.width || decoded.height !== result.physical.height) throw new Error(`PNG physical size mismatch at ${item.label}`);
        await writeFile(resolve(outputDir, filename), bytes); delete images[key];
        images[type] = { path: filename, pngSha256: hash(bytes), rgbaSha256: hash(decoded.rgba), width: decoded.width, height: decoded.height };
      }
      steps.push(result); await writeOutput({ browserVersion, completed: false });
    }
    const disposed = await evaluate('window.mipCameraReview.dispose()');
    await page('HeapProfiler.collectGarbage'); const heapAfterDispose = await page('Runtime.getHeapUsage');
    await evaluate('window.mipCameraReview.teardown()'); await page('HeapProfiler.collectGarbage'); const heapAfterTeardown = await page('Runtime.getHeapUsage');
    await gateProviders.finish(server);
    const violations = [...errors, ...failed];
    for (const step of steps) if (!step.unchanged || step.glError !== 0 || step.dpr !== step.input.dpr || step.physical.width !== step.input.width * step.input.dpr || step.physical.height !== step.input.height * step.input.dpr) violations.push(`Invalid step ${step.label}`);
    if (!disposed.disposed) violations.push('WorldPresentation did not dispose');
    const find = label => steps.find(step => step.label === label);
    const sameCapture = (a, b) => ['actorDrawingBufferRgbaSha256', 'compositeRgbaSha256'].every(key => a.screenshots[key] === b.screenshots[key]);
    const returnIdentical = sameCapture(find('camera-battlefield'), find('camera-returned-first'));
    const promotionFirstIdentical = sameCapture(find('promotion-high-initial'), find('promotion-high-first'));
    const promotionRepeatIdentical = sameCapture(find('promotion-high-first'), find('promotion-high-repeat'));
    if (!returnIdentical) violations.push('Camera return changed frozen pixels');
    if (!promotionFirstIdentical || !promotionRepeatIdentical) violations.push('Zoom promotion first frame changed frozen high-zoom pixels');
    await writeOutput({ browserVersion, completed: true, disposed, heapAfterDispose, heapAfterTeardown,
      invariants: { returnIdentical, promotionFirstIdentical, promotionRepeatIdentical }, validation: { passed: !violations.length, violations },
      method: 'Independent 8345 full-reference or production-native versus external half-margin gate correctness only. Complete Vite pre-resolved gate providers; balanced module preparation before init, no per-frame wrapper. One-bank implicit sampler, original shaders/geometry/poses/inputs and exact 31-camera fixture bytes remain unchanged. Half-level filtering is implementation dependent; this proof does not claim portable pixel equivalence or hardware speed. Warm finer cards are not demoted. Same-source configured stable-order bank/mip correctness only. Variant setup during World3DLayer.create occurs before prepare/first draw. No per-frame pose/key observation. Legacy cache-dependent ordering is preserved as historical failed evidence, not the visual oracle. One held mixed 100-unit / 20-kind scene, deterministic cast/attack/carry and blood histories. 24 zoom / real-CDP-DPR / window-size combinations, empty camera return, high-low-high mip-promotion first-frame and repeat probes. Exactly one production WorldPresentation draw per step, followed by WebGL fence completion. Native physical-resolution actor PNG (including rendered shadow alpha), full-resolution ground+actors+HUD composite PNG, untouched drawing-buffer RGBA SHA, exact PNG RGBA SHA, source hashes, retained resource counters, production picking and frozen fact/clock hashes. No presentation performance or hardware-FPS claims.' });
    if (violations.length) throw new Error(violations.join('\n'));
    console.log(JSON.stringify({ output, sourceCommit, steps: steps.length, passed: true, invariants: { returnIdentical, promotionFirstIdentical, promotionRepeatIdentical } }));
  } catch (error) { await writeOutput({ completed: false, failure: String(error) }); throw error; }
  finally {
    socket?.close();
    if (browser && browser.exitCode === null) { const closed = new Promise(done => { browser.once('exit', done); setTimeout(done, 5000).unref(); }); browser.kill(); await closed; }
    await server?.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
