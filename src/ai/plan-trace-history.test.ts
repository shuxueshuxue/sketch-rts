import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// Exercise the exact standalone browser model, including file:// data. No second implementation in the test.
const scope: { window: Record<string, any> } = { window: {} };
runInNewContext(readFileSync('docs/ai/plan-viz/timeline-model.js', 'utf8'), scope);
const html = readFileSync('docs/ai/plan-viz/timeline.html', 'utf8');
for (const match of html.matchAll(/src="(timeline-data-\d+\.js)"/g))
  runInNewContext(readFileSync('docs/ai/plan-viz/' + match[1], 'utf8'), scope);
const data = JSON.parse(gunzipSync(Buffer.from(scope.window.PLAN_TIMELINE_PACK.join(''), 'base64')).toString());
const model = scope.window.PLAN_TIMELINE_MODEL;
const history = data.thinks.map((t: any) => ({ ...t, nodes: t.nodes.map((i: number) => data.nodes[i]) }));
function node(id: string, status = 'active', reason = '') {
  return { id, label: id, kind: 'task', status, selected: status === 'active', reasons: [{ code: reason }],
    source: 'test-task', target: {}, resources: { unitIds: ['soldier'] }, children: [] };
}
function think(tick: number, nodes: unknown[]) { return { tick, owner: 'player', roots: nodes.map((n: any) => n.id), nodes }; }

