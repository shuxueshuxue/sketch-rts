import type { GameAdapter } from './game-adapter';
import type { GameCommand,GameSnapshot } from '../shared/types';
import type { CampaignSave, CampaignState } from '../campaigns/tidebound/campaign';
import type { CampaignFrame } from '../shared/campaign-session';
import type { CampaignSession } from './campaign-session';
export const TIDE_SAVE='sketch-rts-tidebound-v2';
export class TideboundAdapter implements GameAdapter {
 private worker?:Worker;
 private snapshot?:GameSnapshot; state?:CampaignState;paused=true;
 constructor(options:{save?:CampaignSave;session?:CampaignSession;ready:(snapshot:GameSnapshot)=>void;notice:(message:string)=>void}){
  let ready=false,lastSent=-Infinity;
  const frame=(data:CampaignFrame)=>{
   this.paused=data.paused;
   if(this.snapshot)data.snapshot.map=this.snapshot.map;
   this.snapshot=data.snapshot;this.state=data.state;
   if(!ready){ready=true;options.ready(data.snapshot);}
  };
  if(options.session&&!options.session.host){
   options.session.onFrame=frame;if(options.session.frame)queueMicrotask(()=>frame(options.session!.frame!));
   this.action=data=>options.session!.action(data as never);return;
  }
  this.worker=new Worker(new URL('./tidebound-worker.ts',import.meta.url),{type:'module'});
  if(options.session)options.session.onAction=action=>this.worker?.postMessage(action);
  this.worker.onmessage=({data})=>{
   if(data.type==='frame'){
    frame(data);
    if(options.session&&(data.paused||performance.now()-lastSent>=200)){lastSent=performance.now();options.session.publish(data);}
   }
   if(data.type==='notice'){options.notice(data.message);options.session?.notice(data.message);}
   if(data.type==='save')try{localStorage.setItem(TIDE_SAVE,JSON.stringify(data.save));options.notice('战役已保存');}catch{options.notice('存储空间不足，存档未保存');}
  };
  this.worker.onerror=event=>options.notice(`战役运行错误：${event.message}`);
  this.worker.postMessage({type:'start',...(options.save?{save:options.save}:{})});
 }
 action(data:Record<string,unknown>){this.worker?.postMessage(data);}
 sendCommand(command:GameCommand){this.action({type:'command',command});}
 currentSnapshot(){return this.snapshot;}
 updateToRenderTime(){return false;}
 close(){this.worker?.terminate();}
}
