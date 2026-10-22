import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DISRUPTION_CASES } from '../src/ai/strategy/puzzles/disruption/scenes';
import { runDisruption } from '../src/ai/strategy/puzzles/disruption/run';

const base = '4231d27ee31779286acf3ebb40cf4416aef0f01f';
const args = process.argv.slice(2), option = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const version = option('--mode') ?? 'v9_knight';
if (!['v9_knight', 'v9_archer', 'v9_summoner'].includes(version)) throw Error('Expected an actual room doctrine');
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('Fixed source must be clean');
execFileSync('git', ['diff', '--exit-code', base, 'HEAD', '--', 'src/ai', 'src/sdk', 'src/shared', ':(exclude)src/ai/strategy/puzzles'], { stdio: 'pipe' });
const selected = DISRUPTION_CASES.filter(p => !option('--case') || `${p.key}/${p.variant}` === option('--case'));
if (!selected.length) throw Error('Unknown interference case');
const out = resolve(option('--out') ?? 'work/public-disruption-main'); mkdirSync(out, { recursive: true });
const receipt = { source, main: base, version, cases: selected.map(p => `${p.key}/${p.variant}`),
  strategyControl: false, scope: 'Unchanged main policy/SDK/sim. Scenario opponents act only on fixed world-state triggers. No owner commands/grants or post-start entity mutations injected.' };
writeFileSync(resolve(out, 'source.json'), JSON.stringify(receipt, null, 2) + '\n');
let failures = 0;
for (const puzzle of selected) {
  const dir = resolve(out, `${puzzle.key}-${puzzle.variant}`);
  try {
    const result = runDisruption(puzzle, { version: version as 'v9_knight' | 'v9_archer' | 'v9_summoner', out: dir,
      ...(option('--ticks') ? { maxTicks: Number(option('--ticks')) } : {}) });
    console.log(JSON.stringify({ puzzle: result.summary.puzzle, passed: result.summary.passed, checks: result.summary.checks,
      trigger: result.summary.trigger?.tick ?? null, victimLoss: result.summary.confirmedLoss?.tick ?? null,
      milestones: result.summary.milestones, cpuMs: result.summary.cpuMs }));
    if (!result.summary.passed) failures++;
  } catch (error) {
    mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, 'error.json'), JSON.stringify({ source, main: base,
      name: error instanceof Error ? error.name : 'ThrownValue', message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null }, null, 2)); failures++;
  }
}
process.exitCode = failures ? 1 : 0;
