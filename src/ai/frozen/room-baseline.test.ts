import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import ts from 'typescript';
import { loadRoomBaseline, ROOM_BASELINE_MANIFEST as manifest, verifyBaselineBytes } from './room-baseline';

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('frozen room baseline (CI never builds or requires the artifact)', () => {
  it('locks every source and the build tool to the original Git tree', () => {
    expect(manifest.sourceCommit).toBe('646cf9a0513459d16e6b12007d4945148bb29651');
    const names = [...Object.keys(manifest.sources).filter(path => path !== manifest.entry), manifest.lockfile.path];
    const data = execFileSync('git', ['cat-file', '--batch'], {
      input: names.map(path => `${manifest.sourceCommit}:${path}\n`).join(''), maxBuffer: 16 * 1024 * 1024,
    });
    let offset = 0;
    for (const name of names) {
      const end = data.indexOf(10, offset), header = data.subarray(offset, end).toString();
      const match = header.match(/^[a-f\d]+ blob (\d+)$/);
      expect(match, name).not.toBeNull();
      const size = Number(match![1]);
      const bytes = data.subarray(end + 1, end + 1 + size); offset = end + size + 2;
      const expected = name === manifest.lockfile.path ? manifest.lockfile : manifest.sources[name as keyof typeof manifest.sources];
      expect({ sha256: sha(bytes), bytes: bytes.length }, name).toEqual({ sha256: expected.sha256, bytes: expected.bytes });
      if (name === manifest.lockfile.path)
        expect(JSON.parse(bytes.toString()).packages['node_modules/esbuild'].version).toBe(manifest.tool.version);
    }
    const entry = readFileSync(manifest.entry);
    expect({ sha256: sha(entry), bytes: entry.length }).toEqual(manifest.sources[manifest.entry as keyof typeof manifest.sources]);
    expect(manifest.build).toMatchObject({ platform: 'neutral', format: 'esm', minify: false, treeShaking: true });
    expect(manifest.artifact.sha256).toMatch(/^[a-f\d]{64}$/);
    expect(manifest.sourceMap.sha256).toMatch(/^[a-f\d]{64}$/);
  });

  it('has a closed pinned dependency graph without external or dynamic runtime imports', () => {
    expect(manifest.runtimeImports).toEqual([]);
    const sources = new Set(Object.keys(manifest.sources));
    const offenders: string[] = [];
    for (const path of sources) {
      if (path.endsWith('.json')) continue;
      const source = path === manifest.entry ? readFileSync(path, 'utf8')
        : execFileSync('git', ['show', `${manifest.sourceCommit}:${path}`], { encoding: 'utf8' });
      const emitted = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      const ast = ts.createSourceFile(path, emitted, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (specifier && ts.isStringLiteral(specifier)) {
            if (!specifier.text.startsWith('.')) offenders.push(`${path}: external ${specifier.text}`);
            const base = posix.normalize(posix.join(path === manifest.entry ? '.' : posix.dirname(path), specifier.text));
            if (![base, `${base}.ts`, `${base}.json`, `${base}/index.ts`].some(value => sources.has(value))) offenders.push(`${path}: unpinned ${base}`);
          }
        }
        if (ts.isCallExpression(node)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') offenders.push(`${path}: dynamic import/require`);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(offenders).toEqual([]);
  });

  it('fails on a missing artifact instead of selecting live AI', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'room-baseline-')); scratch.push(cache);
    await expect(loadRoomBaseline(cache)).rejects.toThrow(/ENOENT/);
  });

  it('rejects corrupt bytes before executing them', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'room-baseline-')); scratch.push(cache);
    const directory = join(cache, manifest.artifact.sha256); mkdirSync(directory);
    writeFileSync(join(directory, 'planner.mjs'), 'throw new Error("THIS MUST NOT EXECUTE");');
    await expect(loadRoomBaseline(cache)).rejects.toThrow(/expected .*received/);
  });

  it('checks both content and length', () => {
    const bytes = Buffer.from('fixed bytes');
    expect(() => verifyBaselineBytes(bytes, { sha256: sha(bytes), bytes: bytes.length }, 'probe')).not.toThrow();
    expect(() => verifyBaselineBytes(Buffer.from('other bytes'), { sha256: sha(bytes), bytes: bytes.length }, 'probe')).toThrow('probe');
    expect(() => verifyBaselineBytes(bytes, { sha256: sha(bytes), bytes: bytes.length + 1 }, 'probe')).toThrow('probe');
  });
});