describe('offline plan history chronology and visibility', () => {
  it('never reads a future frame or decision, including before the first observation', () => {
    expect(model.at([{ tick: 10 }, { tick: 20 }], 9)).toBeNull();
    expect(model.at([{ tick: 10 }, { tick: 20 }], 19).tick).toBe(10);
    for (let tick = 0; tick <= 18000; tick += 137) {
      expect(model.at(data.frames, tick).tick).toBeLessThanOrEqual(tick);
      for (const owner of Object.keys(data.players)) {
        const observed = model.at(history.filter((t: any) => t.owner === owner), tick);
        if (observed) expect(observed.tick).toBeLessThanOrEqual(tick);
        else expect(history.find((t: any) => t.owner === owner).tick).toBeGreaterThan(tick);
      }
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

  it('records real phase boundaries, blocked reasons and duration without inventing omitted stages', () => {
    const task = (phase: string, status = 'active', reason = 'stage:' + phase) => [
      { ...node('expansion', status, reason), children: ['expansion/stage:' + phase] },
      { ...node('expansion/stage:' + phase), label: phase },
    ];
    const rows = [think(10, task('assemble')), think(20, task('clear')), think(30, task('clear', 'blocked', 'home-threat')),
      think(45, task('clear')), think(60, task('escort')), think(70, task('build')), think(90, task('complete', 'done'))];
    for (const t of rows) t.roots = ['expansion'];
    const band = model.bands(rows, 100)[0];
    expect(band.segments.map((s: any) => [s.tick, s.end, s.stage, s.status])).toEqual([
      [10, 20, 'assemble', 'active'], [20, 30, 'clear', 'active'], [30, 45, 'clear', 'blocked'],
      [45, 60, 'clear', 'active'], [60, 70, 'escort', 'active'], [70, 90, 'build', 'active'], [90, 90, 'complete', 'done'],
    ]);
    expect(band.segments[2].reasonCode).toBe('home-threat');
    expect(band.segments.some((s: any) => s.stage === 'fund')).toBe(false);
    expect(band.outcome).toBe('done');
  });

  it('joins an explicit attack result only to the matching just-ended attempt', () => {
    const attack = { ...node('attack'), source: 'landAttack', target: { entityId: 'hall' } };
    const result = { ...node('result', 'abandoned', 'withdrew'), source: 'landAttackResult', target: { entityId: 'hall' }, reasons: [{ code: 'withdrew', recordedTick: 25 }] };
    const rows = [think(10, [attack]), { ...think(30, [result]), previousTick: 15 }];
    expect(model.bands(rows, 40)[0]).toMatchObject({ id: 'attack', end: 25, outcome: 'abandoned', result: { source: 'landAttackResult' } });
    result.reasons[0]!.recordedTick = 5;
    expect(model.bands(rows, 40)[0].outcome).toBe('released');
  });

  it('zooms in both directions and pans at the edges without changing the span or leaving the recording', () => {
    expect(model.fitWindow(9000, 3000, 0, 18000)).toEqual({ from: 3000, to: 9000 });
    const close = model.zoomWindow({ from: 0, to: 18000 }, .25, 12000, 0, 18000);
    expect(close).toEqual({ from: 9000, to: 13500 });
    expect(model.panWindow(close, 20000, 0, 18000)).toEqual({ from: 13500, to: 18000 });
    expect(model.panWindow(close, -20000, 0, 18000)).toEqual({ from: 0, to: 4500 });
    expect(model.zoomWindow(close, 100, 12000, 0, 18000)).toEqual({ from: 0, to: 18000 });
    expect(model.fitWindow(500, 500, 0, 18000)).toEqual({ from: 500, to: 700 });
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
    expect(data.frames[0].tick).toBe(0);
    expect(data.frames.at(-1).tick).toBe(18000);
    expect(history).toHaveLength(4804);
    expect(data.provenance.sourceCommit).toBe('bf9a472b02712457d2b5f4198d82ca87c8846de0');
    expect(data.ledgerSource).toMatchObject({ module: 'src/ai/death-ledger.ts', reconciled: true, excludedLifecycleEvents: 33 });
    for (const t of history) for (const n of t.nodes) {
      expect(n.utility.score).toBeNull();
      expect(n.utility.terms).toEqual([]);
      expect(n.resources.gold.reserved).toBeNull();
    }
    const deaths = data.events.filter((e: any) => e.type === 'death');
    expect(deaths).toHaveLength(35);
    expect(deaths.filter((e: any) => e.attribution.disposition === 'normal')).toHaveLength(2);
    expect(deaths.filter((e: any) => e.attribution.disposition === 'abnormal')).toHaveLength(33);
    for (const event of deaths) {
      expect(event.ledger.actualDeath).toBe(true);
      expect(event.attribution.disposition).toBe(event.ledger.classification.disposition);
      expect(event.attribution.category).toBe(event.ledger.classification.primary);
      expect(event.ledger.assignment.stateAttribution).toBe('inferred');
      expect(event.ledger.attributionContext.objectiveId).toBeNull();
    }
    expect(data.events.filter((e: any) => e.type === 'building-loss').map((e: any) => [e.tick, e.owner, e.hp, e.evidence, e.killer])).toEqual([
      [5383, 'p0', -20, 'nonpositive-hp-and-native-removal', null],
      [7236, 'p1', -20, 'nonpositive-hp-and-native-removal', null],
    ]);
    expect(data.events.filter((e: any) => e.type === 'preemption')).toEqual([]);
    expect(model.related({ nodes: [node('root'), { ...node('child'), resources: { unitIds: ['soldier', 'engineer'] } }].map(n => n.id === 'root' ? { ...n, children: ['child'] } : n) }, 'root')).toEqual(['soldier', 'engineer']);
  });

  it('ships a full observed goal lifecycle, a real interruption and all three kinds of loss example', () => {
    const bands = model.bands(history, data.provenance.endTick);
    const complete = bands.find((b: any) => b.key === data.highlights.find((h: any) => h.id === 'goal-complete').bandKey);
    expect(complete.outcome).toBe('done');
    expect(complete.terminalAlreadyObserved).toBe(false);
    expect([...new Set(complete.segments.map((s: any) => s.stage))]).toEqual(['assemble', 'clear/gather', 'clear/engage', 'escort', 'build', 'complete']);
    const interrupted = bands.find((b: any) => b.key === data.highlights.find((h: any) => h.id === 'goal-interrupted').bandKey);
    expect(interrupted.outcome).toBe('abandoned');
    expect(interrupted.result.source).toBe('landAttackResult');
    for (const label of ['正常战损', '异常阵亡', '建筑损失']) {
      const highlight = data.highlights.find((h: any) => h.label === label);
      expect(data.events.find((e: any) => e.id === highlight.eventId).tick).toBe(highlight.tick);
    }
  });
});
