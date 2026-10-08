import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createAiMemoryProvider, planAiOwnerCommandEntries, type AiMemoryProvider } from '../src/ai/planner-context';
import type { AiGameAgent } from '../src/ai/game-runner';
import type { SdkGameCommandPlanner } from '../src/sdk/game-runner';

export const frozenPolicyManifest: { revision: string; files: Record<string, string> } = JSON.parse(
  readFileSync(new URL('../docs/engineering/bootstrap_1/frozen-policy.json', import.meta.url), 'utf8'));
let root: string | undefined;
type HistoricalModules = Pick<typeof import('../src/ai/planner-context'), 'planAiOwnerCommandEntries'>
  & Pick<typeof import('../src/ai/game-runner'), 'runAiGameLoop'>
  & Pick<typeof import('../src/shared/sim/checksum'), 'checksumGame'>;
let modules: Promise<HistoricalModules> | undefined;

/** The acceptance opponents execute their original source tree, independent of later live AI changes. */
export function frozenPolicyRoot(): string {
  if (root) return root;
  root = mkdtempSync(join(tmpdir(), 'bootstrap_1-frozen-'));
  const directory = root;
  process.once('exit', () => rmSync(directory, { recursive: true }));
  const archive = execFileSync('git', ['archive', frozenPolicyManifest.revision, 'package.json', 'src/ai', 'src/sdk', 'src/shared'],
    { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', root], { input: archive });
  return root;
}

export function frozenPolicyModules(): Promise<HistoricalModules> {
  return modules ??= (async () => {
    const directory = frozenPolicyRoot(), outfile = join(directory, 'planner.mjs');
    await build({ stdin: { contents: "export { planAiOwnerCommandEntries } from './src/ai/planner-context';"
      + "export { runAiGameLoop } from './src/ai/game-runner';export { checksumGame } from './src/shared/sim/checksum';",
      resolveDir: directory, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile });
    return import(pathToFileURL(outfile).href) as Promise<HistoricalModules>;
  })();
}

export async function createBootstrapCommandPlanner(memoryProvider: AiMemoryProvider = createAiMemoryProvider()): Promise<SdkGameCommandPlanner<AiGameAgent>> {
  const historical = await frozenPolicyModules();
  return ({ snapshot, owner, agent, source, teams }) => {
    const version = agent.policyVersion ?? agent.version;
    const plan = version === 'v5' || version === 'v7' || version === 'v8' ? historical.planAiOwnerCommandEntries : planAiOwnerCommandEntries;
    return plan(snapshot, { playerId: owner, version, source,
      ...(agent.policyMode ? { policyMode: agent.policyMode } : {}) }, { teams, memoryProvider });
  };
}
