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
function bands(thinks, endTick) {
 const result=[], open=new Map();
 for(const trace of thinks){
  const present=new Set(trace.roots);
  for(const [key,band] of open)if(band.owner===trace.owner&&!present.has(band.id)){
   if(band.end===null){band.end=trace.tick;band.outcome='released';}open.delete(key);
  }
  for(const id of trace.roots){
   const node=trace.nodes.find(n=>n.id===id);if(!node)continue;
   const key=trace.owner+'|'+id;
   let band=open.get(key);
   if(!band){band={key:key+'@'+trace.tick,id,owner:trace.owner,label:node.label,kind:node.kind,start:node.sinceTick??trace.tick,
    observedStart:trace.tick,end:null,outcome:null,segments:[],last:node};result.push(band);open.set(key,band);}
   const prev=band.segments.at(-1);
   if(!prev||prev.status!==node.status)band.segments.push({tick:trace.tick,status:node.status});
   band.last=node;
   if((node.status==='done'||node.status==='abandoned')&&band.end===null){
    band.end=trace.tick;band.outcome=node.status==='done'?'done':node.reasons.some(r=>['army-lost','landing-party-lost'].includes(r.code))?'failed':'abandoned';
    band.terminalAlreadyObserved=band.segments.length===1;
   }
  }
 }
 return result.map(b=>({...b,displayEnd:b.end??endTick}));
}
function assignedClaim(claims,unitId,node){return node.target?.entityId?claims.find(c=>c.id===unitId&&c.targetId===node.target.entityId)||null:null;}
function arrival(history, unitId, tick, claim) {
 if(!claim)return null;
 const same=c=>c.id===unitId&&c.kind===claim.kind&&c.targetId===claim.targetId&&c.sinceTick===claim.sinceTick;
 const rows=history.filter(t=>t.tick<=tick), first=rows.find(t=>t.claims?.some(c=>same(c)&&c.arrived===true));
 if(!first)return null;
 const prior=rows.filter(t=>t.tick<first.tick).some(t=>t.claims?.some(c=>same(c)&&c.arrived===false));
 return {tick:first.tick,beforeObservation:!prior};
}
window.PLAN_TIMELINE_MODEL={at,allowed,related,bands,arrival,assignedClaim};
})();
