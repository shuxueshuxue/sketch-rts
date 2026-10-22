import { describe, expect, it } from 'vitest';
import type { SdkGameCommandPlanner } from '../../../../sdk/game-runner';
import type { AiGameAgent } from '../../../game-runner';
import { seconds } from '../../../../shared/time';
import { DISRUPTION_CASES } from './scenes';
import { runDisruption } from './run';
import { retreatInterception } from './protection';

// Authored legal commands validate the interference mechanics only. No owner
// policy is run here, and these results cannot count as a main AI baseline.
describe('native world-triggered interference mechanics', () => {
  for (const variant of ['loaded', 'empty'] as const) it(`one real warship sinks the ${variant} transport`, () => {
    const puzzle = DISRUPTION_CASES.find(p => p.key === 'transport-sunk' && p.variant === variant)!;
    const w = puzzle.create(), army = w.army.map(u => u.id), hull = w.transport!.id;
    const planner: SdkGameCommandPlanner<AiGameAgent> = c => {
      const ship = c.snapshot.units.find(u => u.id === hull); if (!ship) return [];
      const troops = c.snapshot.units.filter(u => army.includes(u.id));
      const waiting = troops.filter(u => !u.deck && !u.cabin);
      const commands = variant === 'empty' ? (ship.order.type === 'idle' ? [{ type: 'move' as const, unitIds: [hull], x: 1664, y: 768 }] : [])
        : waiting.length ? (waiting.some(u => u.order.type !== 'board') ? [{ type: 'board' as const, unitIds: waiting.map(u => u.id), transportId: hull }] : [])
        : ship.order.type !== 'move' ? [{ type: 'move' as const, unitIds: [hull], x: 2272, y: 768 }] : [];
      return commands.map(command => ({ playerId: c.owner, source: c.source, scriptId: 'native-mechanics-only', command }));
    };
    const r = runDisruption(puzzle, { ownerPlanner: planner, maxTicks: seconds(180) });
    expect(r.state.trigger, 'world-state trigger must actually happen').not.toBeNull();
    expect(r.state.loss?.actualKill?.source.id).toBe(w.interceptors[0]);
    expect(r.final.units.some(u => u.id === hull)).toBe(false);
    if (variant === 'loaded') {
      expect(r.state.trigger!.passengerIds.length).toBeGreaterThan(0);
      expect(r.state.kills.some(k => r.state.trigger!.passengerIds.includes(k.unit.id) && k.cause === 'sinking')).toBe(true);
    } else expect(r.state.trigger!.passengerIds).toHaveLength(0);
  }, 120000);
  it('two real footmen kill a worker after its actual midpoint crossing', () => {
    const puzzle = DISRUPTION_CASES.find(p => p.key === 'worker-ambush' && p.variant === 'stay')!;
    const w = puzzle.create(), worker = w.workers[0]!.id; let sent = false;
    const r = runDisruption(puzzle, { maxTicks: seconds(180), ownerPlanner: c => {
      if (sent) return []; sent = true;
      return [{ playerId: c.owner, source: c.source, scriptId: 'native-mechanics-only', command: { type: 'move', unitIds: [worker], x: w.mine.x, y: w.mine.y } }];
    } });
    expect(r.state.trigger?.targetId).toBe(worker);
    expect(r.state.trigger!.point.x).toBeGreaterThanOrEqual(w.road!.x - 160);
    expect(r.state.loss?.actualKill?.source.owner).toBe(w.opponent);
    expect(r.final.units.some(u => u.id === worker)).toBe(false);
  }, 120000);
  it('small raid is issued only after actual damage in the original island camp', () => {
    const puzzle = DISRUPTION_CASES.find(p => p.key === 'small-harassment' && p.variant === 'small')!;
    const r = runDisruption(puzzle, { maxTicks: seconds(60), ownerPlanner: () => [] });
    expect(r.state.firstCampDamageTick).not.toBeNull();
    expect(r.state.trigger!.tick).toBeGreaterThanOrEqual(r.state.firstCampDamageTick!);
    expect(r.state.commands.some(c => c.command.type === 'attack' && c.command.targetId === r.state.trigger!.targetId)).toBe(true);
  }, 120000);
  it('far raiders can reach the real corridor before a newly departing worker', () => {
    const puzzle = DISRUPTION_CASES.find(p => p.key === 'worker-ambush' && p.variant === 'hit-run')!;
    const w = puzzle.create(), comparison = retreatInterception(w)!;
    expect(comparison.enemyDistance).not.toBeNull();
    expect(comparison.workerDistance).not.toBeNull();
    expect(comparison.canArriveBeforeWorker).toBe(true);
    expect(comparison.enemySeconds!).toBeLessThan(comparison.workerSeconds!);
  });
  for (const variant of ['hit-run', 'fast-hit-run'] as const) it(`${variant}: real retreat and return commands produce at least3 native ambush cycles without spawning victims`, () => {
    const puzzle = DISRUPTION_CASES.find(p => p.key === 'worker-ambush' && p.variant === variant)!;
    const w = puzzle.create(), workers = w.workers.map(u => u.id), sent = new Set<string>();
    const r = runDisruption(puzzle, { maxTicks: seconds(480), ownerPlanner: c => {
      if ([...sent].some(id => c.snapshot.units.some(u => u.id === id && u.hp > 0))) return [];
      if (sent.size && !c.snapshot.units.filter(u => w.interceptors.includes(u.id))
        .every(u => Math.hypot(u.x - w.retreat.x, u.y - w.retreat.y) <= 64)) return [];
      const next = workers.find(id => !sent.has(id)); if (!next) return []; sent.add(next);
      return [{ playerId: c.owner, source: c.source, scriptId: 'native-mechanics-only',
        command: { type: 'move', unitIds: [next], x: w.mine.x, y: w.mine.y } }];
    } });
    expect(r.state.cycles).toHaveLength(3);
    if (variant === 'fast-hit-run') {
      expect(r.summary.interception?.enemySpeed).toBe(82);
      expect(r.summary.interception?.canArriveBeforeWorker).toBe(true);
      expect(r.summary.speedPremise?.allObservedOwnCombatSlower).toBe(true);
      expect(r.summary.speedPremise?.allProducerPotentialKindsSlower).toBe(true);
    }
    expect(r.state.cycles.every(c => c.outcome === 'native-death' && c.retreatedTick !== null)).toBe(true);
    expect(r.state.kills.filter(k => workers.includes(k.unit.id))).toHaveLength(3);
    expect(r.state.commands.some(c => c.command.type === 'move' && c.command.x === w.retreat.x && c.command.y === w.retreat.y)).toBe(true);
  }, 120000);

  it('records native owner kills of the observed attackers as positive death evidence', () => {
    const puzzle = DISRUPTION_CASES.find(p => p.key === 'worker-ambush' && p.variant === 'stay')!;
    const w = puzzle.create();
    const r = runDisruption(puzzle, { maxTicks: seconds(180), ownerPlanner: c => {
      const target = c.snapshot.units.find(u => w.interceptors.includes(u.id) && u.hp > 0);
      const army = c.snapshot.units.filter(u => w.mainForce.includes(u.id) && u.hp > 0);
      if (!target || !army.some(u => u.order.type !== 'attack' || u.order.targetId !== target.id)) return [];
      return [{ playerId: c.owner, source: c.source, scriptId: 'native-mechanics-only',
        command: { type: 'attack', unitIds: army.map(u => u.id), targetId: target.id } }];
    } });
    expect(r.state.kills.filter(e => w.interceptors.includes(e.unit.id) && e.source.owner === w.owner)).toHaveLength(2);
  }, 120000);

});
