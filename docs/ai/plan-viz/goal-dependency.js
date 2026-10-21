/* Artificial layout data only. These objects are NOT the planner's input/output contract. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const html = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock = second => `${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`;
  const names = {met:'已成立',unmet:'未成立',pending:'等事实',active:'执行中',blocked:'等前置',done:'已观测',planned:'尚未申请资源'};
  const titles = ['条件尚未成立，计划从这里长出来','目标让位于回防，依赖从缺口处重推','营地已经清空，工人还在路上','不是命令已发出，而是矿厅已完工'];
  const moments = [{at:260,label:'04:20 反推计划'},{at:310,label:'05:10 抢占与重推'},{at:400,label:'06:40 核对进展'},{at:490,label:'08:10 效果成立'}];
  // The diagram explicitly distinguishes conditions, chosen actions, executors, and observed effects.
  const rows = [
    {id:'camp', title:'营地已清空', fact:'camp-cleared(东岛营地 E3)', action:'清理东岛营地', executor:'集结 / 运兵 / 清营',
      states:['unmet','unmet','met','met'], values:['存活成员 4 / 4','尚未交战 · 缺 2 名兵','存活成员 0 / 4','清空事实持续成立'],
      actionStates:['blocked','blocked','done','done'], notes:['先让岛上兵力达到 6','回防借走 2 兵，重算到岗','06:32 最后一名营员死亡','已完成，不再占用清营资源'],
      who:['6 名已分给集结 · 2 / 6 到岗','4 名保留 · 2 名暂借回防','6 / 6 已到岗 · 清营结束','资源已释放'],
      phase:['集结  →  运兵  →  清营','集结暂停 · 等替补 / 交还','清营 ✓ · 原生效果已观测','完成于 06:32'],
      proof:['尚无清营证明','目标仍有存活成员','E3 成员全部死亡','证据帧 06:32 · 示例 E3'],
      options:[{name:'调用并集结现有部队',chosen:true,price:'预计到岗 45 秒 · 新支出 0 金',reason:'已有可达部队；不挤占建厅预算。'},
        {name:'训练两名步兵再集结',chosen:false,price:'预计到岗 100 秒 · 新支出 200 金',reason:'更晚到达，且可用余额不足；保留为落选方案。'}]},
    {id:'worker',title:'工人在东岛到岗',fact:'worker-at(东岛)',action:'运送工人到东岛',executor:'运输执行器 / 工人',
      states:['unmet','unmet','unmet','met'],values:['东岛可用工人 0','滩头安全已确认，等运力','工人已卸载，尚未走到矿点','1 名工人已在矿点到岗'],
      actionStates:['planned','planned','active','done'],notes:['等待返航船与安全事实','船到岸也不等于工人到岗','卸载  →  步行到矿点','07:10 在目标陆块到岗'],
      who:['未分配 · 不占工人和船','未分配 · 船将在 05:28 空闲','工人 w-07 / 运输船 t-02','w-07 完成建造后开始采矿'],
      phase:['尚未就绪 · 不申请资源','等待 transport-in','已卸载 · 到岗 0 / 1','到岗 ✓ · 建造 ✓'],
      proof:['尚无到岗证明','排队等待不算到岗','船已卸载；矿点距离 180','07:10 工人位置属于目标陆块'],
      options:[{name:'等待现有运输船返航',chosen:true,price:'预计可用 38 秒后 · 新支出 0 金',reason:'已在同一海域；满足截止时间，保留建厅预算。'},
        {name:'新造一艘运输船',chosen:false,price:'预计可用 70 秒后 · 新支出 240 金',reason:'更慢且挤占预留，未被选中；不是执行失败。'}]},
    {id:'gold',title:'建厅所需金币可用',fact:'gold(400, 建造截止前)',action:'清近营取得赏金',executor:'本土清营执行器',
      states:['unmet','met','met','met'],values:['260 / 400 金 · 缺 140','440 金 · 其中 400 已预留','400 金仍预留给矿厅','07:10 已实付 400 金'],
      actionStates:['active','done','done','done'],notes:['赏金是清营的效果，不另造钱','05:05 原生赏金 +180 金','同一笔预留没有重复使用','原生地基确认支出'],
      who:['本土守军 c-01 / c-02 / c-03','近营清空，3 名守军已回位','已释放原清营分配','矿厅地基 b-11 · 支付记录 p-4'],
      phase:['交战中 · 与夺岛使用不同部队','清营 ✓ · 赏金到账 ✓','筹资完成 · 预留仍有效','支出与地基匹配 ✓'],
      proof:['尚未到账 · 余额不含预计赏金','原生余额 260 + 180 = 440','账本预留 400 · 可支配 40','地基 b-11 与实付记录匹配'],
      options:[{name:'清理本土近营',chosen:true,price:'预计 45 秒 · 赏金 +180 金',reason:'比等收入早 23 秒；已有可调用的本土守军。'},
        {name:'等待采矿收入补齐 140 金',chosen:false,price:'预计 68 秒 · 新支出 0 金',reason:'预计完成更晚；不是永远不可用，事实变化后可重新比较。'}]}
  ];
  const bands = [
    {label:'夺岛 · 建立矿厅',from:260,to:490,parts:[['集结',50,''],['让位回防',40,'dim'],['登陆 / 清营',50,''],['运工人',30,''],['建厅 ✓',60,'done']]},
    {label:'防守 · 本土矿区',from:310,to:350,parts:[['回防 ✓',40,'done']]},
    {label:'筹资 · 近营赏金',from:260,to:305,parts:[['清营 +180',45,'done']]}
  ];
  let second=260, selected='camp-action', zoom=1, current=0;
  const factBox = (state,title,detail,code='') => `<div class="fact-line ${state}"><strong>${state==='met'?'✓':state==='pending'?'◌':'◇'} ${html(title)} · ${names[state]}</strong>${html(detail)}${code?`<code>${html(code)}</code>`:''}</div>`;
  function detailForGoal(i) {
    const finished=i===3;
    return `<small class="detail-status">目标 / hall-complete · ${finished?'已证明':'效果未成立'}</small><h3>建立东岛矿厅</h3><p class="detail-lead">要得到可开采的矿点。不是把部队运上岛就算完成。</p>
      <h4>01　目标需要什么</h4>${rows.map(r=>factBox(r.states[i],r.title,r.values[i],r.fact)).join('')}
      <p class="unknown">三项全部成立，建矿厅动作才就绪；此前子目标可见，但不因此占资源。</p>
      <h4>02　最后一个动作</h4>${factBox(finished?'met':'unmet','建矿厅',finished?'工人、清营和预算均已满足；已完成。':'等待三项前置全部成立。','build-hall(东岛矿点)')}
      <h4>03　意图与结果</h4><div class="compare"><div>预计完工<strong>08:00</strong></div><div>实际完工<strong>${finished?'08:10':'—'}</strong></div></div>
      ${finished?'<div class="evidence">✓ 世界中观测到矿厅完工<code>示例 b-11 · complete = true</code>工人开始采矿；实际效果与目标事实对齐。</div>':'<p class="unknown">结果尚未发生，不从计划或已接受命令推断。</p>'}
      <h4>04　效用分解</h4><p class="unknown">收益 — · 成本 — · 成功概率 —<br>样稿不伪装成已接入的估值结果。</p>`;
  }
  function detailForRow(row,i,kind) {
    const status=row.states[i], pending=i===0&&row.id==='worker';
    return `<small class="detail-status">${html(row.fact)} / ${kind==='fact'?'事实':kind==='executor'?'执行记录':kind==='result'?'效果证据':'推导动作'}</small>
      <h3>${html(kind==='fact'?row.title:kind==='executor'?row.executor:kind==='result'?'核对这一步的结果':row.action)}</h3>
      <p class="detail-lead">${html(row.notes[i])}</p><h4>01　它为了让什么成立</h4>${factBox(status,row.title,row.values[i],row.fact)}
      <h4>02　从缺失条件继续反推</h4>${row.id==='camp'?`
        <div class="dependency-mini"><p><b>清营</b> 需要 force-at(东岛, 6)</p><div class="dependency-mini"><p>◇ 东岛兵力不足 → 推出 <b>运兵</b></p><div class="dependency-mini"><p>运兵需要集结点兵力、运力、滩头安全</p><p>◇ 集结点兵力不足 → 推出 <b>集结现有部队</b></p></div></div></div>
        ${factBox(i===0?'pending':'met','滩头安全',i===0?'本次额度尚未算到；已排入事实队列。':'05:10 已取得安全岸点事实。','shore-safe(东岛, 岸点 D2)')}
        <p class="unknown">pending 在此停止展开，计划显示“等事实”，不判失败。</p>`:row.id==='worker'?`
        ${factBox(i<2?'unmet':'met','同海域运力',i<2?'现有船尚在返航，未来可用不等于现在可用。':'t-02 已实际接到运输分配。','transport-in(东侧海域, 1)')}
        ${factBox(pending?'pending':'met','安全登陆点',pending?'等待事实评估；不提前占用工人。':'安全岸点 D2 已验证。','shore-safe(东岛, D2)')}`:
        `<div class="dependency-mini"><p>◇ 金币缺 140 → 找到可产出金币的动作</p><p><b>清近营</b> 效果：营地清空 ＋ 赏金到账</p></div><p class="unknown">只有到账后余额才能被后续动作使用；两目标不能重复预留同一笔钱。</p>`}
      <h4>03　选了什么，落选什么</h4>${row.options.map(o=>`<div class="option ${o.chosen?'chosen':'rejected'}"><strong>${o.chosen?'✓ 选中':'↳ 落选'} · ${html(o.name)}</strong><p class="price">${html(o.price)}</p><small>${html(o.reason)}</small></div>`).join('')}
      ${i===1&&row.id==='camp'?'<div class="fact-line unmet"><strong>↗ 2 名兵被矿区回防抢占</strong>父目标保留，重推 force-at 缺口；不把短暂让位写成夺岛失败。<code>空缺 2 · 替补到岗时间 —</code></div>':''}
      <h4>04　谁在执行</h4><div class="unit-line">${html(row.who[i])}<br><code>示例 action-${row.id} / generation ${i===1&&row.id==='camp'?2:1}</code></div><p>${html(row.phase[i])}</p>
      <h4>05　结果</h4><div class="${status==='met'?'evidence':'unknown'}">${status==='met'?'✓ 已观测：':'尚未成立：'}${html(row.proof[i])}</div>
      <p class="unknown">以上全部为人工样例，执行器名、ID、时间和金额不作规则引用。</p>`;
  }
  function renderDetail(i) {
    if(selected==='goal') {$('#node-detail').innerHTML=detailForGoal(i);return;}
    const [id,kind]=selected.split('-'), row=rows.find(r=>r.id===id)||rows[0];
    $('#node-detail').innerHTML=detailForRow(row,i,kind);
  }
  function node(id,kind,x,y,width,state,title,note,foot='',label='') {
    const icon=state==='met'||state==='done'?'✓':state==='pending'?'◌':kind==='goal'?'⚑':kind==='executor'?'↗':'◇';
    return `<button class="graph-node ${kind} ${state} ${selected===id?'selected':''}" data-node="${id}" style="left:${x}px;top:${y}px;width:${width}px" aria-pressed="${selected===id}"><span class="node-label">${icon} ${label||html(kind)}<b>${html(names[state]||state)}</b></span><span class="node-title">${html(title)}</span><span class="node-note">${note}</span>${foot?`<span class="node-foot">${foot}</span>`:''}</button>`;
  }
  function renderGraph(i) {
    let nodes=node('goal','goal',16,168,174,i===3?'done':'active','建立东岛矿厅',`目标效果<br><b>hall-complete</b><br>矿点可开始采矿`,i===3?'✓ 08:10 效果已证明':'需要右侧 3 项同时成立','目标');
    const paths=[];
    rows.forEach((row,index)=>{
      const y=38+index*130, cy=y+60, st=row.states[i];
      nodes+=node(`${row.id}-fact`,'fact',230,y,184,st,row.title,html(row.values[i]),'全部前置 / AND','事实');
      nodes+=node(`${row.id}-action`,'action',452,y,188,row.actionStates[i],row.action,html(row.notes[i]),'选中 1 · 落选 1 → 查看理由','推导动作');
      nodes+=node(`${row.id}-executor`,'executor',675,y,190,row.actionStates[i],row.id==='worker'?'工人运输':row.id==='camp'?'岛上兵力与清营':'本土筹资',html(row.who[i]),html(row.phase[i]),'实际分配 / 阶段');
      nodes+=node(`${row.id}-result`,'result',905,y,178,st==='met'?'met':'unmet',st==='met'?'效果已被观测':'结果尚未成立',html(row.proof[i]),st==='met'?'✓ 证据可核对':'不拿命令接受当结果','结果证据');
      paths.push(`<path class="dependency-edge" d="M190 239 C210 239 209 ${cy} 230 ${cy}"/><path class="dependency-edge" d="M414 ${cy} H452"/><path class="dependency-edge execution" d="M640 ${cy} H675"/><path class="dependency-edge ${st==='met'?'proved':''}" d="M865 ${cy} H905"/>`);
    });
    $('#graph-nodes').innerHTML=nodes;
    $('#graph-links').innerHTML=`<defs><marker id="dep-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6" fill="none" stroke="currentColor"/></marker></defs><g style="marker-end:url(#dep-arrow)">${paths.join('')}</g><text x="201" y="228" class="edge-label">需要</text>`;
    $('#graph-summary').textContent=i===3?'目标完成：最后由矿厅完工事实确认。':i===1?'2 兵让位回防 → 缺口重推，父目标保留。':i===2?'2 / 3 前置已成立，尚未把卸载当作到岗。':'缺条件会推出动作；等事实不会被当作失败。';
    renderDetail(i);
  }
  function renderTimeline() {
    $('#ticks').innerHTML=[0,180,360,540,720,900].map(t=>`<span style="left:${t/9}%">${clock(t)}</span>`).join('');
    $('#timeline-lanes').innerHTML=bands.map((b,index)=>`<div class="timeline-lane"><label>${html(b.label)}</label><div class="timeline-track" data-track="${index}"><div class="gap" style="left:0;width:${260/9}%">未记录</div><div class="gap" style="left:${490/9}%;right:0">未记录</div><button class="time-band" data-band="${index}" style="left:${b.from/9}%;width:${(b.to-b.from)/9}%" aria-label="${html(b.label)}，点击回看"><span hidden></span>${b.parts.map(([name,duration,style])=>`<span class="${style}" style="flex:${duration}">${html(name)}</span>`).join('')}</button>${index===0?'<button class="preempt-event" data-moment="310" style="left:34.444%" aria-label="05:10 两名兵被抢占">↗ 2兵</button>':''}<i class="timeline-cursor" style="left:${second/9}%"></i></div></div>`).join('');
    $('#moments').innerHTML=moments.map((m,i)=>`<button data-moment="${m.at}" aria-pressed="${second>=260&&second<=490&&i===current}">${m.label}</button>`).join('');
  }
  function fit() {
    const viewport=$('#graph-viewport');
    zoom=Math.min(1,(viewport.clientWidth-16)/1100,(viewport.clientHeight-2)/460);
    zoom=Math.max(.55,zoom);applyZoom();
  }
  function applyZoom() {
    $('#graph-canvas').style.transform=`scale(${zoom})`;
    $('#graph-size').style.width=`${1100*zoom}px`;$('#graph-size').style.height=`${460*zoom}px`;
    $('#zoom-label').textContent=`${Math.round(zoom*100)}%`;
  }
  function render() {
    const recorded=second>=260&&second<=490;
    current=Math.max(0,moments.findLastIndex(m=>m.at<=second));
    $('#frame-clock').textContent=clock(second);$('#seek-clock').textContent=clock(second);$('#time-seek').value=String(second);
    $('#unrecorded').hidden=recorded;$('#graph-size').hidden=!recorded;
    $('#scene-title').textContent=recorded?titles[current]:'这段时间，没有记录';
    if(recorded)renderGraph(current);else{$('#node-detail').innerHTML='<h3>未记录</h3><p class="detail-lead">没有样稿帧，不能推断当时的计划、分配或结果。</p>';$('#graph-summary').textContent='未记录时段不补建。';}
    $('#sample-frame-note').textContent=recorded?`展示样稿帧 ${clock(moments[current].at)} · 保持上一记录帧，不插值`:'当前时段未记录';
    renderTimeline();
    document.body.dataset.sampleMoment=recorded?String(moments[current].at):'unrecorded';
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.node){selected=target.dataset.node;render();}
    if(target.dataset.moment){second=Number(target.dataset.moment);render();}
  });
  $('#time-seek').addEventListener('input',event=>{second=Number(event.target.value);render();});
  // Pointer position is a time, including when the pointer is over a phase bar.
  $('#timeline-lanes').addEventListener('pointerdown',event=>{
    if(event.target.closest('[data-moment]'))return;
    const track=event.target.closest('.timeline-track');if(!track)return;
    const move=e=>{const rect=track.getBoundingClientRect();second=Math.max(0,Math.min(900,Math.round((e.clientX-rect.left)/rect.width*900)));render();};
    move(event);const finish=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish,{once:true});
  });
  $('#zoom-out').addEventListener('click',()=>{zoom=Math.max(.55,zoom-.1);applyZoom();});
  $('#zoom-in').addEventListener('click',()=>{zoom=Math.min(1.5,zoom+.1);applyZoom();});
  $('#zoom-reset').addEventListener('click',fit);
  render();requestAnimationFrame(fit);
  window.addEventListener('resize',fit);
})();
