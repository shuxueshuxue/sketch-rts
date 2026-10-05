import { applyCampaignDelta } from '../shared/campaign-frame';
import type { CampaignFrame } from '../shared/campaign-session';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { isCampaignAction, type CampaignLobby } from '../shared/campaign-session';
// The host's simulation Worker is authoritative. The relay never runs a second simulation.
// All members explicitly share the expedition army, treasury, objectives and relics.
export class CampaignRelay {
 private rooms=new Map<string,{host:WebSocket;members:Map<WebSocket,{id:string;name:string}>;started:boolean;frame?:CampaignFrame}>();
 connect(ws:WebSocket, roomId:string, create:boolean, name:string){
  let room=this.rooms.get(roomId);
  const fail=(message:string)=>{ws.send(JSON.stringify({type:'error',message}));ws.close();};
  if(!/^[a-zA-Z0-9-]{8,64}$/.test(roomId))return fail('房间编号无效');
  if(create){if(room)return fail('房间已存在');if(this.rooms.size>=24)return fail('房间已满，请稍后重试');room={host:ws,members:new Map(),started:false};this.rooms.set(roomId,room);}
  if(!room)return fail('房间不存在或房主已离开');
  if(room.members.size>=8)return fail('此远征房间已满');
  const r=room,id=randomUUID();r.members.set(ws,{id,name:name.slice(0,32)||'远征指挥官'});
  const send=(socket:WebSocket,data:string)=>{if(socket.readyState===1&&socket.bufferedAmount<2_000_000)socket.send(data);};
  const lobby=()=>{const state:CampaignLobby={type:'lobby',roomId,hostId:r.members.get(r.host)!.id,members:[...r.members.values()],started:r.started};for(const s of r.members.keys())send(s,JSON.stringify(state));};
  send(ws,JSON.stringify({type:'welcome',id,host:ws===r.host}));lobby();
  if(r.started){send(ws,JSON.stringify({type:'start'}));if(r.frame)send(ws,JSON.stringify(r.frame));}
  let count=0,last=Date.now();
  ws.on('message',raw=>{
   if(Date.now()-last>1000){count=0;last=Date.now();}if(++count>60)return;
   let data;try{data=JSON.parse(raw.toString());}catch{return;}
   if(!data||typeof data!=='object')return;
   if(data.type==='ping'){send(ws,JSON.stringify({type:'pong'}));return;}
   if(ws===r.host&&data.type==='notice'&&typeof data.message==='string')for(const s of r.members.keys())if(s!==ws)send(s,JSON.stringify({type:'notice',message:data.message.slice(0,500)}));
   if(ws===r.host&&data.type==='start'&&!r.started){r.started=true;lobby();for(const s of r.members.keys())send(s,JSON.stringify({type:'start'}));}
   if(ws===r.host&&data.type==='frame'&&r.started&&data.snapshot&&data.state){r.frame=data;for(const s of r.members.keys())if(s!==ws)send(s,raw.toString());}
   if(ws===r.host&&data.type==='frameDelta'&&r.started&&r.frame&&Array.isArray(data.units)&&Array.isArray(data.removed)&&Array.isArray(data.positions)){try{r.frame=applyCampaignDelta(r.frame,data);}catch{ws.close(1008,'Invalid campaign update');return;}for(const s of r.members.keys())if(s!==ws){if(s.bufferedAmount<256_000)send(s,raw.toString());else {s.close(1013,'Connection too slow; rejoin to synchronize');}}}
   if(data.type==='action'&&r.started&&isCampaignAction(data.action)){
    if(ws!==r.host&&['speed','save'].includes(data.action.type))return;
    send(r.host,JSON.stringify({type:'action',action:data.action,member:id}));
   }
  });
  ws.on('error',()=>{});
  ws.on('close',()=>{
   r.members.delete(ws);
   if(ws===r.host){this.rooms.delete(roomId);for(const s of r.members.keys()){send(s,JSON.stringify({type:'ended',message:'房主已离开，本次协作远征已结束。房主可从检查点继续单人远征，或新建协作房间。'}));s.close();}}
   else if(this.rooms.has(roomId))lobby();
  });
 }
}
