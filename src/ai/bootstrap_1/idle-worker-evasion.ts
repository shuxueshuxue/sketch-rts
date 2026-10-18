import {mountedEscape} from './mounted-micro';
import {armedFoes} from './safe-land-route';
import {sameGround} from '../../shared/terrain';
import type {GameSnapshot,GameCommand,PlayerId} from '../../shared/types';
import type {AiPolicyContext} from '../policy/types';
/** Idle civilians yield to nearby armed threats without taking over income,
 * boarding, construction, or an already accepted recovery task. */
export function idleWorkerEvasion(snapshot:GameSnapshot,owner:PlayerId,options:AiPolicyContext,planned:GameCommand[]):GameCommand[]{
 const foes=armedFoes(snapshot,owner,options),jobs=options.memory.jobs,commands:GameCommand[]=[];
 const eligible=snapshot.units.filter(u=>u.owner===owner&&u.kind==='worker'&&!u.deck&&u.carryingGold===0
  &&(u.order.type==='idle'||u.order.type==='move'&&u.order.avoidCombat&&jobs.some(j=>j.id===u.id&&j.kind==='idleWorkerEvasion'))
  &&!planned.some(c=>('unitIds'in c&&c.unitIds.includes(u.id))||('unitId'in c&&c.unitId===u.id)));
 const seen=new Set<string>();
 for(const worker of eligible){
  const nearby=foes.filter(f=>sameGround(snapshot.map,f,worker)&&Math.hypot(f.x-worker.x,f.y-worker.y)<600);
  if(!nearby.length)continue;
  commands.push(mountedEscape(snapshot,worker,nearby,0,undefined,true));seen.add(worker.id);
  const job=jobs.find(j=>j.id===worker.id&&j.kind==='idleWorkerEvasion');if(job)job.updatedTick=snapshot.tick;
  else jobs.push({id:worker.id,kind:'idleWorkerEvasion',createdTick:snapshot.tick,updatedTick:snapshot.tick});
 }
 options.memory.jobs=jobs.filter(j=>j.kind!=='idleWorkerEvasion'||seen.has(j.id));return commands;
}
