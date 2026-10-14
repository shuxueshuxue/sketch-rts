/** Portable deterministic CPU contract proof. Bundle/run only after the owner
 * releases its performance window. Providers are byte-pinned and never edited. */
import esbuild from 'esbuild';
import { readFile, writeFile, rm, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const arg = key => { const index = process.argv.indexOf(key); if (index < 0) return undefined;
  const value = process.argv[index + 1]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`); return value; };
const scriptPath = fileURLToPath(import.meta.url), repoRoot = resolve(dirname(scriptPath), '..');
const requested = { candidate: arg('--candidate') ?? '/tmp/card-upload-chunk-candidate.ts',
  original: arg('--original') ?? '/tmp/card-upload-chunk-original.ts', region: arg('--region') ?? '/tmp/card-upload-region.ts',
  metadata: arg('--metadata') ?? '/tmp/card-upload-chunk-candidate-source.json',
  output: arg('--out') ?? '/tmp/card-upload-chunk-mock-result.json' };
const pinned = { candidate: '8151202f0add0044a30147645515200e69fde494f439cb801888e62e75f75783',
  original: '3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295',
  region: '25d852a8b6424c81648e93b68db98de1076cee90659d3f2b01cc5b07878c8439' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = resolve(requested.output), resolveRecords = [], before = {}, after = {}, inputBytes = new Map();
let paths, metadata, metadataSourceSha256, threeUrl, threeEntry, scratch, bundleSha256, metafile, result, failure;
const bundleDependencies = [];
const violations = [];
const requireCheck = (condition, message) => { if (!condition) { violations.push(message); throw new Error(message); } };
const canonical = async value => realpath(resolve(value));
const evidence = () => ({ schema: 1, completed: !failure && !!result, passed: !failure && result?.passed === true && violations.length === 0,
  command: { argv: process.argv.slice(2), cwd: process.cwd(), node: process.version, requested, actualPaths: paths, output, repoRoot },
  pinned, metadata, metadataSourceSha256, inputSha256Before: before, inputSha256After: after,
  toolSha256: { driverBefore: before.driver, driverAfter: after.driver, mockBefore: before.mock, mockAfter: after.mock },
  originalSourceSha256: before.original, candidateSourceSha256: before.candidate, dependencySourceSha256: before.region,
  threeBinding: { publicUrl: threeUrl, publicEntry: threeEntry, entrySha256Before: before.three, entrySha256After: after.three,
    esbuildVersion: esbuild.version, providerBareImportsRetained: true,
    oneSharedConstructorChecked: result?.passed === true, resolverRecords: resolveRecords },
  bundleSha256, bundleInputs: metafile?.inputs, bundleDependencies, result, violations,
  failure: failure ? { message: String(failure), stack: failure.stack } : null,
  scope: 'Deterministic CPU contract model. No Canvas/browser/GL or performance benchmark. Full providers and one pinned region helper are bundled with one public Three identity. Native sRGB mip RGBA and frame timing require independent GPU proof/ABBA.' });
try {
  paths = { candidate: await canonical(requested.candidate), original: await canonical(requested.original),
    region: await canonical(requested.region), metadata: await canonical(requested.metadata),
    mock: await canonical(join(dirname(scriptPath), 'art-card-upload-chunk-mock.ts')), driver: await canonical(scriptPath) };
  threeUrl = import.meta.resolve('three'); threeEntry = await canonical(fileURLToPath(threeUrl)); paths.three = threeEntry;
  requireCheck(!Object.values(paths).includes(output), 'Output would overwrite a frozen input');
  for (const [name, file] of Object.entries(paths)) { const bytes = await readFile(file); before[name] = hash(bytes); inputBytes.set(name, bytes); }
  metadataSourceSha256 = before.metadata; metadata = JSON.parse(inputBytes.get('metadata').toString('utf8'));
  for (const name of ['candidate', 'original', 'region']) requireCheck(before[name] === pinned[name], `Frozen ${name} source SHA differs`);
  requireCheck(metadata.candidateSha256 === pinned.candidate && metadata.sourceSha256 === pinned.original
    && metadata.regionSha256 === pinned.region, 'Metadata source/dependency identities differ from frozen provenance');
  requireCheck(!metadata.threeEntrySha256 || before.three === metadata.threeEntrySha256, 'Installed public Three entry differs from captured source');
  for (const name of ['candidate', 'original']) requireCheck(inputBytes.get(name).toString('utf8').startsWith("import * as THREE from 'three';"), `Bare Three import changed: ${name}`);
  const providerFiles = new Set([paths.candidate, paths.original]), threeImporters = new Set([...providerFiles, paths.mock]);
  const providerRequests = new Map([['card-upload-mock:candidate', paths.candidate], ['card-upload-mock:original', paths.original]]);
  scratch = await mkdtemp(join(tmpdir(), 'card-upload-contract-')); const bundle = join(scratch, 'mock.mjs');
  const built = await esbuild.build({ absWorkingDir: repoRoot, entryPoints: [paths.mock], bundle: true, platform: 'node',
    format: 'esm', target: 'node22', outfile: bundle, metafile: true, logLevel: 'silent', plugins: [{
      name: 'frozen-upload-mock-providers', setup(build) {
        build.onResolve({ filter: /^card-upload-mock:(candidate|original)$/ }, args => {
          requireCheck(args.importer === paths.mock, 'Provider redirect requested outside the known mock import point');
          const file = providerRequests.get(args.path); requireCheck(!!file, 'Unknown provider request');
          resolveRecords.push({ request: args.path, importer: args.importer, resolved: file,
            sha256: file === paths.candidate ? before.candidate : before.original, kind: 'provider' });
          return { path: file };
        });
        build.onResolve({ filter: /^\.\/card-upload-region$/ }, args => {
          if (!providerFiles.has(args.importer)) return;
          resolveRecords.push({ request: args.path, importer: args.importer, resolved: paths.region, sha256: before.region, kind: 'region' });
          return { path: paths.region };
        });
        build.onResolve({ filter: /^three$/ }, args => {
          if (!threeImporters.has(args.importer)) return;
          resolveRecords.push({ request: args.path, importer: args.importer, resolved: threeEntry, sha256: before.three, kind: 'three' });
          return { path: threeEntry };
        });
      },
    }] });
  metafile = built.metafile;
  // Include the public Three entry's transitive source files in the run's
  // frozen dependency record, rather than only the entry module's SHA.
  for (const [input, info] of Object.entries(metafile.inputs)) {
    const file = await canonical(resolve(repoRoot, input)), bytes = await readFile(file);
    bundleDependencies.push({ input, path: file, bytes: info.bytes, sha256Before: hash(bytes) });
  }
  for (const provider of providerFiles) {
    requireCheck(resolveRecords.some(row => row.kind === 'provider' && row.resolved === provider), 'Known provider import was not resolved');
    requireCheck(resolveRecords.some(row => row.kind === 'region' && row.importer === provider && row.resolved === paths.region), 'Provider did not use pinned shared region bytes');
    requireCheck(resolveRecords.some(row => row.kind === 'three' && row.importer === provider), 'Provider public Three import was not observed');
  }
  requireCheck(resolveRecords.some(row => row.kind === 'three' && row.importer === paths.mock), 'Mock public Three import was not observed');
  requireCheck(new Set(resolveRecords.filter(row => row.kind === 'three').map(row => row.resolved)).size === 1, 'Multiple public Three identities');
  bundleSha256 = hash(await readFile(bundle));
  const { runMockProof } = await import(pathToFileURL(bundle).href); result = runMockProof();
  requireCheck(result.passed === true, 'Mock contract proof failed');
} catch (error) { failure = error; }
finally {
  if (paths) for (const [name, file] of Object.entries(paths)) {
    try { after[name] = hash(await readFile(file)); if (before[name] && after[name] !== before[name]) violations.push(`Frozen input changed during run: ${name}`); }
    catch (error) { violations.push(`Cannot verify final input: ${name}: ${String(error)}`); }
  }
  for (const dependency of bundleDependencies) {
    try { dependency.sha256After = hash(await readFile(dependency.path));
      if (dependency.sha256Before !== dependency.sha256After) violations.push(`Bundled dependency changed during run: ${dependency.path}`); }
    catch (error) { violations.push(`Cannot verify bundled dependency: ${dependency.path}: ${String(error)}`); }
  }
  // Archive unmodified originals with the run so future calls can pass these
  // locations through CLI, independent of any /tmp provider lifetime.
  const archive = output + '.inputs'; await mkdir(archive, { recursive: true });
  const filenames = { candidate: 'candidate.ts', original: 'original.ts', region: 'card-upload-region.ts',
    metadata: 'metadata.json', mock: 'art-card-upload-chunk-mock.ts', driver: 'art-card-upload-chunk-mock.mjs' };
  const archivedInputs = {};
  for (const [name, filename] of Object.entries(filenames)) if (inputBytes.has(name)) {
    const file = join(archive, filename);
    try { await writeFile(file, inputBytes.get(name), { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (hash(await readFile(file)) !== before[name]) violations.push(`Refused to overwrite a different archived input: ${file}`);
    }
    archivedInputs[name] = { file, sha256: before[name], savedSha256: hash(await readFile(file)) };
  }
  await mkdir(dirname(output), { recursive: true });
  const record = { ...evidence(), archivedInputs };
  await writeFile(output, JSON.stringify(record, null, 2) + '\n');
  if (scratch) await rm(scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ output, passed: record.passed, cases: result?.cases, violations, failure: record.failure?.message,
    providerSourceSha256: { original: before.original, candidate: before.candidate, region: before.region },
    metadataSourceSha256, toolSha256: record.toolSha256, archivedInputs }));
  if (!record.passed) process.exitCode = 1;
}
