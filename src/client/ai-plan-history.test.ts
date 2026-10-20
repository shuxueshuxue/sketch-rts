import {it,expect} from 'vitest';
import {AiPlanHistory} from './ai-plan-history';
import {applyAiPlanDelta, diffAiPlan} from '../ai/plan-stream';
import {buildAiPlanTrace} from '../ai/plan-trace';
import {createGame,snapshotGame} from '../shared/sim';
import {decodeServerNetMessage, encodeNetMessage} from '../shared/net/codec';
import {filterAiPlanPacket, type AiPlanRecording} from '../ai/plan-stream';
import type {StrategyPlanTrace} from '../ai/strategy/types';
it('labels gaps as unrecorded and never carries an earlier plan across one, including replay seeks',()=>{
 const history=new AiPlanHistory();const snapshot=snapshotGame(createGame('bareDuel'));
 const first=buildAiPlanTrace(snapshot,'enemy',{jobs:[],unitClaims:{}},'v9_archer');
 history.receive({type:'coverage',session:1,from:0,to:40});history.receive(diffAiPlan(undefined,first,1));
 history.receive({type:'coverage',session:2,from:90,to:140});
 history.receive(diffAiPlan(undefined,{...first,tick:100},2));
 expect(history.at('enemy',20)?.tick).toBe(0);
 expect(history.recorded(60)).toBe(false);expect(history.at('enemy',60)).toBeUndefined();
 expect(history.at('enemy',95)).toBeUndefined();expect(history.at('enemy',120)?.tick).toBe(100);
 expect(history.at('enemy',150)).toBeUndefined();
});
it('ends a completed band once and distinguishes disappearance from abandonment',()=>{
 const h=new AiPlanHistory();h.receive({type:'coverage',session:1,from:0,to:null});
 const s=snapshotGame(createGame('bareDuel'));const mem:any={jobs:[],unitClaims:{},landExpansion:{mineId:s.resources[0]!.id,sinceTick:0,stage:'assemble',interruptions:[]}};
 let previous:any;
 for(const tick of [0,15,30,45]){s.tick=tick;if(tick>=15)mem.landExpansion.stage='complete';const trace=buildAiPlanTrace(s,'player',mem,'v9_archer',previous);h.receive(diffAiPlan(previous,trace,1));previous=trace;}
 expect(h.bands.find(b=>b.label==='建立分矿')?.to).toBe(15);
});
it('keeps every simultaneous death clickable on its own row',async()=>{
 const {planTimelineRows}=await import('./ai-plan-history');
 const rows=planTimelineRows([{tick:100},{tick:100},{tick:103},{tick:125}],e=>e.tick,e=>e.tick,20);
 expect(rows.map(r=>r.row)).toEqual([0,1,2,0]);
});

it('distinguishes multiplayer after-match access from an observed plan interval', () => {
  const history = new AiPlanHistory();
  history.receive({ type: 'coverage', session: 0, from: 20, to: null, availability: 'after-match' });
  expect(history.availableAfterMatch(30)).toBe(true);
  expect(history.recorded(30)).toBe(false);
  expect(history.nodes(30)).toEqual([]);
  history.receive({ type: 'reset', tick: 0 });
  expect(history.availableAfterMatch(30)).toBe(false);
});

it('preserves optional strategy through network deltas and recorded history, including explicit removal', () => {
  const snapshot = snapshotGame(createGame('bareDuel'));
  const base = buildAiPlanTrace(snapshot, 'enemy', { jobs: [], unitClaims: {} }, 'v9_archer');
  const strategy: StrategyPlanTrace = {
    schemaVersion: 1, tick: 0, owner: base.owner, mode: 'observe',
    situation: { tick: 0, owner: base.owner, horizonTicks: 1200, lands: [], seas: [], assets: [], units: [],
      opportunities: [], economy: { cashGold: base.bank.gold, predictedIncomeGold: 0, horizonTicks: 1200, ledger: [] },
      limitations: [] },
    objectives: [], feasibleObjectiveIds: [], blockedObjectives: [], methods: [], assignments: [], preemptions: [], budget: [], idleForces: [],
    limitations: [{ code: 'transport-test', detail: 'Keep output facts unchanged', evidence: [] }],
  };
  const unit = snapshot.units.find(unit => unit.owner === base.owner)!;
  const units: StrategyPlanTrace['situation']['units'] = Array.from({ length: 120 }, (_, i) => ({
    id: `${unit.id}-${i}`, owner: base.owner, kind: unit.kind, hp: unit.hp, maxHp: unit.maxHp,
    location: { kind: 'land', landId: 'land:1', point: { x: unit.x + i, y: unit.y } },
    strength: 1, roles: ['frontline'], expiresTick: null, commitments: [], arrivals: [],
  }));
  const populated = { ...strategy, situation: { ...strategy.situation, units } };
  const first = { ...base, strategy: populated };
  const second = { ...first, tick: 15, previousTick: 0, strategy: { ...populated, tick: 15,
    situation: { ...populated.situation, tick: 15, units: units.map((row, i) => i ? row : { ...row, hp: row.hp - 1 }) } } };
  const third = { ...base, tick: 30, previousTick: 15 };
  const removal = diffAiPlan(second, third, 1);
  expect(removal.removedHeader).toContain('strategy');
  const initial = diffAiPlan(undefined, first, 1);
  const incremental = diffAiPlan(first, second, 1);
  expect(incremental.header.strategy).toBeUndefined();
  expect(incremental.strategyDelta).toBeDefined();
  expect(applyAiPlanDelta(undefined, incremental)).toBeUndefined();
  expect(encodeNetMessage({ type: 'aiPlans', roomId: 'strategy-output', packet: incremental }).length)
    .toBeLessThan(JSON.stringify(second.strategy).length / 5);
  expect(filterAiPlanPacket(initial, { kind: 'owner', owner: 'player' })).toBeUndefined();
  expect(filterAiPlanPacket(initial, { kind: 'none', reason: 'after-match' })).toBeUndefined();
  const recording: AiPlanRecording = { throughTick: 30, packets: [
    { type: 'coverage', session: 1, from: 0, to: 30 },
    initial, incremental, removal,
  ] };
  const history = new AiPlanHistory();
  for (const packet of recording.packets) {
    const message = decodeServerNetMessage(encodeNetMessage({ type: 'aiPlans', roomId: 'strategy-output', packet }));
    if (message.type !== 'aiPlans') throw new Error('Expected plan packet');
    history.receive(message.packet);
  }
  expect(history.at(base.owner, 10)?.strategy).toEqual(populated);
  expect(history.at(base.owner, 20)?.strategy).toEqual(second.strategy);
  expect(history.at(base.owner, 30)?.strategy).toBeUndefined();
  const replay = new AiPlanHistory();
  const saved = JSON.parse(JSON.stringify(recording)) as AiPlanRecording;
  for (const packet of saved.packets) replay.receive(packet);
  for (const tick of [0, 10, 15, 20, 30]) expect(replay.at(base.owner, tick)).toEqual(history.at(base.owner, tick));
  // Recordings made before keyed patches stored the full strategy in each changed header.
  const { strategyDelta: _patch, ...olderPacket } = incremental;
  expect(applyAiPlanDelta(first, { ...olderPacket, header: { ...olderPacket.header, strategy: second.strategy } })).toEqual(second);
  expect(applyAiPlanDelta(third, diffAiPlan(third, { ...second, tick: 45, strategy: { ...second.strategy, tick: 45 } }, 1))?.strategy?.tick).toBe(45);
  expect(strategy.tick).toBe(0);
  expect(units[0]?.hp).toBe(unit.hp);
});
