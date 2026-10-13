/** Independent Canvas attribution, not formal game timing. Execute serially. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';

const arg = key => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? 'work/art-card-canvas-attribution/proof.json');
const outputDir = dirname(output), cpuFrames = Number(arg('--cpu-frames') ?? 60), realFrames = Number(arg('--real-frames') ?? 12);
const rounds = Number(arg('--rounds') ?? 4), maxSamples = Number(arg('--max-samples') ?? 36);
const hiddenCount = Number(arg('--hidden') ?? 0), paced = !process.argv.includes('--unpaced');
if (!Number.isInteger(cpuFrames) || cpuFrames < 45 || !Number.isInteger(realFrames) || realFrames < 1
  || !Number.isInteger(rounds) || rounds < 4 || rounds % 4 || !Number.isInteger(maxSamples) || maxSamples < 20 || maxSamples > 40
  || !Number.isInteger(hiddenCount) || hiddenCount < 0) throw new Error('Require CPU frames >=45, real frames >=1, rounds a positive multiple of4, samples20..40, hidden>=0');
const captureNs = [116, 135, 158], outsideQuota = Math.floor(maxSamples * 2 / 9);
const quotas = { 116: outsideQuota, 135: maxSamples - outsideQuota * 2, 158: outsideQuota };
const variant = { name: 'canvas-attribution-one-native-bank', maxBanks: 1, mips: 'native' };
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
if (arg('--expect-source') && !sourceCommit.startsWith(arg('--expect-source'))) throw new Error('Selected source is not the requested frozen commit');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const allClientSourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
const supportFiles = ['scripts/art-card-canvas-attribution-collector.js', 'scripts/art-card-canvas-attribution-proof.mjs',
  'scripts/art-viewport-bank-mixed-fixture.js', 'scripts/art-viewport-streaming-fixture.js', 'scripts/art-card-bank-variant.js',
  'scripts/art-card-bank-viewport-metadata.js', 'scripts/art-gpu-completion.mjs'];
const supportSha256 = Object.fromEntries(await Promise.all(supportFiles.map(async file => [file, hash(await readFile(resolve(harnessRoot, file)))])));
const metadata = { schema: 1, sourceRoot, sourceCommit, sourceDirtyBefore: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }),
  sourceClientDiffSha256: hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot })),
  allClientSourceSha256, supportSha256, variant, viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 },
  capture: { captureNs, quotas, maxSamples, hiddenCount, cpuFrames, realFrames, paced }, rounds,
  method: 'Diagnostic capture follows the unchanged real mixed fixture clock. It only observes original raster calls and copies their existing Canvas-miss getImageData return before production flips its rows. Capture has allocation overhead and its timing is NOT a formal benchmark. After that world is disposed, its renderer context lost by production dispose and global resource teardown completed, each actual original RGBA is exported once and released from the browser. Only one full host baseline is loaded for each Canvas-only call. Every replay keeps original size/density, willReadFrequently:true and production reset/clear/save/scale/translate/callback/restore. A=paint/full; B=paint/interior1px/full; C=paint/zeroRGBAcorner1px/full; D=paint/full1/full2. Total includes every read. Initial callback replay including the first newly created domain is retained separately. Four balanced Williams mode orders and alternating forward/reverse case order repeat without discarding warmup or slow rows. Public getImageData timing still includes output allocation, conversion and any deferred rasterization; independent allocate/copy controls run after ALL Canvas mode rounds and are never subtracted from reads. Byte comparison and SHA/export happen outside timers. This is not a game-FPS measurement or a claim that1px flushes the whole Canvas.',
  corpusContract: { format: 'RGBA8', components: 4, rowOrientation: 'top-down', completeSourceDomain: true,
    alphaZeroRgbIncluded: true, maskFlipYForCanvasMiss: true,
    provenance: 'Original production getImageData bytes before in-place rowFlip, not a reduced bounding box or reconstructed pose.' } };
const scratch = await mkdtemp('/tmp/sketch-canvas-attribution-');
const corpus = [], experiments = [], allocationControls = [], errors = [], failed = [];
let server, browser, socket, command, page, evaluate, captureResult, world, finalState, browserVersion, heapAfterExport;
let saved = {};
const writeOutput = async extra => {
  saved = { ...saved, ...extra };
  await mkdir(outputDir, { recursive: true });
  await writeFile(output, JSON.stringify({ ...metadata, browserVersion, captureResult, world,
    corpus, experiments, allocationControls, errors, failed, heapAfterExport, finalState, ...saved }, null, 2) + '\n');
};
function distribution(values) {
  if (!values.length) return { samples: 0 };
  const sorted = [...values].sort((a, b) => a - b), p = percentile => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))];
  return { samples: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: sorted.at(-1) };
}
function summaries() {
  const timings = ['paintSubmissionMs', 'smallReadMs', 'fullRead1Ms', 'fullRead2Ms', 'allReadWallMs',
    'paintAndAllReadsWallMs', 'canvasAcquireAndPaintAndAllReadsWallMs'];
  return Object.fromEntries(['A', 'B', 'C', 'D'].map(arm => {
    const rows = experiments.filter(experiment => experiment.phase === 'balanced-round').flatMap(experiment => experiment.rows)
      .filter(row => row.arm === arm && row.status === 'measured');
    return [arm, { passed: rows.every(row => row.passed),
      ...Object.fromEntries(timings.map(key => [key, distribution(rows.map(row => row[key]))])) }];
  }));
}
try {
  await mkdir(resolve(outputDir, 'corpus'), { recursive: true });
  for (const file of supportFiles) await writeFile(resolve(outputDir, file.split('/').at(-1)), await readFile(resolve(harnessRoot, file)));
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Actual card Canvas attribution</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/art-viewport-bank-mixed-fixture.js"></script>`);
  server = await createServer({ configFile: false, root: scratch, publicDir: resolve(sourceRoot, 'public'),
    define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant) },
    plugins: [{ name: 'canvas-resource-manifest', configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
      if (!request.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next();
      try { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); }
      catch (error) { next(error); }
    }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot] } } });
  await server.listen();
  browser = spawn(arg('--chromium') ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((done, reject) => { const timeout = setTimeout(() => reject(new Error('Chromium startup timeout')), 30000);
    browser.once('error', reject); browser.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timeout); done(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  let serial = 0; const pending = new Map();
  socket.on('message', data => { const message = JSON.parse(String(data));
    if (message.id) { const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timeout);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.done(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.loadingFailed') failed.push(message.params.errorText);
    if (message.method === 'Runtime.consoleAPICalled') { const values = message.params.args.map(value => value.value ?? value.description);
      if (message.params.type === 'error') errors.push(values.join(' '));
      else if (values[0]?.startsWith?.('VIEWPORT ')) console.log(values.join(' ')); }
  });
  command = (method, params = {}, sessionId) => new Promise((done, reject) => { const id = ++serial,
    timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 600000);
    pending.set(id, { done, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }),
    { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  page = (method, params) => command(method, params, sessionId);
  evaluate = async expression => { const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}` });
  await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+60000;function check(){if(window.viewportReview?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error("Fixture timeout"));setTimeout(check,20)}check()})');
  await evaluate(`import('/@fs${harnessRoot}/scripts/art-card-bank-viewport-metadata.js').then(()=>window.cardBankPerformanceMetadata.installed)`);
  await evaluate(`import('/@fs${harnessRoot}/scripts/art-card-canvas-attribution-collector.js').then(()=>window.cardCanvasAttribution.installed)`);
  browserVersion = await command('Browser.getVersion');
  await evaluate(`window.cardCanvasAttribution.begin(${JSON.stringify({ captureNs, quotas, maxSamples, hiddenCount, cycle: 0, cpuFrames, realFrames, paced })})`);
  console.log(`CANVAS capture ${sourceCommit.slice(0, 8)} n=${captureNs.join('/')} max=${maxSamples}`);
  world = await evaluate(`window.viewportReview.cycle(${hiddenCount},0,${JSON.stringify({ cpuFrames, realFrames, paced })})`);
  if (!world.disposed || world.glError !== 0) throw new Error('Captured world was not successfully disposed or had GL errors');
  const screenshots = {};
  for (const [name, base64] of Object.entries(world.screenshots)) {
    const bytes = Buffer.from(base64.split(',')[1], 'base64'), file = `capture-${name}.png`;
    await writeFile(resolve(outputDir, file), bytes); screenshots[name] = { file, bytes: bytes.length, sha256: hash(bytes) };
  }
  world.screenshots = screenshots; world.timingsAreFormal = false;
  if (!await evaluate('window.viewportReview.teardown()')) throw new Error('Resource teardown failed');
  captureResult = await evaluate('window.cardCanvasAttribution.seal()');
  await writeOutput({ completed: false, phase: 'world-disposed-corpus-export' });
  for (let index = 0; index < captureResult.samples; index++) {
    const original = await evaluate(`window.cardCanvasAttribution.exportOriginal(${index})`), bytes = Buffer.from(original.rgbaBase64, 'base64');
    const sample = original.sample, sha256 = hash(bytes);
    if (bytes.length !== sample.width * sample.height * 4 || sha256 !== sample.originalSha256) throw new Error(`Corpus transfer mismatch ${index}`);
    const file = `corpus/card-${String(index).padStart(3, '0')}-${sample.width}x${sample.height}.rgba.bin`;
    await writeFile(resolve(outputDir, file), bytes);
    corpus.push({ ...sample, file, byteLength: bytes.length, sha256, callbackSourceSha256: hash(sample.callbackSource) });
  }
  const images = corpus.map(sample => ({ name: `actual-${String(sample.index).padStart(3, '0')}-${sample.unit?.kind ?? sample.batch}-n${sample.n}`,
    width: sample.width, height: sample.height, sourceSize: sample.width, file: sample.file, sha256: sample.sha256,
    byteLength: sample.byteLength, key: sample.key, n: sample.n, density: sample.density, tileSize: sample.tileSize,
    rowOrientation: sample.rowOrientation, maskFlipYForCanvasMiss: sample.maskFlipYForCanvasMiss }));
  await writeFile(resolve(outputDir, 'corpus-manifest.json'), JSON.stringify({ ...metadata.corpusContract,
    sourceRoot, sourceCommit, allClientSourceSha256, supportSha256, captureResult, images, samples: corpus }, null, 2) + '\n');
  finalState = await evaluate('window.cardCanvasAttribution.state()');
  if (finalState.ownedOriginalRgbaBytes || finalState.liveWorldLayers) throw new Error('Original RGBA/world retained before replay');
  // One explicit GC only between independent phases, never around individual
  // reads/modes. Base64 and capture-copy garbage are drained before experiment.
  await page('HeapProfiler.collectGarbage'); heapAfterExport = await page('Runtime.getHeapUsage');
  const indices = corpus.map(sample => sample.index);
  async function replay(index, round) {
    const bytes = await readFile(resolve(outputDir, corpus[index].file)), baseline = bytes.toString('base64');
    const experiment = await evaluate(`window.cardCanvasAttribution.runSample(${index},${JSON.stringify(baseline)},${round})`);
    experiments.push(experiment);
    if (!experiment.passed) errors.push(`Actual-source callback or mode RGBA mismatch sample=${index} round=${round}`);
  }
  // Retain the first replay and every newly-created Canvas domain explicitly;
  // this initial A replay verifies callback stability against original bytes.
  for (const index of indices) await replay(index, -1);
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? [...indices].reverse() : indices;
    console.log(`CANVAS balanced round=${round} cases=${order.length} direction=${round % 2 ? 'reverse' : 'forward'}`);
    for (const index of order) await replay(index, round);
    await writeOutput({ completed: false, phase: `canvas-round-${round}-complete` });
  }
  // These allocate/copy controls cannot change the Canvas-mode sample sequence.
  for (const index of indices) {
    const baseline = (await readFile(resolve(outputDir, corpus[index].file))).toString('base64');
    const control = await evaluate(`window.cardCanvasAttribution.allocationControl(${index},${JSON.stringify(baseline)},${rounds})`);
    allocationControls.push(control); if (!control.passed) errors.push(`Allocation/copy control mismatch sample=${index}`);
  }
  finalState = await evaluate('window.cardCanvasAttribution.state()');
  await evaluate('window.cardCanvasAttribution.release()');
  const currentSourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  const changedSourceFiles = sourceFiles.filter(file => currentSourceSha256[file] !== allClientSourceSha256[file]);
  const supportSha256After = Object.fromEntries(await Promise.all(supportFiles.map(async file => [file, hash(await readFile(resolve(harnessRoot, file)))])));
  const changedSupportFiles = supportFiles.filter(file => supportSha256After[file] !== supportSha256[file]);
  const rows = experiments.flatMap(experiment => experiment.rows), measured = rows.filter(row => row.status === 'measured');
  const unavailable = rows.filter(row => row.status === 'unavailable');
  const coverageErrors = [];
  if (corpus.length < 20) coverageErrors.push(`Only${corpus.length} actual painted samples; fewer than requested20`);
  for (const n of captureNs) if (!corpus.some(sample => sample.n === n)) coverageErrors.push(`No actual original paint captured at n${n}`);
  if (corpus.some(sample => !sample.actual.actualCanvasMiss)) coverageErrors.push('Non-Canvas-miss sample captured');
  if (changedSourceFiles.length) errors.push(`Client source changed during diagnostic: ${changedSourceFiles.join(',')}`);
  if (changedSupportFiles.length) errors.push(`Diagnostic helper changed during run: ${changedSupportFiles.join(',')}`);
  const validation = { passed: errors.length === 0 && failed.length === 0 && coverageErrors.length === 0
    && measured.length > 0 && measured.every(row => row.passed),
    coverageErrors, changedSourceFiles, changedSupportFiles, originalPixelsTransferredExactly: true,
    allRgbaComparisonsExact: measured.every(row => row.passed), measuredModeRows: measured.length,
    unavailableModes: unavailable.map(row => ({ index: row.index, arm: row.arm, round: row.round, reason: row.reason })) };
  await writeOutput({ completed: true, phase: 'complete', validation, summaries: summaries(),
    sourceDirtyAfter: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }),
    heapAfterExperiment: await page('Runtime.getHeapUsage'),
    coldAndInitialReplayRows: rows.filter(row => row.phase === 'initial-replay'),
    originalCaptureOwnedBytesExcludedFromReplay: true,
    limitations: ['Collecting actual pixels adds allocation/copy work to the world capture; those world timings are not formal.',
      'Canvas-only callbacks can still retain source snapshots/model objects, and CPU/scheduler/GC costs remain.',
      'Small reads may flush a tile/subset; B/C results cannot assume a full Canvas flush.',
      'getImageData output allocation cannot be separated from its flush/copy/convert by a public preallocated destination.',
      'Hash/byte scans, base64 transfer and per-case decoding occur outside timers but can influence later caches/GC; mode positions and case direction are balanced.',
      'Initial replay warms source Canvas domains and is kept separately; balanced rounds must not be called cold-game timing.',
      'This tool deliberately removes live GPU submissions. It does not itself establish whether an original long read was blocked on GPU/channel work.'] });
  console.log(JSON.stringify({ output, passed: validation.passed, corpusSamples: corpus.length,
    measuredModeRows: measured.length, byN: captureResult.byN, coverageErrors, errors, failed }));
  if (!validation.passed) process.exitCode = 1;
} catch (error) {
  await writeOutput({ completed: false, failure: String(error), failureStack: error.stack }); throw error;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) { const exited = new Promise(done => { browser.once('exit', done); setTimeout(done, 5000).unref(); }); browser.kill(); await exited; }
  await server?.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
