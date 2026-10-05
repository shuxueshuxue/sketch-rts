import { diffCampaignFrame, applyCampaignDelta, campaignWireFrame } from '../shared/campaign-frame';
import type { CampaignAction, CampaignFrame, CampaignLobby } from '../shared/campaign-session';
export class CampaignSession {
 private socket:WebSocket;
 private sent?:CampaignFrame;
 private heartbeat:ReturnType<typeof setInterval>;
 id='';host=false;lobby?:CampaignLobby;frame?:CampaignFrame;
 onFrame?:(frame:CampaignFrame)=>void;onAction?:(action:CampaignAction)=>void;
 constructor(public roomId:string,create:boolean,name:string,private events:{lobby:(s:CampaignLobby)=>void;start:()=>void;notice:(s:string)=>void;ended:()=>void}){
  const url=new URL('ws/campaigns/'+encodeURIComponent(roomId),document.baseURI);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.search=new URLSearchParams({create:create?'1':'0',name}).toString();
  this.socket=new WebSocket(url);
  this.heartbeat=setInterval(()=>this.send({type:'ping'}),20_000);
  this.socket.onmessage=({data})=>{const m=JSON.parse(data);
   if(m.type==='welcome'){this.id=m.id;this.host=m.host;}
   if(m.type==='lobby'){this.lobby=m;events.lobby(m);}
   if(m.type==='start')events.start();
   if(m.type==='frame'){this.frame=m;this.onFrame?.(m);}
   if(m.type==='frameDelta'&&this.frame){this.frame=applyCampaignDelta(this.frame,m);this.onFrame?.(this.frame);}
   if(m.type==='action'&&this.host)this.onAction?.(m.action);
   if(m.type==='error'||m.type==='ended'||m.type==='notice')events.notice(m.message);
  };
  this.socket.onerror=()=>events.notice('连接失败，请检查网络后重新加入。');
  this.socket.onclose=()=>{clearInterval(this.heartbeat);events.notice('远征连接已断开，游戏已暂停。');events.ended();};
 }
 send(data:unknown){if(this.socket.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(data));}
 start(){if(this.host)this.send({type:'start'});}
 action(action:CampaignAction){this.send({type:'action',action});}
 notice(message:string){if(this.host)this.send({type:'notice',message});}
 publish(frame:CampaignFrame){if(this.host&&this.socket.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<128_000){const wire=campaignWireFrame(frame);this.send(this.sent?diffCampaignFrame(this.sent,wire):wire);this.sent=wire;}}
 close(){this.socket.close();}
}
