/* Offline second mockup. History is presentation output, never an input to a planner. */
(() => {
'use strict';
const DATA=window.PLAN_TIMELINE, M=window.PLAN_TIMELINE_MODEL;
const $=s=>document.querySelector(s);
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const owners=Object.keys(DATA.players), names={enemy:'赤旗 · 骑士',enemy2:'青旗 · 射手','player-4':'金旗 · 骑士'}, shortNames={enemy:'赤旗',enemy2:'青旗','player-4':'金旗'};
const team=o=>`var(--team-${owners.indexOf(o)})`;
const history=DATA.thinks.map(t=>({...t,nodes:t.nodes.map(i=>window.PLAN_TIMELINE_NODES[i])}));
const series=Object.fromEntries(owners.map(o=>[o,history.filter(t=>t.owner===o)]));
const bands=M.bands(history,DATA.provenance.endTick);
const start=DATA.provenance.startTick,end=DATA.provenance.endTick;
const state={tick:18600,owner:'player-4',selected:null,unit:null,death:null,mode:'spectator',solo:false,own:'player-4',executors:false,playing:false};
const stamp=tick=>{const sec=Math.floor(tick*.05);return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;};
const number=n=>n==null?'—':Math.floor(n).toLocaleString('zh-CN');
const icon=kind=>`<svg class="icon" aria-hidden="true"><use href="#i-${kind}"/></svg>`;
const unitNames={worker:'工人',footman:'步兵',archer:'弓手',horseArcher:'骑射手',ashChieftain:'灰烬酋长',sparkRifleman:'火花射手',knight:'骑士',priest:'牧师',transport:'运输船',carrier:'运兵船',shipOfTheLine:'战列舰',townHall:'城镇大厅',shipyard:'船坞',summoner:'召唤师',witch:'女巫'};
const kindName=k=>unitNames[k]||k;
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

const reasonText=n=>{const r=n?.reasons[0];return r?(reasons[r.code]||r.detail):'模块没有保留原因';};
const status=n=>`<span class="status ${n.status}">${statusNames[n.status]}</span>`;
const allowed=()=>M.allowed(state.mode,state.solo,state.own,owners);
const currentTrace=o=>M.at(series[o],state.tick);
const currentFrame=()=>M.at(DATA.frames,state.tick);
const nodeIn=(trace,id)=>trace?.nodes.find(n=>n.id===id);
const targetName=n=>n.target.entityId?.startsWith('gold-')?'金矿 '+n.target.entityId.match(/(\d+)$/)?.[1]:n.target.entityId?.includes('townHall')?'城镇据点':'记录的目标位置';
const asUnits=f=>(f?.units||[]).map(row=>({...DATA.unitCatalog[row[0]],x:row[1],y:row[2],hp:row[3],shipId:row.length>4?DATA.unitCatalog[row[4]]?.id:null}));
function nodeAt(owner,id,band){const until=band?.outcome==='released'?Math.min(state.tick,band.end-1):state.tick;const rows=series[owner].filter(t=>t.tick<=until&&(!band||t.tick>=band.observedStart));for(let i=rows.length-1;i>=0;i--){const node=nodeIn(rows[i],id);if(node)return {node,trace:rows[i],owner,historical:!nodeIn(currentTrace(owner),id)||(band?.outcome==='released'&&band.end<=state.tick)};}return null;}
function selected(){
 if(!allowed().includes(state.owner))state.owner=allowed()[0]||state.own;
 if(state.selected){const band=bands.find(b=>b.key===state.selected);if(band&&allowed().includes(band.owner)){const found=nodeAt(band.owner,band.id,band);if(found)return {...found,band};}}
 const trace=currentTrace(state.owner);if(!trace)return null;
 const roots=trace.roots.map(id=>nodeIn(trace,id)).filter(Boolean),node=roots.find(n=>n.kind==='island')||roots.find(n=>n.status==='blocked')||roots[0];
 const band=bands.filter(b=>b.owner===state.owner&&b.id===node?.id&&b.observedStart<=state.tick).at(-1);
 if(!node||!band)return null;state.selected=band.key;return {owner:state.owner,trace,node,band,historical:false};
}
function selectBand(key,seek=false){const band=bands.find(b=>b.key===key);if(!band||!allowed().includes(band.owner))return;
 state.owner=band.owner;state.selected=key;state.unit=null;state.death=null;
 if(seek||state.tick<band.observedStart)state.tick=Math.max(start+15,Math.min(end,band.observedStart));
 render();$('#detail').scrollTop=0;
}
function policy(){
 const p=allowed();
 $('#solo-control').hidden=state.mode!=='solo';
 $('#jump-defense').hidden=!p.includes('enemy');$('#jump-death').hidden=!DATA.events.some(e=>e.type==='death'&&p.includes(e.owner));$('#jump-result').hidden=!p.includes('player-4');$('#postmatch').hidden=state.mode!=='online';
 $('#permission-note').textContent=state.mode==='online'?'联机对局只看自己（金旗）；对手计划在赛后回放中查看。':state.mode==='solo'?(state.solo?'单机 · 计划显示已开启。':'单机 · 默认关闭 AI 计划，可自行开启。'):'观战 / 回放 · 所有席位可见。';
 $('#ai-tabs').innerHTML=owners.map(o=>`<button data-owner="${o}" style="--team:${team(o)}" ${p.includes(o)?'':'disabled'} class="${o===state.owner?'active':''}">${shortNames[o]}</button>`).join('');
 $('#map-lock').hidden=p.length>0;$('#map-lock').textContent='AI 计划已关闭';
 if(state.death&&!p.includes(DATA.events.find(e=>e.id===state.death)?.owner))state.death=null;
 $('.flow-nav').hidden=!!state.death;
}
function renderGoals(){
 const trace=allowed().includes(state.owner)?currentTrace(state.owner):null,pick=state.death?null:selected();
 $('#goal-list').innerHTML=trace?trace.roots.map(id=>nodeIn(trace,id)).filter(Boolean).map(n=>{
  const band=bands.filter(b=>b.owner===state.owner&&b.id===n.id&&b.observedStart<=state.tick).at(-1);
  return `<button data-band="${E(band?.key)}" class="${pick?.node.id===n.id?'selected':''}" style="--team:${team(state.owner)}"><strong>${E(prettyLabel(n.label))}</strong><small>效用 ${number(n.utility.score)} ${status(n)}</small></button>`;
 }).join(''):'<div class="empty-dossier">没有公开的计划</div>';
}
function branch(trace,n,depth=0){return `<details class="tree" ${depth<1?'open':''}><summary>${icon(kindIcons[n.kind])}${E(prettyLabel(n.label))}${status(n)}</summary><div class="tree-body">${E(reasonText(n))}${n.requirements.map(r=>`<p>${r.met===true?'✓':r.met===false?'○':'?'} ${E(reasons[r.code]||r.detail)}</p>`).join('')}</div>${n.children.map(id=>nodeIn(trace,id)).filter(Boolean).map(c=>branch(trace,c,depth+1)).join('')}</details>`;}
function goalEvents(pick){return series[pick.owner].filter(t=>t.tick<=state.tick).flatMap(t=>t.changes.filter(c=>c.nodeId===pick.node.id&&c.kind!=='allocation'&&c.kind!=='utility').map(c=>({tick:t.tick,...c})));}
function actualOutcome(pick){
 if(pick.node.status==='done')return reasonText(pick.node);
 if(pick.node.status==='abandoned')return reasonText(pick.node);
 if(pick.historical)return '记录已释放；没有正式结果归因';
 return pick.node.status==='blocked'?'尚未达成 · '+reasonText(pick.node):'仍在执行 · 尚无终局记录';
}
function renderDetail(){
 if(!allowed().length){$('#detail').innerHTML='<div class="empty-dossier">计划关闭时，目标、轨迹、时间轴与归因一起隐藏。</div>';return;}
 const death=DATA.events.find(e=>e.id===state.death&&e.tick<=state.tick&&allowed().includes(e.owner));
 if(death){if(death.type==='building-loss')renderBuildingLoss(death);else renderDeath(death);return;}
 const p=selected();if(!p){$('#detail').innerHTML='<div class="empty-dossier">此刻尚无目标记录</div>';return;}
 const {node:n,trace,owner}=p,ids=M.related(trace,n.id),units=asUnits(currentFrame()),byId=new Map(units.map(u=>[u.id,u]));
 if(!ids.includes(state.unit))state.unit=ids.find(id=>/transport|carrier|ship|galley/i.test(byId.get(id)?.kind||''))||ids[0]||null;
 const deaths=DATA.events.filter(e=>e.type==='death'&&e.owner===owner&&e.tick<=state.tick&&e.attribution.rootIds.includes(n.id));
 const changes=goalEvents(p),lastClaim=M.assignedClaim(trace.claims,state.unit,n);
 const arrival=state.unit?M.arrival(series[owner],state.unit,state.tick,lastClaim):null;
 const details=n.children.map(id=>nodeIn(trace,id)).filter(Boolean);
 $('#detail').innerHTML=`<div class="micro">${E(names[owner])} / 决策 ${stamp(trace.tick)} ${p.historical?'· 历史目标':''}</div><h3>${icon(kindIcons[n.kind])}${E(prettyLabel(n.label))}${status(n)}</h3><div class="reason-callout">${E(reasonText(n))}</div>
 <table class="comparison" aria-label="意图与结果对照"><thead><tr><th></th><th>意图 / 预计</th><th>实际 / 已观察</th></tr></thead><tbody><tr><td>效果</td><td>—<br><span class="stage-mini">预期效果待接入</span></td><td>${E(actualOutcome(p))}</td></tr><tr><td>到达</td><td>—<br><span class="stage-mini">未记录 ETA</span></td><td>${arrival?(arrival.beforeObservation?'≤ ':'')+stamp(arrival.tick):lastClaim?.arrived===false?'未到岗（claim）':'— 未记录'}${arrival?.beforeObservation?'<br><span class="stage-mini">首次观察时已经到位</span>':''}</td></tr></tbody></table>
 <section class="flow-section" id="flow-why"><h4><i>01</i> 为什么选它 <span class="stage-mini">总效用 ${number(n.utility.score)}</span></h4><div class="utility-grid">${[['收益','benefit'],['成本','cost'],['成功概率','successProbability'],['坚持加分','persistence']].map(([label,key])=>{const term=n.utility.terms.find(t=>t.name===key);return `<div>${label}<b>${term?number(term.value):'—'}</b></div>`;}).join('')}</div><p class="micro">评分层待接入；不把模块优先级当作效用分。</p></section>
 <section class="flow-section" id="flow-how"><h4><i>02</i> 怎么做</h4><p>方法选择 <span class="stage-mini">— 待正式规划层输出</span></p>${details.length?details.map(c=>branch(trace,c)).join(''):'<p class="micro">没有独立的子目标记录</p>'}${n.requirements.map(r=>`<p>${r.met===false?'○ 未满足':r.met===true?'✓ 已满足':'? 未知'} · ${E(reasons[r.code]||r.detail)}</p>`).join('')}<p class="micro">此树只展示模块保留的当前阶段，不虚构未来步骤。</p></section>
 <section class="flow-section" id="flow-who"><h4><i>03</i> 派了谁 <span class="stage-mini">${ids.length} 个单位，父子去重</span></h4><div class="crew-list">${ids.map(id=>{const u=byId.get(id),c=M.assignedClaim(trace.claims,id,n);return `<button class="crew-row ${state.unit===id?'selected':''}" data-unit="${E(id)}"><span>${E(kindName(u?.kind||DATA.unitCatalog.find(u=>u.id===id)?.kind||'单位'))} <small>· ${E(id.match(/(\d+)$/)?.[1]||id)}</small></span><span>${c?.returning?'回位中':c?.arrived===true?'已到岗':c?.arrived===false?'在路上':'到岗状态 —'} <small>ETA —</small></span></button>`;}).join('')||'<p class="micro">模块没有保留指定单位；不从附近部队猜测名单。</p>'}</div><p class="micro">点击单位查看它在观察窗内的实走轨迹（可能包含先前任务）。</p><table class="comparison"><thead><tr><th>资源</th><th>需求</th><th>已预留</th></tr></thead><tbody><tr><td>金币</td><td>${number(n.resources.gold.required)}</td><td>${number(n.resources.gold.reserved)}</td></tr></tbody></table><p class="micro">全军现金 ${number(trace.bank.gold)}，不等于本目标预算。</p></section>
 <section class="flow-section" id="flow-progress"><h4><i>04</i> 执行得怎样</h4><ol class="progress-log">${changes.slice(-7).map(c=>`<li><time>${stamp(c.tick)}</time>${c.kind==='added'?'首次观察到任务，非真实开始时间':c.kind==='removed'?'模块释放记录，结果未知':c.kind==='status'?E((statusNames[c.before]||'—')+' → '+(statusNames[c.after]||'—')):E(c.detail.split(' → ').map(s=>reasons[s]||s).join(' → '))}</li>`).join('')||'<li>此窗口内没有独立的变化事件</li>'}</ol></section>
 <section class="flow-section" id="flow-result"><h4><i>05</i> 结果与代价</h4><p>${E(actualOutcome(p))}</p><p>归因至此目标的阵亡 <b>${deaths.length}</b> <span class="inferred">目标归因 · 推断</span></p>${deaths.map(deathButton).join('')}${DATA.events.filter(e=>e.type==='death'&&e.owner===owner&&e.tick<=state.tick&&!e.attribution.rootIds.length).map(e=>'<p class="micro">这一席另有未归属的阵亡：</p>'+deathButton(e)).join('')}<p class="micro">0 不等于无损：没有归属的死亡不会强行分摊给一个目标。抢占与损失预算待账本输出。</p></section>
 <details class="tree"><summary>查看原始依据</summary><div class="tree-body">${E(n.source)}<br>${E(n.id)}<br>目标 ${E(n.target.entityId||'坐标')}<br>观察 tick ${trace.tick}</div></details>`;
}
function deathButton(e){return `<button class="loss-card" data-death="${E(e.id)}"><span class="red">✕ ${stamp(e.tick)} · ${E(kindName(e.kind))}</span>　${e.attribution.assessment==='review'?'疑似异常':'未分类'} <span class="inferred">推断</span></button>`;}
function renderBuildingLoss(e){$('#detail').innerHTML=`<button class="back-plan" id="back-plan">← 回到目标手记</button><p class="micro">建筑损失 / ${E(names[e.owner])}</p><h3 class="death-head">◆ ${E(kindName(e.kind))}被摧毁</h3><dl class="fact-table"><dt>时间</dt><dd>${stamp(e.tick)} / tick ${e.tick}</dd><dt>位置</dt><dd>(${e.x}, ${e.y})</dd><dt>致命来源</dt><dd>${e.killer?E(kindName(e.killer.kind)):'— 未记录'}</dd><dt>服务目标</dt><dd>— 待接入</dd></dl><p class="micro">建筑 HP 归零与移除为事实；没有证据时不推断所属目标或失败原因。</p>`;}
function renderDeath(e){const a=e.attribution;
 const goalNames=a.rootIds.map(id=>nodeAt(e.owner,id)?.node.label||id);
 $('#detail').innerHTML=`<button class="back-plan" id="back-plan">← 回到目标手记</button><p class="micro">阵亡记录 / ${E(names[e.owner])} / tick ${e.tick}</p><h3 class="death-head">✕ ${E(kindName(e.kind))}阵亡</h3><div class="reason-callout">${a.assessment==='review'?'疑似异常 · 需复核':'未判定正常或异常'} <span class="inferred">推断</span></div>
 <dl class="fact-table"><dt>时间 / 位置</dt><dd>${stamp(e.tick)} · (${e.x}, ${e.y})<br><span class="stage-mini">事实 · 仿真中的死亡与坐标</span></dd><dt>致命来源</dt><dd>${e.killer?E(kindName(e.killer.kind)+' · '+(shortNames[e.killer.owner]||e.killer.owner)):'未观察到直接致命击打'}<br><span class="stage-mini">${e.killer?'事实 · 伤害观察接口':'例如船毁连带损失；来源未知时留空'}</span></dd><dt>服务目标</dt><dd>${goalNames.length?E(goalNames.join(' / ')):'未找到保留的目标归属'} <span class="inferred">推断</span></dd><dt>执行步骤</dt><dd>${E(a.stages.map(s=>prettyLabel(s.label)).join(' / ')||'— 没有阶段记录')} <span class="inferred">推断</span></dd><dt>单位占用</dt><dd>${E(a.claim?.kind||'无活跃 claim')}<br>到岗 ${a.claim?.arrived==null?'—':a.claim.arrived?'已到位':'在途中'}</dd><dt>当前订单</dt><dd>${E(({move:'移动',attack:'攻击',attackMove:'攻击前进',idle:'空闲'})[a.order.type]||a.order.type)}${a.order.avoidCombat?' · 避战':''}<br><span class="stage-mini">事实 · 死亡时订单</span></dd><dt>最后执行器</dt><dd>${E(a.command?.scriptId||'—')}<br><span class="stage-mini">${a.command?stamp(a.command.tick)+' · '+E(a.command.type):'窗口内没有交付记录'}</span></dd></dl>
 <section class="flow-section"><h4>为什么标记需复核 <span class="inferred">推断</span></h4><p>${a.command?.scriptId==='mobileCare'?'最后交付的执行器为 mobileCare，死亡时在避战移动。疑似治疗/机动途中损失；缺少正式目标分配表，不能断言其任务归属。':E(a.reason)}</p><p class="micro">正式死亡账本待接入。当前启发式只筛出工人、移动/空闲订单和撤退相关执行器下的死亡；未命中不等于正常战损。</p></section><section class="flow-section"><h4>还缺哪些证据</h4><p class="micro">局部兵力比、目标可接受损失、血量轨迹、伤害构成、切换/抢占上下文均未记录，保持为 —。</p></section><p class="micro">${E(e.unitId)}<br>${e.cause==='ship-loss'?'船毁连带损失':'直接战斗损失'}</p>`;
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

const background=mapBackground();
function renderMap(){
 const f=currentFrame(),units=asUnits(f),focusLoss=DATA.events.find(e=>e.id===state.death),pick=focusLoss?null:selected(),permitted=allowed();let shapes='',marks='',routes='';
 for(const mine of DATA.map.resources){const q=xy(mine);shapes+=`<path d="M${q.x-3} ${q.y+2}l3 -6 4 6-4 3Z" fill="var(--brass)" stroke="var(--ink)" stroke-width=".6"/>`;}
 for(const row of f?.buildings||[]){const b=DATA.buildingCatalog[row[0]];if(!['townHall','shipyard'].includes(b.kind))continue;const q=xy(b),color=owners.includes(b.owner)?team(b.owner):'var(--muted)';
  shapes+=`<g transform="translate(${q.x} ${q.y})" fill="var(--paper-light)" stroke="var(--ink)" stroke-width=".8"><path d="M-6 4V-3L0 -7 6 -3V4Z"/><path d="M0 -7V-14L9 -11 0 -8Z" fill="${color}"/>${!row[1]?'<path d="M-8 7L8 -8"/>':''}</g>`;}
 const clusters=new Map();
 for(const u of units.filter(u=>!u.shipId&&permitted.includes(u.owner))){const key=u.owner+':'+Math.floor(u.x/140)+':'+Math.floor(u.y/140);const c=clusters.get(key)||{owner:u.owner,x:0,y:0,n:0,sea:false};c.x+=u.x;c.y+=u.y;c.n++;c.sea||=/transport|carrier|ship|galley|frigate/i.test(u.kind);clusters.set(key,c);}
 for(const c of clusters.values()){const q=xy({x:c.x/c.n,y:c.y/c.n}),color=team(c.owner);shapes+=c.sea?`<g transform="translate(${q.x} ${q.y})" stroke="var(--ink)" stroke-width=".9"><path d="M-7 3H7L4 7H-4Z" fill="var(--paper-light)"/><path d="M0 -9V3M0 -9L6 0H0Z" fill="${color}"/></g>`:`<circle cx="${q.x}" cy="${q.y}" r="${Math.min(4.3,2+c.n/5)}" fill="${color}" stroke="var(--paper-light)" stroke-width=".8"/>`;}
 if((pick||focusLoss)&&state.unit){
  const points=DATA.frames.filter(row=>row.tick<=state.tick).map(row=>row.units.find(u=>DATA.unitCatalog[u[0]].id===state.unit)).filter(Boolean).map(row=>xy({x:row[1],y:row[2]}));
  if(points.length>1)routes+=`<path class="actual-route" stroke="${team(focusLoss?.owner||pick.owner)}" d="${points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ')}"><title>选中单位实际轨迹，每秒采样，仅绘制当前时刻以前</title></path>`;
  const u=units.find(u=>u.id===state.unit),target=pick?.node.target.position;
  if(u&&!focusLoss){const a=xy(u);if(target){const b=xy(target);routes+=`<path class="intent-route" stroke="${team(focusLoss?.owner||pick.owner)}" d="M${a.x} ${a.y}L${b.x} ${b.y}"><title>记录目标的意图方向；计划导航路线待接入</title></path>`;}
   marks+=`<circle class="trajectory-unit" cx="${a.x}" cy="${a.y}" r="6" stroke="${team(pick.owner)}"/><text x="${a.x+9}" y="${a.y-8}" font-size="10" fill="var(--ink)">${E(kindName(u.kind))}</text>`;}
 }
 const labelPositions=[];
 for(const owner of permitted){const trace=currentTrace(owner);if(!trace)continue;
  for(const id of trace.roots){const n=nodeIn(trace,id);if(!n?.target.position||n.status==='done'||n.status==='abandoned')continue;
   const p=xy(n.target.position),sel=pick?.owner===owner&&pick.node.id===id,color=team(owner);
   const overlap=labelPositions.filter(q=>Math.hypot(q.x-p.x,q.y-p.y)<27).length;labelPositions.push(p);const dx=overlap?20*(overlap%2?1:-1):0,dy=overlap?-16*Math.ceil(overlap/2):0;
   const band=bands.filter(b=>b.owner===owner&&b.id===id&&b.observedStart<=state.tick).at(-1);
   if(sel&&!state.unit){const ids=M.related(trace,id),allocated=units.filter(u=>ids.includes(u.id)),u=allocated.find(u=>/transport|carrier|ship/i.test(u.kind))||allocated[0];if(u){const a=xy(u);routes+=`<path class="intent-route" stroke="${color}" d="M${a.x} ${a.y}L${p.x} ${p.y}"/>`;}}
   marks+=`<g class="goal-mark" data-band="${E(band?.key)}" role="button" tabindex="0" aria-label="${E(shortNames[owner]+' '+prettyLabel(n.label)+' '+reasonText(n))}" transform="translate(${p.x+dx} ${p.y+dy})"><title>${E(shortNames[owner]+' · '+prettyLabel(n.label)+'：'+reasonText(n))}</title>${dx?`<path d="M${-dx} ${-dy}L0 0" stroke="var(--ink)" stroke-width=".6"/>`:''}<circle r="${sel?17:12}" fill="var(--paper-light)" stroke="${color}" stroke-width="${sel?2.5:1.3}"/><svg x="-8" y="-8" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.5"><use href="#i-${kindIcons[n.kind]}"/></svg>${n.status==='blocked'?'<g transform="translate(11 -12)"><circle r="6.5" fill="var(--paper-light)" stroke="var(--red)"/><text y="3.5" text-anchor="middle" font-size="10" fill="var(--red)">!</text></g>':''}</g>`;
   if(sel)marks+=`<g transform="translate(${Math.min(650,Math.max(60,p.x+22))} ${Math.min(535,Math.max(45,p.y-53))})"><rect width="188" height="37" fill="var(--paper-light)" stroke="var(--ink)" stroke-width=".6"/><text x="8" y="14" fill="var(--ink)" font-size="11">${E(prettyLabel(n.label)+' · '+statusNames[n.status])}</text><text x="8" y="29" fill="var(--red)" font-size="10">${E(reasonText(n).slice(0,19))}</text></g>`;
  }
 }
 for(const e of DATA.events.filter(e=>e.tick<=state.tick&&permitted.includes(e.owner))){const p=xy(e);marks+=`<g class="death-mark" data-death="${E(e.id)}" role="button" tabindex="0" aria-label="${E(stamp(e.tick)+' '+kindName(e.kind)+'阵亡，归因推断')}" transform="translate(${p.x} ${p.y})"><title>${E(stamp(e.tick)+' · '+kindName(e.kind)+' · '+(e.attribution?.assessment==='review'?'疑似异常（推断）':'损失'))}</title><circle r="${e.id===state.death?13:10}" fill="var(--paper-light)" stroke="var(--red)" stroke-width="1.7"/><path d="M-4 -4L4 4M4 -4L-4 4" fill="none" stroke="var(--red)" stroke-width="2"/>${e.attribution?.assessment==='review'?'<text x="11" y="-8" fill="var(--red)" font-size="9">推断</text>':''}</g>`;}
 $('#map-svg').innerHTML=background+shapes+routes+marks;
 $('#time').textContent=stamp(state.tick);$('#frame-note').textContent=`位置 ${stamp(f?.tick||start)} · tick ${state.tick.toLocaleString()}`;
 const death=DATA.events.find(e=>e.id===state.death),p=pick;
 $('#map-story').hidden=!permitted.length;
 $('#map-story').innerHTML=death?`<b>${death.type==='death'?'✕ '+E(kindName(death.kind))+'阵亡':'◆ 建筑损失'}</b>${stamp(death.tick)} · 最后执行器 ${E(death.attribution?.command?.scriptId||'—')} <span class="inferred">目标归因 / 异常分类 · 推断</span><small>点击阵亡标记，核对目标、订单和致命来源。</small>`:p?`<b>${E(shortNames[p.owner])} / ${E(prettyLabel(p.node.label))}</b>${E(reasonText(p.node))}<small>最近决策 ${stamp(p.trace.tick)}；实走轨迹不越过当前游标。</small>`:'';
 $('#loss-count').textContent=`可见阵亡 ${DATA.events.filter(e=>e.type==='death'&&e.tick<=state.tick&&permitted.includes(e.owner)).length} · 建筑损失 ${DATA.events.filter(e=>e.type==='building-loss'&&e.tick<=state.tick&&permitted.includes(e.owner)).length}`;
}
const outcomes={done:'✓',abandoned:'◇',failed:'✕',preempted:'↗',released:'/'};
function renderTimeline(){
 const permitted=allowed(),pick=state.death?null:selected(),percent=t=>(Math.max(start,Math.min(end,t))-start)/(end-start)*100;
 let html=`<div class="time-ruler">${Array.from({length:7},(_,i)=>`<span style="left:${i/6*100}%">${stamp(start+(end-start)*i/6)}</span>`).join('')}</div>`;
 for(const owner of permitted){
  const rows=[],ownerBands=bands.filter(b=>b.owner===owner&&(state.executors||!b.last.source.startsWith('unitClaims.')&&b.kind!=='task'));
  const sorted=[...ownerBands].sort((a,b)=>Math.max(start,a.observedStart)-Math.max(start,b.observedStart)||a.displayEnd-b.displayEnd);
  let bars='';const layout=new Map();
  for(const b of sorted){const left=percent(Math.max(start,b.observedStart)),past=b.terminalAlreadyObserved;
   const packingEnd=past?Math.max(start,b.observedStart)+230:b.displayEnd;
   let row=rows.findIndex(last=>last+22<=Math.max(start,b.observedStart));if(row<0){row=rows.length;rows.push(0);}rows[row]=packingEnd;
   layout.set(b.id,{row,left});
   const width=past?Math.min(13,100-left):Math.max(.4,percent(b.displayEnd)-left),n=nodeAt(owner,b.id,b)?.node;
   const label=prettyLabel(b.label),title=past?`${label}：首次观察前已记录${statusNames[b.last.status]}；结束时间见原始记录`:`${label} · ${stamp(b.start)} → ${b.end?stamp(b.end):'观察窗后继续'} · ${b.outcome==='released'?'模块释放，结果未知':b.outcome?outcomes[b.outcome]:'仍在执行'}`;
   bars+=`<button class="goal-band ${past?'past-result':''} ${n?.status==='blocked'?'blocked':''} ${pick?.band.key===b.key?'selected':''}" data-band="${E(b.key)}" style="--team:${team(owner)};left:${left}%;width:${width}%;top:${8+row*26}px" title="${E(title)}"><span class="band-copy">${past?'窗前记录 · ':b.start<start?'← ':''}${E(label)} ${!past&&n?.status==='blocked'?'· 受阻':''}</span>${b.outcome?`<span class="outcome">${outcomes[b.outcome]}</span>`:'<span class="continuation">→</span>'}</button>`;
  }
  const height=rows.length*26+15;
  const handoffs=DATA.events.filter(e=>e.type==='preemption'&&e.owner===owner&&layout.has(e.fromGoalId)&&layout.has(e.toGoalId));
  if(handoffs.length)bars+=`<svg class="preemption-arrows" viewBox="0 0 1000 ${height}" preserveAspectRatio="none">${handoffs.map(e=>{const x=percent(e.tick)*10,a=18+layout.get(e.fromGoalId).row*26,b=18+layout.get(e.toGoalId).row*26;return `<g><title>${E(e.reason+' · '+(e.unitIds?.length||0)+' 个单位 / 金币 '+number(e.gold))}</title><path d="M${x} ${a}C${x+18} ${a},${x+18} ${b},${x} ${b}" fill="none" stroke="var(--red)" stroke-width="1.3" marker-end="url(#arrow)"/><text x="${x+20}" y="${(a+b)/2}" font-size="9" fill="var(--red)">${E((e.unitIds?.length||0)+'兵 / '+number(e.gold)+'金')}</text></g>`;}).join('')}</svg>`;
  const events=DATA.events.filter(e=>e.owner===owner);
  bars+=`<div class="lane-events" style="top:${height-4}px">${events.map(e=>`<button class="loss-point ${e.attribution?.assessment==='review'?'review':''}" data-death="${E(e.id)}" style="left:${percent(e.tick)}%" title="${E(stamp(e.tick)+' · '+kindName(e.kind)+' · '+(e.type==='death'?'阵亡（归因推断）':'建筑损失'))}">${e.type==='death'?'✕':'◆'}</button>`).join('')}</div>`;
  html+=`<div class="ai-lane"><div class="lane-name" style="color:${team(owner)}"><strong>${shortNames[owner]}</strong><small>${DATA.players[owner].version}<br>${ownerBands.length} 段目标记录</small></div><div class="lane-track" data-track="${owner}" style="height:${height+22}px">${bars}<div class="cursor-line" style="left:${percent(state.tick)}%"></div></div></div>`;
 }
 $('#lanes').innerHTML=permitted.length?html:'<div class="empty-dossier">AI 计划已关闭，时间轴隐藏</div>';
 $('#scrub-time').textContent=stamp(state.tick);$('#time-scrubber').value=state.tick;
 $('#event-totals').textContent=`观察窗内：${DATA.events.filter(e=>e.type==='death'&&permitted.includes(e.owner)).length} 阵亡 / ${DATA.events.filter(e=>e.type==='building-loss'&&permitted.includes(e.owner)).length} 建筑损失`;
}
function render(){selected();policy();renderGoals();renderDetail();renderMap();renderTimeline();}
function seek(tick){state.tick=Math.max(start+15,Math.min(end,Math.round(tick)));if(state.death&&DATA.events.find(e=>e.id===state.death).tick>state.tick)state.death=null;render();}
function selectDeath(id){const e=DATA.events.find(e=>e.id===id&&allowed().includes(e.owner));if(!e)return;state.tick=Math.max(state.tick,e.tick);state.owner=e.owner;state.selected=null;state.death=id;state.unit=e.unitId||null;render();$('#detail').scrollTop=0;}
$('#view-mode').addEventListener('change',e=>{state.mode=e.target.value;state.selected=null;state.death=null;state.unit=null;render();});
$('#solo-visible').addEventListener('change',e=>{state.solo=e.target.checked;render();});
$('#show-executors').addEventListener('change',e=>{state.executors=e.target.checked;render();});
$('#time-scrubber').addEventListener('input',e=>seek(Number(e.target.value)));
$('#postmatch').addEventListener('click',e=>{e.preventDefault();state.mode='replay';$('#view-mode').value='replay';render();});
$('#jump-defense').addEventListener('click',()=>{state.owner='enemy';state.selected=null;state.death=null;seek(start+15);});
$('#jump-result').addEventListener('click',()=>{state.owner='player-4';state.selected=null;state.death=null;seek(end);});
$('#jump-death').addEventListener('click',()=>{const e=DATA.events.find(e=>e.type==='death'&&allowed().includes(e.owner));if(e){state.tick=e.tick;selectDeath(e.id);}});
let timer=null;
$('#play').addEventListener('click',()=>{state.playing=!state.playing;$('#play').textContent=state.playing?'Ⅱ 暂停':'▶ 播放';if(timer)clearInterval(timer);if(state.playing){if(state.tick>=end)seek(start+15);timer=setInterval(()=>{seek(state.tick+20);if(state.tick>=end){state.playing=false;clearInterval(timer);$('#play').textContent='▶ 播放';}},200);}});
document.addEventListener('click',e=>{
 const death=e.target.closest('[data-death]');if(death){selectDeath(death.dataset.death);return;}
 const band=e.target.closest('[data-band]');if(band){selectBand(band.dataset.band);return;}
 const owner=e.target.closest('button[data-owner]');if(owner&&!owner.disabled){state.owner=owner.dataset.owner;state.selected=null;state.death=null;state.unit=null;render();return;}
 const unit=e.target.closest('[data-unit]');if(unit){const scroll=$('#detail').scrollTop;state.unit=unit.dataset.unit;renderDetail();renderMap();$('#detail').scrollTop=scroll;return;}
 const flow=e.target.closest('[data-flow]');if(flow){const section=$('#flow-'+flow.dataset.flow);if(section)$('#detail').scrollTop=section.offsetTop-$('#detail').offsetTop;return;}
 if(e.target.closest('#back-plan')){state.death=null;render();}
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('g[data-band],g[data-death]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
let drag=null,raf=null,pendingTick=null;
document.addEventListener('pointerdown',e=>{const track=e.target.closest('[data-track]');if(!track||e.target.closest('button'))return;drag=track.getBoundingClientRect();e.preventDefault();seek(start+(e.clientX-drag.left)/drag.width*(end-start));});
document.addEventListener('pointermove',e=>{if(!drag)return;if(raf)cancelAnimationFrame(raf);pendingTick=start+(e.clientX-drag.left)/drag.width*(end-start);raf=requestAnimationFrame(()=>{seek(pendingTick);pendingTick=null;raf=null;});});
document.addEventListener('pointerup',()=>{drag=null;if(raf)cancelAnimationFrame(raf);raf=null;if(pendingTick!==null)seek(pendingTick);pendingTick=null;});
document.addEventListener('pointercancel',()=>{drag=null;if(raf)cancelAnimationFrame(raf);raf=null;pendingTick=null;});
render();
})();
