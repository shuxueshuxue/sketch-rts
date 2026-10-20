/* Offline second mockup. History is presentation output, never an input to a planner. */
(async () => {
'use strict';
await window.PLAN_TIMELINE_READY;
const DATA=window.PLAN_TIMELINE, M=window.PLAN_TIMELINE_MODEL;
const $=s=>document.querySelector(s);
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const owners=Object.keys(DATA.players),flagNames=['赤旗','青旗','金旗','翠旗','紫旗','朱旗','灰旗','靛旗'],palette=['#a94e3b','#3e7585','#8c7330','#467751','#79577d','#ac7446','#687674','#576a94'];
const shortNames=Object.fromEntries(owners.map((o,i)=>[o,flagNames[i]||o]));
const names=Object.fromEntries(owners.map(o=>[o,shortNames[o]+' · '+DATA.players[o].version]));
const team=o=>palette[owners.indexOf(o)%palette.length]||'var(--muted)';
const history=DATA.thinks.map(t=>({...t,nodes:t.nodes.map(i=>window.PLAN_TIMELINE_NODES[i])}));
const series=Object.fromEntries(owners.map(o=>[o,history.filter(t=>t.owner===o)]));
const bands=M.bands(history,DATA.provenance.endTick);
const start=DATA.provenance.startTick,end=DATA.provenance.endTick;
const state={tick:DATA.featuredTick??Math.floor((start+end)/2),owner:DATA.featuredOwner||DATA.ownOwner||owners.at(-1),selected:DATA.featuredBandKey||null,unit:null,death:null,mode:'spectator',solo:false,own:DATA.ownOwner||owners.at(-1),executors:false,playing:false,view:{from:start,to:end},tool:'range',eventList:false};
const nodeHistory=new Map(),changeHistory=new Map();
for(const trace of history){for(const node of trace.nodes){const key=trace.owner+'|'+node.id;if(!nodeHistory.has(key))nodeHistory.set(key,[]);nodeHistory.get(key).push({tick:trace.tick,node,trace});}for(const change of trace.changes){const key=trace.owner+'|'+change.nodeId;if(!changeHistory.has(key))changeHistory.set(key,[]);changeHistory.get(key).push({tick:trace.tick,...change});}}
const bandFor=(owner,id)=>bands.filter(b=>b.owner===owner&&(b.id===id||b.result?.nodeId===id)&&b.observedStart<=state.tick).at(-1);
const inView=e=>e.tick>=state.view.from&&e.tick<=state.view.to;
const duration=ticks=>{const seconds=Math.round(ticks*.05);return seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+(seconds%60?seconds%60+'秒':'');};
const stamp=tick=>{const sec=Math.floor(tick*.05);return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;};
const number=n=>n==null?'—':Math.floor(n).toLocaleString('zh-CN');
const icon=kind=>`<svg class="icon" aria-hidden="true"><use href="#i-${kind}"/></svg>`;
const unitNames={worker:'工人',footman:'步兵',archer:'弓手',horseArcher:'骑射手',ashChieftain:'灰烬酋长',sparkRifleman:'火花射手',knight:'骑士',priest:'牧师',transport:'运输船',carrier:'运兵船',shipOfTheLine:'战列舰',townHall:'城镇大厅',shipyard:'船坞',summoner:'召唤师',witch:'女巫'};
const kindName=k=>DATA.kindLabels?.[k]||unitNames[k]||k;
const prettyLabel = label => label.startsWith('渡运 · ')?({settle:'渡运 · 工程队',assault:'渡运 · 突袭',advance:'渡运 · 前出登陆',reinforce:'渡运 · 增援',creep:'渡运 · 清营',rebase:'渡运 · 转移驻地',evacuate:'渡运 · 撤离'}[label.slice(5)]||label):label;
const statusNames = { active:'进行中', blocked:'受阻', done:'完成', abandoned:'放弃' };
const kindIcons = { island:'island', expansion:'flag', defense:'shield', attack:'swords', pressure:'advance', transport:'anchor', delivery:'anchor', task:'flag' };
const reasons = {
 'home-threat':'本土遇袭，扩张暂缓', 'mining-threat':'矿区遇袭，等待解除威胁', 'mine-threat':'目标矿区仍有威胁',
 'await-engineer-transport':'已清空滩头，等待工程队渡海', 'saving-hall-capital':'工程队已到，等待建城资金',
 'await-hall-order':'等待工程队下达建城指令', 'building-hall':'分矿正在施工', 'await-garrison':'等待驻防部队到位',
 'garrison-established':'分矿与驻军已交接', 'home-raid-reserve':'守岸兵力被保留，暂不装船', 'no-combat-crew':'缺少可用战斗船员',
 'approaching-with-boarders':'运输船接近装载点，已有乘员', 'landing-defense':'保留登陆防御部队', 'stalled:loading':'装载停滞', 'approaching-load':'运输船正接近装载点', 'retry-delay':'等待重试窗口', 'await-combat-boarding':'等待战斗部队上船',
 'reinforcing-beachhead':'增援现有滩头部队', 'engineers-dispatched':'工程队运输已派出', 'clearing-camp':'清除岛上营地',
 'await-clearing-force':'等待足够的清营兵力', 'landing-established':'已建立实际登陆点', 'landing-party-lost':'登陆部队已损失',
 'mine-exhausted':'矿藏已经耗尽', 'mine-occupied':'目标矿区已被占领', 'ally-mine-claim':'盟友已经认领此矿',
 'await-delivery':'等待首次实际卸载战斗部队', delivered:'已完成实际登陆', withdrew:'上一轮进攻已撤回',
 'army-lost':'上一轮进攻部队已损失', destroyed:'目标已拆除', reached:'已抵达前压据点', advancing:'正在向据点前压',
 'en-route':'部队正在执行任务', arrived:'部队已经到位', returning:'部队正在回位', 'phase:fight':'正在保卫受袭矿区',
 'phase:gather':'集结防守部队', 'phase:loading':'装载部队，准备启航', 'phase:sailing':'正在航渡', 'phase:return':'返航整补',
 'stage:escort':'护送工程队前往矿区', 'stage:assemble':'集结扩张护卫', 'stage:clear':'清除目标矿区守军',
 'stage:attack':'进攻敌方据点', 'stage:fund':'筹措建城资金', 'stage:build':'分矿正在施工', 'stage:complete':'任务完成', 'stage:gather':'在营地外整队',
};

const reasonCaption=(code,detail)=>reasons[code]||reasons[code?.replace(/^(stalled|blocked):/,'')]||detail||'模块没有保留原因';
const reasonText=n=>{const r=n?.reasons[0];return r?reasonCaption(r.code,r.detail):'模块没有保留原因';};
const status=n=>`<span class="status ${n.status}">${statusNames[n.status]}</span>`;
const allowed=()=>M.allowed(state.mode,state.solo,state.own,owners);
const currentTrace=o=>M.at(series[o],state.tick);
const currentFrame=()=>M.at(DATA.frames,state.tick);
const nodeIn=(trace,id)=>trace?.nodes.find(n=>n.id===id);
const targetName=n=>n.target.entityId?.startsWith('gold-')?'金矿 '+n.target.entityId.match(/(\d+)$/)?.[1]:n.target.entityId?.includes('townHall')?'城镇据点':'记录的目标位置';
const asUnits=f=>(f?.units||[]).map(row=>({...DATA.unitCatalog[row[0]],x:row[1],y:row[2],hp:row[3],shipId:row.length>4?DATA.unitCatalog[row[4]]?.id:null}));
function nodeAt(owner,id,band){const until=band?.outcome==='released'?Math.min(state.tick,band.end-1):state.tick,row=M.at(nodeHistory.get(owner+'|'+id)||[],until);if(!row||band&&row.tick<band.observedStart)return null;return {...row,owner,historical:!nodeIn(currentTrace(owner),id)||(band?.outcome==='released'&&band.end<=state.tick)};}
function selected(){
 if(!allowed().includes(state.owner))state.owner=allowed()[0]||state.own;
 if(state.selected){const band=bands.find(b=>b.key===state.selected);if(band&&allowed().includes(band.owner)){const found=nodeAt(band.owner,band.id,band);if(found){const result=band.result&&band.end<=state.tick?band.result:null;return {...found,band,node:result?{...found.node,status:band.outcome==='done'?'done':'abandoned',reasons:result.reasons}:found.node};}}}
 const trace=currentTrace(state.owner);if(!trace)return null;
 const roots=trace.roots.map(id=>nodeIn(trace,id)).filter(Boolean),node=roots.find(n=>n.kind==='island')||roots.find(n=>n.status==='blocked')||roots[0];
 const band=node?bandFor(state.owner,node.id):null;
 if(!node||!band)return null;state.selected=band.key;return {owner:state.owner,trace,node,band,historical:false};
}
function selectBand(key,seek=false){const band=bands.find(b=>b.key===key);if(!band||!allowed().includes(band.owner))return;
 state.owner=band.owner;state.selected=key;state.unit=null;state.death=null;
 if(seek||state.tick<band.observedStart)state.tick=Math.max(start,Math.min(end,band.observedStart));
 render();$('#detail').scrollTop=0;
}
function policy(){
 const p=allowed();
 $('#solo-control').hidden=state.mode!=='solo';
 $('#highlights').innerHTML=(DATA.highlights||[]).filter(h=>!h.owner||p.includes(h.owner)).map((h,i)=>`<button data-highlight="${E(h.id)}">${stamp(h.tick)} · ${E(h.label)}</button>`).join('');$('#postmatch').hidden=state.mode!=='online';
 $('#permission-note').textContent=state.mode==='online'?'联机对局只看自己；对手计划在赛后回放中查看。':state.mode==='solo'?(state.solo?'单机 · 计划显示已开启。':'单机 · 默认关闭 AI 计划，可自行开启。'):'观战 / 回放 · 所有席位可见。';
 $('#ai-tabs').innerHTML=owners.map(o=>`<button data-owner="${o}" style="--team:${team(o)}" ${p.includes(o)?'':'disabled'} class="${o===state.owner?'active':''}">${shortNames[o]}</button>`).join('');
 $('#map-lock').hidden=p.length>0;$('#map-lock').textContent='AI 计划已关闭';
 if(state.death&&!p.includes(DATA.events.find(e=>e.id===state.death)?.owner))state.death=null;
 $('.flow-nav').hidden=!!state.death;$('#goal-list').hidden=!!state.death;
}
function renderGoals(){
 const trace=allowed().includes(state.owner)?currentTrace(state.owner):null,pick=state.death?null:selected();
 $('#goal-list').innerHTML=trace?trace.roots.map(id=>nodeIn(trace,id)).filter(Boolean).map(n=>{
  const band=bandFor(state.owner,n.id);
  return `<button data-band="${E(band?.key)}" class="${pick?.node.id===n.id?'selected':''}" style="--team:${team(state.owner)}"><strong>${E(prettyLabel(n.label))}</strong><small>效用 ${number(n.utility.score)} ${status(n)}</small></button>`;
 }).join(''):'<div class="empty-dossier">没有公开的计划</div>';
}
function branch(trace,n,depth=0){return `<details class="tree" ${depth<1?'open':''}><summary>${icon(kindIcons[n.kind])}${E(prettyLabel(n.label))}${status(n)}</summary><div class="tree-body">${E(reasonText(n))}${n.requirements.map(r=>`<p>${r.met===true?'✓':r.met===false?'○':'?'} ${E(reasons[r.code]||r.detail)}</p>`).join('')}</div>${n.children.map(id=>nodeIn(trace,id)).filter(Boolean).map(c=>branch(trace,c,depth+1)).join('')}</details>`;}
function goalEvents(pick){return (changeHistory.get(pick.owner+'|'+pick.node.id)||[]).filter(c=>c.tick<=state.tick&&c.kind!=='allocation'&&c.kind!=='utility');}
function actualOutcome(pick){
 if(pick.band.result&&pick.band.end<=state.tick){const r=pick.band.result.reasons[0];return (reasons[r?.code]||r?.detail||'结果未详述')+' · 模块结果记录';}
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
 <section class="flow-section" id="flow-result"><h4><i>05</i> 结果与代价</h4><p>${E(actualOutcome(p))}</p><p>归因至此目标的阵亡 <b>${deaths.length}</b> <span class="ledger-badge">死亡账本</span></p>${deaths.map(deathButton).join('')}${DATA.events.filter(e=>e.type==='death'&&e.owner===owner&&e.tick<=state.tick&&!e.attribution.rootIds.length).map(e=>'<p class="micro">这一席另有未归属的阵亡：</p>'+deathButton(e)).join('')}<p class="micro">0 不等于无损：没有归属的死亡不会强行分摊给一个目标。任务归属保留账本的来源和不确定性。</p></section>
 <details class="tree"><summary>查看原始依据</summary><div class="tree-body">${E(n.source)}<br>${E(n.id)}<br>目标 ${E(n.target.entityId||'坐标')}<br>观察 tick ${trace.tick}</div></details>`;
}
const deathCategories={'combat-loss':'交战战损','retreat-failed':'撤退失败','accepted-engagement':'交战战损','logistics-transit':'后勤途中','idle':'闲置阵亡','retreat-or-treatment':'撤退 / 治疗途中','isolated-without-evacuation-plan':'孤立且无撤离任务','recent-reassignment':'刚刚切换任务','out-of-bounds':'超出任务范围','neutral-outside-clearing':'非清营时死于野怪','post-worn-abandonment':'撤回后仍留在交战区','outmatched':'局部兵力劣势','exposed-worker':'工人暴露','friendly-source':'友方伤害','unattributed':'归属未知'};
const engagementEvidence={'native-fatal-hit-force-ids':'致命命中时的原生兵力名单','unit-identities-and-team-relations':'单位身份与队伍关系','bounded-damage-window-includes-fatal-hit':'有限伤害窗口，包含致命命中','outgoing-damage-not-recorded-in-v1':'原始 v1 未采集主动伤害，保持未知','outgoing-damage-observed':'已观察到主动伤害','neutral-opponent-requires-clearing-task':'野怪仅在已记录清营任务中算交战对手','damage-exchange-must-involve-an-opponent':'伤害交换必须涉及账本认定的交战对手','live-killer-position-includes-cross-ground-threats':'原生活着击杀者位置可补充隔岸威胁','sinking-inherits-hull-engagement':'沉船乘员继承船体交战证据'};
const assignmentStates={'unassigned':'未分配','assigned':'已分配','en-route':'在路上','on-station':'已到岗','emergency-interruption':'救命动作中断'};
const taskLabels={'expansion':'扩张','island':'夺岛','attack':'进攻','defense':'回防','guard':'驻防','clear-camp':'清理营地','creep':'清理营地','raid':'袭扰','transport':'渡运','errand':'跑腿任务','naval-combat':'海战','mining':'采矿','construction':'施工','aboard':'随船行动','hold':'驻守'};
const orderName=o=>({move:'移动',attack:'攻击',attackMove:'攻击前进',idle:'空闲',board:'登船',mine:'采矿',build:'建造',holdPosition:'保持位置',repair:'维修',follow:'跟随'})[o?.type]||o?.type||'—';
function deathButton(e){const style=M.deathClass(e.attribution.disposition);return `<button class="loss-card" data-death="${E(e.id)}"><span class="death-tone ${style.id}">${style.glyph} ${stamp(e.tick)} · ${E(kindName(e.kind))}</span>　<span class="ledger-badge ${style.id}">${style.label} · 账本 v${e.ledger.classification.diagnosticVersion}</span></button>`;}
function renderBuildingLoss(e){$('#detail').innerHTML=`<button class="back-plan" id="back-plan">← 回到目标手记</button><p class="micro">建筑损失 / ${E(names[e.owner]||e.owner)}</p><h3 class="death-head">◆ ${E(kindName(e.kind))}被摧毁</h3><dl class="fact-table"><dt>时间</dt><dd>${stamp(e.tick)} / tick ${e.tick}</dd><dt>位置</dt><dd>(${number(e.x)}, ${number(e.y)})</dd><dt>致命来源</dt><dd>${e.killer?E(kindName(e.killer.kind)):'— 未记录'}</dd><dt>服务目标</dt><dd>— 待接入</dd></dl><p class="micro">基线脚本逐 tick 观察到建筑 HP ≤ 0 并被原生移除；不是根据 think 快照中消失推断。未知击杀者和目标归属保持为空。</p>`;}
function renderDeath(e){
 const r=e.ledger,a=r.assignment,c=r.classification,issuer=r.currentOrderIssuer,last=r.lastIssuedOrder,task=a.task;
 const style=M.deathClass(c.disposition),goalNames=e.attribution.rootIds.map(id=>nodeAt(e.owner,id)?.node.label||id);
 const health=r.health.filter(h=>h.tick<=e.tick),min=health[0]?.tick??e.tick,max=Math.max(min+1,e.tick),maxHp=Math.max(1,...health.map(h=>h.maxHp));
 const line=health.map((h,i)=>`${i?'L':'M'}${(h.tick-min)/(max-min)*300} ${48-Math.max(0,h.hp)/maxHp*44}`).join(' ');
 const sources=r.damageWindow.sources,damageTotal=sources.reduce((n,s)=>n+s.damage,0);
 const engagement=c.engagement;
 const engagementFacts=engagement?`<section class="flow-section"><h4>交战判定与证据</h4><dl class="fact-table"><dt>判定</dt><dd>${E(({engaged:'交战中','outside-combat':'交战外',unknown:'证据不足'})[engagement.status]||engagement.status)}<br><span class="stage-mini">${E(engagement.provenance==='reclassified-native-records'?'原生记录离线重分类':'原生实时事件')}</span></dd><dt>观测窗</dt><dd>${stamp(engagement.window.fromTick)}—${stamp(engagement.window.toTick)} / 半径 ${engagement.radius}</dd><dt>对手伤害 / 输出</dt><dd>${number(engagement.receivedDamage)} / ${number(engagement.dealtDamage)}<br><span class="stage-mini">此处仅统计交战对手伤害，并非总受伤；主动伤害 — 表示未采集，不是 0。</span></dd><dt>交战对象</dt><dd>${engagement.opponentIds.length} 个已识别 / ${engagement.unresolvedNearbyIds.length} 个身份待确认</dd><dt>承载归属</dt><dd>${E(engagement.inheritedFromCarrier||'— 无继承')}</dd></dl>${engagement.evidence.map(item=>'<p title="'+E(item)+'">'+E(engagementEvidence[item]||item)+'</p>').join('')}</section>`:'<p class="micro">— 原记录未提供交战判定</p>';

 $('#detail').innerHTML=`<button class="back-plan" id="back-plan">← 回到目标手记</button><p class="micro">死亡账本 / ${E(names[e.owner])} / ${E(r.id)}</p><h3 class="death-tone ${style.id}">${style.glyph} ${E(kindName(e.kind))}阵亡</h3><div class="reason-callout"><span class="ledger-badge ${c.disposition}">${style.label} · 账本 v${c.diagnosticVersion}</span> <small>主分类</small> ${E(deathCategories[c.primary]||c.primary)}</div><div class="diagnostic-tags"><small>子标签</small>${c.tags.map(tag=>'<span title="'+E(tag)+'">'+E(deathCategories[tag]||tag)+'</span>').join('')||'<span>— 无记录</span>'}</div><p>${E(c.explanations[0]||'')}</p>
 <dl class="fact-table"><dt>时间 / 位置</dt><dd>${stamp(e.tick)} · (${number(e.x)}, ${number(e.y)})<br><span class="stage-mini">死亡 tick ${e.tick} / 移除 tick ${r.removedTick}</span></dd><dt>致命来源</dt><dd>${e.killer?E(kindName(e.killer.kind)+' · '+(shortNames[e.killer.owner]||e.killer.owner)):'— 账本未记录直接击杀者'}<br><span class="stage-mini">${E(({damage:'伤害致死',sinking:'沉船连带',unknown:'原因未确认'})[r.cause]||r.cause)} / ${E(({'observed-live-entity':'世界中的直接来源','previously-observed-entity':'来源已离场，保留历史记录','unresolved-source':'来源身份未解析'})[r.killerKindAttribution]||'来源未知')}</span></dd><dt>服务目标</dt><dd>${E(goalNames.join(' / ')||taskLabels[task?.kind]||task?.kind||'未找到任务归属')} ${task?'<span class="inferred">任务归因 · '+E(task.attribution==='inferred'?'推断（账本）':task.attribution)+'</span>':''}<br><span class="stage-mini">${E(task?.id||'正式目标 ID 尚无记录')}</span></dd><dt>执行步骤</dt><dd>${E(task?.stage?task.stage.split(/[:/]/).map(p=>M.phaseLabels[p]||p).join(' · '):'—')}<br><span class="stage-mini">${E(task?.source||'无任务来源')}</span></dd><dt>到岗状态</dt><dd>${E(assignmentStates[a.state]||a.state)} <span class="inferred">${E(a.stateAttribution==='inferred'?'账本推断':a.stateAttribution)}</span></dd><dt>当前订单</dt><dd>${E(orderName(r.currentOrder))}${r.currentOrder.avoidCombat?' · 避战':''}<br><span class="stage-mini">${E(({'matches-last-issued':'与最近一次实际指令匹配','matches-earlier-issued':'来自较早的实际指令','derived-or-unrecorded':'自动或未记录的订单转换'})[r.currentOrderSource]||r.currentOrderSource)}</span></dd><dt>订单执行器</dt><dd>${E(issuer?.executor||'— 未记录')}<br><span class="stage-mini">${issuer?stamp(issuer.tick)+' / '+E(orderName(issuer.command)):'自动接敌或队列转换不借用上一条执行器'}</span></dd><dt>最后下令</dt><dd>${E(last?.executor||'—')}<br><span class="stage-mini">${last?stamp(last.tick)+' / '+E(orderName(last.command)):'—'}</span></dd><dt>单位造价</dt><dd>${number(r.catalogGold)} 金币<br><span class="stage-mini">账本目录造价；不是本次实际支出</span></dd></dl>
 <section class="flow-section"><h4>账本为什么这样分类</h4>${c.explanations.map(x=>'<p>'+E(x)+'</p>').join('')}<p class="micro">直接展示账本诊断，不在界面重新分类。分类与任务归因保留账本的 ${E(c.attribution==='inferred'?'推断':c.attribution)} 标记；尚无正式分配器的战损接受范围。</p></section>
 ${engagementFacts}
 <section class="flow-section"><h4>死前处境</h4><dl class="fact-table"><dt>局部兵力</dt><dd>己方 ${r.context.balance.own.toFixed(2)} / 敌方 ${r.context.balance.hostile.toFixed(2)}<br><span class="stage-mini">${r.context.balance.ratio===null?'比例 —':'比例 '+r.context.balance.ratio.toFixed(2)} / 半径 ${r.context.balance.radius} / 有效战力估算</span></dd><dt>位置</dt><dd>${E(({land:'陆地',sea:'海面',deck:'甲板',cabin:'船舱',garrison:'驻军'})[r.location.space]||r.location.space)} / ${E(r.location.landId||r.location.seaId||'连通块未知')}</dd><dt>撤退 / 治疗</dt><dd>${r.context.retreating?'撤退中':'无撤退标记'} / ${r.context.treatment?'治疗相关':'无治疗标记'}</dd><dt>范围</dt><dd>${r.context.outsidePerimeter===null?'任务边界未知':r.context.outsidePerimeter?'已越过任务边界':'任务边界内'}</dd></dl></section>
 <section class="flow-section"><h4>血量与伤害来源</h4><svg class="health-line" viewBox="0 0 300 54" role="img" aria-label="账本记录的死前血量轨迹"><path d="M0 48H300" fill="none" stroke="var(--line)"/><path d="${line}" fill="none" stroke="${style.color}" stroke-width="1.8"/></svg><p class="micro">${stamp(min)}—${stamp(e.tick)}；由 think / 伤害 / 移除采样，不插造中间血量。</p>${sources.map(source=>`<p>${E(kindName(source.source.kind))} · ${E(shortNames[source.source.owner]||source.source.owner)} <small>· ${E(source.source.id)}</small>　${number(source.damage)} / ${damageTotal?(source.damage/damageTotal*100).toFixed(0):0}% · ${source.hits} 击</p>`).join('')||'<p class="micro">没有伤害窗口记录</p>'}</section>
 <details class="tree"><summary>候选任务与账本原始证据</summary><div class="tree-body">${a.otherTaskCandidates.map(t=>'<p>'+E(t.kind)+' / '+E(t.id)+' / '+E(t.source)+'</p>').join('')}${a.evidence.map(x=>'<p>'+E(x)+'</p>').join('')}${r.limitations.map(x=>'<p>'+E(x)+'</p>').join('')}<p>近期切换 ${r.context.switches.length} 次，未冒充正式抢占交接。</p></div></details>`;
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
  if(focusLoss?.type==='death')points.push(xy(focusLoss));
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
 for(const e of DATA.events.filter(e=>e.tick<=state.tick&&permitted.includes(e.owner)&&(e.id===state.death||e.tick>=Math.max(state.view.from,state.tick-1200)))){
  const p=xy(e),style=M.deathClass(e.attribution?.disposition),r=e.id===state.death?13:8,building=e.type==='building-loss',color=building?'var(--red)':style.color;
  const outline=style.id==='suspicious'?`<path d="M0 -${r}L${r} 0 0 ${r} -${r} 0Z" fill="var(--paper-light)" stroke="${color}" stroke-width="1.7"/>`:`<circle r="${r}" fill="${style.id==='abnormal'&&!building?color:'var(--paper-light)'}" stroke="${color}" stroke-width="1.7"/>`;
  const symbol=building?'<path d="M0 -5L5 0 0 5 -5 0Z" fill="none" stroke="var(--red)" stroke-width="2"/>':`<text y="4" text-anchor="middle" fill="${style.id==='abnormal'?'var(--paper-light)':color}" font-size="12" font-weight="700">${style.glyph}</text>`;
  marks+=`<g class="death-mark ${building?'building-loss':style.id}" data-death="${E(e.id)}" role="button" tabindex="0" aria-label="${E(stamp(e.tick)+' '+kindName(e.kind)+(building?'建筑损失':'阵亡 · '+style.label+'（账本 v'+e.ledger.classification.diagnosticVersion+'）'))}" transform="translate(${p.x} ${p.y})"><title>${E(stamp(e.tick)+' · '+kindName(e.kind)+' · '+(building?'建筑损失':style.label+'（账本）'))}</title>${outline}${symbol}${!building&&['suspicious','abnormal','unattributed'].includes(style.id)?'<text x="12" y="-9" fill="'+color+'" font-size="9">'+style.label+'</text>':''}</g>`;
 }

 $('#map-svg').innerHTML=background+shapes+routes+marks;
 $('#time').textContent=stamp(state.tick);$('#frame-note').textContent=`位置 ${stamp(f?.tick||start)} · tick ${state.tick.toLocaleString()}`;
 const death=DATA.events.find(e=>e.id===state.death),p=pick;
 $('#map-story').hidden=!permitted.length;
 $('#map-story').innerHTML=death?`<b>${death.type==='death'?'✕ '+E(kindName(death.kind))+'阵亡':'◆ 建筑损失'}</b>${stamp(death.tick)} · 最后执行器 ${E(death.ledger?.currentOrderIssuer?.executor||'—')} <span class="ledger-badge ${death.attribution?.disposition||''}">${death.type==='death'?M.deathClass(death.attribution.disposition).label+' · 账本 v'+death.ledger.classification.diagnosticVersion:'逐 tick 观察'}</span><small>点击阵亡标记，核对目标、订单和致命来源。</small>`:p?`<b>${E(shortNames[p.owner])} / ${E(prettyLabel(p.node.label))}</b>${E(reasonText(p.node))}<small>最近决策 ${stamp(p.trace.tick)}；实走轨迹不越过当前游标。</small>`:'';
 $('#loss-count').textContent=`可见阵亡 ${DATA.events.filter(e=>e.type==='death'&&e.tick<=state.tick&&permitted.includes(e.owner)).length} · 建筑损失 ${DATA.events.filter(e=>e.type==='building-loss'&&e.tick<=state.tick&&permitted.includes(e.owner)).length}`;
}
const outcomes={done:'✓',abandoned:'◇',failed:'✕',preempted:'↗',released:'/'};
function renderTimeline(){
 const permitted=allowed(),pick=state.death?null:selected(),view=state.view,span=view.to-view.from,percent=t=>(Math.max(view.from,Math.min(view.to,t))-view.from)/span*100;
 const trackWidth=Math.max(1,$('#lanes').getBoundingClientRect().width-112);
 const rowHeight=35,depths={fund:10,assemble:18,gather:18,clear:32,fight:45,escort:24,loading:23,sailing:34,build:43,complete:16,return:14};
 let html=`<div class="time-ruler">${Array.from({length:7},(_,i)=>`<span style="left:${i/6*100}%">${stamp(view.from+span*i/6)}</span>`).join('')}</div>`;
 for(const owner of permitted){
  const rows=[],ownerBands=bands.filter(b=>b.owner===owner&&b.observedStart<=view.to&&b.displayEnd>=view.from&&(state.executors||!b.last.source.startsWith('unitClaims.')&&b.kind!=='task'));
  const sorted=[...ownerBands].sort((a,b)=>a.observedStart-b.observedStart||a.displayEnd-b.displayEnd);let bars='';const layout=new Map();
  for(const b of sorted){const visibleStart=Math.max(view.from,b.observedStart),visibleEnd=Math.min(view.to,b.displayEnd),left=percent(visibleStart),past=b.terminalAlreadyObserved;
   const packingStart=Math.max(view.from,b.observedStart),packingEnd=past?packingStart+span*.07:b.displayEnd;
   let row=rows.findIndex(last=>last+span*.006<=packingStart);if(row<0){row=rows.length;rows.push(0);}rows[row]=packingEnd;layout.set(b.id,{row,left});
   const width=past?Math.min(8,100-left):Math.max(.15,percent(visibleEnd)-left),n=nodeAt(owner,b.id,b)?.node;
   const label=prettyLabel(b.label),title=(past?'仅观察到结果，未观察到起点；':'')+`${label} · ${stamp(b.start)} → ${b.end?stamp(b.end):'仍在执行'} · ${b.outcome==='released'?'记录释放，结果未知':b.outcome?outcomes[b.outcome]:'未结束'}`;
   const phaseSegments=b.segments.filter(s=>s.tick<visibleEnd&&s.end>visibleStart).map(segment=>{
    const x=(Math.max(segment.tick,visibleStart)-visibleStart)/(visibleEnd-visibleStart)*100,w=(Math.min(segment.end,visibleEnd)-Math.max(segment.tick,visibleStart))/(visibleEnd-visibleStart)*100;
    const why=reasonCaption(segment.reasonCode,segment.reasonDetail),text=segment.stageLabel+(segment.status==='blocked'?' · '+why:'')+' '+duration(segment.end-segment.tick);
    return `<span class="band-phase ${segment.status==='blocked'?'blocked':''}" data-phase-tick="${Math.max(segment.tick,visibleStart)}" style="left:${x}%;width:${w}%;--depth:${depths[segment.stage.split('/')[0]]||18}%"><span class="phase-label">${E(text)}</span>${segment.tick>view.from?'<i class="phase-reason"></i>':''}<span class="phase-tooltip">${stamp(segment.tick)}—${stamp(segment.end)} / ${duration(segment.end-segment.tick)}<br><b>${E(segment.stageLabel)}</b> · ${E(why)}</span></span>`;
   }).join('');
   bars+=`<button class="goal-band ${past?'past-result':''} ${pick?.band.key===b.key?'selected':''}" data-band="${E(b.key)}" style="--team:${team(owner)};left:${left}%;width:${width}%;top:${8+row*rowHeight}px" title="${E(title)}"><span class="phase-strip">${phaseSegments}</span><span class="band-copy">${past?'结果记录 · ':b.observedStart<view.from?'← ':''}${E(label)}</span>${b.end!==null&&b.end<=view.to?`<span class="outcome">${outcomes[b.outcome]}</span>`:'<span class="continuation">→</span>'}</button>`;
  }
  const height=rows.length*rowHeight+12;
  const handoffs=(DATA.preemptions||[]).filter(e=>e.owner===owner&&inView(e)&&layout.has(e.fromGoalId)&&layout.has(e.toGoalId));
  if(handoffs.length)bars+=`<svg class="preemption-arrows" viewBox="0 0 1000 ${height}" preserveAspectRatio="none">${handoffs.map(e=>{const x=percent(e.tick)*10,a=22+layout.get(e.fromGoalId).row*rowHeight,b=22+layout.get(e.toGoalId).row*rowHeight;return `<g><title>${E(e.reason)}</title><path d="M${x} ${a}C${x+15} ${a},${x+15} ${b},${x} ${b}" fill="none" stroke="var(--red)" marker-end="url(#arrow)"/><text x="${x+18}" y="${(a+b)/2}" font-size="9">${E((e.unitIds?.length||0)+'兵 / '+number(e.gold)+'金')}</text></g>`;}).join('')}</svg>`;
  const events=DATA.events.filter(e=>e.owner===owner&&inView(e)),losses=M.lossRows(events,span,trackWidth),eventHeight=losses.rows*17+4;
  bars+=`<div class="lane-events" style="top:${height}px;height:${eventHeight}px">${losses.placements.map(({event:e,row})=>`<button class="loss-point ${e.attribution?.disposition||''}" data-death="${E(e.id)}" style="left:${percent(e.tick)}%;top:${row*17+2}px;bottom:auto" title="${E(stamp(e.tick)+' · '+kindName(e.kind)+' · '+(e.type==='death'?M.deathClass(e.attribution.disposition).label+'（账本）':'建筑损失'))}">${e.type==='death'?M.deathClass(e.attribution.disposition).glyph:'◆'}</button>`).join('')}</div>`;
  html+=`<div class="ai-lane"><div class="lane-name" style="color:${team(owner)}"><strong>${shortNames[owner]}</strong><small>${DATA.players[owner].version}<br>${DATA.players[owner].recordedPlans===false?'此席计划未记录':ownerBands.length+' 段目标记录'}</small></div><div class="lane-track" data-track="${owner}" style="height:${height+eventHeight}px">${bars}${state.tick>=view.from&&state.tick<=view.to?`<div class="cursor-line" style="left:${percent(state.tick)}%"></div>`:''}</div></div>`;
 }
 $('#lanes').innerHTML=permitted.length?html:'<div class="empty-dossier">AI 计划已关闭，时间轴隐藏</div>';
 $('#scrub-time').textContent=stamp(state.tick);$('#time-scrubber').min=view.from;$('#time-scrubber').max=view.to;$('#time-scrubber').value=state.tick;$('#scrub-end').textContent=stamp(view.to);
 $('#window-label').textContent=stamp(view.from)+' — '+stamp(view.to)+' / '+(span/(end-start)*100).toFixed(0)+'%';
 const losses=DATA.events.filter(e=>permitted.includes(e.owner)&&inView(e)),counts=M.deathCounts(losses);
 const selectedPhase=pick?M.at(pick.band.segments,state.tick):null;
 $('#phase-summary').textContent=selectedPhase?prettyLabel(pick.band.label)+' / '+selectedPhase.stageLabel+' / 已观察 '+duration(Math.max(0,Math.min(state.tick,selectedPhase.end)-selectedPhase.tick))+' / '+(reasonCaption(selectedPhase.reasonCode,selectedPhase.reasonDetail)):'明暗区分阶段；斜纹表示受阻。悬停阶段边界可查看开始、结束和记录原因。';
 $('#event-totals').textContent=`本窗：${losses.filter(e=>e.type==='death').length} 阵亡：${counts.normal} 正常 / ${counts.suspicious} 存疑 / ${counts.abnormal} 异常 / ${counts.unattributed} 未归因；${losses.filter(e=>e.type==='building-loss').length} 建筑损失`;
 const whole=t=>(t-start)/(end-start)*100;
 $('#overview-window').style.left=whole(view.from)+'%';$('#overview-window').style.width=(span/(end-start)*100)+'%';$('#overview-cursor').style.left=whole(state.tick)+'%';
 $('#overview-events').innerHTML=DATA.events.filter(e=>permitted.includes(e.owner)).map(e=>`<i class="overview-dot ${e.type} ${e.attribution?.disposition||''}" style="left:${whole(e.tick)}%"></i>`).join('');
 $('#loss-list-toggle').textContent=(state.eventList?'收起':'逐条查看')+'本窗事件（'+losses.length+'）';$('#loss-list-toggle').setAttribute('aria-expanded',state.eventList);$('#event-list').hidden=!state.eventList;
 $('#event-list').innerHTML=state.eventList?losses.map(e=>`<button data-death="${E(e.id)}"><time>${stamp(e.tick)}</time> ${E(shortNames[e.owner])} · ${E(kindName(e.kind))} <b class="death-tone ${M.deathClass(e.attribution?.disposition).id}">${e.type==='building-loss'?'◆ 建筑损失':M.deathClass(e.attribution.disposition).glyph+' '+M.deathClass(e.attribution.disposition).label}</b></button>`).join(''):'';
 $('#tool-range').classList.toggle('active',state.tool==='range');$('#tool-pan').classList.toggle('active',state.tool==='pan');$('#tool-range').setAttribute('aria-pressed',state.tool==='range');$('#tool-pan').setAttribute('aria-pressed',state.tool==='pan');
}
function render(){selected();policy();renderGoals();renderDetail();renderMap();renderTimeline();}
function seek(tick){state.tick=Math.max(start,Math.min(end,Math.round(tick)));if(state.death&&DATA.events.find(e=>e.id===state.death).tick>state.tick)state.death=null;render();}
function setView(view){state.view=view;state.tick=Math.max(view.from,Math.min(view.to,state.tick));render();}
function showTick(tick){if(tick<state.view.from||tick>state.view.to){const span=state.view.to-state.view.from;state.view=M.fitWindow(tick-span/2,tick+span/2,start,end);}seek(tick);}
function selectDeath(id){const e=DATA.events.find(e=>e.id===id&&allowed().includes(e.owner));if(!e)return;state.owner=e.owner;state.selected=null;state.death=id;state.unit=e.unitId||null;showTick(e.tick);$('#detail').scrollTop=0;}
$('#view-mode').addEventListener('change',e=>{state.mode=e.target.value;state.selected=null;state.death=null;state.unit=null;render();});
$('#solo-visible').addEventListener('change',e=>{state.solo=e.target.checked;render();});
$('#show-executors').addEventListener('change',e=>{state.executors=e.target.checked;render();});
$('#time-scrubber').addEventListener('input',e=>seek(Number(e.target.value)));
$('#postmatch').addEventListener('click',e=>{e.preventDefault();state.mode='replay';$('#view-mode').value='replay';render();});
$('#tool-range').addEventListener('click',()=>{state.tool='range';renderTimeline();});$('#tool-pan').addEventListener('click',()=>{state.tool='pan';renderTimeline();});
$('#zoom-in').addEventListener('click',()=>setView(M.zoomWindow(state.view,.5,state.tick,start,end)));
$('#zoom-out').addEventListener('click',()=>setView(M.zoomWindow(state.view,2,state.tick,start,end)));
$('#loss-list-toggle').addEventListener('click',()=>{state.eventList=!state.eventList;renderTimeline();});
$('#zoom-reset').addEventListener('click',()=>setView({from:start,to:end}));
$('#pan-left').addEventListener('click',()=>setView(M.panWindow(state.view,-(state.view.to-state.view.from)*.5,start,end)));
$('#pan-right').addEventListener('click',()=>setView(M.panWindow(state.view,(state.view.to-state.view.from)*.5,start,end)));
let resizeFrame=null;window.addEventListener('resize',()=>{if(resizeFrame)cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>renderTimeline());});
let timer=null;
$('#play').addEventListener('click',()=>{state.playing=!state.playing;$('#play').textContent=state.playing?'Ⅱ 暂停':'▶ 播放';if(timer)clearInterval(timer);if(state.playing){if(state.tick>=state.view.to)seek(state.view.from);timer=setInterval(()=>{seek(Math.min(state.view.to,state.tick+Math.max(20,Math.round((state.view.to-state.view.from)/100))));if(state.tick>=state.view.to){state.playing=false;clearInterval(timer);$('#play').textContent='▶ 播放';}},200);}});
document.addEventListener('click',e=>{
 const highlight=e.target.closest('[data-highlight]');if(highlight){const h=DATA.highlights.find(h=>h.id===highlight.dataset.highlight);if(h.range)state.view=M.fitWindow(h.range.from,h.range.to,start,end);if(h.eventId)selectDeath(h.eventId);else{state.owner=h.owner;state.selected=h.bandKey||null;state.death=null;showTick(h.tick);}return;}
 const death=e.target.closest('[data-death]');if(death){selectDeath(death.dataset.death);return;}
 const band=e.target.closest('[data-band]');if(band){const phase=e.target.closest('[data-phase-tick]');if(phase)state.tick=Math.max(start,Math.min(end,Number(phase.dataset.phaseTick)));selectBand(band.dataset.band);return;}
 const owner=e.target.closest('button[data-owner]');if(owner&&!owner.disabled){state.owner=owner.dataset.owner;state.selected=null;state.death=null;state.unit=null;render();return;}
 const unit=e.target.closest('[data-unit]');if(unit){const scroll=$('#detail').scrollTop;state.unit=unit.dataset.unit;renderDetail();renderMap();$('#detail').scrollTop=scroll;return;}
 const flow=e.target.closest('[data-flow]');if(flow){const section=$('#flow-'+flow.dataset.flow);if(section)$('#detail').scrollTop=section.offsetTop-$('#detail').offsetTop;return;}
 if(e.target.closest('#back-plan')){state.death=null;render();}
});
document.addEventListener('dblclick',e=>{const target=e.target.closest('[data-band]');if(!target)return;const b=bands.find(b=>b.key===target.dataset.band);if(b){const span=Math.max(200,b.displayEnd-b.observedStart);setView(M.fitWindow(b.observedStart-span*.05,b.displayEnd+span*.05,start,end));}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('g[data-band],g[data-death]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
let drag=null,raf=null,lastX=null;
function applyDrag(x,final=false){
 if(!drag)return;const {rect,view,mode,origin}=drag,whole=mode.startsWith('overview'),width=whole?end-start:view.to-view.from,tick=(whole?start:view.from)+(x-rect.left)/rect.width*width;
 if(mode==='range'){
  const lo=Math.min(origin,tick),hi=Math.max(origin,tick),selection=document.querySelector('.range-selection');
  if(selection){selection.style.left=(Math.max(view.from,lo)-view.from)/width*100+'%';selection.style.width=(Math.min(view.to,hi)-Math.max(view.from,lo))/width*100+'%';selection.innerHTML='<b>'+stamp(lo)+' — '+stamp(hi)+'</b>';}
  if(final){if(Math.abs(x-drag.startX)<5)seek(origin);else setView(M.fitWindow(lo,hi,start,end));}
 }else if(mode==='pan')setView(M.panWindow(view,-(x-drag.startX)/rect.width*width,start,end));
 else if(mode==='overview-from')setView(M.fitWindow(Math.min(tick,view.to-200),view.to,start,end));
 else if(mode==='overview-to')setView(M.fitWindow(view.from,Math.max(tick,view.from+200),start,end));
 else setView(M.panWindow(view,(x-drag.startX)/rect.width*width,start,end));
}
document.addEventListener('pointerdown',e=>{
 const overview=e.target.closest('#overview-track'),track=e.target.closest('[data-track]');if(!overview&&(!track||e.target.closest('button')))return;
 const rect=(overview||track).getBoundingClientRect(),view={...state.view},mode=overview?'overview-'+(e.target.dataset.edge||'pan'):state.tool;
 drag={rect,view,mode,origin:(overview?start:view.from)+(e.clientX-rect.left)/rect.width*(overview?end-start:view.to-view.from),startX:e.clientX};lastX=e.clientX;e.preventDefault();
 if(mode==='range'){const selection=document.createElement('div');selection.className='range-selection';track.append(selection);}
});
document.addEventListener('pointermove',e=>{if(!drag)return;lastX=e.clientX;if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{raf=null;applyDrag(lastX);});});
document.addEventListener('pointerup',()=>{if(!drag)return;if(raf)cancelAnimationFrame(raf);raf=null;applyDrag(lastX,true);drag=null;document.querySelectorAll('.range-selection').forEach(e=>e.remove());});
document.addEventListener('pointercancel',()=>{drag=null;if(raf)cancelAnimationFrame(raf);raf=null;document.querySelectorAll('.range-selection').forEach(e=>e.remove());});
$('#time-scrubber').min=start;$('#time-scrubber').max=end;$('#overview-start').textContent=stamp(start);$('#overview-end').textContent=stamp(end);
$('#atlas-name').textContent=DATA.map.label||DATA.map.name;$('#record-title').textContent=(DATA.map.label||DATA.map.name)+' · 战略手记';$('#record-range').textContent='真实对局 '+stamp(start)+'—'+stamp(end)+' / '+owners.length+' 席 AI';
render();
})().catch(error=>{document.querySelector('.war-room').innerHTML='<div class="loading-record">记录加载失败：'+String(error.message).replace(/[<>&]/g,'')+'</div>';console.error(error);});
