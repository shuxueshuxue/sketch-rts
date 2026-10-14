import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import WebSocket from 'ws';

const arg = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const root = resolve(arg('--source') ?? process.cwd());
const output = resolve(arg('--out') ?? 'work/homepage-audio-proof.json');
const scratch = await mkdtemp('/tmp/sketch-homepage-audio-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let server, browser, socket;
const errors = [], requests = [], results = {};
const instrumentation = String.raw`
  const trace = window.homeAudio = { contexts: [], decodes: [], resumes: [], starts: [] };
  const contexts = [];
  const Native = window.AudioContext;
  window.AudioContext = new Proxy(Native, { construct(target, args) {
    const ctx = Reflect.construct(target, args), id = contexts.push(ctx) - 1;
    trace.contexts.push({ id, initialState: ctx.state, at: performance.now() });
    const decode = ctx.decodeAudioData.bind(ctx), resume = ctx.resume.bind(ctx), createSource = ctx.createBufferSource.bind(ctx);
    ctx.decodeAudioData = (...args) => decode(...args).then(buffer => {
      let peak = 0; for (let ch = 0; ch < buffer.numberOfChannels; ch++) for (const sample of buffer.getChannelData(ch)) peak = Math.max(peak, Math.abs(sample));
      trace.decodes.push({ id, duration: buffer.duration, length: buffer.length, peak, state: ctx.state, at: performance.now() }); return buffer;
    });
    ctx.resume = (...args) => { const item = { id, from: ctx.state, at: performance.now() }; trace.resumes.push(item); return resume(...args).then(value => { item.to = ctx.state; item.finishedAt = performance.now(); return value; }); };
    ctx.createBufferSource = (...args) => { const source = createSource(...args), start = source.start.bind(source); source.start = (...times) => {
      trace.starts.push({ id, state: ctx.state, duration: source.buffer?.duration, at: performance.now(), trustedGesture: navigator.userActivation.hasBeenActive }); return start(...times);
    }; return source; };
    return ctx;
  }});
  window.homeAudioState = () => ({ ...trace, liveContexts: contexts.map(ctx => ({ state: ctx.state, currentTime: ctx.currentTime })), settings: JSON.parse(localStorage.getItem('sketch-rts-sound') ?? 'null') });
`;
try {
  server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), cacheDir: resolve(scratch, 'vite'),
    define: { 'import.meta.env.VITE_SOUND_PACK': JSON.stringify('cc0'), 'import.meta.env.VITE_SKETCH_RTS_DEPLOYMENT': JSON.stringify('static') },
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const port = server.httpServer.address().port;
  browser = spawn(arg('--chromium') ?? '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=document-user-activation-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${resolve(scratch, 'chromium')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((done, reject) => { const timeout = setTimeout(() => reject(new Error('Chromium startup timeout')), 30000); browser.once('error', reject); browser.stderr.on('data', bytes => { const match = String(bytes).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); done(match[1]); } }); });
  socket = new WebSocket(endpoint); await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  let serial = 0; const pending = new Map();
  socket.on('message', bytes => { const data = JSON.parse(String(bytes)); if (data.id) { const item = pending.get(data.id); if (!item) return; pending.delete(data.id); clearTimeout(item.timeout); data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.done(data.result); return; }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    if (data.method === 'Network.requestWillBeSent' && /\.(ogg|mp3|wav)(?:\?|$)/.test(data.params.request.url)) requests.push({ url: new URL(data.params.request.url).pathname, query: new URL(data.params.request.url).search, type: data.params.type, at: data.params.timestamp });
  });
  const command = (method, params = {}, sessionId) => new Promise((done, reject) => { const id = ++serial, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 120000); pending.set(id, { done, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }), { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => command(method, params, sessionId);
  const evaluate = async expression => { const value = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text); return value.result.value; };
  const waitFor = expression => evaluate(`new Promise((resolve,reject)=>{const until=performance.now()+90000;const check=()=>{if(${expression})return resolve(true);if(performance.now()>until)return reject(new Error('Audio proof condition timeout'));setTimeout(check,20)};check()})`);
  const click = async selector => { const at = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Missing button');const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await page('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: 1 }); await page('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: 1 }); };
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
  await page('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await waitFor("window.homeAudioState && document.querySelector('[data-open-profile]') && document.querySelector('.resource-screen')?.hidden && homeAudio.decodes.length > 0");
  results.preGesture = await evaluate('homeAudioState()');
  if (results.preGesture.starts.length || results.preGesture.resumes.length || results.preGesture.liveContexts.some(ctx => ctx.state !== 'suspended')) throw new Error('Homepage audio unlocked or played before a gesture');
  if (requests.some(item => item.type !== 'Script' && !/\/click\.ogg$/.test(item.url))) throw new Error('Homepage loaded battle audio');
  await click('[data-open-profile]'); await waitFor('homeAudio.starts.length === 1');
  results.firstClick = await evaluate('homeAudioState()');
  if (results.firstClick.starts[0].state !== 'running' || !results.firstClick.starts[0].trustedGesture || results.firstClick.decodes[0].peak <= 0) throw new Error('First homepage cue did not start real nonempty audio');
  await waitFor("document.querySelector('[data-mute]')");
  await click('[data-mute]');
  results.muted = await evaluate('homeAudioState()');
  if (!results.muted.settings?.muted) throw new Error('Mute setting did not take effect');
  // A second real click on the profile's save action must remain silent.
  await click('[data-profile-form] button[type="submit"]');
  await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
  results.mutedClick = await evaluate('homeAudioState()');
  if (results.mutedClick.starts.length !== 1) throw new Error('Muted interface emitted another voice');
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  await mkdir(dirname(output), { recursive: true }); await writeFile(resolve(dirname(output), 'homepage.png'), Buffer.from(data, 'base64'));
  results.browser = await command('Browser.getVersion');
  results.passed = !errors.length;
  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
} catch (error) { results.passed = false; results.failure = error.stack ?? String(error); process.exitCode = 1; }
finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ sourceRoot: root, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceFiles: Object.fromEntries(await Promise.all(['src/client/sound.ts','src/client/main.ts','src/client/sound-loading.test.ts'].map(async file => [file, hash(await readFile(resolve(root, file)))]))),
    harnessSha256: hash(await readFile(new URL(import.meta.url))), method: 'Fresh Chromium profile, real homepage and native AudioContext, strict browser autoplay policy, instrumented native decode/resume/source start, and trusted CDP pointer events. The test build selects the repository CC0 pack, whose menu navigation uses its existing click cue. Headless has no physical speakers; this proves loaded nonempty audio buffers and browser playback lifecycle, not human hearing.',
    requests, errors, ...results }, null, 2) + '\n');
  socket?.close(); browser?.kill('SIGTERM'); await server?.close(); await rm(scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ output, passed: results.passed, failure: results.failure }));
}
