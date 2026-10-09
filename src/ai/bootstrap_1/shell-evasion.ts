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

/** Leave visible enemy blast areas and keep clear until the projectile or ground effect expires. */
export function planShellEvasion(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const hazards = [
    ...snapshot.projectiles.filter(projectile => projectile.weapon?.delivery === 'shell'
      && isEnemyOwner(snapshot, owner, projectile.owner, options)).map(shell => ({
      id: shell.id, x: shell.toX, y: shell.toY, radius: shell.weapon!.radius!, remaining: shell.remaining,
      angle: Math.atan2(shell.toY - shell.fromY, shell.toX - shell.fromX),
    })),
    ...snapshot.effects.filter(effect => (effect.type === 'storm' || effect.type === 'burningGround')
      && effect.owner !== undefined && effect.damage! > 0 && effect.radius! > 0 && effect.tickEvery! > 0
      && isEnemyOwner(snapshot, owner, effect.owner, options)).map(effect => ({
      id: effect.id, x: effect.x, y: effect.y, radius: effect.radius!, remaining: effect.remaining, angle: 0,
    })),
  ];
  const soldiers = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unitMover(unit.kind) === 'land' && !unit.deck
    && unit.order.type !== 'board' && unit.order.type !== 'charge' && !unit.effects.some(effect => effect.type === 'root'));
  const enemies = [...snapshot.units, ...snapshot.buildings].filter(enemy => enemy.attackDamage > 0
    && !('order' in enemy && enemy.deck) && isEnemyOwner(snapshot, owner, enemy.owner, options));
  options.memory.jobs = options.memory.jobs.filter(job => !job.kind.startsWith(JOB_PREFIX)
    || (hazards.some(hazard => job.kind === JOB_PREFIX + hazard.id) && soldiers.some(unit => unit.id === job.id)));
  const commands: Extract<GameCommand, { type: 'move' }>[] = [];
  const destinations: { x: number; y: number; radius: number }[] = [];
  for (const unit of soldiers) {
    const job = options.memory.jobs.find(job => job.id === unit.id && job.kind.startsWith(JOB_PREFIX));
    const order = unit.order;
    if (job && order.type === 'move' && hazards.every(hazard =>
      Math.hypot(order.x - hazard.x, order.y - hazard.y) > hazard.radius + unit.radius)) {
      commands.push({ type: 'move', unitIds: [unit.id], x: order.x, y: order.y });
      destinations.push({ x: order.x, y: order.y, radius: unit.radius });
      continue;
    }
    const incoming = hazards.filter(hazard => Math.hypot(unit.x - hazard.x, unit.y - hazard.y) <= hazard.radius + unit.radius)
      .sort((a, b) => a.remaining - b.remaining);
    const hazard = incoming[0];
    if (!hazard) {
      // Keep an escaped soldier clear until the hazard ends; another army script must not walk it back in.
      if (job) commands.push({ type: 'move', unitIds: [unit.id], x: unit.order.type === 'move' ? unit.order.x : unit.x,
        y: unit.order.type === 'move' ? unit.order.y : unit.y });
      continue;
    }
    const reach = hazard.radius + unit.radius + CLEARANCE;
    const budget = unit.speed * (hazard.remaining - 1) / SIM_TICKS_PER_SECOND;
    const points = DIRECTIONS.map(offset => ({ x: hazard.x + detCos(hazard.angle + offset * Math.PI / 8) * reach,
      y: hazard.y + detSin(hazard.angle + offset * Math.PI / 8) * reach }))
      .filter(point => Math.hypot(point.x - unit.x, point.y - unit.y) <= budget && isWalkable(snapshot.map, point.x, point.y))
      .filter(point => hazards.every(other => Math.hypot(point.x - other.x, point.y - other.y) > other.radius + unit.radius))
      .map(point => ({ ...point,
        exposure: Math.max(0, ...enemies.map(enemy => enemy.attackRange + enemy.radius + unit.radius
          + ('order' in enemy ? enemy.speed : 0) * Math.hypot(point.x - unit.x, point.y - unit.y) / unit.speed
          - Math.hypot(point.x - enemy.x, point.y - enemy.y))),
        score: Math.hypot(point.x - unit.x, point.y - unit.y)
        + destinations.reduce((total, other) => total + Math.max(0, unit.radius + other.radius + CLEARANCE - Math.hypot(point.x - other.x, point.y - other.y)) * 4, 0) }))
      .sort((a, b) => a.exposure - b.exposure || a.score - b.score);
    const point = points.find(point => {
      const walk = walkingDistance(snapshot.map, unit, point);
      return walk !== undefined && walk <= budget;
    });
    if (!point) continue;
    commands.push({ type: 'move', unitIds: [unit.id], x: point.x, y: point.y });
    destinations.push({ ...point, radius: unit.radius });
    if (job) { job.kind = JOB_PREFIX + hazard.id; job.updatedTick = snapshot.tick; }
    else options.memory.jobs.push({ id: unit.id, kind: JOB_PREFIX + hazard.id, createdTick: snapshot.tick, updatedTick: snapshot.tick });
  }
  return commands;
}
