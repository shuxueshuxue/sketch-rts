import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readAcceptedHallSafety } from './worker-safety';

const original = () => JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/worker-safety-597-near-build.json.gz', import.meta.url))).toString());
describe('recorded native build safety proofs', () => {
  it('follows the exact original declaration through pool-worker grounding and real lease', () => {
    const r = original(), before = JSON.stringify(r);
    const rows = readAcceptedHallSafety(r.snapshot, r.observation, r.memoryAfter.strategyAllocation);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.passed).toBe(true);
    expect(rows[0]?.proofs.map(p => [p.role, p.passed])).toEqual([['logical-mine', true], ['exact-build-site', true]]);
    expect(JSON.stringify(r)).toBe(before);
  });
  it('rejects a missing logical mine proof even when the exact construction site remains safe', () => {
    const r = original(), originalRows = readAcceptedHallSafety(r.snapshot, r.observation, r.memoryAfter.strategyAllocation);
    const id = originalRows[0]!.proofs[0]!.fact!.id;
    for (const p of r.observation.output.plans) p.facts = p.facts.filter((f: { id: string }) => f.id !== id);
    expect(readAcceptedHallSafety(r.snapshot, r.observation, r.memoryAfter.strategyAllocation)[0]?.passed).toBe(false);
  });
  it('rejects future met, stale epochs and absent finish protection in recorded proof counterexamples', () => {
    for (const bad of ['future', 'epoch', 'window']) {
      const r = original(), rows = readAcceptedHallSafety(r.snapshot, r.observation, r.memoryAfter.strategyAllocation);
      const id = rows[0]!.proofs[0]!.fact!.id;
      for (const p of r.observation.output.plans) {
        const fact = p.facts.find((f: { id: string }) => f.id === id);
        if (fact) {
          if (bad === 'future') fact.observation.availableTick = r.snapshot.tick + 1;
          else if (bad === 'epoch') fact.observation.observedTick = r.snapshot.tick - 1;
        }
        if (bad === 'window') for (const a of p.actions) a.declaration.preconditionWindows =
          a.declaration.preconditionWindows?.filter((w: { factId: string }) => w.factId !== id);
      }
      expect(readAcceptedHallSafety(r.snapshot, r.observation, r.memoryAfter.strategyAllocation)[0]?.passed).toBe(false);
    }
  });
});
