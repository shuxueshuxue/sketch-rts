import { describe, expect, it } from 'vitest';
import { createWorldPacker, ledgerEvent } from '../../scripts/ai-plan-viz-ledger-import';

function casualty() {
  return { id: 'loss-1', tick: 51, removedTick: 52, owner: 'player', actualDeath: true,
    unit: { id: 'soldier', kind: 'archer', x: 10, y: 20 }, killer: null,
    assignment: { observedTick: 45, task: { id: 'expansion:mine-1', targetId: 'mine-1', attribution: 'inferred' } },
    classification: { disposition: 'normal', primary: 'combat-loss', attribution: 'inferred', diagnosticVersion: 2,
      tags: ['retreat-or-treatment', 'retreat-failed'], engagement: { evidence: ['recorded combat'], gaps: [] },
      v1: { disposition: 'abnormal', primary: 'retreat-or-treatment' }, explanations: ['ledger explanation'] } };
}
describe('plan visualization imports the death ledger without reclassifying it', () => {
  it('retains the exact classification, evidence and uncertainty from the ledger', () => {
    const record = casualty(), before = JSON.stringify(record), event = ledgerEvent(record, []);
    expect(event?.attribution).toMatchObject({ source: 'death-ledger', disposition: 'normal', category: 'combat-loss', rootIds: [] });
    expect(event?.ledger).toBe(record);
    expect(event?.ledger.assignment.task.attribution).toBe('inferred');
    // A retreat tag and its old diagnosis must not promote v2 combat losses back into abnormal deaths.
    expect(event?.ledger.classification.tags).toEqual(['retreat-or-treatment', 'retreat-failed']);
    expect(event?.ledger.classification.v1.disposition).toBe('abnormal');
    expect(JSON.stringify(record)).toBe(before);
    record.classification.disposition = 'abnormal'; record.classification.primary = 'outmatched';
    expect(ledgerEvent(record, [])?.attribution.disposition).toBe('abnormal');
  });
  it('keeps suspicious and unattributed deaths separate from abnormal deaths', () => {
    for (const disposition of ['suspicious', 'abnormal', 'unattributed']) {
      const record = casualty(); record.classification.disposition = disposition;
      const event = ledgerEvent(record, []);
      expect(event?.attribution.disposition).toBe(disposition);
      expect(event?.ledger.classification).toBe(record.classification);
    }
  });
  it('requires the reclassified v2 export instead of silently displaying v1 severity as current', () => {
    const record = casualty(); record.classification.diagnosticVersion = 1;
    expect(() => ledgerEvent(record, [])).toThrow('Expected death-ledger v2');
  });
  it('links only the same owner and same observed task attempt, never a future or nearby goal', () => {
    const record = casualty();
    const goal = { id: 'expansion:mine-1:20', selected: true, target: { entityId: 'mine-1' } };
    const traces = [{ owner: 'enemy', tick: 40, nodes: [goal], roots: [goal.id] },
      { owner: 'player', tick: 60, nodes: [goal], roots: [goal.id] }];
    expect(ledgerEvent(record, traces)?.attribution.rootIds).toEqual([]);
    traces.push({ owner: 'player', tick: 45, nodes: [goal], roots: [goal.id] });
    traces.sort((a, b) => a.tick - b.tick);
    expect(ledgerEvent(record, traces)?.attribution.rootIds).toEqual([goal.id]);
    record.assignment.task.targetId = 'other-mine';
    expect(ledgerEvent(record, traces)?.attribution.rootIds).toEqual([]);
  });
  it('keeps alive summon expiry out of combat death marks and rejects an unavailable classification', () => {
    const record = casualty(); record.actualDeath = false;
    expect(ledgerEvent(record, [])).toBeNull();
    record.actualDeath = true; record.classification.disposition = 'lifecycle';
    expect(ledgerEvent(record, [])).toBeNull();
    record.classification.disposition = 'unknown';
    expect(() => ledgerEvent(record, [])).toThrow('Missing ledger classification');
  });
  it('retains historical kinds when a building upgrades and resolves a passenger before its ship in a frame', () => {
    const packer = createWorldPacker();
    const first = packer.frame({ tick: 0, units: [{ id: 'passenger', owner: 'player', kind: 'archer', x: 1, y: 2, hp: 20, deck: { shipId: 'ship' } },
      { id: 'ship', owner: 'player', kind: 'transport', x: 1, y: 2, hp: 100 }],
      buildings: [{ id: 'hall', owner: 'player', kind: 'townHall', x: 1, y: 2, hp: 500, complete: true }] });
    const second = packer.frame({ tick: 20, units: [], buildings: [{ id: 'hall', owner: 'player', kind: 'keep', x: 1, y: 2, hp: 600, complete: true }] });
    expect(first.units[0]![4]).toBe(first.units[1]![0]);
    expect(packer.buildings[first.buildings[0]![0]!]!.kind).toBe('townHall');
    expect(packer.buildings[second.buildings[0]![0]!]!.kind).toBe('keep');
  });
});
