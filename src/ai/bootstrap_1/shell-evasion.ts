import { unitMover } from '../../shared/catalog';
import { detCos, detSin } from '../../shared/det-math';
import { isWalkable, walkingDistance } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import type { AiPolicyContext, AiScript } from '../policy/types';

const JOB_PREFIX = 'shellEvasion:';
const CLEARANCE = 12;
const DIRECTIONS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8];

export const shellEvasion: AiScript = {
  id: 'shellEvasion',
  phase: 'tactics',
  run: planShellEvasion,
  claimsUnits: (snapshot, owner, options) => new Set(planShellEvasion(snapshot, owner, options).flatMap(command =>
    command.type === 'move' ? command.unitIds : [])),
};

/** Leave a visible shell's impact area before it lands, then release the army back to its commander. */
export function planShellEvasion(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const shells = snapshot.projectiles.filter(projectile => projectile.weapon?.delivery === 'shell'
    && isEnemyOwner(snapshot, owner, projectile.owner, options));
  const soldiers = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unitMover(unit.kind) === 'land' && !unit.deck
    && unit.order.type !== 'board' && unit.order.type !== 'charge' && !unit.effects.some(effect => effect.type === 'root'));
  options.memory.jobs = options.memory.jobs.filter(job => !job.kind.startsWith(JOB_PREFIX)
    || (shells.some(shell => job.kind === JOB_PREFIX + shell.id) && soldiers.some(unit => unit.id === job.id)));
  const commands: Extract<GameCommand, { type: 'move' }>[] = [];
  const destinations: { x: number; y: number; radius: number }[] = [];
  for (const unit of soldiers) {
    const job = options.memory.jobs.find(job => job.id === unit.id && job.kind.startsWith(JOB_PREFIX));
    const order = unit.order;
    if (job && order.type === 'move' && shells.every(shell =>
      Math.hypot(order.x - shell.toX, order.y - shell.toY) > shell.weapon!.radius! + unit.radius)) {
      commands.push({ type: 'move', unitIds: [unit.id], x: order.x, y: order.y });
      destinations.push({ x: order.x, y: order.y, radius: unit.radius });
      continue;
    }
    const incoming = shells.filter(shell => Math.hypot(unit.x - shell.toX, unit.y - shell.toY) <= shell.weapon!.radius! + unit.radius)
      .sort((a, b) => a.remaining - b.remaining);
    const shell = incoming[0];
    if (!shell) {
      // Keep an escaped soldier outside the blast until impact; another army script must not walk it back in.
      if (job) commands.push({ type: 'move', unitIds: [unit.id], x: unit.order.type === 'move' ? unit.order.x : unit.x,
        y: unit.order.type === 'move' ? unit.order.y : unit.y });
      continue;
    }
    const angle = Math.atan2(shell.toY - shell.fromY, shell.toX - shell.fromX);
    const reach = shell.weapon!.radius! + unit.radius + CLEARANCE;
    const budget = unit.speed * (shell.remaining - 1) / SIM_TICKS_PER_SECOND;
    const points = DIRECTIONS.map(offset => ({ x: shell.toX + detCos(angle + offset * Math.PI / 8) * reach,
      y: shell.toY + detSin(angle + offset * Math.PI / 8) * reach }))
      .filter(point => Math.hypot(point.x - unit.x, point.y - unit.y) <= budget && isWalkable(snapshot.map, point.x, point.y))
      .filter(point => shells.every(other => Math.hypot(point.x - other.toX, point.y - other.toY) > other.weapon!.radius! + unit.radius))
      .map(point => ({ ...point, score: Math.hypot(point.x - unit.x, point.y - unit.y)
        + destinations.reduce((total, other) => total + Math.max(0, unit.radius + other.radius + CLEARANCE - Math.hypot(point.x - other.x, point.y - other.y)) * 4, 0) }))
      .sort((a, b) => a.score - b.score);
    const point = points.find(point => {
      const walk = walkingDistance(snapshot.map, unit, point);
      return walk !== undefined && walk <= budget;
    });
    if (!point) continue;
    commands.push({ type: 'move', unitIds: [unit.id], x: point.x, y: point.y });
    destinations.push({ ...point, radius: unit.radius });
    if (job) { job.kind = JOB_PREFIX + shell.id; job.updatedTick = snapshot.tick; }
    else options.memory.jobs.push({ id: unit.id, kind: JOB_PREFIX + shell.id, createdTick: snapshot.tick, updatedTick: snapshot.tick });
  }
  return commands;
}
