import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditProductionClientBootstrap } from './production-client-bootstrap';
const roots: string[] = [];
function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'client-bootstrap-')); roots.push(root); mkdirSync(join(root, 'assets'));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(root, 'assets', name), source);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const main = 'const n=Object.freeze(Object.defineProperty({initializeVisuals:()=>{}},Symbol.toStringTag,{value:"Module"}));export{n as z};';
describe('built interface bootstrap dependency boundary', () => {
  it('rejects a transitive import and export-from path with a cycle', () => {
    const result = auditProductionClientBootstrap(fixture({ 'main-a.js': 'import "./helper-b.js";'+main,
      'helper-b.js': 'export * from "./world3d-c.js";', 'world3d-c.js': 'import "./main-a.js";' }));
    expect(result.passed).toBe(false);
    expect(result.forbiddenPaths).toEqual([['assets/main-a.js','assets/helper-b.js','assets/world3d-c.js']]);
  });
  it('permits dynamic imports and unrelated static world entry imports', () => {
    const result = auditProductionClientBootstrap(fixture({ 'main-a.js': 'const lazy=()=>import("./world3d-c.js");'+main,
      'game.js': 'import "./world3d-c.js";', 'world3d-c.js': 'export const world=1;' }));
    expect(result.passed).toBe(true); expect(result.reachable).toEqual(['assets/main-a.js']);
  });
  it('recognizes the public direct export and rejects its static edge', () => {
    expect(auditProductionClientBootstrap(fixture({ 'main-a.js':'export async function initializeVisuals(){};import "./world3d-c.js";',
      'world3d-c.js':'export {};' })).passed).toBe(false);
  });
  it('does not silently pass missing or ambiguous interface exports', () => {
    expect(auditProductionClientBootstrap(fixture({ 'main.js':'const text="initializeVisuals";' })).errors[0]).toMatch(/found 0/);
    expect(auditProductionClientBootstrap(fixture({ 'main.js':main,'other.js':main })).errors[0]).toMatch(/found 2/);
  });
  it('rejects missing static modules instead of treating the graph as complete', () => {
    expect(auditProductionClientBootstrap(fixture({ 'main.js':'export {x} from "./missing.js";'+main })).errors).toEqual([expect.stringContaining('Missing built static dependency')]);
  });
});
