import {it,expect} from 'vitest';
import {createGame} from '../shared/sim';
import {CommandFrameRuntime} from '../shared/sim/command-frame-runtime';
import {createAiRuntime,createInlineAiThinkExecutor,createPresetAiRuntimeFramePlanner} from './runtime';
import {AiPlanObserver} from './plan-observer';
import {AiPlanHistory} from '../client/ai-plan-history';
it('does not stitch a reopened view across missing client data even while the server continues recording',()=>{
 const game=createGame('bareDuel',{aiPlayers:['enemy']}),ai=createAiRuntime(['enemy']),executor=createInlineAiThinkExecutor(ai);
 const observer=new AiPlanObserver(game,['enemy'],executor),history=new AiPlanHistory();
 const runtime=new CommandFrameRuntime({game,roomId:'gap',rejectionLabel:'test',aiPlanner:createPresetAiRuntimeFramePlanner(game,ai,{executor})});
 const advance=(ticks:number)=>{for(let i=0;i<ticks;i++){runtime.tick();observer.step();}};
 observer.record(true);const stop=observer.subscribe(packet=>history.receive(packet));advance(30);stop();
 advance(120);const reopened=observer.subscribe(packet=>history.receive(packet));advance(30);
 expect(history.recorded(15)).toBe(true);expect(history.recorded(80)).toBe(false);expect(history.at('enemy',80)).toBeUndefined();
 expect(history.at('enemy',165)).toBeDefined();
 expect(observer.recordingData()!.packets.some(p=>p.type==='trace'&&p.tick>30&&p.tick<150)).toBe(true);
 reopened();observer.dispose();
});
