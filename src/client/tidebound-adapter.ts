import type { GameAdapter } from './game-adapter';
import type { GameCommand,GameSnapshot } from '../shared/types';
import type { CampaignSave, CampaignState } from '../campaigns/tidebound/campaign';
export const TIDE_SAVE='sketch-rts-tidebound-v1';
export class TideboundAdapter implements GameAdapter {
 private worker=new Worker(new URL('./tidebound-worker.ts',import.meta.url),{type:'module'});
 private snapshot?:GameSnapshot; state?:CampaignState;paused=false;
 constructor(options:{save?:CampaignSave;ready:(snapshot:GameSnapshot)=>void;notice:(message:string)=>void}){
  let ready=false;
  this.worker.onmessage=({data})=>{
   if(data.type==='frame'){
    this.paused=data.paused??false;
    // Map and terrain are immutable: retain identity so the terrain atlas remains cached across worker messages.
    if(this.snapshot)data.snapshot.map=this.snapshot.map;
    this.snapshot=data.snapshot;this.state=data.state;if(!ready){ready=true;options.ready(data.snapshot);}
   }
   if(data.type==='notice')options.notice(data.message);
   if(data.type==='save')try{localStorage.setItem(TIDE_SAVE,JSON.stringify(data.save));options.notice('战役已保存');}catch{options.notice('存储空间不足，存档未保存');}
  };
  this.worker.onerror=(event)=>options.notice(`战役运行错误：${event.message}`);
  this.worker.postMessage({type:'start',...(options.save?{save:options.save}:{})});
 }
 action(data:Record<string,unknown>){this.worker.postMessage(data);}
 sendCommand(command:GameCommand){this.action({type:'command',command});}
 currentSnapshot(){return this.snapshot;}
 updateToRenderTime(){return false;}
 close(){this.worker.terminate();}
}
