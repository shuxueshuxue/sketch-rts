/** Complete external gate providers only. No frame observer or shader override. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizePath } from 'vite';

const hash = value => createHash('sha256').update(value).digest('hex');
const clean = id => normalizePath(id.split('?')[0].replace(/^\/@fs(?=\/)/, ''));
const gateFile = 'src/client/world3d/card-mip-residency.ts';
const worldFile = 'src/client/world3d/world-layer.ts';
const originalExpression = 'Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-1)';
const halfExpression = 'Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-.5)';
const expectedCommit = '8345a0dcfeb96b6777ac3940ec64cba13816c851';
const OPTIMIZED_ENTRIES = Object.freeze(['three', 'three/addons/loaders/GLTFLoader.js']);

/** Vite 6's explicit optimizer blocks listen() until include entries finish.
 * The temporary root must resolve the very same installed package. */
export async function prepareMipHalfDependencyRoot(scratch, sourceRoot) {
  const target = await realpath(resolve(sourceRoot, 'node_modules'));
  const link = resolve(scratch, 'node_modules');
  await symlink(target, link, 'dir');
  return { path: link, target, source: resolve(sourceRoot, 'node_modules'), temporaryRootOnly: true };
}

export function mipHalfOptimizeDepsV2() {
  return { include: [...OPTIMIZED_ENTRIES], noDiscovery: true };
}

