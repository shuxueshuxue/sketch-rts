import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import WebSocket from 'ws';
import { resourceManifest } from '../tools/resource-manifest.ts';
import {createQueueSourceFreeze} from './art-card-queue-source-freeze-v2.mjs';

const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strategy=arg('--strategy')??'control';if(!['control','pre','pre-post'].includes(strategy))throw new Error('Use --strategy control|pre|pre-post');
const maxBanks = Number(arg('--max-banks') ?? 1), mipMode = arg('--mips') ?? 'native';
if (!Number.isInteger(maxBanks) || maxBanks < 1 || maxBanks > 8 || !['native', 'full'].includes(mipMode)) throw new Error('Use --max-banks 1..8 and --mips native|full');
const variant = { name: arg('--variant') ?? `ordered-bank-${maxBanks}-${mipMode}`, maxBanks, mips: mipMode,
  ordering: 'production stable snapshot ordering', referenceOverrides: mipMode === 'full' ? ['residentMip returns 0'] : [] };
const scene = arg('--scene') ?? 'mixed';
if (!['canonical','mixed'].includes(scene)) throw new Error('Use --scene canonical|mixed');
const fixtureName='art-card-queue-bracket-entry.js';
if (!/^art-card-queue-bracket-entry\.js$/.test(fixtureName)) throw new Error('Fixture must be a viewport script basename');
const sourceRoot = resolve(arg('--source') ?? harnessRoot), output = resolve(arg('--out') ?? `docs/art/refactor/followup/card-streaming/stall-followup/queue-bracket-v3/${strategy}/raw.json`);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const repeats = Number(arg('--repeats') ?? 2), counts = (arg('--hidden') ?? '0').split(',').map(Number);
const paced = true, cpuFrames = Number(arg('--cpu-frames') ?? 60), realFrames = Number(arg('--real-frames') ?? 12);
if (maxBanks !== 1 || mipMode !== 'native' || scene !== 'mixed' || repeats !== 2 || counts.length !== 1 || counts[0] !== 0 || cpuFrames !== 60 || realFrames !== 12) throw new Error('Current-stall diagnosis requires mixed hidden0 oneNative, two lifetimes, 60 CPU/12 real, paced original schedule');
const expectedSourceCommit = execFileSync('git', ['rev-parse', '42bd^{commit}'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
if (sourceCommit !== expectedSourceCommit) throw new Error('Current-stall diagnosis requires frozen 42bd HEAD');
if (execFileSync('git', ['diff', 'HEAD', '--', 'src'], { cwd: sourceRoot }).length) throw new Error('Source tree must be clean against 42bd');
const outputDir = dirname(output);
await mkdir(dirname(outputDir), { recursive: true });
await mkdir(outputDir); // Exclusive: never overwrite a prior success or failure.
const scratch = await mkdtemp('/tmp/sketch-queue-bracket-v3-');
const cycles = [], simulation = [], errors = [], failed = []; let server, browser, socket;
let stopTrace, traceEndedPromise, savedOutputFields = {};
const traceCategories = ['devtools.timeline','v8','disabled-by-default-v8.gc','blink.user_timing','disabled-by-default-skia','cc','gpu','toplevel'];
const trace = { categories: traceCategories, transferMode: 'ReturnAsStream', recordMode: 'record-as-much-as-possible',
  startRequested: false, started: false, endRequested: false, complete: false, errors: [],
  scope: 'Browser-wide trace with observer overhead; User Timing spans correlate synchronous wall time with Canvas/GC/GPU-channel events, not GPU timer-query duration. Gzip compression occurs only after all measurements and browser teardown.' };
const hashFile = async file => { const result = createHash('sha256'); for await (const chunk of createReadStream(file)) result.update(chunk); return result.digest('hex'); };
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceGitDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], { cwd: sourceRoot }));
const clientFiles = execFileSync('rg', ['--files', 'src/client'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const allClientSourceSha256 = Object.fromEntries(await Promise.all(clientFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
const fullSourceFiles = execFileSync('rg', ['--files', 'src'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
const fullSourceBytes = new Map(await Promise.all(fullSourceFiles.map(async file => [file, await readFile(resolve(sourceRoot, file))])));
const fullSourceSha256 = Object.fromEntries([...fullSourceBytes].map(([file, bytes]) => [file, hash(bytes)]));
const profilerSource = await readFile(resolve(harnessRoot, 'scripts/art-card-queue-bracket-profiler.js'));
const parentHarnessSource = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-proof.mjs'));
const sourceFreeze=await createQueueSourceFreeze({sourceRoot,harnessRoot,scratch,outputDir,entryFixture:fixtureName,observerPath:resolve(scratch,'queue-profiler.js')});
const freezeHelperBytes=await readFile(resolve(harnessRoot,'scripts/art-card-queue-source-freeze-v2.mjs'));
const diagnostic = { boundedJSONExport:true,fullGLSequenceStoredAsSeparateCompleteArtifact:true,protocol:'One JSON.stringify after cycle; UTF8 checksum + 1MiB character slices; all GL calls retained. WS error/close reject pending immediately.',strategy,sourceInventory:sourceFreeze.metadata,sourceFreezeHelperSha256:hash(freezeHelperBytes),observerPerturbation:true,pureGpuTiming:null,productionOnly: true, expectedSourceCommit, fullSourceSha256, providerOverrides: [], loader: 'Current production modules only; profiler imported from its archived run-start bytes in scratch. Existing oneNative setup only; no historical peak/mask/cache providers.', formalTiming: false, tracing: true, profilerSha256: hash(profilerSource), parentHarnessSha256: hash(parentHarnessSource), method: 'Inclusive method wrappers and cheap per-draw snapshots add observer overhead. This is a latency attribution diagnostic, not formal before/after timing. Follow with the unchanged non-profiled harness for formal results.' };
const variantHelper = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-variant.js'));
const viewportMetadata = await readFile(resolve(harnessRoot, 'scripts/art-card-bank-viewport-metadata.js'));
const factFixtureName = scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js';
const factFixtureSha256 = hash(await readFile(resolve(harnessRoot, 'scripts', factFixtureName)));
const writeOutput = async extra => { savedOutputFields = { ...savedOutputFields, ...extra }; await mkdir(outputDir, { recursive: true }); await writeFile(output, JSON.stringify({ trace, diagnostic, variant, scene, factFixtureName, factFixtureSha256, variantHelperSha256: hash(variantHelper), viewportMetadataSha256:hash(viewportMetadata), sourceRoot, sourceCommit, sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }), sourceGitDiffSha256, allClientSourceSha256, harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), fixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts/art-viewport-fixture.js'))), entryFixtureName: fixtureName, entryFixtureSha256: hash(await readFile(resolve(harnessRoot, 'scripts', fixtureName))), viewport: { width: 1280, height: 720, dpr: 1, zoom: .75 }, counts, repeats, paced, cpuFrames, realFrames, errors, failed, cycles, simulation, ...savedOutputFields }, null, 2) + '\n'); };
try {
  await mkdir(outputDir, { recursive: true });
  await sourceFreeze.archive();await writeFile(resolve(outputDir,'source-freeze.mjs'),freezeHelperBytes);
  const optimizeDeps=await sourceFreeze.prepare();
  await writeFile(resolve(outputDir, 'profiler.js'), profilerSource);
  await writeFile(resolve(scratch, 'queue-profiler.js'), profilerSource);
  for (const [file, bytes] of fullSourceBytes) {
    const target = resolve(outputDir, 'source-snapshot', file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(resolve(outputDir, 'parent-harness.mjs'), parentHarnessSource);
  await writeFile(resolve(outputDir, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)));
  await writeFile(resolve(outputDir, 'fixture.js'), await readFile(resolve(harnessRoot, 'scripts', fixtureName)));
  await writeFile(resolve(outputDir, 'bank-variant.js'), variantHelper);
  await writeFile(resolve(outputDir, 'viewport-metadata.js'), viewportMetadata);
  await writeFile(resolve(outputDir, 'fact-fixture.js'), await readFile(resolve(harnessRoot, 'scripts', scene === 'mixed' ? 'art-viewport-streaming-fixture.js' : 'art-viewport-fixture.js')));
  await writeFile(resolve(scratch, 'index.html'), `<meta charset="UTF-8"><title>Fixed visible world benchmark</title><style>body{margin:0;background:#182526}#mount{position:relative;width:1280px;height:720px}canvas.game-canvas{position:absolute;inset:0;width:1280px;height:720px;z-index:2}</style><div id="mount"></div><script type="module" src="/@fs${harnessRoot}/scripts/${fixtureName}"></script>`);
  const entryHtml = await readFile(resolve(scratch, 'index.html'));
  diagnostic.entryHtmlSha256 = hash(entryHtml);
  await writeFile(resolve(outputDir, 'entry.html'), entryHtml);
  server = await createServer({ configFile: false, root: scratch,cacheDir:resolve(scratch,'.vite-cache'),optimizeDeps, publicDir: resolve(sourceRoot, 'public'), define: { __BENCHMARK_SOURCE_ROOT__: JSON.stringify(sourceRoot), __CARD_BANK_VARIANT__: JSON.stringify(variant), __CARD_QUEUE_STRATEGY__: JSON.stringify(strategy) },
    plugins: [sourceFreeze.plugin,{ name: 'viewport-resource-manifest', configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.split('?')[0]?.endsWith('/resource-manifest.json')) return next(); try { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await resourceManifest(resolve(sourceRoot, 'public')))); } catch (error) { next(error); } }); } }],
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, harnessRoot, sourceRoot] } } });
  await server.listen();await sourceFreeze.startup(server);await writeOutput({completed:false,dependencyPreparationComplete:true});const address = server.httpServer.address();
  browser = spawn(arg('--chromium') ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((done, reject) => { const timeout = setTimeout(() => reject(new Error('Chromium startup timeout')), 30000); browser.once('error', reject); browser.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); done(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  let serial = 0; const pending = new Map();
  socket.on('message', data => { const message = JSON.parse(String(data)); if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.done(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.loadingFailed') failed.push(message.params.errorText);
    if (message.method === 'Runtime.consoleAPICalled') { const values = message.params.args.map(arg => arg.value ?? arg.description); if (message.params.type === 'error') errors.push(values.join(' ')); if (values[0]?.startsWith?.('VIEWPORT ')) console.log(values.join(' ')); } });
  const rejectPending=error=>{for(const item of pending.values()){clearTimeout(item.timeout);item.reject(error);}pending.clear();};
  socket.on('error',error=>{errors.push('WebSocket error: '+String(error));rejectPending(error);});
  socket.on('close',(code,reason)=>{if(pending.size)rejectPending(new Error('WebSocket closed '+code+' '+String(reason)));});
  const command = (method, params = {}, sessionId) => new Promise((done, reject) => {if(socket.readyState!==WebSocket.OPEN)return reject(new Error('CDP socket is not open: '+method)); const id = ++serial, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 600000); pending.set(id, { done, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }), { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => command(method, params, sessionId);
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable'); await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${address.port}` });
  const evaluate = async expression => { const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+60000;const check=()=>{if(window.viewportReview?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error("Fixture init timeout"));setTimeout(check,20)};check()})');
  await evaluate(`import('/@fs${harnessRoot}/scripts/art-card-bank-viewport-metadata.js').then(()=>window.cardBankPerformanceMetadata.installed)`);
  await evaluate(`import('/queue-profiler.js').then(()=>window.cardLatencyProfiler.installed)`);
  const exportObject=async(expression,label)=>{
    const header=await evaluate(`(async()=>{const value=await (${expression});const text=JSON.stringify(value);window.__cardQueueExportText=text;const bytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',bytes);return{label:${JSON.stringify(label)},characters:text.length,bytes:bytes.length,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),glCalls:value.glSequenceCalls?.length??null,rows:value.rows?.length??null};})()`);
    console.log('EXPORT '+label+' '+JSON.stringify(header));await writeFile(resolve(outputDir,label+'.export-header.json'),JSON.stringify(header,null,2)+'\n');
    const chunks=[];for(let offset=0;offset<header.characters;offset+=1048576)chunks.push(await evaluate(`window.__cardQueueExportText.slice(${offset},${offset+1048576})`));
    const text=chunks.join(''),bytes=Buffer.from(text,'utf8');if(text.length!==header.characters||bytes.length!==header.bytes||hash(bytes)!==header.sha256)throw new Error('Bounded JSON export checksum differs: '+label);
    const file=label+'.json';await writeFile(resolve(outputDir,file),bytes);await evaluate('delete window.__cardQueueExportText');
    diagnostic.boundedExports??=[];diagnostic.boundedExports.push({...header,file,sliceCharacters:1048576,chunks:chunks.length,afterCycleMeasurements:true});const decoded=JSON.parse(text);if(Array.isArray(decoded.glSequenceCalls)){decoded.glSequenceCallsArtifact={file,jsonPointer:'/glSequenceCalls',sha256:header.sha256,bytes:header.bytes,calls:decoded.glSequenceCalls.length,completeUnfiltered:true};delete decoded.glSequenceCalls;}return decoded;
  };
  const browserVersion = await command('Browser.getVersion');
  let resolveTraceComplete;
  const traceComplete = new Promise(resolve => { resolveTraceComplete = resolve; });
  socket.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.method === 'Tracing.tracingComplete') resolveTraceComplete(message.params);
  });
  stopTrace = () => {
    if (!trace.startRequested) return Promise.resolve();
    if (traceEndedPromise) return traceEndedPromise;
    traceEndedPromise = (async () => {
      trace.endRequested = true;
      await command('Tracing.end');
      let timeout;
      const completed = await Promise.race([traceComplete, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Tracing.tracingComplete timeout')), 120000);
      })]).finally(() => clearTimeout(timeout));
      trace.tracingComplete = completed;
      if (completed.dataLossOccurred) errors.push('Browser trace reports dataLossOccurred');
      if (!completed.stream) throw new Error('Trace completed without ReturnAsStream handle');
      const temporary = resolve(outputDir, 'trace.partial.json');
      let file;
      const digest = createHash('sha256'); let bytes = 0;
      trace.raw = { file: 'trace.partial.json', complete: false };
      try {
        file = await open(temporary, 'w');
        while (true) {
          const chunk = await command('IO.read', { handle: completed.stream, size: 1024 * 1024 });
          const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
          await file.writeFile(buffer); digest.update(buffer); bytes += buffer.length; trace.raw.bytes = bytes;
          if (chunk.eof) break;
        }
        await file.close();
        await rename(temporary, resolve(outputDir, 'trace.json'));
        trace.raw = { file: 'trace.json', bytes, sha256: digest.digest('hex'), complete: true };
        trace.complete = true;
      } finally {
        await file?.close().catch(() => {});
        await command('IO.close', { handle: completed.stream }).catch(error => {
          trace.errors.push({ phase: 'stream-close', message: String(error), stack: error.stack });
        });
      }
    })();
    return traceEndedPromise;
  };
  trace.startRequested = true;
  await command('Tracing.start', { categories: traceCategories.join(','), options: trace.recordMode,
    transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'none' });
  trace.started = true;
  for (let cycle = 0; cycle < repeats; cycle++) for (const count of counts) {
    console.log(`START ${sourceCommit.slice(0, 8)} hidden=${count} cycle=${cycle}`);
    await evaluate(`window.cardLatencyProfiler.begin(${JSON.stringify({ hiddenCount: count, cycle, cpuFrames, realFrames, paced, scene })})`);
    const result = await exportObject(`window.viewportReview.cycle(${count},${cycle},${JSON.stringify({ cpuFrames, realFrames, paced })})`,'cycle-'+cycle+'-result');
    result.latencyProfile = await exportObject('window.cardLatencyProfiler.drain()','cycle-'+cycle+'-profile');
    const schedule = result.latencyProfile.scheduleValidation;
    if (!schedule.allExpectedRows || schedule.mismatches.length) errors.push(`Latency profile schedule mismatch ${count}/${cycle}: ${JSON.stringify(schedule)}`);
    const screenshots = {};
    for (const [name, png] of Object.entries(result.screenshots)) { const bytes = Buffer.from(png.split(',')[1], 'base64'), filename = `${sourceCommit.slice(0, 8)}-hidden-${count}-cycle-${cycle}-${name}.png`; await writeFile(resolve(outputDir, filename), bytes); screenshots[name] = { path: filename, sha256: hash(bytes) }; }
    result.screenshots = screenshots; result.pixelProofSha256 = hash(JSON.stringify(result.pixelProof)); // Retain the raw visible snapshot facts as well as their existing SHA.
    await page('HeapProfiler.collectGarbage'); result.heapAfterGc = await page('Runtime.getHeapUsage'); cycles.push(result); await writeOutput({ browserVersion, completed: false });
  }
  await stopTrace();
  // Simulation intentionally not run: presentation-only stall diagnosis.
  await evaluate('window.viewportReview.teardown()'); await page('HeapProfiler.collectGarbage');
  const files = ['src/client/world-presentation.ts', 'src/client/world3d/world-layer.ts', 'src/client/world-renderer.ts', 'src/client/unit-animation.ts', 'src/client/combat-presentation.ts'];
  const sourceSha256 = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  const endSourceFiles = execFileSync('rg', ['--files', 'src'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
  diagnostic.finalSourceSha256 = Object.fromEntries(await Promise.all(endSourceFiles.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
  diagnostic.sourceStayedFrozen = JSON.stringify(fullSourceSha256) === JSON.stringify(diagnostic.finalSourceSha256);
  if (!diagnostic.sourceStayedFrozen) errors.push('Production source changed during diagnosis');
  await sourceFreeze.finish(server);
  if(hash(await readFile(resolve(harnessRoot,'scripts/art-card-queue-source-freeze-v2.mjs')))!==diagnostic.sourceFreezeHelperSha256)errors.push('Freeze helper changed');
  const violations = [...errors, ...failed]; for (const cycle of cycles) if (cycle.glError !== 0 || !cycle.disposed) violations.push(`invalid GL/disposal cycle ${cycle.hiddenCount}/${cycle.cycle}`);
  await writeOutput({ browserVersion, sourceSha256, completed: true, heapAfterTeardown: await page('Runtime.getHeapUsage'), validation: { passed: !violations.length, violations }, method: `42bd CURRENT-PRODUCTION STALL DIAGNOSTIC WITH OBSERVER OVERHEAD, NOT FORMAL TIMING OR AN EXPLANATION OF A PREVIOUS UNOBSERVED STALL. No historical provider substitutions. Current peak/mask/cache/uploader/ordering are unchanged. Two complete mixed100 hidden0 oneNative lifetimes, 18 real prep draws n0..51, 60 warm n54..113, all 60 CPU samples n114..173, all 12 real frames n480..491, empty/return probes and original between-lifetime explicit GC retained. No frame selection; the selected diagnostic strategy adds separately accounted n135 synchronization and event-loop waits, retaining original content commands. Pre-drain latency may relocate waits and is not an optimization. CPU section disables renderer.render only, so uploads, Canvas execution and driver backpressure remain possible. Natural GC may occur within timed calls; explicit harness GC is outside draws. All stage deltas and method wrappers are diagnostic; inclusive costs overlap and cannot be summed. Trace polling/scheduler costs are not pure GPU duration. Same fact fixture, screenshots and raw facts retained for separate strict comparison; matching pixels are not asserted without that check. Compression occurs after browser shutdown.` });
  if (violations.length) throw new Error(violations.join('\n'));
  console.log(JSON.stringify({ output, cycles: cycles.map(({ hiddenCount, cycle, cpu, real }) => ({ hiddenCount, cycle, cpu: cpu.fullPresentation, real: real.fullPresentationCompleteWall })) }));
} catch (error) { await writeOutput({ completed: false, failure: String(error), failureStack: error.stack }); throw error; }
finally {
  // End tracing and drain its stream on both success and original failure,
  // before closing the CDP connection. Never replace the original failure.
  try { await stopTrace?.(); }
  catch (error) { trace.errors.push({ phase: 'trace-end-or-drain', message: String(error), stack: error.stack }); }
  socket?.close();
  if (browser && browser.exitCode === null) {
    const closed = new Promise(done => { browser.once('exit', done); setTimeout(done, 5000).unref(); });
    browser.kill(); await closed;
  }
  try { await server?.close(); await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
  catch (error) { trace.errors.push({ phase: 'server-cleanup', message: String(error), stack: error.stack }); }
  // No trace compression overlaps sampled rendering or simulation.
  trace.compressionDeferredUntilAllStrategies=true;
  if (trace.raw?.complete&&process.argv.includes('--compress-after-teardown')) {
    try {
      const compressed = resolve(outputDir, 'trace.json.gz');
      await pipeline(createReadStream(resolve(outputDir, trace.raw.file)), createGzip({ level: 6 }), createWriteStream(compressed));
      trace.gzip = { file: 'trace.json.gz', bytes: (await stat(compressed)).size, sha256: await hashFile(compressed), compressedAfterMeasurementsAndBrowserTeardown: true };
    } catch (error) { trace.errors.push({ phase: 'trace-gzip', message: String(error), stack: error.stack }); }
  }
  try { await writeOutput({}); }
  catch (error) { console.error('Final trace metadata write failed:', error); if (!savedOutputFields.failure) throw error; }
}
