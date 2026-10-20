import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the exact standalone browser model, including file:// data. No second implementation in the test.
const scope: { window: Record<string, any> } = { window: {} };
for (const name of ['timeline-model.js', 'timeline-data.js', 'timeline-nodes.js'])
  runInNewContext(readFileSync(`docs/ai/plan-viz/${name}`, 'utf8'), scope);
const model = scope.window.PLAN_TIMELINE_MODEL;
const data = scope.window.PLAN_TIMELINE;
const history = data.thinks.map((t: any) => ({ ...t, nodes: t.nodes.map((i: number) => scope.window.PLAN_TIMELINE_NODES[i]) }));
function node(id: string, status = 'active', reason = '') {
  return { id, label: id, kind: 'task', status, selected: status === 'active', reasons: [{ code: reason }],
    resources: { unitIds: ['soldier'] }, children: [] };
}
function think(tick: number, nodes: unknown[]) { return { tick, owner: 'player', roots: nodes.map((n: any) => n.id), nodes }; }

describe('offline plan history chronology and visibility', () => {
  it('never reads a future frame or decision, including before the first observation', () => {
    expect(model.at([{ tick: 10 }, { tick: 20 }], 9)).toBeNull();
    expect(model.at([{ tick: 10 }, { tick: 20 }], 19).tick).toBe(10);
    for (let tick = 18015; tick <= 19800; tick += 17) {
      expect(model.at(data.frames, tick).tick).toBeLessThanOrEqual(tick);
      for (const owner of Object.keys(data.players)) expect(model.at(history.filter((t: any) => t.owner === owner), tick).tick).toBeLessThanOrEqual(tick);
    }
  });

  it('keeps recorded completion, abandonment, explicit loss and mere disappearance distinct', () => {
    const traces = [think(10, [node('complete'), node('withdraw'), node('lost'), node('vanished')]),
      think(20, [node('complete', 'done'), node('withdraw', 'abandoned'), node('lost', 'abandoned', 'army-lost')]),
      think(30, [])];
    const bands = model.bands(traces, 40);
    expect(bands.map((b: any) => [b.id, b.outcome, b.end])).toEqual([
      ['complete', 'done', 20], ['withdraw', 'abandoned', 20], ['lost', 'failed', 20], ['vanished', 'released', 20],
    ]);
    expect(model.bands([think(10, [node('ongoing')])], 40)[0]).toMatchObject({ end: null, displayEnd: 40, outcome: null });
  });

  it('gives a released and later reacquired claim two distinct timeline segments', () => {
    const bands = model.bands([think(10, [node('claim')]), think(20, []), think(30, [node('claim')])], 40);
    expect(bands).toHaveLength(2);
    expect(bands[0].key).not.toBe(bands[1].key);
    expect(bands[0].outcome).toBe('released');
    expect(bands[1].outcome).toBeNull();
  });

  it('does not borrow an arrival from another assignment or infer an unobserved ETA', () => {
    const one = { id: 'soldier', kind: 'guard', targetId: 'mine-a', sinceTick: 1 },
      two = { ...one, targetId: 'mine-b', sinceTick: 20 };
    const rows = [{ tick: 10, claims: [{ ...one, arrived: true }] }, { tick: 20, claims: [{ ...two, arrived: false }] },
      { tick: 30, claims: [{ ...two, arrived: true }] }];
    expect(model.assignedClaim([one], 'soldier', { target: { entityId: 'mine-b' } })).toBeNull();
    expect(model.assignedClaim([one], 'soldier', { target: { position: { x: 1, y: 2 } } })).toBeNull();
    expect(model.assignedClaim([one, two], 'soldier', { target: { entityId: 'mine-b' } })).toEqual(two);
    expect(model.arrival(rows, 'soldier', 20, two)).toBeNull();
    expect(model.arrival(rows, 'soldier', 30, two)).toEqual({ tick: 30, beforeObservation: false });
    expect(model.arrival(rows, 'soldier', 30, one)).toEqual({ tick: 10, beforeObservation: true });
    expect(model.arrival(rows, 'soldier', 30, undefined)).toBeNull();
  });

  it('enforces the chosen visibility rules for every visualization layer', () => {
    const owners = ['red', 'blue', 'gold'];
    expect(model.allowed('spectator', false, 'gold', owners)).toEqual(owners);
    expect(model.allowed('replay', false, 'gold', owners)).toEqual(owners);
    expect(model.allowed('solo', false, 'gold', owners)).toEqual([]);
    expect(model.allowed('solo', true, 'gold', owners)).toEqual(owners);
    expect(model.allowed('online', true, 'gold', owners)).toEqual(['gold']);
    const html = readFileSync('docs/ai/plan-viz/timeline.html', 'utf8');
    expect(html).toMatch(/id="solo-visible" type="checkbox">/);
    expect(html).not.toContain('match-ended');
  });

  it('keeps real missing values and inferred attribution honest in the shipped sample', () => {
    expect(data.frames).toHaveLength(91);
    expect(history).toHaveLength(360);
    expect(data.provenance.baseCommit).toBe('3c0844e3');
    for (const t of history) for (const n of t.nodes) {
      expect(n.utility.score).toBeNull();
      expect(n.utility.terms).toEqual([]);
      expect(n.resources.gold.reserved).toBeNull();
    }
    const deaths = data.events.filter((e: any) => e.type === 'death');
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatchObject({ tick: 19142, kind: 'horseArcher', attribution: { certainty: 'inferred', rootIds: [], assessment: 'review', command: { scriptId: 'mobileCare' } } });
    expect(data.events.filter((e: any) => e.type === 'building-loss')).toEqual([]);
    expect(data.events.filter((e: any) => e.type === 'preemption')).toEqual([]);
    expect(model.related({ nodes: [node('root'), { ...node('child'), resources: { unitIds: ['soldier', 'engineer'] } }].map(n => n.id === 'root' ? { ...n, children: ['child'] } : n) }, 'root')).toEqual(['soldier', 'engineer']);
  });
});
