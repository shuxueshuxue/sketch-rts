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
