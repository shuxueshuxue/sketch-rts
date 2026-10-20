import {it,expect} from 'vitest';
import {createRoomHost} from './room-host';
import {RoomNetHub,type RoomNetSocket} from './room-net';
import {RULES_VERSION} from '../shared/rules-version';
import {decodeServerNetMessage} from '../shared/net/codec';
import type {ServerNetMessage} from '../shared/net/types';
class Socket implements RoomNetSocket{
  messages:ServerNetMessage[]=[];handlers=new Map<string,Function>();
  send(raw:string){this.messages.push(decodeServerNetMessage(raw));}
  on(event:'message'|'close',handler:Function){this.handlers.set(event,handler);}
  receive(message:unknown){this.handlers.get('message')?.(JSON.stringify(message));}
  close(){this.handlers.get('close')?.();}
}
it('filters incremental plans on the server by joined seat; a forged requested owner cannot expose opponents',()=>{
  const host=createRoomHost({autoTick:false});const room=host.createRoom({id:'plans',host:{id:'host',name:'Host'},mapId:'bareDuel'});host.startRoom(room.id);
  const hub=new RoomNetHub({roomHost:host}),player=new Socket(),watcher=new Socket();
  for(const [socket,id] of [[player,'player'],[watcher,'spectator-observer']] as const){hub.connect(room.id,socket);socket.receive({type:'join',rulesVersion:RULES_VERSION,roomId:room.id,playerId:id});}
  for(let tick=0;tick<20;tick++)hub.tickRoom(room.id);
  expect([...player.messages,...watcher.messages].some(m=>m.type==='aiPlans')).toBe(false);
  player.receive({type:'aiPlans',roomId:room.id,enabled:true,owner:'enemy',all:true,mode:'spectator'});
  watcher.receive({type:'aiPlans',roomId:room.id,enabled:true});
  for(let tick=0;tick<40;tick++)hub.tickRoom(room.id);
  const plans=(s:Socket)=>s.messages.flatMap(m=>m.type==='aiPlans'&&m.packet.type==='trace'?[m.packet]:[]);
  expect(plans(player)).toEqual([]);expect(plans(watcher).some(p=>p.owner==='enemy')).toBe(true);
  expect(plans(watcher).some(p=>p.baseTick!==null)).toBe(true);
  watcher.receive({type:'aiPlans',roomId:room.id,enabled:false});const count=watcher.messages.filter(m=>m.type==='aiPlans').length;
  for(let tick=0;tick<20;tick++)hub.tickRoom(room.id);
  expect(watcher.messages.filter(m=>m.type==='aiPlans')).toHaveLength(count);
  player.close();watcher.close();host.closeRoom(room.id,'host');
});
it('recording is opt in; live replay reads exclude opponents, spectator reads include them',()=>{
  const host=createRoomHost({autoTick:false});const room=host.createRoom({id:'recorded-plans',host:{id:'host',name:'Host'},mapId:'bareDuel'});host.startRoom(room.id);
  host.tickRoom(room.id,30);expect(()=>host.readDebugReplay(room.id)).toThrow(/not recording/);
  host.enableDebugReplay(room.id,{id:'proof'});host.tickRoom(room.id,40);
  const own=host.readDebugReplay(room.id,'player'),spectator=host.readDebugReplay(room.id,'spectator-proof');
  expect(own.initialSave.snapshot.tick).toBe(30);
  expect(own.aiPlans?.packets.some(p=>p.type==='trace'&&p.owner==='enemy')).toBe(false);
  expect(host.readDebugReplay(room.id).aiPlans?.packets.some(p=>p.type==='trace')).toBe(false);
  expect(spectator.aiPlans?.packets.some(p=>p.type==='trace'&&p.owner==='enemy')).toBe(true);
  host.closeRoom(room.id,'host');
});
it('restarts an open view on room reset and releases the last subscription on disconnect',()=>{
 const host=createRoomHost({autoTick:false}),room=host.createRoom({id:'reset-plan',host:{id:'host',name:'Host'},mapId:'bareDuel'});host.startRoom(room.id);
 const hub=new RoomNetHub({roomHost:host}),socket=new Socket();hub.connect(room.id,socket);
 socket.receive({type:'join',rulesVersion:RULES_VERSION,roomId:room.id,playerId:'spectator-observer'});
 socket.receive({type:'aiPlans',roomId:room.id,enabled:true});host.tickRoom(room.id,20);
 host.resetRoom(room.id,'bareDuel');host.tickRoom(room.id,20);
 const packets=socket.messages.flatMap(m=>m.type==='aiPlans'?[m.packet]:[]),reset=packets.findIndex(p=>p.type==='reset');
 expect(reset).toBeGreaterThan(-1);expect(packets.slice(reset+1).some(p=>p.type==='trace'&&p.baseTick===null)).toBe(true);
 socket.close();host.closeRoom(room.id,'host');
});
