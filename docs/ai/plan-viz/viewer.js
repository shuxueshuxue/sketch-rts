/* Offline, output-only mockup. No policy code runs in this page. */
(() => {
'use strict';
const DATA = window.PLAN_VIZ_SAMPLE;
const $ = s => document.querySelector(s);
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = { enemy: '赤旗 · 骑士', enemy2: '青旗 · 射手', 'player-4': '金旗 · 骑士' };
const shortNames = { enemy: '赤旗', enemy2: '青旗', 'player-4': '金旗' };
const owners = Object.keys(DATA.players);
const team = owner => `var(--team-${owners.indexOf(owner)})`;
const state = { frame:0, owner:document.body.classList.contains('variant-b')?'enemy':'player-4', selected:null,
  mode:'spectator', solo:true, online:'self', ended:false, own:'player-4' };
const prettyLabel = label => label.startsWith('渡运 · ')?({settle:'渡运 · 工程队',assault:'渡运 · 突袭',advance:'渡运 · 前出登陆',reinforce:'渡运 · 增援',creep:'渡运 · 清营',rebase:'渡运 · 转移驻地',evacuate:'渡运 · 撤离'}[label.slice(5)]||label):label;
const statusNames = { active:'进行中', blocked:'受阻', done:'完成', abandoned:'放弃' };
const kindIcons = { island:'island', expansion:'flag', defense:'shield', attack:'swords', pressure:'advance', transport:'anchor', delivery:'anchor', task:'flag' };
const reasons = {
 'home-threat':'本土遇袭，扩张暂缓', 'mining-threat':'矿区遇袭，等待解除威胁', 'mine-threat':'目标矿区仍有威胁',
 'await-engineer-transport':'已清空滩头，等待工程队渡海', 'saving-hall-capital':'工程队已到，等待建城资金',
 'await-hall-order':'等待工程队下达建城指令', 'building-hall':'分矿正在施工', 'await-garrison':'等待驻防部队到位',
 'garrison-established':'分矿与驻军已交接', 'home-raid-reserve':'守岸兵力被保留，暂不装船', 'no-combat-crew':'缺少可用战斗船员',
 'approaching-load':'运输船正接近装载点', 'retry-delay':'等待重试窗口', 'await-combat-boarding':'等待战斗部队上船',
 'reinforcing-beachhead':'增援现有滩头部队', 'engineers-dispatched':'工程队运输已派出', 'clearing-camp':'清除岛上营地',
 'await-clearing-force':'等待足够的清营兵力', 'landing-established':'已建立实际登陆点', 'landing-party-lost':'登陆部队已损失',
 'mine-exhausted':'矿藏已经耗尽', 'mine-occupied':'目标矿区已被占领', 'ally-mine-claim':'盟友已经认领此矿',
 'await-delivery':'等待首次实际卸载战斗部队', delivered:'已完成实际登陆', withdrew:'上一轮进攻已撤回',
 'army-lost':'上一轮进攻部队已损失', destroyed:'目标已拆除', reached:'已抵达前压据点', advancing:'正在向据点前压',
 'en-route':'部队正在执行任务', arrived:'部队已经到位', returning:'部队正在回位', 'phase:fight':'正在保卫受袭矿区',
 'phase:gather':'集结防守部队', 'phase:loading':'装载部队，准备启航', 'phase:sailing':'正在航渡', 'phase:return':'返航整补',
 'stage:escort':'护送工程队前往矿区', 'stage:assemble':'集结扩张护卫', 'stage:clear':'清除目标矿区守军',
 'stage:fund':'筹措建城资金', 'stage:build':'分矿正在施工', 'stage:complete':'任务完成', 'stage:gather':'在营地外整队',
};
const reasonText = node => { const r=node.reasons[0]; return r ? reasons[r.code] || r.detail : '模块未记录原因'; };
const icon = kind => `<svg class="icon" aria-hidden="true"><use href="#i-${kind}"></use></svg>`;
const stamp = tick => { const sec=Math.floor(tick * DATA.provenance.secondsPerTick);return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`; };
const number = x => x == null ? '—' : Math.floor(x).toLocaleString('zh-CN');
const status = node => `<span class="status ${node.status}">${statusNames[node.status]}</span>`;
const targetName = node => {const id=node.target.entityId;return !id?'战图坐标':id.startsWith('gold-')?`金矿${id.match(/(\d+)$/)?.[1]?' '+id.match(/(\d+)$/)[1]:''}`:id.includes('townHall')||id.includes('townhall')?'城镇据点':id.includes('shipyard')?'船坞':'作战目标';};
const frame = () => DATA.frames[state.frame];
function permission() {
 if(state.mode==='solo'&&!state.solo)return {allowed:[],note:'单机计划已关闭；战图保留，意图与计划隐藏。'};
 if(state.mode==='online') {
  if(state.online==='after'&&!state.ended)return {allowed:[],note:'联机 · 赛后公开：当前对局尚未结束。'};
  if(state.online==='self')return {allowed:[state.own],note:'联机 · 只显示自己这一席的计划。'};
 }
 return {allowed:owners,note:state.mode==='online'?'赛后回顾 · 可查看全部 AI 的计划。':state.mode==='solo'?'单机 · 计划显示已开启。':'观战 / 回放 · 可查看全部 AI 的计划。'};
}
function available() { const p=permission();return Object.entries(frame().traces).filter(([o])=>p.allowed.includes(o)&&(state.owner==='all'||state.owner===o)); }
function selected() {const all=available();for(const [o,t] of all){const n=t.nodes.find(n=>state.selected===o+'|'+n.id);if(n)return {owner:o,trace:t,node:n};}
 const preferred=all.flatMap(([o,t])=>t.roots.map(id=>({owner:o,trace:t,node:t.nodes.find(n=>n.id===id)}))).filter(x=>x.node);
 const pick=preferred.find(x=>x.node.kind==='island'&&x.node.status==='blocked')||preferred.find(x=>x.node.status==='blocked')||preferred[0];
 if(pick)state.selected=pick.owner+'|'+pick.node.id;return pick;
}
function controls() {
 const p=permission();if(state.owner==='all'&&p.allowed.length===1)state.owner=p.allowed[0];if(state.owner!=='all'&&!p.allowed.includes(state.owner))state.owner=p.allowed[0]||state.own;
 $('#solo-control').classList.toggle('hidden',state.mode!=='solo');$('#online-control').classList.toggle('hidden',state.mode!=='online');
 $('#end-control').classList.toggle('hidden',state.mode!=='online'||state.online!=='after');
 $('#permission-note').textContent=p.note;
 $('#ai-tabs').innerHTML=[['all','全部'],...owners.map(o=>[o,shortNames[o]])].map(([o,label])=>
 `<button data-owner="${o}" style="--team:${team(o)}" ${o==='all'?p.allowed.length<2?'disabled':'':!p.allowed.includes(o)?'disabled':''} class="${state.owner===o?'active':''}">${label}</button>`).join('');
}
function relatedUnits(trace,node) {
 const ids=new Set(node.resources.unitIds);
 for(const id of node.children){const child=trace.nodes.find(n=>n.id===id);if(child)for(const unit of relatedUnits(trace,child))ids.add(unit);}
 return [...ids];
}
function renderLedger() {
 const all=available(), pick=selected();
 $('#goal-list').innerHTML=all.length?all.map(([owner,t])=>{
  const nodes=t.roots.map(id=>t.nodes.find(n=>n.id===id)).filter(Boolean);
  return `<div class="owner-title" style="--team:${team(owner)}"><i class="owner-dot"></i>${E(names[owner])} <span>${t.plannerVersion} · 最近决策 ${stamp(t.tick)}</span></div>`+
  nodes.map(node=>`<button class="goal ${pick?.owner===owner&&pick.node.id===node.id?'selected':''}" style="--team:${team(owner)}" data-node="${E(node.id)}" data-owner="${owner}">
   <div class="goal-heading">${icon(kindIcons[node.kind])}<span class="goal-name">${E(prettyLabel(node.label))}</span>${status(node)}</div>
   <div class="goal-meta"><span>${E(targetName(node))} · ${relatedUnits(t,node).length} 个关联单位</span><span title="当前模块未留存效用分">效用 ${number(node.utility.score)}</span></div>
   <p class="goal-reason">${E(reasonText(node))}</p></button>`).join('');
 }).join(''):`<div class="locked">${icon('lock')}<h3>计划尚未公开</h3><p>${E(permission().note)}</p></div>`;
 const roots=all.flatMap(([,t])=>t.nodes.filter(n=>t.roots.includes(n.id)));
 $('#metric-active').textContent=roots.filter(n=>n.status==='active').length;
 $('#metric-blocked').textContent=roots.filter(n=>n.status==='blocked').length;
 $('#metric-units').textContent=new Set(all.flatMap(([,t])=>t.nodes.flatMap(n=>n.resources.unitIds))).size;
 $('#metric-bank').textContent=all.length?number(all.reduce((n,[,t])=>n+t.bank.gold,0)):'—';
 $('#detail').innerHTML=pick?renderDetail(pick):`<div class="locked">${icon('lock')}<p>公开后可展开目标与子目标</p></div>`;
}
function renderDetail({owner,trace,node}) {
 function branch(n,depth=0,parentReason=reasonText(node)){
  const why=reasonText(n),requirements=n.requirements.map(r=>({ ...r, text:reasons[r.code]||r.detail })).filter(r=>r.text!==why&&r.text!==parentReason);
  return `<details class="tree" ${depth<2?'open':''}><summary>${icon(kindIcons[n.kind])}<span>${E(prettyLabel(n.label))}</span>${status(n)}</summary>
  <div class="tree-body">${why!==parentReason?E(why):''}${requirements.map(r=>`<p>${r.met===false?'○':r.met===true?'✓':'?'} ${E(r.text)}</p>`).join('')}
  ${n.resources.unitIds.length?`<p>任务名单 ${n.resources.unitIds.length} 个单位</p>`:''}</div>${n.children.map(id=>trace.nodes.find(x=>x.id===id)).filter(Boolean).map(c=>branch(c,depth+1,why)).join('')}</details>`;
 }
 return `<div class="micro">计划批注 / ${E(shortNames[owner])}</div><h3 style="--team:${team(owner)}">${icon(kindIcons[node.kind])}${E(prettyLabel(node.label))}${status(node)}</h3>
 <p class="reason-note">${E(reasonText(node))}</p>
 <div class="detail-stats"><span>效用分<b>${number(node.utility.score)}</b></span><span>关联单位<b>${relatedUnits(trace,node).length} 个</b></span><span>需求金额<b>${number(node.resources.gold.required)}</b></span><span>已预留<b>${number(node.resources.gold.reserved)}</b></span></div>
 ${node.children.length?node.children.map(id=>trace.nodes.find(n=>n.id===id)).filter(Boolean).map(n=>branch(n)).join(''):'<p class="micro">当前目标没有独立的子任务记录</p>'}<details class="tree"><summary>查看依据与占用</summary><div class="tree-body"><p>来源：${E(node.source)}</p><p>目标：${E(node.target.entityId||'坐标目标')}</p><p>效用：${node.utility.source==='not-recorded'?'现有模块未记录，等待战略评分层输出':E(node.utility.score)}</p>${node.utility.terms.map(term=>`<p>${E(term.name)} ${E(term.value)} · ${E(term.explanation)}</p>`).join('')}<p>金额需求为规则名义费用；预留未知。父子节点名单可能重叠，不重复相加。</p><p class="ids">${node.resources.unitIds.map(E).join('<br>')||'未记录指定单位'}</p><p class="trace-source">${E(node.id)}</p></div></details>`;
}
// Extract actual cell boundaries, simplify sub-cell corners and round the ink coast. No invented islands or coordinates.
const W=900,H=650, scale=Math.min(790/DATA.map.width,550/DATA.map.height),ox=(W-DATA.map.width*scale)/2,oy=45;
const xy = p=>({x:ox+p.x*scale,y:oy+p.y*scale});
function polygons(test){
 const t=DATA.map.terrain,edges=new Map();if(!t)return [];
 const yes=(x,y)=>x>=0&&y>=0&&x<t.cols&&y<t.rows&&test(t.cells[y*t.cols+x]);
 const edge=(a,b)=>{const key=a.join(',');if(!edges.has(key))edges.set(key,[]);edges.get(key).push(b);};
 for(let y=0;y<t.rows;y++)for(let x=0;x<t.cols;x++)if(yes(x,y)){
  if(!yes(x,y-1))edge([x,y],[x+1,y]);if(!yes(x+1,y))edge([x+1,y],[x+1,y+1]);
  if(!yes(x,y+1))edge([x+1,y+1],[x,y+1]);if(!yes(x-1,y))edge([x,y+1],[x,y]);
 }
 const out=[];
 while(edges.size){const start=edges.keys().next().value;let key=start,poly=[],guard=0;
  do {const next=edges.get(key);if(!next?.length)break;poly.push(key.split(',').map(Number));const point=next.pop();if(!next.length)edges.delete(key);key=point.join(',');}while(key!==start&&guard++<200000);
  if(poly.length>8)out.push(poly.filter((p,i)=>{const a=poly[(i+poly.length-1)%poly.length],b=poly[(i+1)%poly.length];return p[0]!==a[0]&&p[1]!==b[1]||p[1]!==a[1]&&p[0]!==b[0];}).map(([x,y])=>xy({x:x*t.cell,y:y*t.cell})));
 }
 return out;
}
function contour(points){if(points.length<3)return '';let d='';for(let i=0;i<points.length;i++){const p=points[i],next=points[(i+1)%points.length],prev=points[(i+points.length-1)%points.length];
 if(!i)d+=`M${(prev.x+p.x)/2},${(prev.y+p.y)/2}`;d+=` Q${p.x},${p.y} ${(p.x+next.x)/2},${(p.y+next.y)/2}`;}return d+'Z';}
const coast=polygons(c=>c!=='~'&&c!==',').map(contour).join(' '),forest=polygons(c=>c==='T').map(contour).join(' '),rock=polygons(c=>c==='#').map(contour).join(' ');
function mapBackground(){let waves='';for(let i=0;i<21;i++){const x=28+(i*211)%850,y=70+(i*137)%525;waves+=`<path d="M${x} ${y}q7 -4 14 0t14 0m-16 8q7 -3 14 0"/>`;}
 return `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5 1 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>
 <g fill="none" stroke="var(--ink)" stroke-opacity=".16" stroke-width=".7">${waves}</g>
 <path d="${coast}" transform="translate(0 3)" fill="var(--sea-dark)"/>
 <path d="${coast}" fill="var(--paper-dark)" stroke="var(--ink)" stroke-opacity=".5" stroke-width="1.1"/>
 <path d="${forest}" fill="var(--forest)" stroke="var(--ink)" stroke-opacity=".13" stroke-width=".7"/>
 <path d="${rock}" fill="var(--rock)" stroke="var(--ink)" stroke-opacity=".18" stroke-width=".7"/>
 <g transform="translate(70 88)" fill="none" stroke="var(--ink)" opacity=".65"><path d="M0 -25L6 0 0 24 -6 0ZM-20 0H20M0 -20V20" stroke-width="1"/><path d="M0 -25L6 0H0Z" fill="var(--ink)"/><text y="-34" fill="var(--ink)" stroke="none" text-anchor="middle" font-size="13" font-family="Georgia">N</text></g>
 <g transform="translate(55 600)" stroke="var(--ink)" stroke-width="1"><path d="M0 -4V3H82V-4M41 0V4" fill="none"/><text y="18" fill="var(--ink)" stroke="none" font-size="11">约 1,000 码</text></g>`;
}
function renderMap(){const f=frame(),pick=selected(),p=permission();let shapes='',intents='',marks='';
 for(const mine of DATA.map.resources){const q=xy(mine);shapes+=`<g transform="translate(${q.x} ${q.y})" opacity=".65"><path d="M-4 2L0 -4 4 2 0 5Z" fill="var(--brass)" stroke="var(--ink)" stroke-width=".8"/></g>`;}
 for(const b of f.buildings.filter(b=>b.kind==='townHall'||b.kind==='shipyard')){const q=xy(b),color=owners.includes(b.owner)?team(b.owner):'var(--muted)';
 shapes+=`<g transform="translate(${q.x} ${q.y})" fill="var(--paper-light)" stroke="var(--ink)" stroke-width=".9"><path d="M-6 4V-3L0 -7 6 -3V4Z"/><path d="M0 -7V-14L9 -11 0 -8Z" fill="${color}"/><path d="M-2 4V0H2V4"/></g>`;}
 const clusters=new Map();for(const u of f.units.filter(u=>!u.shipId&&(!['solo','online'].includes(state.mode)||p.allowed.includes(u.owner)))){
  const key=u.owner+':'+Math.floor(u.x/175)+':'+Math.floor(u.y/175);const c=clusters.get(key)||{owner:u.owner,x:0,y:0,n:0,sea:false};c.x+=u.x;c.y+=u.y;c.n++;c.sea||=/transport|ship|galley|frigate/i.test(u.kind);clusters.set(key,c);
 }
 for(const c of clusters.values()){const q=xy({x:c.x/c.n,y:c.y/c.n}),color=owners.includes(c.owner)?team(c.owner):'var(--muted)';
  shapes+=c.sea?`<g transform="translate(${q.x} ${q.y})" stroke="var(--ink)" stroke-width=".9"><path d="M-7 3H7L4 7H-4Z" fill="var(--paper-light)"/><path d="M0 -9V3M0 -9L6 0H0Z" fill="${color}"/></g>`:
   `<g transform="translate(${q.x} ${q.y})"><circle r="${Math.min(4.3,2+c.n/5)}" fill="${color}" stroke="var(--paper-light)" stroke-width=".8"/>${c.n>=5?`<text y="-7" class="map-unit-label">${c.n}</text>`:''}</g>`;
 }
 const byId=new Map(f.units.map(u=>[u.id,u])),labels=[];
 for(const [owner,t] of available())for(const id of t.roots){const node=t.nodes.find(n=>n.id===id);if(!node?.target.position||node.status==='abandoned'||node.status==='done')continue;
  const q=xy(node.target.position),isSelected=pick?.owner===owner&&pick.node.id===id,color=team(owner);
  const allocated=relatedUnits(t,node).map(id=>byId.get(id)).filter(Boolean);
  if(allocated.length){const ship=allocated.find(u=>/transport|ship|galley|frigate/i.test(u.kind));
   const from=(node.kind==='transport'||node.kind==='island')&&ship?ship:{x:allocated.reduce((s,u)=>s+u.x,0)/allocated.length,y:allocated.reduce((s,u)=>s+u.y,0)/allocated.length};const a=xy(from);
   if(Math.hypot(a.x-q.x,a.y-q.y)>15)intents+=`<path class="intent ${isSelected?'selected':''}" style="--team:${color}" d="M${a.x} ${a.y}Q${(a.x+q.x)/2+20} ${(a.y+q.y)/2-18} ${q.x} ${q.y}"/>`;
  }
  let dx=0,dy=0;const near=labels.filter(a=>Math.hypot(a.x-q.x,a.y-q.y)<25).length;if(near){dx=near%2?22:-22;dy=-14*Math.ceil(near/2);}labels.push(q);
  marks+=`<g class="goal-mark" data-node="${E(id)}" data-owner="${owner}" transform="translate(${q.x+dx} ${q.y+dy})" style="--team:${color}">
   ${dx?`<path d="M${-dx} ${-dy}L0 0" stroke="var(--ink)" stroke-width=".8"/>`:''}<circle r="${isSelected?17:13}" fill="var(--paper-light)" stroke="${color}" stroke-width="${isSelected?2.3:1.3}"/>
   <svg x="-8" y="-8" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${kindIcons[node.kind]}"/></svg>
   ${node.status==='blocked'?'<g transform="translate(11 -13)"><circle r="7" class="blocked-tag"/><text y="3.5" font-size="11" text-anchor="middle" fill="var(--red)">!</text></g>':''}
   <title>${E(names[owner]+' · '+node.label+'：'+reasonText(node))}</title></g>`;
  if(isSelected)marks+=`<g transform="translate(${Math.min(660,Math.max(65,q.x+22))} ${Math.min(560,Math.max(45,q.y-42))})"><path d="M0 0H172V38H0Z" fill="var(--paper-light)" stroke="var(--ink)" stroke-width=".7"/><text x="8" y="15" font-size="12" fill="var(--ink)">${E(prettyLabel(node.label)+' · '+statusNames[node.status])}</text><text x="8" y="30" font-size="11" fill="var(--red)">${E(reasonText(node).slice(0,17))}</text></g>`;
 }
 $('#map-svg').innerHTML=mapBackground()+shapes+intents+marks;
 $('#map-lock').classList.toggle('hidden',p.allowed.length>0);$('#map-lock').textContent=p.note;
 $('#map-name').textContent='环水群岛 / '+DATA.map.name;$('#map-frame-time').textContent=stamp(f.tick);
}
function renderTimeline(){const f=frame(),allowed=available().map(([o])=>o);
 const byOwner={
  enemy:[['本土受袭，扩张暂缓','回防与清营计划同时保留'],['矿区交战，装载重试','渡运等待重新组织'],['守岸兵力仍需保留','本土威胁尚未解除']],
  enemy2:[['护送工程队，分矿施工','渡运仍在接近装载点'],['向前压据点行军','保留扩张目标，继续部署'],['前压点已经抵达','据点任务记录为完成']],
  'player-4':[['滩头已清，工程队未到','清营结束，等待工程队运输'],['已派运输，组织登陆','一支登陆船正在装载'],['工程队到岸，资金待齐','受阻原因由运输转为资金']]
 };
 const moments=!allowed.length?Array.from({length:3},()=>['计划尚未公开','选择允许公开的观看方式'])
  :allowed.length===1?byOwner[allowed[0]]:[['夺岛与本土回防并行','同一局的多支部队同时行动'],['保住矿区，组织渡运','各席继续执行已有任务'],['工程队到岸，资金待齐','前压据点也已抵达']];
 $('#moments').innerHTML=DATA.frames.map((f,i)=>`<button class="moment ${i===state.frame?'active':''}" data-frame="${i}"><span class="moment-time">${stamp(f.tick)}</span><span><span class="moment-label">${moments[i][0]}</span><span class="moment-sub" style="display:block">${moments[i][1]}</span></span></button>`).join('');
 const events=DATA.events.filter(e=>allowed.includes(e.owner)&&e.tick<=f.tick);
 $('#event-strip').innerHTML=events.length?events.slice(-7).map(e=>`<div class="event" title="${E(e.detail)}"><strong>${stamp(e.tick)} · ${E(shortNames[e.owner])}</strong><p>${E(prettyLabel(e.label))}</p><p>${e.kind==='added'?'首次观察到此元素':e.kind==='status'?E(statusNames[e.before]+' → '+statusNames[e.after]):e.kind==='removed'?'模块已释放 · 结果未推断':E(e.detail.split(' → ').map(s=>reasons[s]||s).join(' → '))}</p></div>`).join(''):'<div class="micro">当前可见范围内没有公开的计划变化。</div>';
 $('#time').textContent=stamp(f.tick);$('#decision-note').textContent=`第 ${f.tick.toLocaleString()} tick · 每 15 tick 决策`;
}
function render(){controls();renderLedger();renderMap();renderTimeline();}
$('#view-mode').addEventListener('change',e=>{state.mode=e.target.value;state.selected=null;render();});
$('#solo-visible').addEventListener('change',e=>{state.solo=e.target.checked;render();});
$('#online-rule').addEventListener('change',e=>{state.online=e.target.value;state.selected=null;render();});
$('#match-ended').addEventListener('change',e=>{state.ended=e.target.checked;state.selected=null;render();});
document.addEventListener('click',e=>{const moment=e.target.closest('[data-frame]');if(moment){state.frame=Number(moment.dataset.frame);render();return;}
 const goal=e.target.closest('[data-node]');if(goal){state.selected=goal.dataset.owner+'|'+goal.dataset.node;render();return;}
 const owner=e.target.closest('button[data-owner]');if(owner&&!owner.disabled){state.owner=owner.dataset.owner;state.selected=null;render();}
});
render();
})();
