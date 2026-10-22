import { expect, it } from 'vitest';
import { AiPlanHistory } from './ai-plan-history';
import { planViewNodes, strategyGoalId } from './ai-plan-strategy';
import { strategyPlanPanel } from './ai-plan-strategy-panel';
import { strategyFixture } from './ai-plan-strategy.test-fixture';
import { diffAiPlan, type AiPlanPacket } from '../ai/plan-stream';
import type { AiPlanTrace } from '../ai/plan-trace';

it('joins formal troops by objective without turning observed tasks or candidate quotes into grants', () => {
  const { trace, first, second } = strategyFixture(), original = JSON.stringify(trace);
  const nodes = planViewNodes(trace);
  const formal = nodes.find(node => node.id === strategyGoalId('defense'))!;
  const candidate = nodes.find(node => node.id === strategyGoalId('candidate-only'))!;
  expect(formal.resources.unitIds).toEqual([first.id]);
  expect(formal.strategy?.allocation?.committedUtilityGold).toBe(120);
  expect(formal.requirements.some(condition => condition.met === false && condition.code === 'shore-safe')).toBe(true);
  expect(candidate.resources.unitIds).toEqual([]);
  expect(candidate.resources.unitIds).not.toContain(second.id);
  expect(candidate.strategy?.allocation).toBeUndefined();
  expect(candidate.utility.score).toBeNull();
  expect(JSON.stringify(trace)).toBe(original);
  expect(planViewNodes(trace)).toBe(nodes);
});

it('shows utility, real handoffs, ETA and the three different kinds of missing resources', () => {
  const { trace, events } = strategyFixture();
  const node = planViewNodes(trace).find(node => node.strategy?.objectiveId === 'defense')!;
  const recorded = events.map(event => ({ owner: trace.owner, event, observedTick: 50, session: 1 }));
  const html = strategyPlanPanel(trace, node, recorded);
  for (const text of ['正式分配', '收益：avoid-loss 200', '成本：travel 20', '80%', '坚持加分 4',
    '预计到达', '0:01', '实际到岗', '抢占 island → defense', '新增收益 60', '原目标损失 25',
    '切换成本 8', '资源不足', '金币 80', '救命中断后的空缺', '工人 1 名', 'fixture-camp-blocked',
    '实际被打断订单 move', 'shore-safe', 'gather']) expect(html).toContain(text);
  const noArrival = strategyPlanPanel(trace, node, []);
  expect(noArrival).toContain('已到岗，时刻未记录');
  expect(noArrival).not.toContain('抢占 island');
  const candidate = planViewNodes(trace).find(node => node.strategy?.objectiveId === 'candidate-only')!;
  expect(strategyPlanPanel(trace, candidate, [])).toContain('观察报价（未正式分配）');
  const unknown = { ...trace, strategy: { ...trace.strategy!, allocation: { ...trace.strategy!.allocation!, assignments:
    trace.strategy!.allocation!.assignments.map(row => ({ ...row, action: { ...row.action, generation: 2 },
      eta: { status: 'unknown' as const, forecastTick: 40, arrivalTick: null, reason: events[0]!.reason } })) } } };
  const unknownHtml = strategyPlanPanel(unknown, planViewNodes(unknown)[0]!, recorded);
  expect(unknownHtml).toContain('— (unknown)');
  expect(unknownHtml).toContain('已到岗，时刻未记录');
  const unsafeEvent = { ...events[0]!, reason: { ...events[0]!.reason, values: { unsafe: '<img src=x onerror=1>' } } };
  expect(strategyPlanPanel(trace, node, [{ ...recorded[0]!, event: unsafeEvent }]))
    .not.toContain('<img');
});

it('starts a new lifetime when a completed objective ID is reused instead of extending its old outcome', () => {
  const { trace, strategy, allocation } = strategyFixture(), history = new AiPlanHistory();
  history.receive({ type: 'coverage', session: 1, from: 0, to: null });
  let previous: AiPlanTrace | undefined;
  for (const tick of [50, 60, 90]) {
    const next: AiPlanTrace = { ...trace, tick, strategy: { ...strategy, tick, allocation: { ...allocation,
      objectives: allocation.objectives.map(row => row.objectiveId !== 'defense' ? row : {
        ...row, status: tick === 60 ? 'complete' : 'active', sinceTick: tick === 90 ? 90 : 0,
      }) } } };
    history.receive(diffAiPlan(previous, next, 1)); previous = next;
  }
  expect(history.bands.filter(band => band.id === strategyGoalId('defense')).map(band => [band.from, band.to, band.status]))
    .toEqual([[50, 60, 'complete'], [90, 90, 'active']]);
});

it('keeps stages and events exact through deltas, recording and seeks, without backfilling a closed gap', () => {
  const fixture = strategyFixture(), history = new AiPlanHistory(), packets: AiPlanPacket[] = [
    { type: 'coverage', session: 1, from: 0, to: 60 },
  ];
  let previous: AiPlanTrace | undefined;
  for (const tick of [0, 15, 30, 45, 60]) {
    const trace: AiPlanTrace = { ...fixture.trace, tick, strategy: { ...fixture.strategy, tick,
      situation: { ...fixture.strategy.situation, tick }, allocation: { ...fixture.allocation,
        events: fixture.events.filter(event => event.tick <= tick),
        objectives: fixture.allocation.objectives.map(row => tick === 60 && row.objectiveId === 'defense' ? { ...row, status: 'failed' } : row),
        executions: fixture.allocation.executions.map(row => ({ ...row, phase: tick < 30 ? 'assemble' : 'fight' })),
      } } };
    packets.push({ ...diffAiPlan(previous, trace, 1), positions: [{ id: fixture.first.id, x: tick, y: 10 }] });
    previous = trace;
  }
  for (const packet of JSON.parse(JSON.stringify(packets))) history.receive(packet);
  expect(history.allocationEvents.map(entry => entry.event.id)).toEqual(fixture.events.map(event => event.id));
  expect(history.eventsAt(25).map(entry => entry.event.id)).toEqual(['event-1']);
  expect(history.eventsAt(30).map(entry => entry.event.id)).toEqual(['event-1', 'event-2', 'event-3']);
  expect(history.at('player', 15)?.strategy?.allocation?.objectives[0]?.status).toBe('active');
  const band = history.bands.find(band => band.id === strategyGoalId('defense'))!;
  expect(band.segments.map(segment => segment.phase)).toEqual(['assemble (受阻)', 'fight (受阻)']);
  expect(band.status).toBe('failed');
  expect(band.to).toBe(60);
  expect(history.points(fixture.first.id, 0, 60)[0]?.goals).toContain(strategyGoalId('defense'));
  history.receive({ type: 'coverage', session: 2, from: 100, to: 140 });
  const resumed = { ...fixture.trace, tick: 110, strategy: { ...fixture.strategy, tick: 110,
    situation: { ...fixture.strategy.situation, tick: 110 } } };
  history.receive(diffAiPlan(undefined, resumed, 2));
  expect(history.nodes(80)).toEqual([]);
  expect(history.eventsAt(80)).toEqual([]);
  expect(history.at('player', 105)).toBeUndefined();
  expect(history.allocationEvents).toHaveLength(4);
  const other: AiPlanTrace = { ...fixture.trace, owner: 'enemy', strategy: { ...fixture.strategy, owner: 'enemy' } };
  history.receive(diffAiPlan(undefined, other, 1));
  expect(history.allocationEvents).toHaveLength(8);
  history.receive({ type: 'reset', tick: 0 });
  expect(history.allocationEvents).toEqual([]);
});
