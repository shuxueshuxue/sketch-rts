import {applyAiPlanDelta, type AiPlanPacket, type AiPlanBuildingLoss} from '../ai/plan-stream';
import type {AiPlanTrace} from '../ai/plan-trace';
import type {AiUnitDeathRecord} from '../ai/death-ledger-types';
import { planPhase, planViewNodes, type PlanAllocationEvent, type PlanViewNode } from './ai-plan-strategy';
export type PlanBand = {owner:string;id:string;label:string;kind:string;from:number;to:number;status:string;segments:{from:number;to:number;phase:string;reason:string}[]};
export class AiPlanHistory {
  readonly frames = new Map<string,AiPlanTrace[]>();
  readonly bands: PlanBand[] = [];
  readonly deaths: AiUnitDeathRecord[] = [];
  readonly buildings: AiPlanBuildingLoss[] = [];
  readonly allocationEvents: PlanAllocationEvent[] = [];
  private allocationEventIds = new Set<string>();
  readonly coverage = new Map<number,{from:number;to:number|null;availability?:'after-match'}>();
  readonly paths = new Map<string,{tick:number;x:number;y:number;session:number;goals:string[]}[]>();
  private current = new Map<string,{trace:AiPlanTrace;session:number}>();
  revision=0;
  receive(packet:AiPlanPacket) {
    this.revision++;
    if(packet.type==='reset'){this.frames.clear();this.bands.length=0;this.deaths.length=0;this.buildings.length=0;this.allocationEvents.length=0;this.allocationEventIds.clear();this.coverage.clear();this.paths.clear();this.current.clear();return;}
    if(packet.type==='coverage'){this.coverage.set(packet.session,{from:packet.from,to:packet.to,...(packet.availability?{availability:packet.availability}:{})});return;}
    if(packet.type==='events'){
      for(const death of packet.deaths) if(!this.deaths.some(d=>d.id===death.id))this.deaths.push(death);
      for(const b of packet.buildings)if(!this.buildings.some(d=>d.id===b.id&&d.tick===b.tick))this.buildings.push(b);
      return;
    }
    const before=this.current.get(packet.owner);
    const trace=applyAiPlanDelta(before?.session===packet.session?before.trace:undefined,packet);
    if(!trace)return;
    this.current.set(trace.owner,{trace,session:packet.session});
    const frames=this.frames.get(trace.owner)??[];frames.push(trace);this.frames.set(trace.owner,frames);
    const nodes = planViewNodes(trace), ids = new Set(nodes.map(node => node.id));
    const interval = this.coverage.get(packet.session);
    for (const event of trace.strategy?.allocation?.events ?? []) {
      // A retained business journal is not a recording of a time when observation was off.
      const key = JSON.stringify([trace.owner, event.id]);
      if (!interval || interval.availability || event.tick < interval.from || event.tick > trace.tick
        || (interval.to !== null && event.tick > interval.to) || this.allocationEventIds.has(key)) continue;
      this.allocationEventIds.add(key);
      this.allocationEvents.push({ owner: trace.owner, event, observedTick: trace.tick, session: packet.session });
    }
    for(const p of packet.positions??[]){const points=this.paths.get(p.id)??[];points.push({...p,tick:packet.tick,session:packet.session,goals:nodes.filter(n=>n.resources.unitIds.includes(p.id)).map(n=>n.id)});this.paths.set(p.id,points);}
    if(before?.session===packet.session)for(const oldId of planViewNodes(before.trace).map(node => node.id))if(!ids.has(oldId)){
      const ended=this.bands.find(b=>b.owner===trace.owner&&b.id===oldId&&!terminal(b.status)&&b.from>=(interval?.from??packet.tick));
      if(ended){ended.to=packet.tick;ended.status='released';}
    }
    for(const node of nodes){
      const id = node.id;
      const since = Math.max(interval?.from ?? packet.tick, node.strategy ? node.sinceTick ?? 0 : 0);
      let band=this.bands.filter(b=>b.owner===trace.owner&&b.id===id&&b.status!=='released'&&b.from>=since).at(-1);
      if(band&&terminal(band.status)&&node.goalPlan&&node.status!=='complete'&&packet.tick>band.to)band=undefined;
      if(!band){band={owner:trace.owner,id,label:node.label,kind:node.goalPlan?'goal':node.strategy?'strategy':node.kind,from:packet.tick,to:packet.tick,status:node.status,segments:[]};this.bands.push(band);}
      if(terminal(band.status))continue;
      band.to=packet.tick;band.status=node.status;
      const {phase,reason}=planPhase(trace,node);
      const last=band.segments.at(-1);
      if(last?.phase===phase&&last.reason===reason)last.to=packet.tick;
      else band.segments.push({from:packet.tick,to:packet.tick,phase,reason});
    }
  }
  points(id:string,from:number,to:number){
    const points=this.paths.get(id)??[];
    const bound=(tick:number)=>{let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid]!.tick<tick)lo=mid+1;else hi=mid;}return lo;};
    return points.slice(bound(from),bound(to+1));
  }
  recorded(tick:number){return [...this.coverage.values()].some(c=>!c.availability&&tick>=c.from&&(c.to===null||tick<=c.to));}
  availableAfterMatch(tick:number){return !this.recorded(tick)&&[...this.coverage.values()].some(c=>c.availability==='after-match'&&tick>=c.from&&(c.to===null||tick<=c.to));}
  at(owner:string,tick:number):AiPlanTrace|undefined {
    if(!this.recorded(tick))return;
    const frames=this.frames.get(owner)??[];let lo=0,hi=frames.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(frames[mid]!.tick<=tick)lo=mid+1;else hi=mid;}
    const frame=frames[lo-1];
    // A baseline before a closed gap does not become a record of a later opening.
    const interval=[...this.coverage.values()].find(c=>!c.availability&&tick>=c.from&&(c.to===null||tick<=c.to));
    return frame&&interval&&frame.tick>=interval.from?frame:undefined;
  }
  nodes(tick:number):{trace:AiPlanTrace;node:PlanViewNode}[]{return [...this.frames.keys()].flatMap(owner=>{const trace=this.at(owner,tick);return trace?planViewNodes(trace).map(node=>({trace,node})):[];});}
  eventsAt(tick:number){return this.recorded(tick)?this.allocationEvents.filter(entry=>entry.observedTick<=tick&&entry.event.tick<=tick):[];}
}
const terminal=(status:string)=>['done','complete','failed','abandoned','released'].includes(status);
export function deathStyle(death:AiUnitDeathRecord){
  const disposition=death.classification.disposition;
  return disposition==='normal'?{kind:'normal',label:'战损（正常）',icon:'×',color:'#58765b'}
    :disposition==='suspicious'?{kind:'suspicious',label:'存疑',icon:'?',color:'#a97720'}
    :disposition==='abnormal'?{kind:'abnormal',label:'异常',icon:'!',color:'#af443b'}
    :{kind:'unattributed',label:disposition==='lifecycle'?'存活到期':'未归因',icon:'·',color:'#777d80'};
}

