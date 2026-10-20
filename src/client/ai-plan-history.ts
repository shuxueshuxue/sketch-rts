import {applyAiPlanDelta, type AiPlanPacket, type AiPlanBuildingLoss} from '../ai/plan-stream';
import type {AiPlanNode, AiPlanTrace} from '../ai/plan-trace';
import type {AiUnitDeathRecord} from '../ai/death-ledger-types';
export type PlanBand = {owner:string;id:string;label:string;from:number;to:number;status:string;segments:{from:number;to:number;phase:string;reason:string}[]};
export class AiPlanHistory {
  readonly frames = new Map<string,AiPlanTrace[]>();
  readonly bands: PlanBand[] = [];
  readonly deaths: AiUnitDeathRecord[] = [];
  readonly buildings: AiPlanBuildingLoss[] = [];
  readonly coverage = new Map<number,{from:number;to:number|null}>();
  readonly paths = new Map<string,{tick:number;x:number;y:number;session:number}[]>();
  private current = new Map<string,{trace:AiPlanTrace;session:number}>();
  revision=0;
  receive(packet:AiPlanPacket) {
    this.revision++;
    if(packet.type==='reset'){this.frames.clear();this.bands.length=0;this.deaths.length=0;this.buildings.length=0;this.coverage.clear();this.paths.clear();this.current.clear();return;}
    if(packet.type==='coverage'){this.coverage.set(packet.session,{from:packet.from,to:packet.to});return;}
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
    for(const p of packet.positions??[]){const points=this.paths.get(p.id)??[];points.push({...p,tick:packet.tick,session:packet.session});this.paths.set(p.id,points);}
    for(const id of trace.roots){
      const node=trace.nodes.find(n=>n.id===id);if(!node)continue;
      let band=this.bands.find(b=>b.owner===trace.owner&&b.id===id&&b.from>=(this.coverage.get(packet.session)?.from??packet.tick));
      if(!band){band={owner:trace.owner,id,label:node.label,from:packet.tick,to:packet.tick,status:node.status,segments:[]};this.bands.push(band);}
      band.to=packet.tick;band.status=node.status;
      const phase=trace.nodes.find(n=>node.children.includes(n.id))?.label??node.reasons[0]?.code??node.status;
      const reason=node.reasons.map(r=>r.detail).join('；');
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
  recorded(tick:number){return [...this.coverage.values()].some(c=>tick>=c.from&&(c.to===null||tick<=c.to));}
  at(owner:string,tick:number):AiPlanTrace|undefined {
    if(!this.recorded(tick))return;
    const frames=this.frames.get(owner)??[];let lo=0,hi=frames.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(frames[mid]!.tick<=tick)lo=mid+1;else hi=mid;}
    const frame=frames[lo-1];
    // A baseline before a closed gap does not become a record of a later opening.
    const interval=[...this.coverage.values()].find(c=>tick>=c.from&&(c.to===null||tick<=c.to));
    return frame&&interval&&frame.tick>=interval.from?frame:undefined;
  }
  nodes(tick:number):{trace:AiPlanTrace;node:AiPlanNode}[]{return [...this.frames.keys()].flatMap(owner=>{const trace=this.at(owner,tick);return trace?trace.roots.flatMap(id=>{const node=trace.nodes.find(n=>n.id===id);return node?[{trace,node}]:[];}):[];});}
}
export function deathStyle(death:AiUnitDeathRecord){
  const disposition=death.classification.disposition;
  return disposition==='normal'?{kind:'normal',label:'战损（正常）',icon:'×',color:'#58765b'}
    :disposition==='suspicious'?{kind:'suspicious',label:'存疑',icon:'?',color:'#a97720'}
    :disposition==='abnormal'?{kind:'abnormal',label:'异常',icon:'!',color:'#af443b'}
    :{kind:'unattributed',label:disposition==='lifecycle'?'存活到期':'未归因',icon:'·',color:'#777d80'};
}
