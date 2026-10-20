import {afterEach,it,expect,vi} from 'vitest';
import {createGame,snapshotGame} from '../../shared/sim';
import * as context from '../death-ledger-context';
import * as trace from '../plan-trace';
import {createAiThinkHost} from './host';
import type {AiThinkReply,AiThinkMessage} from './protocol';
afterEach(()=>vi.restoreAllMocks());
function setup(){
 const game=createGame('bareDuel',{aiPlayers:['enemy']}),snapshot=snapshotGame(game),replies:AiThinkReply[]=[];
 const {terrain:_terrain,landmarks:_landmarks,...map}=snapshot.map;
 const host=createAiThinkHost();host.open({type:'open',session:'output',map:game.map},reply=>replies.push(structuredClone(reply)));
 const message:Extract<AiThinkMessage,{type:'think'}>={type:'think',session:'output',tick:0,deliveryTick:2,snapshot:{...snapshot,map},requests:[{playerId:'enemy'}]};
 return {host,message,replies};
}
it('queues commands before constructing any projection and sends diagnostics on a separate reply',()=>{
 const {host,message,replies}=setup(),original=context.projectDeathThinkContext;
 const projection=vi.spyOn(context,'projectDeathThinkContext').mockImplementation((...args)=>{
  expect(replies).toHaveLength(1);expect(replies[0]).toHaveProperty('commands');return original(...args);
 });
 host.think({...message,observe:1});expect(projection).toHaveBeenCalledOnce();
 expect(replies[0]).toHaveProperty('commands');expect(replies[0]).not.toHaveProperty('observations');
 expect(replies[1]).toHaveProperty('kind','observation');
});
it('still delivers the completed command frame when a diagnostic projection fails',()=>{
 const {host,message,replies}=setup();vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.spyOn(context,'projectDeathThinkContext').mockImplementation(()=>{throw new Error('diagnostic projection');});
 host.think({...message,observe:1});expect(replies).toHaveLength(1);expect(replies[0]).toHaveProperty('commands');expect(replies[0]).not.toHaveProperty('error');
});
it('does no trace or attribution construction and sends no diagnostic reply with observation off',()=>{
 const {host,message,replies}=setup(),projection=vi.spyOn(context,'projectDeathThinkContext'),builder=vi.spyOn(trace,'buildAiPlanTrace');
 host.think(message);expect(projection).not.toHaveBeenCalled();expect(builder).not.toHaveBeenCalled();
 expect(replies).toHaveLength(1);expect(replies[0]).not.toHaveProperty('observations');
});
