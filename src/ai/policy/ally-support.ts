import { unitMover } from "../../shared/catalog";
import { sameGround, walkingDistance } from "../../shared/terrain";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { isOpponentOwner, teamFor } from "./ownership";
import { resolveAiCommandIntent } from "./commands";
import { averagePoint, distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { readV6Intel } from "./v6/intel";
import { strengthOf, TOWER_STRENGTH } from "./v6/strength";
import { isBacklineKind } from "./v6/backline";

function toward(from: { x: number; y: number }, to: { x: number; y: number }, length: number) {
  const gap = distance(from, to) || 1;
  return { x: from.x + (to.x - from.x) * length / gap, y: from.y + (to.y - from.y) * length / gap };
}

// Support is a temporary assignment, released when the threat ends, the ally falls, or home needs the army.
// Terrain and the strength arriving together decide whether a rescue is practical.
export function supportUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  const intel = readV6Intel(snapshot, owner, options);
  const homeApproach = intel.enemies.some(enemy => enemy.army.some(unit => {
    const order = unit.order;
    return intel.ownHalls.some(hall => distance(unit, hall) <= 1_500 && ((order.type === "attack" && order.targetId === hall.id) || (order.type === "attackMove" && distance(order, hall) <= 500)));
  }));
  if (intel.intrusion || homeApproach) {
    delete options.memory.support;
    return new Set();
  }
  const busy = new Set([
    ...(options.memory.v6?.raid?.unitIds ?? []),
    ...(options.memory.v6?.closeout?.unitIds ?? []),
    ...(options.memory.v6?.creep?.group ?? []),
    ...Object.values(options.memory.naval?.ferries ?? {}).flatMap((ferry) => ferry.crewIds),
  ]);
  const army = snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker" && unitMover(unit.kind) === "land" && sameGround(snapshot.map, unit, intel.home) && unit.attackDamage > 0 && unit.hp >= unit.maxHp * 0.4 && unit.order.type !== "board" && !busy.has(unit.id));
  if (!army.length) {
    delete options.memory.support;
    return new Set();
  }
  const center = averagePoint(army);
  const allied = (other: string) => other !== owner && other !== "neutral" && teamFor(snapshot, owner, options) === teamFor(snapshot, other, options);
  const threats = snapshot.buildings.filter((base) => allied(base.owner) && base.kind === "townHall")
    .flatMap((base) => {
      const walk = walkingDistance(snapshot.map, center, base);
      if (walk === undefined) return [];
      const enemies = snapshot.units.filter((unit) => {
        if (unit.attackDamage <= 0 || unit.kind === "worker" || !isOpponentOwner(snapshot, owner, unit.owner, options) || !sameGround(snapshot.map, unit, base)) return false;
        const order = unit.order;
        const approaching = (order.type === "attack" && order.targetId === base.id) || (order.type === "attackMove" && distance(order, base) <= 500);
        return distance(unit, base) <= 700 || (approaching && distance(unit, base) <= 1_500);
      });
      if (!enemies.length) return [];
      const defenders = snapshot.units.filter((unit) => allied(unit.owner) && distance(unit, base) <= 850 && sameGround(snapshot.map, unit, base));
      const cover = snapshot.buildings.filter((tower) => allied(tower.owner) && tower.complete && tower.attackDamage > 0 && enemies.some((enemy) => distance(tower, enemy) <= tower.attackRange)).length * TOWER_STRENGTH;
      const threat = strengthOf(enemies);
      const help = army.filter((unit) => sameGround(snapshot.map, unit, base));
      const dps = enemies.reduce((n, unit) => n + unit.attackDamage * 20 / Math.max(1, unit.attackCooldown), 0);
      const contact = Math.min(...enemies.map(unit => Math.max(0, distance(unit, base) - unit.attackRange - base.radius) / Math.max(1, unit.speed)));
      const arrival = walk / Math.max(1, Math.min(...help.map(unit => unit.speed)));
      const window = contact + base.hp / Math.max(1, dps) + strengthOf(defenders) * 8;
      if (arrival > window * 1.25) return [];
      if (strengthOf(defenders) + cover >= threat * 1.15 || strengthOf(help) + strengthOf(defenders) + cover < threat * 1.05) return [];
      return [{ base, help, walk, threat }];
    }).sort((a, b) => Number(b.base.id === options.memory.support?.baseId) - Number(a.base.id === options.memory.support?.baseId) || a.walk / a.threat - b.walk / b.threat);
  const chosen = threats[0];
  if (!chosen) {
    delete options.memory.support;
    return new Set();
  }
  const previous = options.memory.support;
  options.memory.support = { baseId: chosen.base.id, unitIds: chosen.help.map((unit) => unit.id), sinceTick: previous?.baseId === chosen.base.id ? previous.sinceTick : snapshot.tick };
  return new Set(options.memory.support.unitIds);
}

export function planAllySupport(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const assignment = options.memory.support;
  const base = assignment && snapshot.buildings.find((building) => building.id === assignment.baseId);
  if (!base || !assignment) return [];
  const troops = snapshot.units.filter((unit) => assignment.unitIds.includes(unit.id));
  if (!troops.length) return [];
  const enemies = snapshot.units.filter((unit) => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.attackDamage > 0 && sameGround(snapshot.map, unit, base) && distance(unit, base) <= 1_500);
  if (!enemies.length) return [];
  const point = toward(base, averagePoint(enemies), 180);
  const front = troops.filter((unit) => !isBacklineKind(unit));
  const rear = troops.filter(isBacklineKind);
  return [...orders(front, point), ...orders(rear, toward(point, averagePoint(troops), 200))];

  function orders(group: Unit[], goal: { x: number; y: number }): GameCommand[] {
    const ready = group.filter((unit) => {
      const order = unit.order;
      return order.type !== "cast" && order.type !== "charge" && !(order.type === "attack" && enemies.some((enemy) => enemy.id === order.targetId) && distance(unit, base!) <= 850) && !(order.type === "attackMove" && distance(order, goal) < 100);
    });
    return ready.length ? [resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: ready.map((unit) => unit.id), ...goal }, options)] : [];
  }
}
