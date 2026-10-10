import { unitMover } from '../../shared/catalog';
import { detCos, detSin } from '../../shared/det-math';
import { isWalkable, segmentWalkable, walkingDistance } from '../../shared/terrain';
import { boltIntersection } from '../../shared/weapons';
import type { Point } from '../policy/spatial';
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

type Hazard = Point & { id: string; radius: number; remaining: number; angle: number; from?: Point };

function overlaps(hazard: Hazard, point: Point, radius: number) {
  return hazard.from ? boltIntersection(hazard.from, hazard, { x: point.x, y: point.y, radius }, hazard.radius) !== undefined
    : Math.hypot(point.x - hazard.x, point.y - hazard.y) <= hazard.radius + radius;
}

/** Leave visible enemy fire and keep clear until its projectile or ground effect expires. */
export function planShellEvasion(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const hazards: Hazard[] = [
    ...snapshot.projectiles.filter(projectile => (projectile.weapon?.delivery === 'shell' || projectile.weapon?.delivery === 'bolt' && projectile.weapon.maxHits! > 1)
      && isEnemyOwner(snapshot, owner, projectile.owner, options)).map(shell => ({
      id: shell.id, x: shell.toX, y: shell.toY, radius: shell.weapon!.radius!, remaining: shell.remaining,
      angle: Math.atan2(shell.toY - shell.fromY, shell.toX - shell.fromX),
      ...(shell.weapon!.delivery === 'bolt' ? { from: { x: shell.fromX, y: shell.fromY } } : {}),
    })),
    ...snapshot.effects.filter(effect => (effect.type === 'storm' || effect.type === 'burningGround')
      && effect.owner !== undefined && effect.damage! > 0 && effect.radius! > 0 && effect.tickEvery! > 0
      && isEnemyOwner(snapshot, owner, effect.owner, options)).map(effect => ({
      id: effect.id, x: effect.x, y: effect.y, radius: effect.radius!, remaining: effect.remaining, angle: 0,
    })),
  ];
  const soldiers = snapshot.units.filter(unit => unit.owner === owner && unitMover(unit.kind) === 'land' && !unit.deck
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
      !overlaps(hazard, order, unit.radius))) {
      commands.push({ type: 'move', unitIds: [unit.id], x: order.x, y: order.y });
      destinations.push({ x: order.x, y: order.y, radius: unit.radius });
      continue;
    }
    // A clear walking order can enter the visible fire before the next decision.
    const walking = (order.type === 'move' || order.type === 'attackMove' && order.targetId === undefined)
      && segmentWalkable(snapshot.map, unit, order) ? order : unit;
    const step = (hazard: Hazard) => {
      const budget = unit.speed * (hazard.remaining - 1) / SIM_TICKS_PER_SECOND;
      const gap = Math.hypot(walking.x - unit.x, walking.y - unit.y);
      const fraction = gap > budget ? budget / gap : 1;
      return { x: unit.x + (walking.x - unit.x) * fraction, y: unit.y + (walking.y - unit.y) * fraction };
    };
    const incoming = hazards.filter(hazard => overlaps(hazard, unit, unit.radius) || overlaps(hazard, step(hazard), unit.radius))
      .sort((a, b) => a.remaining - b.remaining);
    const hazard = incoming[0];
    if (!hazard) {
      // Keep an escaped soldier clear until the hazard ends; another army script must not walk it back in.
      if (job) commands.push({ type: 'move', unitIds: [unit.id], x: unit.order.type === 'move' ? unit.order.x : unit.x,
        y: unit.order.type === 'move' ? unit.order.y : unit.y });
      continue;
    }
    const reach = hazard.radius + unit.radius + CLEARANCE;
    const along = hazard.from ? boltIntersection(hazard.from, hazard,
      overlaps(hazard, unit, unit.radius) ? unit : step(hazard), hazard.radius)! : 0;
    const length = hazard.from ? Math.hypot(hazard.x - hazard.from.x, hazard.y - hazard.from.y) : 0;
    const origin = hazard.from ? { x: hazard.from.x + (hazard.x - hazard.from.x) * Math.min(1, along / length),
      y: hazard.from.y + (hazard.y - hazard.from.y) * Math.min(1, along / length) } : hazard;
    const budget = unit.speed * (hazard.remaining - 1) / SIM_TICKS_PER_SECOND;
    const points = DIRECTIONS.map(offset => ({ x: origin.x + detCos(hazard.angle + offset * Math.PI / 8) * reach,
      y: origin.y + detSin(hazard.angle + offset * Math.PI / 8) * reach }))
      .filter(point => Math.hypot(point.x - unit.x, point.y - unit.y) <= budget && isWalkable(snapshot.map, point.x, point.y))
      .filter(point => hazards.every(other => !overlaps(other, point, unit.radius)))
      .map(point => ({ ...point,
        exposure: Math.max(0, ...enemies.map(enemy => enemy.attackRange + enemy.radius + unit.radius
          + ('order' in enemy ? enemy.speed : 0) * Math.hypot(point.x - unit.x, point.y - unit.y) / unit.speed
          - Math.hypot(point.x - enemy.x, point.y - enemy.y))),
        score: Math.hypot(point.x - unit.x, point.y - unit.y)
        + destinations.reduce((total, other) => total + Math.max(0, unit.radius + other.radius + CLEARANCE - Math.hypot(point.x - other.x, point.y - other.y)) * 4, 0) }))
      .sort((a, b) => a.exposure - b.exposure || a.score - b.score);
    const point = points.find(point => {
      const walk = segmentWalkable(snapshot.map, unit, point)
        ? Math.hypot(point.x - unit.x, point.y - unit.y) : walkingDistance(snapshot.map, unit, point);
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
