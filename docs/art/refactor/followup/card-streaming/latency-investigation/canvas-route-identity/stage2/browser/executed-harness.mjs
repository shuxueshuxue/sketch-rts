/** Independent CPU Canvas proof of actual catalog atlas entry points.
 * node scripts/art-canvas-route-identity-proof-v2.mjs --before ATLAS --before-appearance APPEARANCE
 *   [--source ROOT] [--before-commit d07cda2] [--out FRESH_DIR/proof.json] [--chromium PATH]
 * No timing, WebGL, simulation, browser renderer or production instrumentation.
 */
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createServer} from 'vite';
import WebSocket from 'ws';

const arg = key => {
  const at = process.argv.indexOf(key);
  if (at < 0) return undefined;
  if (!process.argv[at + 1] || process.argv[at + 1].startsWith('--')) throw new Error('Missing value for ' + key);
  return process.argv[at + 1];
};
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(arg('--source') ?? harnessRoot);
const beforePath = arg('--before') && resolve(arg('--before'));
if (!beforePath) throw new Error('--before must name the frozen untouched atlas-art.ts file');
const beforeAppearancePath = arg('--before-appearance') && resolve(arg('--before-appearance'));
if (!beforeAppearancePath) throw new Error('--before-appearance must name the frozen untouched unit-appearance.ts file');
const output = resolve(arg('--out') ?? 'work/art-canvas-route-identity-v2/proof.json');
const outputDir = dirname(output), sourceDir = resolve(sourceRoot, 'src/client');
const currentPath = resolve(sourceDir, 'atlas-art.ts');
if (beforePath === currentPath) throw new Error('Before and candidate atlas modules must have separate source files');
const portraitPath = resolve(sourceDir, 'art/portrait-fit.ts');
const appearancePath = resolve(sourceDir, 'art/unit-appearance.ts');
if (beforeAppearancePath === appearancePath || beforeAppearancePath === beforePath) throw new Error('Before appearance must be a separate frozen source file');
const fixturePath = resolve(harnessRoot, 'scripts/art-canvas-route-identity-fixture-v2.js');
const harnessPath = fileURLToPath(import.meta.url), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [beforeSource, currentSource, beforeAppearanceSource, currentAppearanceSource, portraitSource, fixtureSource, harnessSource] = await Promise.all([
  readFile(beforePath), readFile(currentPath), readFile(beforeAppearancePath), readFile(appearancePath), readFile(portraitPath), readFile(fixturePath), readFile(harnessPath),
]);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: sourceRoot, encoding: 'utf8'}).trim();
const beforeCommitReference = arg('--before-commit') ?? 'd07cda2';
const beforeCommit = execFileSync('git', ['rev-parse', `${beforeCommitReference}^{commit}`], {cwd: sourceRoot, encoding: 'utf8'}).trim();
const beforeGitPath = `${beforeCommit}:src/client/atlas-art.ts`;
const beforeGitBlobId = execFileSync('git', ['rev-parse', beforeGitPath], {cwd: sourceRoot, encoding: 'utf8'}).trim();
const beforeGitSource = execFileSync('git', ['show', beforeGitPath], {cwd: sourceRoot});
if (!beforeSource.equals(beforeGitSource)) throw new Error('Frozen before artifact differs from exact Git atlas blob ' + beforeGitPath);
const beforeAppearanceGitPath = `${beforeCommit}:src/client/art/unit-appearance.ts`;
const beforeAppearanceGitBlobId = execFileSync('git', ['rev-parse', beforeAppearanceGitPath], {cwd: sourceRoot, encoding: 'utf8'}).trim();
const beforeAppearanceGitSource = execFileSync('git', ['show', beforeAppearanceGitPath], {cwd: sourceRoot});
if (!beforeAppearanceSource.equals(beforeAppearanceGitSource)) throw new Error('Frozen before appearance differs from exact Git blob ' + beforeAppearanceGitPath);
const sourceClientDiffSha256 = hash(execFileSync('git', ['diff', 'HEAD', '--', 'src/client'], {cwd: sourceRoot}));
await mkdir(dirname(outputDir), {recursive: true});
await mkdir(outputDir); // Never overwrite a previous success, failure or partial run.
const sourceInputs = new Map([[currentPath, currentSource], [appearancePath, currentAppearanceSource], [portraitPath, portraitSource]]);
const virtualSources = new Map([
  ['atlas-before', {bytes: beforeSource, resolveDir: sourceDir}],
  ['atlas-candidate', {bytes: currentSource, resolveDir: sourceDir}],
  ['appearance-before', {bytes: beforeAppearanceSource, resolveDir: resolve(sourceDir, 'art')}],
  ['appearance-candidate', {bytes: currentAppearanceSource, resolveDir: resolve(sourceDir, 'art')}],
  ['portrait-before', {bytes: portraitSource, resolveDir: resolve(sourceDir, 'art')}],
  ['portrait-candidate', {bytes: portraitSource, resolveDir: resolve(sourceDir, 'art')}],
]);
const entry = [
  "export * as before from 'proof:atlas-before';",
  "export * as candidate from 'proof:atlas-candidate';",
  "export * as beforeUnitAppearance from 'proof:appearance-before';",
  "export * as candidateUnitAppearance from 'proof:appearance-candidate';",
  "export {fittedPortraitStats as portraitStatsBefore} from 'proof:portrait-before';",
  "export {fittedPortraitStats as portraitStatsCandidate} from 'proof:portrait-candidate';",
  `export {figures,creatures} from ${JSON.stringify(resolve(sourceDir, 'art/appearance.ts'))};`,
  `export {actionPaintSize} from ${JSON.stringify(resolve(sourceDir, 'art/action-direction.ts'))};`,
  `export {canEquip,itemHands,wieldRefusal} from ${JSON.stringify(resolve(sourceRoot, 'src/shared/equipment.ts'))};`,
  `export {UNIT_DEFS} from ${JSON.stringify(resolve(sourceRoot, 'src/shared/catalog.ts'))};`,
  `export {equipmentForKind,equipmentFamily} from ${JSON.stringify(resolve(sourceDir, 'art/rig.ts'))};`,
].join('\n');
virtualSources.set('entry', {bytes: Buffer.from(entry), resolveDir: sourceDir});
const resolutionRecords = [], loadedSources = [];
const loaders = {'.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.json': 'json'};
const errors = [], loadingFailures = [], loadedUrls = new Set();
let server, browser, socket, scratch, evidence, failure;
const pending = new Map();
const startedAt = new Date().toISOString();
const metadata = {
  sourceRoot, sourceCommit, sourceClientDiffSha256,
  beforeArtifact: {path: beforePath, sha256: hash(beforeSource), bytes: beforeSource.length, commitReference: beforeCommitReference, commit: beforeCommit, gitPath: beforeGitPath, gitBlobId: beforeGitBlobId, gitBlobSha256: hash(beforeGitSource), exactGitBytes: true},
  beforeAppearanceArtifact: {path: beforeAppearancePath, sha256: hash(beforeAppearanceSource), bytes: beforeAppearanceSource.length, commit: beforeCommit, gitPath: beforeAppearanceGitPath, gitBlobId: beforeAppearanceGitBlobId, gitBlobSha256: hash(beforeAppearanceGitSource), exactGitBytes: true},
  candidateArtifact: {path: currentPath, sha256: hash(currentSource), bytes: currentSource.length},
  candidateAppearanceArtifact: {path: appearancePath, sha256: hash(currentAppearanceSource), bytes: currentAppearanceSource.length},
  portraitDependency: {path: portraitPath, sha256: hash(portraitSource), bytes: portraitSource.length},
  harnessSha256: hash(harnessSource), fixtureSha256: hash(fixtureSource),
  isolation: 'Two actual atlas modules and their matching unit-appearance providers compiled from frozen source bytes with separate module namespaces. Before atlas and appearance artifacts both match the pinned Git commit byte for byte. Each atlas owns its real RasterCache; each appearance provider owns its own catalog objects, memo map and candidate WeakSet brand. Fixture appearanceFor calls use the matching provider, never a third appearance module. Portrait-fit is duplicated with identical source bytes and independent FittedPortraitCache instances. Other unchanged body and scratch-canvas dependencies are frozen from the same current source graph.',
  scope: 'Exact CPU Canvas correctness and actual cache reuse only. Complete original RGBA (including transparent RGB), crop, final entry output and untimed cache/source-read counts. No rendering-time or game-memory claim; no WebGL context, renderer, simulation, benchmark or per-frame observer.',
};
try {
  await writeFile(resolve(outputDir, 'executed-harness.mjs'), harnessSource);
  await writeFile(resolve(outputDir, 'executed-fixture.js'), fixtureSource);
  await writeFile(resolve(outputDir, 'before-atlas-art.ts'), beforeSource);
  await writeFile(resolve(outputDir, 'candidate-atlas-art.ts'), currentSource);
  await writeFile(resolve(outputDir, 'before-unit-appearance.ts'), beforeAppearanceSource);
  await writeFile(resolve(outputDir, 'candidate-unit-appearance.ts'), currentAppearanceSource);
  await writeFile(resolve(outputDir, 'portrait-fit.ts'), portraitSource);
  const bundled = await build({
    entryPoints: ['proof:entry'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    absWorkingDir: sourceRoot, sourcemap: false, minify: false, metafile: true, logLevel: 'silent',
    plugins: [{name: 'isolated-actual-canvas-atlas', setup(plugin) {
      plugin.onResolve({filter: /^proof:/}, args => {
        const path = args.path.slice('proof:'.length);
        if (!virtualSources.has(path)) throw new Error('Unexpected proof module ' + path);
        resolutionRecords.push({request: args.path, importer: args.importer, namespace: 'canvas-route-proof', resolved: path});
        return {path, namespace: 'canvas-route-proof'};
      });
      plugin.onResolve({filter: /^\.\/art\/portrait-fit$/, namespace: 'canvas-route-proof'}, args => {
        if (!['atlas-before', 'atlas-candidate'].includes(args.importer)) throw new Error('Unexpected portrait importer');
        const path = args.importer === 'atlas-before' ? 'portrait-before' : 'portrait-candidate';
        resolutionRecords.push({request: args.path, importer: args.importer, namespace: 'canvas-route-proof', resolved: path});
        return {path, namespace: 'canvas-route-proof'};
      });
      plugin.onResolve({filter: /^\.\/art\/unit-appearance$/, namespace: 'canvas-route-proof'}, args => {
        if (!['atlas-before', 'atlas-candidate'].includes(args.importer)) throw new Error('Unexpected appearance importer');
        const path = args.importer === 'atlas-before' ? 'appearance-before' : 'appearance-candidate';
        resolutionRecords.push({request: args.path, importer: args.importer, namespace: 'canvas-route-proof', resolved: path});
        return {path, namespace: 'canvas-route-proof'};
      });
      plugin.onLoad({filter: /.*/, namespace: 'canvas-route-proof'}, args => {
        const source = virtualSources.get(args.path);
        loadedSources.push({module: args.path, sha256: hash(source.bytes), servedFromRunStartSnapshot: true});
        return {contents: source.bytes.toString('utf8'), loader: args.path === 'entry' ? 'js' : 'ts', resolveDir: source.resolveDir};
      });
      plugin.onLoad({filter: /\.(?:ts|tsx|js|mjs|cjs|json)$/, namespace: 'file'}, async args => {
        let bytes = sourceInputs.get(args.path);
        if (!bytes) {bytes = await readFile(args.path); sourceInputs.set(args.path, bytes);}
        return {contents: bytes.toString('utf8'), loader: loaders[extname(args.path)], resolveDir: dirname(args.path)};
      });
    }}],
  });
  if (bundled.outputFiles.length !== 1) throw new Error('Expected one self-contained ESM proof bundle');
  const bundle = bundled.outputFiles[0].contents;
  metadata.bundleSha256 = hash(bundle);
  metadata.resolutionRecords = resolutionRecords;
  metadata.loadedSources = loadedSources;
  metadata.sharedDependencySha256 = Object.fromEntries([...sourceInputs].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, hash(bytes)]));
  metadata.bundleInputs = Object.keys(bundled.metafile.inputs).sort();
  await writeFile(resolve(outputDir, 'executed-modules.js'), bundle);
  await writeFile(resolve(outputDir, 'bundle-metafile.json'), JSON.stringify(bundled.metafile, null, 2) + '\n');
  // All four changed source modules must be served only through their isolated namespaces.
  for (const path of [currentPath, appearancePath]) if (Object.keys(bundled.metafile.inputs).includes(path) || Object.keys(bundled.metafile.inputs).includes(path.slice(sourceRoot.length + 1))) throw new Error('An unisolated changed module entered the proof bundle: ' + path);
  for (const name of ['atlas-before','atlas-candidate','appearance-before','appearance-candidate','portrait-before','portrait-candidate']) if (!loadedSources.some(record => record.module === name && record.servedFromRunStartSnapshot)) throw new Error('An isolated actual provider was not loaded: ' + name);
  scratch = await mkdtemp('/tmp/canvas-route-identity-v2-');
  await writeFile(resolve(scratch, 'modules.js'), bundle);
  await writeFile(resolve(scratch, 'fixture.js'), fixtureSource);
  await writeFile(resolve(scratch, 'index.html'), '<meta charset="UTF-8"><title>Actual Canvas catalog identity proof</title><link rel="icon" href="data:,"><script type="module" src="/fixture.js"></script>');
  server = await createServer({configFile: false, root: scratch, server: {host: '127.0.0.1', port: 0, hmr: false}});
  await server.listen();
  const chromium = arg('--chromium') ?? process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
  const browserArgs = ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'profile')}`, 'about:blank'];
  metadata.browserLaunch = {executable: chromium, args: browserArgs.filter(value => !value.startsWith('--user-data-dir='))};
  browser = spawn(chromium, browserArgs, {stdio: ['ignore', 'ignore', 'pipe']});
  const endpoint = await new Promise((done, reject) => {
    const cleanup = () => {clearTimeout(timeout); browser.removeListener('error', onError); browser.stderr.removeListener('data', onData);};
    const onError = error => {cleanup(); reject(error);};
    const onData = chunk => {const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) {cleanup(); done(match[1]);}};
    const timeout = setTimeout(() => {cleanup(); reject(new Error('Chromium startup timeout'));}, 30000);
    browser.once('error', onError); browser.stderr.on('data', onData);
  });
  socket = new WebSocket(endpoint);
  await new Promise((done, reject) => {socket.once('open', done); socket.once('error', reject);});
  const rejectPending = reason => {
    for (const request of pending.values()) {clearTimeout(request.timeout); request.reject(reason);}
    pending.clear();
  };
  socket.on('close', () => rejectPending(new Error('CDP closed')));
  socket.on('error', error => rejectPending(error));
  socket.on('message', bytes => {
    const message = JSON.parse(String(bytes));
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timeout);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.done(message.result); return;
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.loadingFailed') loadingFailures.push(message.params.errorText);
    if (message.method === 'Network.requestWillBeSent') loadedUrls.add(message.params.request.url);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(value => value.value ?? value.description).join(' '));
  });
  let serial = 0;
  const command = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++serial, timeout = setTimeout(() => {pending.delete(id); reject(new Error('CDP timeout ' + method));}, 900000);
    pending.set(id, {done, reject, timeout});
    socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
  });
  const {targetId} = await command('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await command('Target.attachToTarget', {targetId, flatten: true});
  const page = (method, params = {}) => command(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  await page('Page.navigate', {url: `http://127.0.0.1:${server.httpServer.address().port}`});
  await evaluate('new Promise((resolve,reject)=>{const deadline=performance.now()+30000;function poll(){if(window.canvasRouteIdentity?.ready)return resolve(true);if(performance.now()>deadline)return reject(new Error("Fixture init timeout"));setTimeout(poll,20)}poll()})');
  const proof = await evaluate('window.canvasRouteIdentity.run()');
  const teardown = await evaluate('window.canvasRouteIdentity.teardown()');
  evidence = {...metadata, startedAt, ...proof, teardown, browser: await command('Browser.getVersion'), errors, loadingFailures, loadedUrls: [...loadedUrls].sort()};
} catch (error) {
  failure = String(error);
  evidence = {...metadata, startedAt, completed: false, passed: false, failure, failureStack: error.stack, errors, loadingFailures};
} finally {
  socket?.close();
  for (const request of pending.values()) {clearTimeout(request.timeout); request.reject(new Error('Proof teardown'));}
  pending.clear();
  const running = () => !!browser?.pid && browser.exitCode === null && browser.signalCode === null;
  const waitForExit = () => new Promise(done => {
    if (!running()) {done(true); return;}
    const finished = value => {clearTimeout(timeout); browser.removeListener('exit', exited); done(value);};
    const exited = () => finished(true);
    const timeout = setTimeout(() => finished(false), 5000);
    browser.once('exit', exited);
  });
  const shutdown = {started: !!browser?.pid, terminateSent: false, killSent: false};
  if (running()) {shutdown.terminateSent = browser.kill('SIGTERM'); await waitForExit();}
  if (running()) {shutdown.killSent = browser.kill('SIGKILL'); await waitForExit();}
  shutdown.exited = !running(); shutdown.exitCode = browser?.exitCode ?? null; shutdown.signalCode = browser?.signalCode ?? null;
  evidence.browserShutdown = shutdown;
  if (!shutdown.exited) errors.push('Own Chromium process did not exit after SIGTERM/SIGKILL');
  await server?.close();
  if (scratch && shutdown.exited) await rm(scratch, {recursive: true, force: true, maxRetries: 4, retryDelay: 100});
  else if (scratch) evidence.retainedScratchOnFailedShutdown = scratch;
}
evidence.dependenciesAfter = {};
for (const [path] of sourceInputs) {
  try {evidence.dependenciesAfter[path] = hash(await readFile(path));}
  catch (error) {errors.push('Dependency unavailable after proof: ' + path + ' ' + error);}
}
evidence.dependenciesUnchanged = JSON.stringify(metadata.sharedDependencySha256) === JSON.stringify(Object.fromEntries(Object.entries(evidence.dependenciesAfter).sort(([a], [b]) => a.localeCompare(b))));
try {evidence.beforeArtifactAfterSha256 = hash(await readFile(beforePath));}
catch (error) {evidence.beforeArtifactAfterSha256 = null; errors.push('Frozen before artifact unavailable after proof: ' + error);}
evidence.beforeArtifactUnchanged = evidence.beforeArtifactAfterSha256 === metadata.beforeArtifact.sha256;
try {evidence.beforeAppearanceArtifactAfterSha256 = hash(await readFile(beforeAppearancePath));}
catch (error) {evidence.beforeAppearanceArtifactAfterSha256 = null; errors.push('Frozen before appearance unavailable after proof: ' + error);}
evidence.beforeAppearanceArtifactUnchanged = evidence.beforeAppearanceArtifactAfterSha256 === metadata.beforeAppearanceArtifact.sha256;
try {evidence.harnessAfterSha256 = hash(await readFile(harnessPath)); evidence.fixtureAfterSha256 = hash(await readFile(fixturePath));}
catch (error) {errors.push('Proof helper unavailable after proof: ' + error);}
evidence.helpersUnchanged = evidence.harnessAfterSha256 === metadata.harnessSha256 && evidence.fixtureAfterSha256 === metadata.fixtureSha256;
const teardown = evidence.teardown;
evidence.teardownValid = teardown?.restoredObservers === true && teardown.webGLAttempts === 0 && teardown.remainingCapturedBytes === 0 && ['before', 'candidate'].every(provider => teardown[provider]?.raster?.ownedCanvasBytes === 0 && teardown[provider]?.portrait?.ownedCanvasBytes === 0);
if (evidence.completed === true && (evidence.webGLAttempts !== 0 || !evidence.teardownValid)) errors.push('WebGL attempted or proof observers/cache ownership were not fully released');
evidence.completedAt = new Date().toISOString();
evidence.passed = evidence.completed === true && evidence.passed === true && errors.length === 0 && loadingFailures.length === 0 && evidence.dependenciesUnchanged && evidence.beforeArtifactUnchanged && evidence.beforeAppearanceArtifactUnchanged && evidence.helpersUnchanged && evidence.teardownValid && evidence.webGLAttempts === 0 && evidence.browserShutdown.exited;
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({output, completed: evidence.completed, passed: evidence.passed, totals: evidence.totals, errors, loadingFailures, failure}));
if (!evidence.passed) process.exitCode = 1;
