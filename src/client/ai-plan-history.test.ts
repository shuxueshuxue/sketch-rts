import {it,expect} from 'vitest';
import {AiPlanHistory} from './ai-plan-history';
import {diffAiPlan} from '../ai/plan-stream';
import {buildAiPlanTrace} from '../ai/plan-trace';
import {createGame,snapshotGame} from '../shared/sim';
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
