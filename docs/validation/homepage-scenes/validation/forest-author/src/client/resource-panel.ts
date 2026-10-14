import { resources,resourceSize,resourceText,type ResourcePhase } from './resources';
import './resource-panel.css';

const names={startup:resourceText('启动界面','Interface'),home:resourceText('首页场景','Home scene'),match:resourceText('遭遇战','Skirmish')};
export class ResourcePanel {
  private root=document.createElement('section');
  private title=document.createElement('h2');
  private progress=document.createElement('progress');
  private summary=document.createElement('p');
  private stage=document.createElement('p');
  private details=document.createElement('details');
  private rows=document.createElement('div');
  private tabs=document.createElement('nav');
  private close=document.createElement('button');
  private retry=document.createElement('button');
  private selected:ResourcePhase='startup';
  private pending=false;
  private queued=false;
  private frame:number|undefined;
  private unsubscribe:()=>void;
  private disposed=false;
  private runs=new Set<()=>void>();
  private again:(()=>void)|undefined;
  renderer='';
  constructor(){
    this.root.className='resource-screen';this.root.hidden=true;this.root.setAttribute('role','dialog');this.root.setAttribute('aria-label',resourceText('资源载入','Resource loading'));
    const card=document.createElement('div');card.className='resource-card';this.root.append(card);
    this.close.textContent=resourceText('关闭','Close');this.close.className='resource-close';this.close.onclick=()=>{if(!this.pending)this.root.hidden=true;};
    this.progress.max=1;this.progress.setAttribute('aria-label',resourceText('资源读取进度','Bytes loaded'));
    this.summary.className='resource-summary';this.summary.setAttribute('aria-live','polite');this.stage.className='resource-stage';
    for(const phase of ['startup','home','match'] as const){const button=document.createElement('button');button.textContent=names[phase];button.onclick=()=>{this.selected=phase;this.update();};button.dataset.phase=phase;this.tabs.append(button);}
    const label=document.createElement('summary');label.textContent=resourceText('查看资源大小与耗时','Resource sizes and timings');this.details.append(label,this.rows);this.rows.className='resource-rows';this.details.ontoggle=()=>this.update();
    this.retry.textContent=resourceText('重试','Retry');this.retry.hidden=true;this.retry.onclick=()=>this.again?.();
    card.append(this.close,this.title,this.tabs,this.progress,this.summary,this.stage,this.details,this.retry);document.body.append(this.root);
    this.unsubscribe=resources.subscribe(()=>{if(this.queued||this.disposed)return;this.queued=true;this.frame=requestAnimationFrame(()=>{this.frame=undefined;this.queued=false;this.update();});});
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.unsubscribe();if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined;this.again=undefined;this.pending=false;for(const finish of this.runs)finish();this.root.remove();}
  open(){if(this.pending)return;this.root.hidden=false;this.close.hidden=false;this.tabs.hidden=false;this.details.open=true;this.update();}
  async run(phase:ResourcePhase,title:string,task:()=>Promise<void>){
    // Keep the original caller suspended across retries, so startup and match
    // creation resume only after the same preparation has actually succeeded.
    await new Promise<void>((resolve,reject)=>{
      const cancel=()=>{this.runs.delete(cancel);reject(new DOMException('Resource panel was disposed','AbortError'));};
      const finish=()=>{this.runs.delete(cancel);resolve();};this.runs.add(cancel);
      const attempt=async()=>{
        if(this.disposed){cancel();return;}
        resources.phase=phase;this.selected=phase;this.pending=true;this.root.hidden=false;this.close.hidden=true;this.tabs.hidden=true;this.retry.hidden=true;this.details.open=false;this.stage.textContent=title;this.update();this.again=undefined;
        try{await task();this.pending=false;this.root.hidden=true;finish();}
        catch(error){if(this.disposed){cancel();return;}this.stage.textContent=`${resourceText('载入失败：','Loading failed: ')}${error instanceof Error?error.message:String(error)}`;this.retry.hidden=false;this.again=()=>void attempt();}
      };
      void attempt();
    });
  }
  preparing(text:string){this.stage.textContent=text;}
  private update(){
    if(this.disposed||this.root.hidden)return;
    const state=resources.summary(this.selected);this.title.textContent=this.pending?`${resourceText('载入','Loading ')}${names[this.selected]}`:resourceText('资源记录','Resource report');
    if(state.unknown || state.total===0&&state.entries.length>0)this.progress.removeAttribute('value');else this.progress.value=state.total?Math.min(1,state.loaded/state.total):0;
    this.summary.textContent=state.entries.length?`${resourceSize(state.loaded)} / ${state.unknown?resourceText('总大小待确认','total pending'):resourceSize(state.total)} · ${state.ready}/${state.entries.length} ${resourceText('项','files')}${state.reused?` · ${resourceText('复用','reused')} ${resourceSize(state.reused)}`:''}${state.failed?` · ${state.failed} ${resourceText('项失败','failed')}`:''}`:resourceText('尚未进入此载入阶段','This phase has not started');
    if(!this.pending)this.stage.textContent=`${names[this.selected]}${this.renderer?` · ${this.renderer}`:''} · ${resourceText('读取大小包含浏览器缓存；网络压缩大小可能不同','Read size includes browser cache; compressed network size may differ')}`;
    for(const button of this.tabs.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.phase===this.selected));
    if(!this.details.open){this.rows.replaceChildren();return;}
    const fragment=document.createDocumentFragment();
    for(const entry of [...state.entries].sort((a,b)=>(b.expected??b.loaded)-(a.expected??a.loaded))){
      const row=document.createElement('div');row.className='resource-row';
      const label=document.createElement('span');label.textContent=entry.label;label.title=entry.url;
      const size=document.createElement('span');size.textContent=entry.expected===undefined?`${resourceSize(entry.loaded)} / ?`:resourceSize(entry.expected);
      const status=document.createElement('span');status.textContent=entry.state==='ready'?`${(entry.elapsed/1000).toFixed(2)} s`:entry.state==='failed'?entry.error??resourceText('失败','Failed'):`${resourceText('读取','Reading')} ${resourceSize(entry.loaded)}`;
      row.append(label,size,status);fragment.append(row);
    }
    this.rows.replaceChildren(fragment);
  }
}
let panel:ResourcePanel|undefined;
export function resourcePanel(){return panel??=new ResourcePanel();}
export function disposeResourcePanel(){panel?.dispose();panel=undefined;}
