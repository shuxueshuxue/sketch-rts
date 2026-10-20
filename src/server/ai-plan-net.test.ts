import {it,expect,vi} from 'vitest';
import {createRoomHost} from './room-host';
import {RoomNetHub,type RoomNetSocket} from './room-net';
import {RULES_VERSION} from '../shared/rules-version';
import {decodeServerNetMessage} from '../shared/net/codec';
import type {ServerNetMessage} from '../shared/net/types';
import { filterAiPlanPacket } from '../ai/plan-stream';
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
it('keeps room frames and every tick checksum identical when recording and subscription are added',()=>{
 const run=(observe:boolean)=>{
  const host=createRoomHost({autoTick:false}),room=host.createRoom({id:'same-room',host:{id:'host',name:'Host'},mapId:'bareDuel',layoutSeed:'same-world'});host.startRoom(room.id);
  const frames:string[]=[];host.observeRoomFrames(room.id,event=>frames.push(JSON.stringify(event.frame)));
  const stop=observe?host.subscribeAiPlans(room.id,()=>{}):undefined;if(observe)host.enableDebugReplay(room.id,{id:'hash-proof'});
  const hashes:string[]=[];for(let i=0;i<90;i++){host.tickRoom(room.id,1);hashes.push(host.checksumRoom(room.id));}
  stop?.();if(observe)host.stopDebugReplay(room.id);host.closeRoom(room.id,'host');return {frames,hashes};
 };
 expect(run(true)).toEqual(run(false));
});
it('binds recorded plan access to the joined socket and room, never a caller supplied viewer name',()=>{
 const host=createRoomHost({autoTick:false}),room=host.createRoom({id:'access',host:{id:'host',name:'Host'},mapId:'bareDuel'});host.startRoom(room.id);
 const hub=new RoomNetHub({roomHost:host}),socket=new Socket();hub.connect(room.id,socket);
 socket.receive({type:'join',rulesVersion:RULES_VERSION,roomId:room.id,playerId:'player'});
 socket.receive({type:'aiPlans',roomId:room.id,enabled:true});
 const token=socket.messages.find(m=>m.type==='aiPlans'&&m.accessToken);
 expect(token?.type==='aiPlans'&&token.accessToken).toBeTruthy();
 if(token?.type!=='aiPlans')throw new Error('No access token');
 expect(hub.planViewer(room.id,token.accessToken)).toBe('player');
 expect(hub.planViewer('another-room',token.accessToken)).toBeUndefined();expect(hub.planViewer(room.id,'spectator-forged')).toBeUndefined();
 socket.close();expect(hub.planViewer(room.id,token.accessToken)).toBeUndefined();host.closeRoom(room.id,'host');
});

function multiplayerPlanRoom(id: string) {
  // These AIs still emit think traces; no pending build commands obscure the match-ending fixture.
  const host = createRoomHost({ autoTick: false, aiScripts: [] });
  const room = host.createRoom({ id, host: { id: 'host', name: 'Host' }, mapId: 'verdantCrossroads', humanCount: 2, aiCount: 2 });
  host.joinRoom(room.id, { id: 'guest', name: 'Guest' });
  for (const slot of host.getRoom(room.id).slots) {
    host.updateSlot(room.id, slot.id, { ready: true, team: slot.controller === 'human' ? 'team-1' : 'team-2' });
  }
  host.startRoom(room.id);
  const observe = vi.spyOn(host, 'subscribeAiPlans');
  const hub = new RoomNetHub({ roomHost: host }), socket = new Socket();
  hub.connect(room.id, socket);
  socket.receive({ type: 'join', rulesVersion: RULES_VERSION, roomId: room.id, playerId: 'spectator-forged' });
  socket.receive({ type: 'aiPlans', roomId: room.id, enabled: true });
  host.enableDebugReplay(room.id, { id: 'multiplayer-proof' });
  host.tickRoom(room.id, 40);
  const access = socket.messages.find(message => message.type === 'aiPlans' && message.accessToken);
  if (access?.type !== 'aiPlans' || !access.accessToken) throw new Error('No plan access token');
  return { host, room, hub, socket, observe, token: access.accessToken };
}

it('withholds live plans from a self-declared spectator in a seated multiplayer room, including replay reads', () => {
  const { host, room, hub, socket, token, observe } = multiplayerPlanRoom('multiplayer-plans');
  expect(observe).not.toHaveBeenCalled();
  const packets = socket.messages.flatMap(message => message.type === 'aiPlans' ? [message.packet] : []);
  expect(packets.length).toBeGreaterThan(0);
  expect(packets.every(packet => packet.type === 'coverage')).toBe(true);
  expect(packets.some(packet => packet.type === 'coverage' && 'availability' in packet && packet.availability === 'after-match')).toBe(true);
  const recorded = host.readDebugReplay(room.id, hub.planViewer(room.id, token)).aiPlans!.packets;
  expect(recorded.length).toBeGreaterThan(0);
  expect(recorded.every(packet => packet.type === 'coverage')).toBe(true);
  const beforeReset = socket.messages.length;
  host.resetRoom(room.id, room.mapId);
  const resetPackets = socket.messages.slice(beforeReset).flatMap(message => message.type === 'aiPlans' ? [message.packet] : []);
  // Reset is a content-free control: discard the old world's timeline even for a restricted viewer.
  expect(resetPackets.map(packet => packet.type)).toEqual(['reset', 'coverage']);
  expect(observe).not.toHaveBeenCalled();
  socket.close();
  host.closeRoom(room.id, 'host');
});

it('opens the recorded opponent plans to the same spectator after the multiplayer match ends', () => {
  const { host, room, hub, socket, token } = multiplayerPlanRoom('ended-multiplayer-plans');
  expect(host.readDebugReplay(room.id, hub.planViewer(room.id, token)).aiPlans!.packets.some(packet => packet.type === 'trace')).toBe(false);
  host.commandTickRoom(room.id, [
    { playerId: 'enemy2', command: { type: 'forfeit' } },
    { playerId: 'player-4', command: { type: 'forfeit' } },
  ], 1);
  expect(host.getRoom(room.id).status).toBe('ended');
  const packets = host.readDebugReplay(room.id, hub.planViewer(room.id, token)).aiPlans!.packets;
  expect(packets.some(packet => packet.type === 'trace' && packet.owner === 'enemy2')).toBe(true);
  expect(packets.some(packet => packet.type === 'trace' && packet.owner === 'player-4')).toBe(true);
  socket.close();
  host.closeRoom(room.id, 'host');
});

it('gives an explicit none audience no packets, including coverage', () => {
  expect(filterAiPlanPacket({ type: 'coverage', session: 1, from: 0, to: null }, { kind: 'none' })).toBeUndefined();
  expect(filterAiPlanPacket({ type: 'reset', tick: 0 }, { kind: 'none' })).toBeUndefined();
});
