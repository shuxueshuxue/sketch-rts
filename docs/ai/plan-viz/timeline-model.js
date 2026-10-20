/* Shared by the offline viewer and chronology/visibility tests. No game policy runs here. */
(() => {
'use strict';
function at(rows, tick) {
 let low=0, high=rows.length-1, found=-1;
 while(low<=high){const mid=(low+high)>>1;if(rows[mid].tick<=tick){found=mid;low=mid+1;}else high=mid-1;}
 return found<0?null:rows[found];
}
function allowed(mode, solo, own, owners) {
 return mode==='solo'&&!solo?[]:mode==='online'?[own]:[...owners];
}
function related(trace, id, seen=new Set()) {
 if(seen.has(id))return [];seen.add(id);
 const node=trace?.nodes.find(n=>n.id===id);
 return node?[...new Set([...node.resources.unitIds,...node.children.flatMap(c=>related(trace,c,seen))])]:[];
}
const phaseLabels={assigned:'已分配',fund:'筹资',assemble:'集结',clear:'清营',escort:'护送',build:'施工',complete:'交接完成',gather:'整队',fight:'交战',engage:'接战',loading:'装船',sailing:'航渡',return:'返航',travel:'行军',strike:'攻击',attack:'进攻',home:'回位',advance:'前进',skirmish:'接战',retreat:'撤退'};
function phase(trace,node){
 const child=node.children.map(id=>trace.nodes.find(n=>n.id===id)).find(n=>n&&/\/(stage|phase):/.test(n.id));
 const code=child?.id.match(/\/(?:stage|phase):([^/]+)$/)?.[1]||node.reasons.find(r=>/^(stage|phase):/.test(r.code))?.code.split(':')[1];
 const camp=child?.children.map(id=>trace.nodes.find(n=>n.id===id)).find(n=>n&&/\/camp:/.test(n.id));
 const sub=camp?.id.match(/\/camp:([^/]+)$/)?.[1];
 return {stage:(code||'execution')+(sub?'/'+sub:''),stageLabel:(phaseLabels[code]||code||'阶段未记录')+(sub?' · '+(phaseLabels[sub]||sub):'')};
}
function outcome(node){return node.status==='done'?'done':node.reasons.some(r=>['army-lost','landing-party-lost'].includes(r.code))?'failed':'abandoned';}
function bands(thinks, endTick) {
 const result=[], open=new Map(), linkedResults=new Set();
 for(const trace of thinks){
  const present=new Set(trace.roots),removed=[];
  for(const [key,band] of open)if(band.owner===trace.owner&&!present.has(band.id)){
   if(band.end===null){band.end=trace.tick;band.outcome='released';removed.push(band);}open.delete(key);
  }
  for(const id of trace.roots){
   const node=trace.nodes.find(n=>n.id===id);if(!node)continue;
   // A retained attack result is an explicit module outcome, unlike disappearance.
   if(linkedResults.has(trace.owner+'|'+node.id))continue;
   if(node.source==='landAttackResult'){
    const recorded=node.reasons[0]?.recordedTick;
    const prior=removed.find(b=>b.last.source==='landAttack'&&b.last.target.entityId===node.target.entityId&&recorded>b.observedStart&&recorded>=(trace.previousTick??trace.tick-15)&&recorded<=trace.tick);
    if(prior){prior.end=recorded;prior.outcome=outcome(node);prior.result={nodeId:node.id,tick:recorded,reasons:node.reasons,source:node.source};linkedResults.add(trace.owner+'|'+node.id);continue;}
   }
   const key=trace.owner+'|'+id;
   let band=open.get(key);
   if(!band){band={key:key+'@'+trace.tick,id,owner:trace.owner,label:node.label,kind:node.kind,start:node.sinceTick??trace.tick,
    observedStart:trace.tick,end:null,outcome:null,segments:[],last:node};result.push(band);open.set(key,band);}
   const info=phase(trace,node),reason=node.reasons[0],prev=band.segments.at(-1);
   if(!prev||prev.status!==node.status||prev.stage!==info.stage||prev.reasonCode!==reason?.code)
    band.segments.push({tick:trace.tick,status:node.status,...info,reasonCode:reason?.code||null,reasonDetail:reason?.detail||null});
   band.last=node;
   if((node.status==='done'||node.status==='abandoned')&&band.end===null){
    band.end=trace.tick;band.outcome=outcome(node);band.terminalAlreadyObserved=band.observedStart===trace.tick;
   }
  }
 }
 return result.map(b=>({...b,displayEnd:b.end??endTick,segments:b.segments.map((s,i)=>({...s,end:Math.max(s.tick,Math.min(b.end??endTick,b.segments[i+1]?.tick??endTick))}))}));
}
function fitWindow(from,to,start,end,minSpan=200){
 if(!Number.isFinite(from)||!Number.isFinite(to)||end<=start)return {from:start,to:end};
 let lo=Math.min(from,to),hi=Math.max(from,to),span=Math.min(end-start,Math.max(minSpan,Math.round(hi-lo)));
 lo=Math.round(Math.max(start,Math.min(end-span,lo)));return {from:lo,to:lo+span};
}
function zoomWindow(view,factor,anchor,start,end){
 const span=view.to-view.from,next=Math.max(200,Math.min(end-start,span*factor)),ratio=span?(anchor-view.from)/span:.5;
 return fitWindow(anchor-next*ratio,anchor+next*(1-ratio),start,end);
}
function panWindow(view,delta,start,end){return fitWindow(view.from+delta,view.to+delta,start,end);}
function assignedClaim(claims,unitId,node){return node.target?.entityId?claims.find(c=>c.id===unitId&&c.targetId===node.target.entityId)||null:null;}
function arrival(history, unitId, tick, claim) {
 if(!claim)return null;
 const same=c=>c.id===unitId&&c.kind===claim.kind&&c.targetId===claim.targetId&&c.sinceTick===claim.sinceTick;
 const rows=history.filter(t=>t.tick<=tick), first=rows.find(t=>t.claims?.some(c=>same(c)&&c.arrived===true));
 if(!first)return null;
 const prior=rows.filter(t=>t.tick<first.tick).some(t=>t.claims?.some(c=>same(c)&&c.arrived===false));
 return {tick:first.tick,beforeObservation:!prior};
}
window.PLAN_TIMELINE_MODEL={at,allowed,related,bands,arrival,assignedClaim,phase,fitWindow,zoomWindow,panWindow,phaseLabels};
})();
