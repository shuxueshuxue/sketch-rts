import { build, version as esbuildVersion, type Plugin } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = '646cf9a0513459d16e6b12007d4945148bb29651';
const root = fileURLToPath(new URL('../', import.meta.url));
const entryPath = 'tools/ai/room-baseline-entry.ts';
const manifestPath = join(root, 'src/ai/frozen/room-baseline-646c/manifest.json');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const settings = { format: 'esm', platform: 'neutral', target: 'es2022', minify: false, treeShaking: true,
  sourcemap: 'external', sourcesContent: true, charset: 'utf8', legalComments: 'none' } as const;

export async function buildRoomBaseline(repo: string, cache: string, writeManifest = false) {
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 32 * 1024 * 1024 });
  const files = new Set(git(['ls-tree', '-r', '--name-only', SOURCE]).toString().trim().split('\n'));
  const sources = new Map<string, { sha256: string; bytes: number }>();
  const original = (path: string) => git(['show', `${SOURCE}:${path}`]);
  const entry = readFileSync(join(root, entryPath));
  const plugin: Plugin = { name: 'pinned-room-source', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.kind === 'entry-point') return { path: 'entry.ts', namespace: 'frozen-room' };
      if (!args.path.startsWith('.')) throw new Error(`External runtime import is forbidden: ${args.path}`);
      const base = posix.normalize(posix.join(posix.dirname(args.importer), args.path));
      const path = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, `${base}/index.ts`].find(path => files.has(path));
      if (!path) throw new Error(`Unresolved pinned source: ${args.importer} -> ${args.path}`);
      return { path, namespace: 'frozen-room' };
    });
    b.onLoad({ filter: /.*/, namespace: 'frozen-room' }, args => {
      const contents = args.path === 'entry.ts' ? entry : original(args.path);
      sources.set(args.path === 'entry.ts' ? entryPath : args.path, { sha256: hash(contents), bytes: contents.length });
      return { contents, loader: args.path.endsWith('.json') ? 'json' : 'ts' };
    });
  } };
  const lockfile = original('package-lock.json');
  const locked = JSON.parse(lockfile.toString()).packages['node_modules/esbuild'].version as string;
  if (esbuildVersion !== locked) throw new Error(`Use pinned esbuild ${locked}, found ${esbuildVersion}`);
  const result = await build({ ...settings, entryPoints: ['entry.ts'], outfile: '/room-baseline/planner.mjs',
    bundle: true, write: false, metafile: true, plugins: [plugin] });
  for (const output of Object.values(result.metafile!.outputs))
    if (output.imports.length) throw new Error('Frozen output must have no runtime imports');
  const js = result.outputFiles!.find(file => file.path.endsWith('planner.mjs'))!;
  const map = result.outputFiles!.find(file => file.path.endsWith('planner.mjs.map'))!;
  const manifest = { schema: 1, version: 'room-baseline-646c', sourceCommit: SOURCE,
    families: ['v9_archer', 'v9_summoner', 'v9_knight'],
    lockfile: { path: 'package-lock.json', sha256: hash(lockfile), bytes: lockfile.length },
    tool: { name: 'esbuild', version: esbuildVersion },
    build: { ...settings, bundle: true, entryPoints: ['entry.ts'], outfile: '/room-baseline/planner.mjs', resolverNamespace: 'frozen-room' },
    entry: entryPath, sources: Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b, 'en'))),
    artifact: { file: 'planner.mjs', sha256: hash(js.contents), bytes: js.contents.length },
    sourceMap: { file: 'planner.mjs.map', sha256: hash(map.contents), bytes: map.contents.length }, runtimeImports: [] };
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  if (writeManifest) { mkdirSync(dirname(manifestPath), { recursive: true }); writeFileSync(manifestPath, serialized); }
  else if (readFileSync(manifestPath, 'utf8') !== serialized) throw new Error('Rebuild does not match the committed manifest');
  const directory = join(resolve(cache), manifest.artifact.sha256);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'planner.mjs'), js.contents);
  writeFileSync(join(directory, 'planner.mjs.map'), map.contents);
  return { directory, artifact: manifest.artifact, sourceMap: manifest.sourceMap, sourceFiles: sources.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (flag: string) => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
  const cache = arg('--cache');
  if (!cache) throw new Error('Usage: tsx scripts/build-room-baseline.ts --cache DIR [--repo DIR] [--write-manifest]');
  console.log(JSON.stringify(await buildRoomBaseline(arg('--repo') ?? root, cache, process.argv.includes('--write-manifest'))));
}