/** Pack time intervals without hiding simultaneous events under one another. */
export function planTimelineRows<T>(items:readonly T[],start:(item:T)=>number,end:(item:T)=>number,gap:number){
  const ends:number[]=[];
  return [...items].sort((a,b)=>start(a)-start(b)).map(item=>{
    let row=ends.findIndex(last=>last+gap<=start(item));if(row<0)row=ends.length;
    ends[row]=end(item);return {item,row};
  });
}

/** Link only an explicitly recorded task identity, never nearby units or positions. */
export function planDeathMatches(owner:string,node:PlanViewNode,death:AiUnitDeathRecord,fromTick:number){
  if(death.owner!==owner||!death.actualDeath||death.tick<fromTick)return false;
  if(node.goalPlan)return death.attributionContext.objectiveId===node.goalPlan.goal.id
    ||node.goalPlan.actions.some(action=>action.allocation?.objectiveId===death.attributionContext.objectiveId);
  if(node.strategy)return death.attributionContext.objectiveId===node.strategy.objectiveId;
  const id=death.assignment.task?.id;
  if(!id)return false;
  if(id===node.id)return true;
  return (node.source==='landExpansion' && id===`expansion:${node.target.entityId}`)
    || (node.source==='landAttack' && id===`attack:${node.target.entityId}`);
}
