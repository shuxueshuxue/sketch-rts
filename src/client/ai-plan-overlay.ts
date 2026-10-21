import './ai-plan-overlay.css';
import {AiPlanHistory, deathStyle, planTimelineRows, planDeathMatches} from './ai-plan-history';
import type {GameAdapter} from './game-adapter';
import type {GameSnapshot} from '../shared/types';
import type {DebugReplayTrace} from '../shared/replay';
import type {AiUnitDeathRecord} from '../ai/death-ledger-types';
import {allocationEventId, allocationEventLabel, allocationReason, planStatus as status, traceObjectiveNodeId} from './ai-plan-strategy';
import {planHtml as escape, planClock as clock, strategyPlanPanel} from './ai-plan-strategy-panel';
import {goalPlanDetail, goalPlanGraph} from './ai-goal-plan';
import type {GoalGraphOrder} from './ai-goal-plan-layout';
import {fitGoalPlanView} from './ai-goal-plan-view';

const icons:Record<string,string>={island:'⚑',expansion:'⌂',defense:'◇',attack:'⚔',pressure:'➶',transport:'⚓',delivery:'⚑',task:'·'};
type Point={x:number;y:number};

/** UI only. The overlay imports output schemas and delta helpers; all marks are from received output. */
export class AiPlanOverlay {
  private root=document.createElement('section');
  private toggle=document.createElement('button');
  private history!:AiPlanHistory;
  private adapter:GameAdapter|undefined;
  private stop:(()=>void)|undefined;
  private opened=false;
  get isOpen(){return this.opened;}
  private recording=false;
  private scrubbing=false;
  private showTasks=false;
  private showGraph=true;
  private graphNode='$goal';
  private graphOrder:GoalGraphOrder='time';
  private graphZoom:number|undefined;
  private graphWide=true;
  private graphScroll={plan:'',left:0,top:0};
  private selected:{owner:string;id:string}|undefined;
  private death:AiUnitDeathRecord|undefined;
  private paintedRevision=-1;
  private paintedSecond=-1;
  private selectedKey='';
  private viewFrom=0;
  private viewTo:number|undefined;
  private hits:{x:number;y:number;action:()=>void}[]=[];
  private lastNodes:ReturnType<AiPlanHistory['nodes']>=[];
  private mapNodes:ReturnType<AiPlanHistory['nodes']>=[];
  private nodeTick=-1;
  constructor(private options:{getAdapter:()=>GameAdapter;getSnapshot:()=>GameSnapshot|null|undefined;isMatch:()=>boolean;
    project:(point:Point)=>Point;center:(point:Point)=>void;openReplay:(trace:DebugReplayTrace)=>void|Promise<void>;canvas:HTMLCanvasElement}) {
    this.root.className='ai-plan-overlay';this.root.hidden=true;
    this.toggle.hidden=true;this.toggle.className='ai-plan-toggle';this.toggle.textContent='阵前手记';this.toggle.setAttribute('aria-expanded','false');
    this.toggle.onclick=()=>this.setOpen(!this.opened);
    document.body.append(this.toggle,this.root);
    this.root.addEventListener('click',event=>this.click(event));
    this.root.addEventListener('pointerdown',event=>{if((event.target as Element).matches('[data-plan-seek]'))this.scrubbing=true;});
    document.addEventListener('pointerup',()=>{if(this.scrubbing){this.scrubbing=false;this.paintedRevision=-1;}});
    this.root.addEventListener('input',event=>{
      const input=event.target as HTMLInputElement;
      if(input.matches('[data-plan-seek]'))this.adapter?.seekReplay?.(Number(input.value));
    });
    this.root.addEventListener('wheel',event=>{
      if(!(event.target as Element).closest('[data-plan-timeline]')||(!event.ctrlKey&&!event.altKey))return;
      event.preventDefault();this.zoom(event.deltaY<0?.7:1.4);
    },{passive:false});
    let markedClick=false;
    options.canvas.addEventListener('mouseup',event=>{if(markedClick){markedClick=false;event.stopImmediatePropagation();event.preventDefault();}},true);
    this.root.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape')this.setOpen(false);});
    options.canvas.addEventListener('mousedown',event=>{
      if(!this.opened||event.button!==0)return;
      const rect=options.canvas.getBoundingClientRect();
      const hit=[...this.hits].reverse().find(p=>Math.hypot(p.x-event.clientX+rect.left,p.y-event.clientY+rect.top)<17);
      if(hit){markedClick=true;event.stopImmediatePropagation();event.preventDefault();hit.action();}
    },true);
  }
  private setOpen(open:boolean){
    this.opened=open;this.root.hidden=!open;this.toggle.setAttribute('aria-expanded',String(open));
    if(open){if(document.pointerLockElement)void document.exitPointerLock();this.bind();this.paintedRevision=-1;}
    else {this.stop?.();this.stop=undefined;const tick=this.options.getSnapshot()?.tick??0;
      for(const c of this.history.coverage.values())if(c.to===null)c.to=tick;}
  }
  detach(){this.stop?.();this.stop=undefined;this.adapter=undefined;}
  private bind(){
    const adapter=this.options.getAdapter();
    if(this.adapter!==adapter){this.stop?.();this.adapter=adapter;this.stop=undefined;this.recording=false;this.history=new AiPlanHistory();this.selected=undefined;this.death=undefined;this.viewFrom=0;this.viewTo=undefined;this.nodeTick=-1;}
    if(this.opened&&!this.stop&&adapter.subscribePlans)this.stop=adapter.subscribePlans(packet=>{
      const start=performance.now();this.history.receive(packet);this.nodeTick=-1;
      performance.measure('ai-plan:receive',{start,duration:performance.now()-start});performance.clearMeasures('ai-plan:receive');
    });
  }
  /** Called after the actual world has painted. Closed: one branch, no history projection or drawing. */
  draw(ctx:CanvasRenderingContext2D){
    const available=this.options.isMatch();if(this.toggle.hidden===available)this.toggle.hidden=!available;
    if(!available){if(this.opened)this.setOpen(false);return;}
    if(!this.opened)return;
    this.bind();const snapshot=this.options.getSnapshot();if(!snapshot)return;
    const started=performance.now(),tick=snapshot.tick;
    if(this.nodeTick!==tick){
      this.lastNodes=this.history.nodes(tick);this.nodeTick=tick;
      // Quotes can share a site with a committed objective. Paint the actual grant above them.
      this.mapNodes=[...this.lastNodes].sort((a,b)=>Number(!!a.node.strategy?.allocation)-Number(!!b.node.strategy?.allocation));
    }
    this.hits=[];ctx.save();ctx.lineWidth=1.5;ctx.font='600 13px system-ui';
    const selected=this.lastNodes.find(({trace,node})=>trace.owner===this.selected?.owner&&node.id===this.selected?.id);
    for(const {trace,node} of this.mapNodes){
      if(node.kind==='task'&&!node.strategy&&!node.goalPlan&&!this.showTasks)continue;
      const target=node.target.position;if(!target)continue;
      const blocked=node.status==='blocked'||!!node.strategy&&node.requirements.some(condition=>condition.met!==true);
      const at=this.options.project(target),color=blocked?'#a97720':node.status==='abandoned'||node.status==='failed'?'#9e5146':node.strategy&&!node.strategy.allocation?'#8a816e':'#405d68';
      const focused=selected?.node===node;
      ctx.strokeStyle=color;ctx.fillStyle=color;
      for(const id of (focused?node.resources.unitIds.slice(0,48):[])){
        const points=this.history.points(id,trace.tick-15,tick);
        const current=points?.at(-1);if(!current)continue;
        const from=this.options.project(current);ctx.globalAlpha=focused?.8:.33;ctx.setLineDash([7,5]);
        ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(at.x,at.y);ctx.stroke();
        const angle=Math.atan2(at.y-from.y,at.x-from.x);ctx.beginPath();ctx.moveTo(at.x,at.y);ctx.lineTo(at.x-10*Math.cos(angle-.4),at.y-10*Math.sin(angle-.4));ctx.lineTo(at.x-10*Math.cos(angle+.4),at.y-10*Math.sin(angle+.4));ctx.closePath();ctx.fill();
        if(focused){
          const path=this.history.points(id,Math.max(this.viewFrom,trace.tick-600,node.sinceTick??this.history.bands.filter(b=>b.owner===trace.owner&&b.id===node.id&&b.from<=trace.tick).at(-1)?.from??0),tick);
          ctx.globalAlpha=.65;ctx.setLineDash([]);ctx.beginPath();let lastSession=-1,lastTick=-Infinity;
          for(const p of path){if(!p.goals.includes(node.id)){lastSession=-1;lastTick=-Infinity;continue;}const q=this.options.project(p);if(lastSession!==p.session||p.tick-lastTick>30)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);lastSession=p.session;lastTick=p.tick;}ctx.stroke();
        }
      }
      ctx.globalAlpha=1;ctx.setLineDash([]);ctx.fillStyle='#f2ead9';ctx.beginPath();ctx.arc(at.x,at.y,focused?15:12,0,Math.PI*2);ctx.fill();ctx.strokeStyle=color;ctx.stroke();ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(blocked?'!':icons[node.kind]??'·',at.x,at.y+5);
      ctx.textAlign='left';ctx.fillText(node.label,at.x+19,at.y+4);
      if(blocked){ctx.font='11px system-ui';ctx.fillText((node.requirements[0]?.detail??node.reasons[0]?.code??'受阻').slice(0,34),at.x+19,at.y+20);ctx.font='600 13px system-ui';}
      this.hits.push({...at,action:()=>{this.selected={owner:trace.owner,id:node.id};this.graphNode='$goal';this.death=undefined;this.scrollPanelTop();this.paintedRevision=-1;}});
    }
    for(const death of this.history.deaths){
      if(death.tick>tick||!death.actualDeath||death.tick<tick-1800)continue;
      const style=deathStyle(death),p=this.options.project(death.unit);
      ctx.fillStyle='#f2ead9';ctx.strokeStyle=style.color;ctx.setLineDash(style.kind==='suspicious'?[3,2]:[]);
      ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=style.color;ctx.textAlign='center';ctx.fillText(style.icon,p.x,p.y+4);
      this.hits.push({...p,action:()=>{this.death=death;this.scrollPanelTop();this.paintedRevision=-1;}});
    }
    ctx.restore();
    const second=Math.floor(tick/20);
    if(this.paintedSecond!==second||this.paintedRevision!==this.history.revision||this.selectedKey!==`${this.selected?.id}:${this.death?.id}`){
      // DOM updates are limited to one per game second; selection responds immediately.
      if(this.paintedSecond!==second||this.paintedRevision===-1||this.selectedKey!==`${this.selected?.id}:${this.death?.id}`){if(this.scrubbing){const panel=this.root.querySelector('.plan-panel');if(panel)panel.innerHTML='<small>意图 → 行动 → 结果</small><h2>把打算与结果对上</h2>'+this.panel(tick);this.refreshGraph();}
        else this.render(snapshot);this.paintedSecond=second;this.paintedRevision=this.history.revision;this.selectedKey=`${this.selected?.id}:${this.death?.id}`;}
    }
    performance.measure('ai-plan:draw',{start:started,duration:performance.now()-started});performance.clearMeasures('ai-plan:draw');
  }
  private render(snapshot:GameSnapshot){
    const tick=snapshot.tick,range=this.adapter?.replayRange,max=Math.max(1,range?.to??tick),from=this.viewFrom,to=this.viewTo??max;
    const width=Math.max(1,to-from),pct=(t:number)=>Math.max(0,Math.min(100,(t-from)/width*100));
    const recorded=this.history.recorded(tick),afterMatch=this.history.availableAfterMatch(tick);
    const lanes=[...this.history.frames.keys()];
    const plotWidth=Math.max(300,this.root.clientWidth-145),gap=width*18/plotWidth;
    const lane=(owner:string)=>{
      const bands=planTimelineRows(this.history.bands.filter(b=>b.owner===owner&&b.to>=from&&b.from<=to&&(this.showTasks||b.kind!=='task')),b=>b.from,b=>b.to,0);
      const bandRows=Math.max(1,...bands.map(b=>b.row+1));
      const bandHtml=bands.map(({item:b,row})=>{
        const left=pct(b.from),right=pct(Math.max(b.to,b.from+10));
        return `<button class="plan-band ${escape(b.status)}" data-goal="${escape(b.id)}" data-owner="${escape(owner)}" data-start="${b.from}" style="left:${left}%;width:${Math.max(.6,right-left)}%;top:${row*22+8}px" title="${escape(b.label)} · ${clock(b.from)}–${clock(b.to)} · ${escape(status[b.status])}">${b.segments.map((s,j)=>`<span style="left:${(s.from-b.from)/Math.max(1,b.to-b.from)*100}%;width:${Math.max(2,(s.to-s.from)/Math.max(1,b.to-b.from)*100)}%;opacity:${.4+j%3*.2}" title="${escape(s.phase+'：'+s.reason)}"></span>`).join('')}<b>${escape(b.label)}</b><i>${b.status==='done'||b.status==='complete'?'✓':b.status==='abandoned'||b.status==='failed'?'×':b.status==='blocked'?'!':b.status==='released'?'·':'›'}</i></button>`;
      }).join('');
      const allocationEvents = this.history.allocationEvents.filter(entry => entry.owner === owner);
      const allEvents=[...this.history.deaths.filter(d=>d.owner===owner&&d.actualDeath).map(d=>({tick:d.tick,seekTick:d.tick,id:d.id,style:deathStyle(d),title:`${d.unit.kind} · ${deathStyle(d).label}`})),...this.history.buildings.filter(b=>b.owner===owner).map(b=>({tick:b.tick,seekTick:b.tick,id:`building:${b.id}`,style:{kind:'building',icon:'▧'},title:`建筑损失 · ${b.kind}`})),
        ...allocationEvents.map(entry => ({ tick: entry.event.tick, seekTick: entry.observedTick, id: allocationEventId(entry),
          style: { kind: entry.event.kind === 'preempted' || entry.event.kind === 'lease-transferred' ? 'preemption' : 'allocation', icon: entry.event.kind === 'preempted' || entry.event.kind === 'lease-transferred' ? '⇄' : '◆' },
          title: `${allocationEventLabel(entry.event)} · ${allocationReason(entry.event.reason)}` }))].filter(e=>e.tick>=from&&e.tick<=to);
      const events=planTimelineRows(allEvents,e=>e.tick,e=>e.tick,gap);
      const eventRows=Math.max(0,...events.map(e=>e.row+1));
      const eventHtml=events.map(({item:e,row})=>`<button class="plan-event ${e.style.kind}" style="left:${pct(e.tick)}%;top:${12+bandRows*22+row*16}px" data-event="${escape(e.id)}" data-tick="${e.seekTick}" title="${clock(e.tick)} ${escape(e.title)}">${e.style.icon}</button>`).join('');
      const arrows = allocationEvents.flatMap(({event}) => {
        const handoff = event.kind === 'preempted' ? event.quotation : event.kind === 'lease-transferred' ? event : undefined;
        if (!handoff || event.tick < from || event.tick > to) return [];
        const bandAt = (id:string) => bands.find(({item}) => item.id === traceObjectiveNodeId(this.history.at(owner,event.tick),id) && item.from <= event.tick && item.to >= event.tick);
        const source = bandAt(handoff.fromObjectiveId), target = bandAt(handoff.toObjectiveId);
        if (!source || !target) return [];
        return [`<path d="M ${(pct(event.tick)-.5)*plotWidth/100} ${source.row*22+18} L ${(pct(event.tick)+.5)*plotWidth/100} ${target.row*22+18}" vector-effect="non-scaling-stroke" marker-end="url(#plan-arrow-${escape(owner)})"/>`];
      }).join('');
      const arrowHtml = arrows ? `<svg class="plan-handoffs" viewBox="0 0 ${plotWidth} ${Math.max(58,bandRows*22+eventRows*16+21)}" preserveAspectRatio="none"><defs><marker id="plan-arrow-${escape(owner)}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6"/></marker></defs>${arrows}</svg>` : '';
      return `<div class="plan-lane" style="height:${Math.max(58,bandRows*22+eventRows*16+21)}px"><label>${escape(owner)}</label><div class="plan-track">${gaps.map(([a,b])=>`<span class="plan-gap" style="left:${pct(a)}%;width:${pct(b)-pct(a)}%">未记录</span>`).join('')}${bandHtml}${arrowHtml}${eventHtml}<i class="plan-cursor" style="left:${pct(tick)}%"></i></div></div>`;
    };
    const gaps: [number,number][]=[];let cursor=from;
    for(const c of [...this.history.coverage.values()].filter(c=>!c.availability).sort((a,b)=>a.from-b.from)){if(c.from>cursor)gaps.push([cursor,Math.min(c.from,to)]);cursor=Math.max(cursor,Math.min(c.to??max,max));}if(cursor<to)gaps.push([cursor,to]);
    const detailsOpen=this.root.querySelector<HTMLDetailsElement>('.plan-panel details')?.open??false;
    const panelScroll=this.root.querySelector('.plan-panel')?.scrollTop??0,lanesScroll=this.root.querySelector('.plan-lanes')?.scrollTop??0;
    const panelMarkup = this.panel(tick);
    this.saveGraphScroll();
    this.root.innerHTML=`<header><span><small>FIELD NOTES · ${range?'REPLAY':'LIVE'}</small><strong>阵前手记</strong></span><em>${clock(tick)} · ${range?'已录制回放':'当前战况'}</em>${this.lastNodes.some(entry=>entry.node.goalPlan)?'<button data-action="goal-graph">依赖图</button>':''}${range?'':`<button data-action="record">${this.recording?'■ 停止录制':'● 录制'}</button><button data-action="replay">查看录制</button>`}<button data-action="export">导出</button><label class="plan-import">打开录制<input type="file" accept=".json,application/json" hidden></label><button data-action="close" aria-label="关闭手记">×</button></header>
      <aside class="plan-panel"><small>意图 → 行动 → 结果</small><h2>把打算与结果对上</h2><p class="plan-muted">${range?'拖动时间轴，地图与计划同步回看。':'观战：人机局可见 · 多人局赛后开放 · 联机：仅自己'}</p>${afterMatch?'<div class="plan-unrecorded">赛后开放<br><small>多人局观战期间不提供实时计划；赛后可查看实际录制过的时段。</small></div>':!recorded?'<div class="plan-unrecorded">未记录<br><small>该时段没有采集计划，不补建、不插值。</small></div>':''}${panelMarkup}<details><summary>当前目标 · ${this.lastNodes.length}</summary>${this.lastNodes.map(({trace,node})=>`<button class="plan-list" data-goal="${escape(node.id)}" data-owner="${escape(trace.owner)}"><span>${escape(trace.owner)} · ${icons[node.kind]} ${escape(node.label)}</span><small>${escape(status[node.status])} · 分数 ${node.utility.score??'—'}</small></button>`).join('')||'<p>等待下一次 AI 思考。</p>'}</details><footer>虚线：打算怎么走 · 实线：本目标近30秒足迹<br>归因仍保留其证据和推断标识。</footer></aside>
      <section class="plan-timeline" data-plan-timeline><div class="plan-time-tools"><button data-action="fold">收起 / 展开时间轴</button><button data-action="fit">全局</button><button data-action="tasks">${this.showTasks?'隐藏事务':'显示事务'}</button><button data-action="zoom-in">＋</button><button data-action="zoom-out">−</button><button data-action="left">←</button><button data-action="right">→</button><span>${clock(from)} — ${clock(to)}</span></div><div class="plan-lanes">${lanes.map(lane).join('')||(afterMatch?'<p class="plan-unrecorded">赛后开放 · 多人局观战期间不提供实时计划。</p>':'<p class="plan-unrecorded">未记录 · 打开视图以后才开始采集。</p>')}</div>${range?`<input data-plan-seek aria-label="回放进度" type="range" min="${range.from}" max="${range.to}" value="${tick}" step="1">`:'<p class="plan-live-note">实时观战只显示到当前时刻；主动录制后可以回看。</p>'}<div class="plan-key">× 战损（正常）　<span class="suspicious">? 存疑</span>　<span class="abnormal">! 异常</span>　· 未归因　▧ 建筑损失　／斜线区域：未记录</div></section>`;
    // The graph is independent of the seek input, so dragging keeps pointer ownership.
    this.refreshGraph();
    const details=this.root.querySelector<HTMLDetailsElement>('.plan-panel details');if(details)details.open=detailsOpen;
    const panel=this.root.querySelector('.plan-panel');if(panel)panel.scrollTop=panelScroll;
    const laneList=this.root.querySelector('.plan-lanes');if(laneList)laneList.scrollTop=lanesScroll;
    const input=this.root.querySelector<HTMLInputElement>('input[type=file]');
    if(input)input.onchange=()=>{const file=input.files?.[0];if(file)void file.text().then(text=>this.options.openReplay(JSON.parse(text) as DebugReplayTrace)).catch(e=>this.error(e));};
  }
  private panel(tick:number){
    if(this.death){const d=this.death,s=deathStyle(d);return `<article class="plan-death ${s.kind}"><h3>${s.icon} ${s.label} · ${escape(d.unit.kind)}</h3><p>${clock(d.tick)} · ${escape(d.owner)} · ${escape(d.id)}</p><h4>执行什么时阵亡</h4><p>${escape(d.assignment.task?.id??'任务未记录')}<br>${escape(d.assignment.task?.stage??'—')} · ${escape(d.assignment.state)}</p><h4>被谁击杀</h4><p>${escape(d.killer?.kind??'—')} · ${escape(d.killer?.owner??'—')}</p><h4>主分类与子标签</h4><p>${escape(d.classification.primary)}<br>${escape(d.classification.tags.join(' · '))}</p><small>任务归属：${d.assignment.stateAttribution==='inferred'?'推断（账本）':escape(d.assignment.stateAttribution)}；主分类来自死亡账本 v2。</small></article>`;}
    const chosen=this.lastNodes.find(({trace,node})=>trace.owner===this.selected?.owner&&node.id===this.selected?.id)??this.lastNodes.find(({node})=>node.status==='active'&&node.resources.unitIds.length>0)??this.lastNodes[0];if(!chosen)return '<p class="plan-empty">这里会展示实际留下的计划。<br>还没有的数据保持“— / 待接入”。</p>';
    const {trace,node}=chosen;this.selected={owner:trace.owner,id:node.id};
    const plannerNote=trace.goalPlanner?'':'<p class="plan-unrecorded">未记录目标规划器输出。<br>以下为模块或分配记录。</p>';
    const index=new Map(trace.nodes.map(n=>[n.id,n]));
    const tree=(ids:string[],seen=new Set<string>()):string=>ids.map(id=>{
      if(seen.has(id))return '';seen.add(id);const child=index.get(id);if(!child)return '';
      return `<div class="plan-child">↳ ${escape(child.label)} <small>${escape(status[child.status])} · ${child.resources.unitIds.length} 名</small><br><small>${child.reasons.map(r=>escape(r.detail)).join('；')}</small>${child.requirements.filter(r=>r.met!==true).map(r=>`<p>! ${escape(r.detail)}</p>`).join('')}${tree(child.children,seen)}</div>`;
    }).join('');
    const band=this.history.bands.filter(b=>b.owner===trace.owner&&b.id===node.id&&b.from<=trace.tick).at(-1);
    const deaths=this.history.deaths.filter(d=>d.tick<=tick&&planDeathMatches(trace.owner,node,d,node.sinceTick??band?.from??trace.tick));
    const deathSection = `<section><h4>本目标的阵亡</h4><p>账本目标关联 ${deaths.length} 次 · 保留原归因标识</p>${deaths.slice(-6).map(d=>`<button class="plan-list" data-event="${escape(d.id)}" data-tick="${d.tick}">${deathStyle(d).icon} ${clock(d.tick)} · ${escape(d.unit.kind)} · ${deathStyle(d).label} · ${escape(d.attributionContext.provenance)}</button>`).join('')}</section>`;
    if(node.goalPlan)return goalPlanDetail(node.goalPlan,trace,this.graphNode)+deathSection;
    if (node.strategy) return plannerNote+strategyPlanPanel(trace,node,this.history.eventsAt(tick))+deathSection;
    const progress=(this.history.frames.get(trace.owner)??[]).filter(frame=>frame.tick<=tick&&frame.tick>=(node.sinceTick??band?.from??trace.tick))
      .flatMap(frame=>frame.changes.filter(change=>change.nodeId===node.id||change.nodeId.startsWith(`${node.id}/`))
        .map(change=>({tick:frame.tick,detail:change.detail,kind:change.kind,id:change.nodeId})));
    const recent=[...new Map(progress.map(event=>[`${event.tick}:${event.id}:${event.kind}`,event])).values()].slice(-5);
    return plannerNote+`<article><div class="plan-goal-title"><span>${icons[node.kind]}</span><div><small>${escape(trace.owner)} · ${escape(status[node.status])}</small><h3>${escape(node.label)}</h3></div><b>${node.utility.score??'—'}</b></div>
      <h4>01　为什么选它</h4>${node.utility.terms.length?node.utility.terms.map(t=>`<p>${escape(t.name)} <b>${t.value}</b> · ${escape(t.explanation)}</p>`).join(''):'<p class="plan-muted">收益 —　成本 —　成功概率 —<br>坚持加分 — · 待接入</p>'}<p>${node.reasons.map(r=>escape(r.detail)).join('<br>')}</p>
      <h4>02　怎么做</h4><p class="plan-muted">方法：— · 来源：${escape(node.source)} · ${escape(status[node.status])}</p>${tree(node.children)}${node.requirements.map(r=>`<p>${r.met===true?'✓':r.met===false?'!':'—'} ${escape(r.detail)}</p>`).join('')}
      <h4>03　派了谁</h4><p>${node.resources.unitIds.length} 名 · 预留金币 ${node.resources.gold.reserved??'—'} / 需求 ${node.resources.gold.required??'—'}</p><div class="plan-unit-ids">${node.resources.unitIds.map(escape).join(' · ')||'没有记录单位分配'}</div><div class="plan-compare"><span>预计到达<br><b>—</b></span><span>实际到达<br><b>${node.reasons.some(r=>r.code==='arrived')?'已到位（时刻未记录）':'—'}</b></span></div>
      <h4>04　执行得怎样</h4>${recent.map(event=>`<p>${clock(event.tick)} · ${escape(event.detail)}</p>`).join('')||'<p>该目标还没有记录到进展事件。</p>'}<p class="plan-muted">抢占关系：待接入</p>
      <h4>05　结果如何</h4><div class="plan-compare"><span>预期效果<br><b>—</b></span><span>结果（模块记录）<br><b>${escape(status[node.status])}</b></span></div><p>本目标账本归属 ${deaths.length} 次阵亡（推断）</p>${deaths.slice(-4).map(d=>`<button class="plan-list" data-event="${escape(d.id)}" data-tick="${d.tick}">${deathStyle(d).icon} ${clock(d.tick)} · ${escape(d.unit.kind)} · ${deathStyle(d).label}</button>`).join('')}</article>`;
  }
  private async click(event:Event){
    const element=(event.target as Element).closest<HTMLElement>('button');if(!element)return;
    const action=element.dataset.action;
    if(element.dataset.planNode){this.graphNode=element.dataset.planNode;this.graphWide=false;if(this.root.clientWidth<=800)this.showGraph=false;this.scrollPanelTop();this.paintedRevision=-1;return;}
    if(action==='goal-graph'){this.showGraph=!this.showGraph;this.paintedRevision=-1;}
    if(action==='goal-time'||action==='goal-regression'){
      this.graphOrder=action==='goal-time'?'time':'regression';this.graphZoom=undefined;
      this.root.querySelector('.goal-graph-viewport')?.scrollTo(0,0);this.paintedRevision=-1;
    }
    if(action==='goal-wide'){this.graphWide=!this.graphWide;this.paintedRevision=-1;}
    if(action==='goal-fit'||action==='goal-zoom-in'||action==='goal-zoom-out'){
      const zoom=Number(this.root.querySelector<HTMLElement>('.goal-graph-stage')?.dataset.zoom??1);
      this.graphZoom=action==='goal-fit'?undefined:Math.max(.3,Math.min(2,zoom*(action==='goal-zoom-in'?1.25:.8)));
      this.paintedRevision=-1;
    }
    if(action==='close')this.setOpen(false);
    if(action==='fold')this.root.classList.toggle('plan-folded');
    if(action==='record'){try{if(this.recording)await this.adapter?.stopRecording?.();else await this.adapter?.startRecording?.();this.recording=!this.recording;this.paintedRevision=-1;}catch(e){this.error(e);}}
    if(action==='export'){try{const trace=await this.adapter?.recordedReplay?.();if(trace){const url=URL.createObjectURL(new Blob([JSON.stringify(trace)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`sketch-${trace.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}}catch(e){this.error(e);}}
    if(action==='replay'){try{const trace=await this.adapter?.recordedReplay?.();if(trace)await this.options.openReplay(trace);}catch(e){this.error(e);}}
    if(action==='tasks'){this.showTasks=!this.showTasks;this.paintedRevision=-1;}
    if(action==='fit'){this.viewFrom=0;this.viewTo=undefined;this.paintedRevision=-1;}
    if(action==='zoom-in')this.zoom(.6);if(action==='zoom-out')this.zoom(1.6);
    if(action==='left'||action==='right'){const span=(this.viewTo??this.options.getSnapshot()?.tick??1)-this.viewFrom,move=span*(action==='left'?-.3:.3);this.window(this.viewFrom+move,span);}
    if(element.dataset.goal){if(element.dataset.start)this.adapter?.seekReplay?.(Number(element.dataset.start));this.selected={owner:element.dataset.owner!,id:element.dataset.goal};this.graphNode='$goal';this.death=undefined;this.paintedRevision=-1;const goal=this.history.nodes(element.dataset.start?Number(element.dataset.start):this.options.getSnapshot()?.tick??0).find(entry=>entry.trace.owner===this.selected!.owner&&entry.node.id===this.selected!.id)?.node;if(goal?.target.position)this.options.center(goal.target.position);}
    if(element.dataset.event){
      const tick=Number(element.dataset.tick);this.adapter?.seekReplay?.(tick);
      const death=this.history.deaths.find(d=>d.id===element.dataset.event);this.death=death;
      if(death)this.options.center(death.unit);
      else{
        const building=this.history.buildings.find(b=>`building:${b.id}`===element.dataset.event);if(building)this.options.center(building);
        const allocation=this.history.allocationEvents.find(entry=>allocationEventId(entry)===element.dataset.event);
        if(allocation){this.selected={owner:allocation.owner,id:traceObjectiveNodeId(this.history.at(allocation.owner,tick),allocation.event.objectiveId)};this.graphNode='$goal';
          const goal=this.history.nodes(tick).find(entry=>entry.trace.owner===this.selected!.owner&&entry.node.id===this.selected!.id)?.node;
          if(goal?.target.position)this.options.center(goal.target.position);}
      }
      this.paintedRevision=-1;
    }
    if(element.dataset.goal||element.dataset.event)this.scrollPanelTop();
  }
  private scrollPanelTop(){const panel=this.root.querySelector('.plan-panel');if(panel)panel.scrollTop=0;}
  private refreshGraph(){
    this.saveGraphScroll();
    const timeline=this.root.querySelector('.plan-timeline');
    if(timeline)this.root.style.setProperty('--plan-bottom',`${timeline.getBoundingClientRect().height+30}px`);
    const old=this.root.querySelector('.plan-dependency-sheet');
    const chosen=this.lastNodes.find(entry=>entry.trace.owner===this.selected?.owner&&entry.node.id===this.selected?.id);
    const markup=this.showGraph&&!this.death&&chosen?.node.goalPlan?goalPlanGraph(chosen.node.goalPlan,chosen.trace,this.graphNode,this.graphOrder):'';
    this.root.classList.toggle('plan-graph-wide',!!markup&&this.graphWide);
    if(old){if(markup)old.outerHTML=markup;else old.remove();}
    else if(markup)this.root.insertAdjacentHTML('beforeend',markup);
    const sheet=this.root.querySelector<HTMLElement>('.plan-dependency-sheet');
    const wideButton=sheet?.querySelector('[data-action=goal-wide]');if(wideButton)wideButton.textContent=this.graphWide?'显示详情':'展开图';
    const view=sheet?.querySelector('.goal-graph-viewport');
    if(sheet)fitGoalPlanView(sheet,this.graphZoom);
    if(view&&sheet?.dataset.graphPlan===this.graphScroll.plan){view.scrollLeft=this.graphScroll.left;view.scrollTop=this.graphScroll.top;}
    const money=sheet?.querySelector('.goal-money-scroll.time-aligned');if(money&&view)money.scrollLeft=view.scrollLeft;
  }
  private saveGraphScroll(){
    const sheet=this.root.querySelector<HTMLElement>('.plan-dependency-sheet');
    const view=sheet?.querySelector('.goal-graph-viewport');
    if(view)this.graphScroll={plan:sheet!.dataset.graphPlan??'',left:view.scrollLeft,top:view.scrollTop};
  }
  private window(from:number,span:number){const max=Math.max(1,this.adapter?.replayRange?.to??this.options.getSnapshot()?.tick??1);span=Math.min(max,Math.max(1,span));this.viewFrom=Math.max(0,Math.min(max-span,from));this.viewTo=this.viewFrom+span;this.paintedRevision=-1;}
  private zoom(factor:number){const end=this.viewTo??this.adapter?.replayRange?.to??this.options.getSnapshot()?.tick??1,span=Math.max(200,(end-this.viewFrom)*factor),center=(end+this.viewFrom)/2;this.window(center-span/2,span);}
  private error(error:unknown){const message=document.createElement('p');message.className='plan-error';message.textContent=String(error);this.root.prepend(message);}
}
