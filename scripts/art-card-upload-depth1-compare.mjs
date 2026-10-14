/** Untimed, strict comparison of two completed depth-one uploader proofs.
 * Usage: node scripts/art-card-upload-depth1-compare.mjs --original RUN --candidate RUN --out NEW_DIR
 * Inputs are immutable capture artifacts. No browser or simulation is started.
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanvas, loadImage} from '@napi-rs/canvas';

const argv = process.argv.slice(2);
const arg = name => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };
if (!arg('--original') || !arg('--candidate') || !arg('--out')) {
  console.error('Required: --original RUN --candidate RUN --out NEW_DIR'); process.exit(2);
}
const roots = {original: resolve(arg('--original')), candidate: resolve(arg('--candidate'))};
const out = resolve(arg('--out'));
if (roots.original === roots.candidate || Object.values(roots).some(p => out === p || out.startsWith(p + sep))) {
  throw new Error('Distinct input roots and an independent output directory are required');
}
await mkdir(dirname(out), {recursive: true});
await mkdir(out); // Exclusive: never overwrite an earlier result, including a failed result.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frozenCommit = '42bd61c74934dc76f30d42b62e1e31eb5c5974ff';
const captureTicks = [0, 18, 19, 36, 55, 74, 93, 112, 120, 180, 302];
const uploader = 'src/client/world3d/card-mip-uploader.ts';
// Independently frozen archive identities, not hashes supplied by the two runs.
const frozenSourceSet = '99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0';
const originalUploaderSha256 = '3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295';
const candidateUploaderSha256 = '2bfd78fa7260240fd151fbd3bff1bb0b20557d61ac387b7f3fddcd9643e46813';
const allowedReplacements = [
  {before: 'type Scratch={texture:THREE.DataTexture;', after: 'type Scratch={texture:THREE.DataArrayTexture;'},
  {before: 'private uploadDestination=new THREE.Vector2();', after: 'private uploadDestination=new THREE.Vector3();'},
  {before: 'texture=new THREE.DataTexture(data,width,height);', after: 'texture=new THREE.DataArrayTexture(data,width,height,1);'},
  {before: 'this.uploadDestination.set(region.left,region.top);', after: 'this.uploadDestination.set(region.left,region.top,0);'},
];
const stageClocks = ['paintMs', 'readbackMs', 'cacheMs', 'pickMaskMs', 'rowFlipMs', 'slotMs'];
const excludedTimingFields = ['cards.gpuTransferSubmissionWallMs', 'cards.rasterWorkWallMs', 'cards.rasterCache.workMs', 'cards.rasterCache.avoidedPaintMs', ...stageClocks.map(k => 'cards.rasterStages.' + k)];
const differences = [], checks = [], inputs = [], images = [], sourceProofs = {}, timing = {};
const own = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);
const fail = (path, reason, detail = {}) => differences.push({path, reason, ...detail});
function check(path, condition, detail = {}) {
  checks.push({path, passed: !!condition});
  if (!condition) fail(path, 'Required invariant failed', detail);
}
function fields(o, names, path) { for (const k of names) check(path + '.' + k + '.present', own(o, k)); }
function object(o, path) { check(path, o !== null && typeof o === 'object' && !Array.isArray(o)); }
function array(o, count, path) { check(path, Array.isArray(o) && (count === undefined || o.length === count), {expectedLength: count, actualLength: o?.length}); }
function flags(o, names, path) { fields(o, names, path); for (const k of names) check(path + '.' + k, o?.[k] === true); }
function same(a, b, path) {
  if (Object.is(a, b)) { if (a === undefined) fail(path, 'Both values are missing'); return; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    fail(path, 'Values differ', {original: a ?? null, candidate: b ?? null, originalMissing: a === undefined, candidateMissing: b === undefined}); return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) fail(path + '.length', 'Array lengths differ', {original: a.length, candidate: b.length});
    for (let n = 0; n < Math.max(a.length, b.length); n++) {
      if (n >= a.length || n >= b.length) fail(path + '[' + n + ']', 'Array element missing', {original: a[n] ?? null, candidate: b[n] ?? null});
      else same(a[n], b[n], path + '[' + n + ']');
    }
  } else {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!own(a, k) || !own(b, k)) fail(path + '.' + k, 'Object field missing', {original: a[k] ?? null, candidate: b[k] ?? null});
      else same(a[k], b[k], path + '.' + k);
    }
  }
}
function inside(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.split('/').some(p => !p || p === '.' || p === '..') || relativePath.startsWith('/')) throw new Error('Unsafe artifact path: ' + relativePath);
  const file = resolve(root, relativePath);
  if (!file.startsWith(root + sep)) throw new Error('Artifact escapes input root');
  return file;
}
async function bytes(role, name) {
  const value = await readFile(inside(roots[role], name));
  inputs.push({role, file: name, bytes: value.length, sha256: sha(value)}); return value;
}
async function json(role, name, proof) {
  const value = await bytes(role, name);
  if (proof) {
    const rows = proof.exports?.filter(row => row.file === name);
    check(role + '.exports.' + name + '.unique', rows?.length === 1);
    const row = rows?.[0];
    fields(row, ['bytes', 'sha256', 'characters', 'chunks', 'sliceCharacters'], role + '.exports.' + name);
    check(role + '.exports.' + name + '.exactBytes', row?.bytes === value.length && row?.sha256 === sha(value) && row?.characters === value.toString('utf8').length);
  }
  return JSON.parse(value);
}
function sequence(seq, path) {
  array(seq, undefined, path); check(path + '.nonempty', seq?.length > 0);
  return seq.map((call, n) => {
    fields(call, ['method', 'targetTexture', 'args'], path + '[' + n + ']');
    if (!call.targetTexture?.includes(':scratch:')) return call;
    const a = call.args;
    if (call.method === 'texSubImage3D') {
      check(path + '[' + n + '].depthOneScratch', a?.[0] === 35866 && a[4] === 0 && a[7] === 1);
      return {...call, method: 'texSubImage2D', args: [3553, a[1], a[2], a[3], a[5], a[6], ...a.slice(8)]};
    }
    if (call.method === 'generateMipmap' && a?.[0] === 35866) return {...call, args: [3553]};
    return call;
  });
}
function picks(values, path) {
  array(values, 1590, path);
  values.forEach((p, n) => {
    fields(p, ['x', 'y', 'hit'], path + '[' + n + ']');
    check(path + '[' + n + '].grid', p.x === 12 + n % 53 * 24 && p.y === 12 + Math.floor(n / 53) * 24);
    check(path + '[' + n + '].hit', p.hit === null || (typeof p.hit === 'object' && typeof p.hit.id === 'string'));
  });
}
function mathematicalCards(role, shot, n) {
  const cards = shot.cards, path = role + '.gameplay.capture[' + n + '].cards', clocks = {};
  const record = (o, k, field) => {
    check(path + '.' + field + '.clock', own(o, k) && Number.isFinite(o[k]) && o[k] >= 0);
    clocks['cards.' + field] = o?.[k] ?? null;
  };
  record(cards, 'gpuTransferSubmissionWallMs', 'gpuTransferSubmissionWallMs');
  record(cards, 'rasterWorkWallMs', 'rasterWorkWallMs');
  object(cards.rasterCache, path + '.rasterCache'); object(cards.rasterStages, path + '.rasterStages');
  record(cards.rasterCache, 'workMs', 'rasterCache.workMs'); record(cards.rasterCache, 'avoidedPaintMs', 'rasterCache.avoidedPaintMs');
  same(Object.keys(cards.rasterStages).sort(), [...stageClocks].sort(), path + '.rasterStages.exactClockKeys');
  for (const k of stageClocks) record(cards.rasterStages, k, 'rasterStages.' + k);
  timing[role].excludedTimingActualValues.push({tick: shot.tick, fields: clocks});
  const {gpuTransferSubmissionWallMs, rasterWorkWallMs, rasterCache, rasterStages, ...rest} = cards;
  const {workMs, avoidedPaintMs, ...cacheState} = rasterCache;
  const stages = {...rasterStages}; for (const k of stageClocks) delete stages[k];
  return {...rest, rasterCache: cacheState, rasterStages: stages};
}
async function imagePair(name, originalUrl, candidateUrl) {
  const decoded = [];
  for (const [role, url] of [['original', originalUrl], ['candidate', candidateUrl]]) {
    const png = await bytes(role, name);
    check(role + '.' + name + '.png', png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    check(role + '.' + name + '.exportDataUrl', typeof url === 'string' && url.startsWith('data:image/png;base64,') && Buffer.from(url.slice(22), 'base64').equals(png));
    const image = await loadImage(png);
    check(role + '.' + name + '.dimensions', image.width === 1280 && image.height === 720);
    const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const rgba = Buffer.from(context.getImageData(0, 0, image.width, image.height).data);
    let opaque = true; for (let n = 3; n < rgba.length; n += 4) if (rgba[n] !== 255) { opaque = false; break; }
    // These captures have an opaque composite background. Fail if that premise
    // changes, so canvas premultiplication cannot conceal transparent RGB data.
    check(role + '.' + name + '.opaqueComposite', opaque);
    decoded.push({width: image.width, height: image.height, rgba, pngSha256: sha(png)});
  }
  const [a, b] = decoded, row = {file: name, width: a.width, height: a.height, originalPngSha256: a.pngSha256, candidatePngSha256: b.pngSha256, originalRgbaSha256: sha(a.rgba), candidateRgbaSha256: sha(b.rgba), changedPixels: 0, changedChannels: 0, samples: []};
  check(name + '.sameDimensions', a.width === b.width && a.height === b.height && a.rgba.length === b.rgba.length);
  if (a.rgba.length === b.rgba.length) {
    for (let p = 0; p < a.rgba.length; p += 4) {
      let changed = false;
      for (let c = 0; c < 4; c++) if (a.rgba[p + c] !== b.rgba[p + c]) { row.changedChannels++; changed = true; }
      if (changed) { row.changedPixels++; if (row.samples.length < 20) row.samples.push({x: p / 4 % a.width, y: Math.floor(p / 4 / a.width), original: [...a.rgba.subarray(p, p + 4)], candidate: [...b.rgba.subarray(p, p + 4)]}); }
    }
    if (row.changedPixels) {
      const xor = Buffer.alloc(a.rgba.length); for (let n = 0; n < xor.length; n++) xor[n] = a.rgba[n] ^ b.rgba[n];
      row.fullDifference = {file: name + '.rgba-xor.bin', bytes: xor.length, sha256: sha(xor)};
      await writeFile(resolve(out, row.fullDifference.file), xor, {flag: 'wx'});
    }
  }
  row.passed = a.width === b.width && a.height === b.height && a.rgba.equals(b.rgba);
  images.push(row); check(name + '.fullRGBAExact', row.passed, row);
}
async function source(role, p) {
  const s = p.sourceInventory, path = role + '.sourceInventory';
  object(s, path); fields(s, ['sourceSha256', 'finalSourceSha256', 'gitSourceBlobSha1', 'sourcePublicTree', 'sourceSnapshots', 'helperSnapshots', 'loadedModules', 'thirdPartyModules', 'sameContextThreeResolvedIds', 'dependencyPreparation', 'uploaderOverride'], path);
  check(path + '.commit', s.expectedCommit === frozenCommit && s.originalSourceCount === 1125);
  flags(s, ['sourceStayedFrozen', 'helpersStayedFrozen'], path);
  object(s.sourceSha256, path + '.sourceSha256'); check(path + '.sourceCount', Object.keys(s.sourceSha256).length === 1125);
  same(s.sourceSha256, s.finalSourceSha256, path + '.sourceStayedIdentical');
  same(Object.keys(s.sourceSha256).sort(), Object.keys(s.gitSourceBlobSha1).sort(), path + '.gitBlobCoverage');
  array(s.sourceSnapshots, 1125, path + '.sourceSnapshots');
  const seen = new Set(), sourceFiles = []; let totalBytes = 0;
  for (const row of s.sourceSnapshots) {
    fields(row, ['relativePath', 'snapshot', 'sha256'], path + '.sourceSnapshot');
    check(path + '.' + row.relativePath + '.unique', !seen.has(row.relativePath)); seen.add(row.relativePath);
    check(path + '.' + row.relativePath + '.snapshotPath', row.snapshot === 'complete-source-snapshot/' + row.relativePath);
    const b = await readFile(inside(roots[role], row.snapshot)); totalBytes += b.length;
    // Key order matches compact sorted-key JSON used by the frozen archive.
    sourceFiles.push({name: row.relativePath, sha256: sha(b), size: b.length});
    const blob = createHash('sha1').update(Buffer.from('blob ' + b.length + '\0')).update(b).digest('hex');
    check(path + '.' + row.relativePath + '.fullShaAndGitBlob', sha(b) === row.sha256 && row.sha256 === s.sourceSha256[row.relativePath] && blob === s.gitSourceBlobSha1[row.relativePath]);
  }
  sourceFiles.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const fileSetSha256 = sha(JSON.stringify(sourceFiles));
  check(path + '.independentFrozenSourceSet', totalBytes === 9687156 && fileSetSha256 === frozenSourceSet, {bytes: totalBytes, fileSetSha256, expectedFileSetSha256: frozenSourceSet});
  same([...seen].sort(), Object.keys(s.sourceSha256).sort(), path + '.archivedCoverage');
  array(s.helperSnapshots, undefined, path + '.helperSnapshots'); check(path + '.helpersNonempty', s.helperSnapshots.length > 0);
  for (const row of s.helperSnapshots) { const b = await bytes(role, row.snapshot); check(path + '.' + row.snapshot + '.sha', sha(b) === row.sha256); }
  for (const [name, expected] of Object.entries(p.toolSha256)) { const b = await bytes(role, name); check(role + '.tool.' + name + '.sha', sha(b) === expected); }
  array(s.thirdPartyModules, undefined, path + '.thirdPartyModules'); check(path + '.thirdPartyNonempty', s.thirdPartyModules.length > 0);
  for (const row of s.thirdPartyModules) check(path + '.thirdParty.' + row.id + '.unchanged', row.unchangedAtFinish === true);
  array(s.sameContextThreeResolvedIds, 1, path + '.threeIdentity');
  flags(s.dependencyPreparation, ['noDiscovery', 'beforeBrowserLaunch', 'stayedStable'], path + '.dependencies');
  for (const label of ['startup', 'finish']) {
    const d = s.dependencyPreparation[label]; flags(d, ['optimizationComplete'], path + '.dependencies.' + label);
    array(d.entries, 2, path + '.dependencies.' + label + '.entries'); array(d.discovered, 0, path + '.dependencies.' + label + '.discovered');
    check(path + '.dependencies.' + label + '.threeIdentity', d.entries.find(row => row.name === 'three')?.resolvedId === s.sameContextThreeResolvedIds[0]);
  }
  const u = s.uploaderOverride;
  flags(u, ['unchangedAtFinish', 'executedModuleLoaded', 'executionStayedPinned'], path + '.override');
  check(path + '.override.originalIdentity', u.originalRelativePath === uploader && u.originalSha256 === s.sourceSha256[uploader] && u.originalGitBlobSha1 === s.gitSourceBlobSha1[uploader]);
  check(path + '.override.policy', u.enabled === (role === 'candidate'));
  array(u.executedRows, undefined, path + '.override.executedRows'); check(path + '.override.executedRows.nonempty', u.executedRows.length > 0);
  const expected = role === 'candidate' ? p.candidateMetadata.candidateSha256 : p.candidateMetadata.sourceSha256;
  check(path + '.override.executedSha256', u.executedSha256 === expected);
  for (const row of u.executedRows) check(path + '.override.row', row.executedSha256 === expected && row.kind === (role === 'candidate' ? 'executed-uploader-override' : 'production-source') && (role !== 'candidate' || row.originalSourceSha256 === s.sourceSha256[uploader]));
  for (const row of u.executedRows) {
    const loaded = s.loadedModules.filter(v => v.id === row.id && v.path === u.originalLogicalPath);
    check(path + '.override.loadedModuleIdentity', loaded.length === 1 && loaded[0].sha256 === expected && loaded[0].executedSha256 === expected && loaded[0].kind === row.kind && loaded[0].frozenRunStartBytes === true && (role !== 'candidate' || (loaded[0].originalSourceSha256 === originalUploaderSha256 && loaded[0].executedSnapshot === 'executed-candidate.ts')));
  }
  const original = await bytes(role, 'complete-source-snapshot/' + uploader);
  check(path + '.override.originalBytes', u.originalBytes === original.length && sha(original) === p.candidateMetadata.sourceSha256);
  if (role === 'candidate') {
    check(path + '.override.snapshot', u.overrideSnapshot === 'executed-candidate.ts');
    const executed = await bytes(role, u.overrideSnapshot); let rebuilt = original.toString('utf8');
    array(p.candidateMetadata.replacements, undefined, role + '.candidateMetadata.replacements'); check(role + '.candidateMetadata.replacements.nonempty', p.candidateMetadata.replacements.length > 0);
    for (const row of p.candidateMetadata.replacements) {
      check(role + '.replacement.uniqueAnchor', typeof row.before === 'string' && row.before.length > 0 && typeof row.after === 'string' && rebuilt.split(row.before).length === 2);
      rebuilt = rebuilt.replace(row.before, row.after);
    }
    check(path + '.override.exactReconstruction', Buffer.from(rebuilt).equals(executed) && sha(executed) === expected && u.overrideSha256 === expected && u.finalOverrideSha256 === expected && u.overrideBytes === executed.length && u.finalOverrideBytes === executed.length);
  } else check(path + '.override.noCandidate', u.overridePath === null && u.overrideSnapshot === null && u.overrideSha256 === null && u.overrideBytes === null);
  sourceProofs[role] = {count: seen.size, bytes: totalBytes, fileSetSha256, frozenSourceSetSha256: frozenSourceSet, originalSourceMapSha256: sha(JSON.stringify(Object.entries(s.sourceSha256).sort())), gitBlobMapSha256: sha(JSON.stringify(Object.entries(s.gitSourceBlobSha1).sort())), uploaderOriginalSha256: u.originalSha256, uploaderExecutedSha256: u.executedSha256, candidateSeparatelyArchived: role === 'candidate'};
}
function proof(role, p) {
  const path = role + '.proof';
  fields(p, ['version', 'sourceCommit', 'policy', 'candidateMetadata', 'toolSha256', 'sourceInventory', 'completed', 'errors', 'arms', 'exports', 'corpus', 'actualInputs', 'actualCapture', 'gameplay', 'validation', 'runtimeScripts', 'browserTeardownComplete'], path);
  check(path + '.identity', p.version === 1 && p.sourceCommit === frozenCommit && p.policy === role && p.expectedUploads === 53 && p.formalTiming === false);
  flags(p, ['completed', 'browserTeardownComplete'], path); array(p.errors, 0, path + '.errors');
  check(path + '.noFailure', !own(p, 'failure') && !own(p, 'failureStack'));
  flags(p.validation, ['passed', 'actual53Payloads', 'candidateExactReplacements', 'fullPriorAndFinalNativeStateExact', 'perEventNativeOracleExact', 'runtimeHttpModulesCovered'], path + '.validation');
  flags(p.runtimeScripts, ['started', 'finished', 'passed'], path + '.runtimeHttp'); array(p.runtimeScripts.coverageGaps, 0, path + '.runtimeHttp.coverageGaps');
  const coverage = p.runtimeScripts.coverageSummary;
  check(path + '.runtimeHttp.fullCoverage', Number.isInteger(coverage?.relevantInventoryEntries) && coverage.relevantInventoryEntries > 0 && coverage.coveredInventoryEntries === coverage.relevantInventoryEntries && coverage.capturedScriptBodies === coverage.scriptResponses && coverage.scriptResponses > 0);
  check(path + '.corpus', p.corpus.checksumVerifiedBeforeBrowser === true && p.corpus.originalRunExit1Retained === true && p.corpus.decodedBytes === 123861068 && p.corpus.decodedSha256 === '78cbe11c56cc3ca61949f6bff83b7307136bc225366f3ec4fb507e4257fe5721' && p.corpus.expectedCapturedExport?.bytes === p.corpus.decodedBytes && p.corpus.expectedCapturedExport?.sha256 === p.corpus.decodedSha256);
  check(path + '.actualInputs', p.actualInputs.uploads === 53 && p.actualInputs.n === 135 && Number.isInteger(p.actualInputs.events) && p.actualInputs.events >= 53 && p.actualInputs.sourceFullBytes > 0);
  flags(p.candidateMetadata, ['candidateExactReplacements', 'productionUnchanged'], path + '.candidateMetadata'); check(path + '.candidateCommit', p.candidateMetadata.sourceCommit === frozenCommit);
  check(path + '.frozenUploaderIdentities', p.candidateMetadata.sourceSha256 === originalUploaderSha256 && p.candidateMetadata.candidateSha256 === candidateUploaderSha256);
  same(p.candidateMetadata.replacements, allowedReplacements, path + '.reviewedExactFourReplacements');
  array(p.arms, 2, path + '.arms'); array(p.exports, 4, path + '.exports'); object(p.toolSha256, path + '.toolSha256'); check(path + '.toolsCount', Object.keys(p.toolSha256).length === 6);
}
function actual(role, a, p) {
  fields(a, ['validation', 'pixelFacts', 'glContentSequence', 'picks', 'screenshot'], role + '.actual');
  flags(a.validation, ['passed', 'completeUploadInputAndEventOrderExact', 'completePriorAndFinalNativeStateExact', 'batchOwnershipExact', 'factsExact', 'transferCountsAndBytesExact', 'nativeSequenceExactExceptExplicitScratchTarget'], role + '.actual.validation');
  check(role + '.actual.uploads', a.validation.actualUploads === 53);
  fields(a.pixelFacts, ['tick', 'units', 'effects'], role + '.actual.pixelFacts'); check(role + '.actual.tick', a.pixelFacts.tick === 45); array(a.pixelFacts.units, 100, role + '.actual.units'); array(a.pixelFacts.effects, undefined, role + '.actual.effects');
  picks(a.picks, role + '.actual.picks'); same(p.actualCapture.validation, a.validation, role + '.actual.proofValidation');
  check(role + '.actual.proofPicks', p.actualCapture.pickSamples === a.picks.length && p.actualCapture.screenshot === 'actual-n135.png');
  same(p.actualCapture.uniquePickedIds, [...new Set(a.picks.flatMap(v => v.hit ? [v.hit.id] : []))], role + '.actual.proofPickedIds');
}
function gameplay(role, g, p) {
  fields(g, ['passed', 'spiritId', 'attackerId', 'deadTick', 'hits', 'spiritTargetHits', 'snapshots', 'checksums', 'bloodCounts', 'captures'], role + '.gameplay'); flags(g, ['passed'], role + '.gameplay');
  check(role + '.gameplay.unitIds', typeof g.spiritId === 'string' && typeof g.attackerId === 'string' && g.spiritId !== g.attackerId);
  array(g.hits, 11, role + '.gameplay.hits'); array(g.spiritTargetHits, 6, role + '.gameplay.spiritTargetHits');
  same(g.spiritTargetHits, g.hits.filter(hit => hit.effect?.unitId === g.spiritId), role + '.gameplay.independentIncomingHits');
  check(role + '.gameplay.deathTick', g.deadTick === 112);
  for (const name of ['snapshots', 'checksums', 'bloodCounts']) {
    array(g[name], 303, role + '.gameplay.' + name);
    g[name].forEach((v, n) => check(role + '.gameplay.' + name + '[' + n + '].tick', v.tick === n));
  }
  g.snapshots.forEach((v, n) => { array(v.units, undefined, role + '.gameplay.snapshot.units'); check(role + '.gameplay.spiritAlive[' + n + ']', v.units.some(u => u.id === g.spiritId) === (n < 112)); });
  g.checksums.forEach((v, n) => { fields(v, ['beforeDraw', 'afterDraw'], role + '.gameplay.checksum[' + n + ']'); check(role + '.gameplay.drawDidNotChangeSimulation[' + n + ']', v.beforeDraw !== undefined && v.beforeDraw === v.afterDraw); });
  g.bloodCounts.forEach((v, n) => check(role + '.gameplay.noBlood[' + n + ']', v.air === 0 && v.ground === 0 && v.body === 0));
  array(g.captures, 11, role + '.gameplay.captures'); same(g.captures.map(v => v.tick), captureTicks, role + '.gameplay.captureTicks');
  timing[role] = {scope: 'Untimed diagnostic captures. Listed clocks are recorded, not claimed equal, and excluded only from mathematical state equality; no FPS or performance conclusion.', nativeArms: p.arms.map(a => ({policy: a.policy, submissionMs: a.submissionMs, waitMs: a.waitMs, envelopeMs: a.envelopeMs})), excludedTimingActualValues: []};
  g.captures.forEach((v, n) => {
    fields(v, ['tick', 'png', 'picks', 'cards', 'gpuInk'], role + '.gameplay.capture[' + n + ']'); picks(v.picks, role + '.gameplay.capture[' + n + '].picks'); object(v.cards, role + '.gameplay.cards'); object(v.gpuInk, role + '.gameplay.gpuInk');
  });
  same(p.gameplay, {passed: true, snapshots: 303, hits: 11, spiritTargetHits: 6, deadTick: 112, captures: 11, pickSamples: g.captures.reduce((n, v) => n + v.picks.length, 0), simulationDrawChecksumsUnchanged: true, spiritBloodAlwaysZero: true}, role + '.gameplay.proofSummary');
}
function native(role, arm) {
  const path = role + '.native.' + arm.policy, v = arm.validation;
  flags(v, ['passed', 'completePriorStateExact', 'completeFinalStateExact', 'nativeSequenceExactExceptExplicitScratchTarget', 'independentFullDomainOracleExact', 'cpuSourceNeverInitialized'], path + '.validation');
  check(path + '.counts', v.actualUploads === 53 && v.finalNativeLevels === 1040);
  array(v.validatedWrites, arm.policy === 'validate' ? 53 : 0, path + '.validatedWrites');
  if (arm.policy === 'validate') {
    let levels = 0; for (const w of v.validatedWrites) { fields(w, ['event', 'page', 'layer', 'levels', 'allRGBAExact'], path + '.write'); check(path + '.writeExact', w.allRGBAExact === true && Number.isInteger(w.levels) && w.levels > 0); levels += w.levels; }
    check(path + '.writtenNativeLevels', levels === 523);
  }
  fields(arm.transferDeltas, ['cards', 'remains'], path + '.transferDeltas');
  check(path + '.transfers', arm.transferDeltas.cards?.mipLayerUpdates === 53 && arm.transferDeltas.cards?.mipCopyCalls === 523 && arm.transferDeltas.cards?.scratchPartialUploads === 53);
  check(path + '.terminalGpuCompletion', arm.terminalCompletion?.status === 37146 || arm.terminalCompletion?.status === 37148);
  check(path + '.oraclePolicy', arm.oracleGpuAllocationThisArm === (arm.policy === 'validate'));
}

try {
  const ps = {}, as = {}, gs = {}, arms = {};
  for (const role of ['original', 'candidate']) {
    const p = ps[role] = await json(role, 'proof.json'); proof(role, p);
    await source(role, p);
    const a = as[role] = await json(role, 'actual-n135.json', p); actual(role, a, p);
    const g = gs[role] = await json(role, 'actual-gameplay.json', p); gameplay(role, g, p);
    arms[role] = {};
    for (const policy of ['validate', 'stage-query']) {
      const arm = await json(role, 'replay-' + policy + '.json', p); check(role + '.native.policy', arm.policy === policy); native(role, arm);
      const matches = p.arms.filter(v => v.policy === policy); check(role + '.native.uniquePolicy', matches.length === 1); same(matches[0], arm, role + '.native.exportMatchesProof.' + policy); arms[role][policy] = arm;
    }
    same(arms[role].validate.transferDeltas, arms[role]['stage-query'].transferDeltas, role + '.native.armTransferCounts');
  }
  for (const key of ['sourceCommit', 'candidateMetadata', 'toolSha256', 'corpus', 'actualInputs']) same(ps.original[key], ps.candidate[key], 'proof.' + key);
  for (const key of ['sourceSha256', 'finalSourceSha256', 'gitSourceBlobSha1', 'sourcePublicTree']) same(ps.original.sourceInventory[key], ps.candidate.sourceInventory[key], 'fullOriginalSource.' + key);
  same(ps.original.sourceInventory.helperSnapshots, ps.candidate.sourceInventory.helperSnapshots, 'fullOriginalSource.helperSnapshots');
  for (const key of ['picks', 'pixelFacts', 'validation']) same(as.original[key], as.candidate[key], 'actual-n135.' + key);
  same(sequence(as.original.glContentSequence, 'original.actual.sequence'), sequence(as.candidate.glContentSequence, 'candidate.actual.sequence'), 'actual-n135.normalizedGLSequence');
  for (const key of ['passed', 'spiritId', 'attackerId', 'deadTick', 'snapshots', 'checksums', 'hits', 'spiritTargetHits', 'bloodCounts']) same(gs.original[key], gs.candidate[key], 'actual-gameplay.' + key);
  for (const policy of ['validate', 'stage-query']) {
    same(arms.original[policy].validation, arms.candidate[policy].validation, 'native.' + policy + '.validation');
    same(arms.original[policy].transferDeltas, arms.candidate[policy].transferDeltas, 'native.' + policy + '.transferDeltas');
    same(sequence(arms.original[policy].glContentSequence, 'original.native.' + policy + '.sequence'), sequence(arms.candidate[policy].glContentSequence, 'candidate.native.' + policy + '.sequence'), 'native.' + policy + '.normalizedGLSequence');
  }
  await imagePair('actual-n135.png', as.original.screenshot, as.candidate.screenshot);
  for (let n = 0; n < captureTicks.length; n++) {
    const a = gs.original.captures[n], b = gs.candidate.captures[n];
    same(a.tick, b.tick, 'gameplay.capture[' + n + '].tick'); same(a.picks, b.picks, 'gameplay.capture[' + n + '].picks'); same(a.gpuInk, b.gpuInk, 'gameplay.capture[' + n + '].gpuInk');
    same(mathematicalCards('original', a, n), mathematicalCards('candidate', b, n), 'gameplay.capture[' + n + '].cards');
    await imagePair('actual-gameplay-' + captureTicks[n] + '.png', a.png, b.png);
  }
} catch (error) { fail('execution', 'Comparison could not complete; no partial pass', {error: String(error), stack: error.stack}); }
const script = await readFile(fileURLToPath(import.meta.url));
await writeFile(resolve(out, 'executed-compare.mjs'), script, {flag: 'wx'});
const diffBytes = Buffer.from(JSON.stringify({version: 1, differences}, null, 2) + '\n');
await writeFile(resolve(out, 'raw-differences.json'), diffBytes, {flag: 'wx'});
const summary = {version: 1, passed: differences.length === 0 && images.length === 12 && images.every(v => v.passed), roots, sourceCommit: frozenCommit, scope: 'Strict untimed artifact, full-source, native texture, fullRGBA and authoritative gameplay equivalence. Diagnostic timings are not FPS, a pure algorithm cost, or a hardware-general improvement.', excludedTimingFields, timingEqualityClaimed: false, scriptSha256: sha(script), inputArtifacts: inputs, fullSource: sourceProofs, nativeExpected: {uploads: 53, writtenLevels: 523, residentLevels: 1040}, gameplayExpected: {snapshots: 303, checksums: 303, hits: 11, spiritTargetHits: 6, deathTick: 112, bloodAlwaysZero: true, captureTicks}, images, diagnosticTiming: timing, checks, differenceCount: differences.length, rawDifferences: {file: 'raw-differences.json', bytes: diffBytes.length, sha256: sha(diffBytes)}};
await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({passed: summary.passed, images: images.length, differences: differences.length, out}));
process.exitCode = summary.passed ? 0 : 1;