export async function createMipHalfProviders({ sourceRoot, harnessRoot, candidateSource, mode, scratch, outputDir }) {
  if (!['reference', 'production', 'candidate'].includes(mode)) throw new Error('Use --mode reference|production|candidate');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  if (sourceCommit !== expectedCommit) throw new Error('Half-margin experiment requires frozen 8345a0d HEAD');
  if (execFileSync('git', ['diff', 'HEAD', '--', 'src', 'public'], { cwd: sourceRoot }).length) throw new Error('Half-margin experiment requires unchanged tracked src/public against 8345a0d');
  const files = execFileSync('git', ['ls-files', 'src'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').sort();
  const sources = new Map(await Promise.all(files.map(async file => [normalizePath(resolve(sourceRoot, file)), await readFile(resolve(sourceRoot, file))])));
  const originalPath = normalizePath(resolve(sourceRoot, gateFile)), original = sources.get(originalPath);
  if (!original || !original.equals(execFileSync('git', ['show', `${expectedCommit}:${gateFile}`], { cwd: sourceRoot }))) throw new Error('Original gate is not the exact 8345 source');
  if (original.toString().split(originalExpression).length !== 2) throw new Error('Expected exactly one original margin expression');
  candidateSource = normalizePath(resolve(candidateSource));
  if (candidateSource === originalPath) throw new Error('Half-margin candidate must be external to the production gate');
  const candidate = await readFile(candidateSource);
  if (!candidate.equals(Buffer.from(original.toString().replace(originalExpression, halfExpression)))) throw new Error('Candidate must equal complete production module except -1 to -.5 in the base expression');
  const referencePath = normalizePath(resolve(scratch, 'card-mip-full-reference.ts'));
  const reference = Buffer.from(original.toString().replace('let base=Math.max(0,Math.min(MAX_BASE_MIP,' + originalExpression + '));', 'let base=0;'));
  if (reference.equals(original)) throw new Error('Full-reference expression anchor did not match');
  await writeFile(referencePath, reference);
  const providers = new Map([[originalPath, original], [referencePath, reference], [candidateSource, candidate]]);
  const helperNames = ['art-card-bank-camera-fixture.js', 'art-card-mip-camera-fixture.js', 'art-card-bank-variant.js', 'art-gpu-completion.mjs', 'art-viewport-bank-mixed-fixture.js', 'art-viewport-bank-canonical-fixture.js', 'art-viewport-streaming-fixture.js', 'art-viewport-fixture.js', 'art-card-bank-viewport-metadata.js'];
  const helpers = new Map(await Promise.all(helperNames.map(async name => {
    const path = normalizePath(resolve(harnessRoot, 'scripts', name));
    return [path, await readFile(path)];
  })));
  const selectedPath = mode === 'reference' ? referencePath : mode === 'production' ? originalPath : candidateSource;
  const records = [], loaded = [], thirdParty = new Map();
  const metadata = {
    version: 2, mode, expectedCommit, sourceCommit, originalPath, candidateSource, selectedPath,
    selectedSha256: hash(providers.get(selectedPath)), candidateExactSingleExpressionDifference: true,
    sourceSha256: Object.fromEntries([...sources].map(([path, bytes]) => [path.slice(normalizePath(sourceRoot).length + 1), hash(bytes)])),
    sourcePublicTree: execFileSync('git', ['rev-parse', 'HEAD:public'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
    sourceSnapshots: [], providerSnapshots: [], helperSnapshots: [], resolveRecords: records, loadedModules: loaded,
    policy: { reference: 'Complete original gate, final base expression is 0; full original native chain', production: 'Complete 8345 gate, one-level margin', candidate: 'Complete 8345 gate, half-level margin' },
    setup: 'Vite pre-resolve replaces only World3DLayer ./card-mip-residency import with one complete frozen module. All relative provider dependencies resolve through the original production gate location. All public Three imports resolve through current World3DLayer. No per-frame wrapper, pose/key traversal, shader override, source raster crop or input change.',
    limitations: 'Anisotropic LOD/filter algorithms and generateMipmap kernels are implementation dependent. Half-level eligibility is a candidate, not a portable pixel-equivalence theorem. Current warm cache reuses finer chains and does not demote them; smaller requested bases mainly affect newly allocated/rebuilt cards. Correctness captures and fence/readback time are not performance measurements.'
  };
  metadata.dependencyPreparation = { optimizeDeps: mipHalfOptimizeDepsV2(), expectedEntries: [...OPTIMIZED_ENTRIES], beforeBrowserLaunch: true,
    method: 'Same Vite 6 explicit optimizer include/noDiscovery in every mode. Await server.listen(), whose client environment listen awaits explicit optimization init, then verify both entries and archive completed bundles before starting Chromium. Preserve full IDs including version queries; no guard relaxation.' };
  const loaderSource = `
import * as THREE from 'three';
const paths=${JSON.stringify([...providers.keys()])};
const modules=await Promise.all(paths.map(path=>import(/* @vite-ignore */ '/@fs'+path)));
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const probe={sourceSize:512,tileSize:128,foot:17,matrix:new THREE.Matrix4(),passes:[{camera:new THREE.OrthographicCamera(-512,512,288,-288,1,12000),physicalWidth:1280,physicalHeight:720}]};
const reports=[];
for(let i=0;i<modules.length;i++){
 const module=modules[i];if(typeof module.cardBaseMip!=='function'||typeof module.cardMipFootprint!=='function')throw new Error('Complete gate exports missing');
 const baseSource=module.cardBaseMip.toString(),footprintSource=module.cardMipFootprint.toString();
 reports.push({path:paths[i],baseSource,baseSha256:await sha(baseSource),footprintSource,footprintSha256:await sha(footprintSource),probeBase:module.cardBaseMip(probe),probeFootprint:module.cardMipFootprint(probe)});
}
if(reports[1].probeBase!==0)throw new Error('Full-reference module did not return mip zero');
if(reports.some(row=>row.footprintSha256!==reports[0].footprintSha256))throw new Error('Gate footprint function changed');
window.mipHalfGateReview={ready:true,mode:${JSON.stringify(mode)},selectedPath:${JSON.stringify(selectedPath)},threeRevision:THREE.REVISION,providers:reports,balancedCompleteProvidersLoadedBeforeInit:true,perFrameOverrides:false};
`;
  metadata.loaderSha256 = hash(loaderSource);
  await writeFile(resolve(scratch, 'mip-half-loader.js'), loaderSource);
  const worldPath = normalizePath(resolve(sourceRoot, worldFile));
  const plugin = {
    name: 'frozen-complete-half-margin-gate', enforce: 'pre',
    async resolveId(request, importer) {
      const importerPath = importer ? clean(importer) : '';
      if (request === './card-mip-residency' && importerPath === worldPath) {
        records.push({ request, importer, resolvedId: selectedPath, purpose: 'selected-complete-gate', providerSha256: metadata.selectedSha256 });
        return selectedPath;
      }
      const externalProvider = providers.has(importerPath) && importerPath !== originalPath;
      const inSource = importerPath.startsWith(normalizePath(sourceRoot) + '/src/');
      const inScratch = importerPath.startsWith(normalizePath(scratch) + '/');
      const inHarness = importerPath.includes('/scripts/');
      if (!externalProvider && !inSource && !inScratch && !inHarness) return null;
      const from = externalProvider && request.startsWith('.') ? originalPath : importer;
      if (request === 'three') {
        const resolved = await this.resolve(request, worldPath, { skipSelf: true });
        if (!resolved) throw new Error('Cannot resolve canonical current Three');
        records.push({ request, importer, resolvedId: resolved.id, currentResolvedId: resolved.id, sameThreeIdentity: true, purpose: 'current-context-public-three' });
        return resolved;
      }
      const resolved = await this.resolve(request, from, { skipSelf: true });
      records.push({ request, importer, resolutionImporter: from, resolvedId: resolved?.id ?? null, purpose: externalProvider ? 'external-provider-dependency' : 'original-module-dependency', redirectedRelativeDependency: externalProvider && request.startsWith('.') });
      return resolved;
    },
    async load(id) {
      const path = clean(id), bytes = providers.get(path) ?? sources.get(path) ?? helpers.get(path);
      if (bytes) {
        loaded.push({ id, path, sha256: hash(bytes), frozenRunStartBytes: true, kind: providers.has(path) ? 'gate-provider' : helpers.has(path) ? 'original-fixture-helper' : 'production-source' });
        return bytes.toString('utf8');
      }
      if (path.startsWith(normalizePath(sourceRoot) + '/src/')) throw new Error('Source module is outside frozen tracked source inventory: ' + path);
      if (path.includes('/node_modules/') && /\.(?:m?js)$/.test(path)) {
        try { thirdParty.set(path, { id, path, sha256: hash(await readFile(path)) }); } catch {}
      }
      return null;
    }
  };
  async function archive() {
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(outputDir, 'mip-half-loader.js'), loaderSource);
    metadata.helperSnapshots = [];
    for (const [path, bytes] of helpers) {
      const snapshot = 'runtime-helper-snapshots/' + path.split('/').at(-1);
      await mkdir(dirname(resolve(outputDir, snapshot)), { recursive: true });
      await writeFile(resolve(outputDir, snapshot), bytes);
      metadata.helperSnapshots.push({ path, sha256: hash(bytes), snapshot });
    }
    metadata.providerSnapshots = [];
    for (const [path, bytes] of providers) {
      const filename = path === originalPath ? 'production-gate.ts' : path === referencePath ? 'full-reference-gate.ts' : 'candidate-half-gate.ts';
      await writeFile(resolve(outputDir, filename), bytes);
      metadata.providerSnapshots.push({ path, sha256: hash(bytes), snapshot: filename });
    }
    if (!metadata.sourceSnapshots.length) for (const [path, bytes] of sources) {
      const file = path.slice(normalizePath(sourceRoot).length + 1), snapshot = 'source-snapshot/' + file;
      await mkdir(dirname(resolve(outputDir, snapshot)), { recursive: true });
      await writeFile(resolve(outputDir, snapshot), bytes);
      metadata.sourceSnapshots.push({ path, relativePath: file, sha256: hash(bytes), snapshot });
    }
  }
  async function inspectRuntime(evaluate) {
    const runtime = await evaluate("import('/mip-half-loader.js').then(()=>window.mipHalfGateReview)");
    metadata.runtime = runtime;
    if (!runtime.balancedCompleteProvidersLoadedBeforeInit || runtime.perFrameOverrides || runtime.selectedPath !== selectedPath || runtime.mode !== mode) throw new Error('Gate runtime isolation invalid');
    if (!records.some(row => row.purpose === 'selected-complete-gate' && row.resolvedId === selectedPath)) throw new Error('World3DLayer did not resolve the selected gate');
    const three = records.filter(row => row.sameThreeIdentity);
    if (!three.length || new Set(three.map(row => row.resolvedId)).size !== 1) throw new Error('Multiple canonical Three module identities');
    return runtime;
  }
  async function dependencySnapshot(server, label) {
    const environment = server.environments?.client;
    const optimizer = environment?.depsOptimizer;
    if (!optimizer || !optimizer.options.noDiscovery || JSON.stringify(optimizer.options.include) !== JSON.stringify(OPTIMIZED_ENTRIES)) throw new Error('V2 dependency optimizer configuration is not the exact explicit include policy');
    const depMetadata = optimizer.metadata;
    if (Object.keys(depMetadata.discovered).length) throw new Error('V2 optimizer has unfinished discovered dependencies');
    const optimized = Object.keys(depMetadata.optimized).sort();
    if (JSON.stringify(optimized) !== JSON.stringify([...OPTIMIZED_ENTRIES].sort())) throw new Error('V2 optimizer did not complete precisely both Three entry points');
    const entries = [], chunks = [];
    for (const [kind, collection, rows] of [['optimized', depMetadata.optimized, entries], ['chunks', depMetadata.chunks, chunks]]) {
      for (const [name, info] of Object.entries(collection)) {
        if (info.processing) throw new Error('V2 optimized dependency still processing: ' + name);
        const bytes = await readFile(info.file), sha256 = hash(bytes), snapshot = 'optimized-dependency-snapshots/' + sha256 + '.js';
        await mkdir(dirname(resolve(outputDir, snapshot)), { recursive: true });
        await writeFile(resolve(outputDir, snapshot), bytes);
        rows.push({ name, kind, file: info.file, source: info.src ?? null, browserHash: info.browserHash, fileHash: info.fileHash ?? null,
          resolvedId: optimizer.getOptimizedDepId(info), bytes: bytes.length, sha256, snapshot });
      }
    }
    const result = { label, hash: depMetadata.hash, lockfileHash: depMetadata.lockfileHash, configHash: depMetadata.configHash,
      browserHash: depMetadata.browserHash, entries, chunks, discovered: [], optimizationComplete: true };
    return result;
  }
  async function inspectStartup(server, dependencyRoot) {
    metadata.dependencyPreparation.temporaryDependencyRoot = dependencyRoot;
    metadata.dependencyPreparation.startup = await dependencySnapshot(server, 'before-browser-launch');
    return metadata.dependencyPreparation.startup;
  }
  async function finish(server) {
    metadata.finalSourceSha256 = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(sourceRoot, file)))])));
    metadata.sourceStayedFrozen = JSON.stringify(metadata.sourceSha256) === JSON.stringify(metadata.finalSourceSha256) && !execFileSync('git', ['diff', 'HEAD', '--', 'src', 'public'], { cwd: sourceRoot }).length;
    metadata.candidateStayedFrozen = candidate.equals(await readFile(candidateSource));
    metadata.helpersStayedFrozen = true;
    for (const [path, bytes] of helpers) if (!bytes.equals(await readFile(path))) metadata.helpersStayedFrozen = false;
    metadata.thirdPartyModules = [];
    for (const item of thirdParty.values()) metadata.thirdPartyModules.push({ ...item, unchangedAtFinish: hash(await readFile(item.path)) === item.sha256 });
    metadata.moduleGraph = [...server.moduleGraph.idToModuleMap.values()].map(module => ({ id: module.id, url: module.url, importers: [...module.importers].map(item => item.id), dependencies: [...module.importedModules].map(item => item.id) }));
    metadata.sameContextThreeResolvedIds = [...new Set(records.filter(row => row.sameThreeIdentity).map(row => row.resolvedId))];
    metadata.dependencyPreparation.finish = await dependencySnapshot(server, 'after-final-draw');
    const stable = snapshot => JSON.stringify({ ...snapshot, label: undefined });
    metadata.dependencyPreparation.stayedStable = stable(metadata.dependencyPreparation.startup) === stable(metadata.dependencyPreparation.finish);
    await archive();
    if (!metadata.sourceStayedFrozen || !metadata.candidateStayedFrozen || !metadata.helpersStayedFrozen || metadata.thirdPartyModules.some(row => !row.unchangedAtFinish)) throw new Error('Source/provider/helper/dependency changed during half-margin capture');
    if (!metadata.dependencyPreparation.stayedStable || metadata.sameContextThreeResolvedIds.length !== 1) throw new Error('V2 optimized dependencies or full Three identity changed during capture');
    const expectedThree = metadata.dependencyPreparation.startup.entries.find(row => row.name === 'three')?.resolvedId;
    if (metadata.sameContextThreeResolvedIds[0] !== expectedThree) throw new Error('Three imports do not match the completed startup optimized entry including its query');
  }
  return { plugin, metadata, archive, inspectRuntime, inspectStartup, finish, allowed: [dirname(candidateSource)], loaderSource };
}
