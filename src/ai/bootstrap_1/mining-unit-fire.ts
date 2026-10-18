import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, PlayerId, GameCommand } from '../../shared/types';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { miningJobSafety } from './mining-job-defense';
import { miningJobOrder } from './mining-jobs';
import { armedFoes } from './safe-land-route';
import { mountedEscape, mountedThreatReach, THINK_TICKS } from './mounted-micro';

/** A nearby owned hall does not protect a miner from a live ranged unit.
 * Use the existing body-aware escape choice and retain the real mining job. */
function tasks(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const foes = armedFoes(snapshot, owner, options);
  return snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck && unit.hp > 0)
    .flatMap(worker => {
      const job = miningJobOrder(worker);
      if (!job) return [];
      const nearby = foes.filter(foe => Math.hypot(foe.x - worker.x, foe.y - worker.y)
        < Math.max(600, mountedThreatReach(snapshot, foe, worker, THINK_TICKS) + 100));
      if (!nearby.some(foe => Math.hypot(foe.x - worker.x, foe.y - worker.y)
        <= mountedThreatReach(snapshot, foe, worker, THINK_TICKS)
          + ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND)) return [];
      const escape = mountedEscape(snapshot, worker, nearby, 0, undefined, true);
      if (escape.type !== 'move' || Math.hypot(escape.x - worker.x, escape.y - worker.y) < 1) return [];
      return [{ worker, job, escape }];
    });
}

export const miningFire: AiScript = {
  ...miningJobSafety,
  claimsUnits: (snapshot, owner, options) => new Set([...miningJobSafety.claimsUnits!(snapshot, owner, options),
    ...tasks(snapshot, owner, options).map(task => task.worker.id)]),
  run(snapshot, owner, options) {
    const wanted = tasks(snapshot, owner, options), claimed = new Set(wanted.map(task => task.worker.id));
    const ordinary = miningJobSafety.run(snapshot, owner, options) as GameCommand[];
    return [...ordinary.filter(command => !('unitIds' in command) || command.unitIds.every(id => !claimed.has(id))),
      ...wanted.flatMap(({ worker, job, escape }) => [escape,
        { type: 'mine' as const, unitIds: [worker.id], resourceId: job.resourceId, queued: true }])];
  },
};
