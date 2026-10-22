import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { SemanticFrame } from './goal-semantic-judgment';

const trace = (): SemanticFrame[] => Array.from({ length: 20 }, (_, i) => ({
  run: 'cli-contract-only', seat: 'owner', goalId: 'island', think: i + 1, tick: (i + 1) * 15,
  complete: true, puzzleCheck: 'passed', allocation: 'observed',
  incumbent: { goalId: 'island', condition: { state: 'valid' }, ready: ['a'], steps: [
    { id: 'a', selector: { provider: 'economy', kind: 'build', grounding: { mine: 'resource-1' } },
      dependsOn: [], bindings: { worker: { kind: 'existing', entityId: 'worker-1' } } },
  ] },
}));
function run(rows: unknown[], mode = 'cold') {
  const dir = mkdtempSync(join(tmpdir(), 'semantic-cli-contract-')), input = join(dir, 'projection.jsonl.gz'), output = join(dir, 'report.json');
  const bytes = gzipSync(rows.map(x => JSON.stringify(x)).join('\n') + '\n'); writeFileSync(input, bytes);
  try {
    const child = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/planner-semantic-report.ts'),
      '--input', input, '--out', output, '--mode', mode, '--k', '20', '--tail', '3', '--start-tick', '1',
      '--ticks-per-minute', '1200', '--require-allocation', 'true'], { encoding: 'utf8' });
    expect(readFileSync(input).equals(bytes)).toBe(true);
    const report = child.status === 0 || child.status === 1 ? JSON.parse(readFileSync(output, 'utf8')) : null;
    return { child, report, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

it('CLI reads original gzip/JSONL without mutating it and records its hash and frozen parameters', () => {
  const { child, report, sha256 } = run(trace());
  expect(child.status, child.stderr).toBe(0);
  expect(report.input.sha256).toBe(sha256); expect(report.input.observations).toBe(20);
  expect(report.frozen).toEqual({ k: 20, tail: 3, requireAllocation: true });
  expect(report.cold[0].solving).toMatchObject({ passed: true, firstComplete: { think: 1, tick: 15 }, firstReady: { think: 1, tick: 15 } });
});

it('CLI exits1 for a stable empty trace and for missing actual allocation, keeping the original evidence', () => {
  for (const rows of [trace().map(x => ({ ...x, incumbent: null, complete: false })),
    trace().map(x => ({ ...x, allocation: 'missing' }))]) {
    const { child, report } = run(rows);
    expect(child.status, child.stderr).toBe(1);
    expect(report.cold[0].convergence.passed).toBe(true); expect(report.cold[0].solving.passed).toBe(false);
  }
});

it('CLI cannot hide one failing seat among passing groups', () => {
  const rows = trace().flatMap(x => [x, { ...x, seat: 'second', puzzleCheck: 'failed' }]);
  const { child, report } = run(rows);
  expect(child.status, child.stderr).toBe(1); expect(report.cold).toHaveLength(2);
  expect(report.cold.filter((x: any) => x.solving.passed)).toHaveLength(1);
});

it('live mode reports observed switching without applying cold puzzle acceptance', () => {
  const { child, report } = run(trace().map(x => ({ ...x, complete: null, puzzleCheck: 'unavailable', allocation: 'missing' })), 'live');
  expect(child.status, child.stderr).toBe(0); expect(report.cold).toEqual([]);
  expect(report.switches.minutes[0]).toMatchObject({ switches: 0, validSamples: 20 });
});
