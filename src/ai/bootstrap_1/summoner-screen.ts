import { casterMeleeMicro } from './caster-screen';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { sameGround } from '../../shared/terrain';
import { averagePoint, distance, type Point } from '../policy/spatial';
import { units } from '../policy/snapshot';
import type { AiPolicyContext } from '../policy/types';
import { isBacklineKind, planCasterScreen, v6CasterPost } from '../policy/v6/backline';
import { readV6Intel } from '../policy/v6/intel';
import { v6Memory } from '../policy/v6/memory';
import { SUMMONING_UNIT_KINDS } from '../policy/versions';
import { summonHost } from './summon-host';
import { v6AssaultStagePoint } from '../policy/v6/general';

function advancingScreen(front: Unit[], center: Point, target: Point) {
  const toward = { x: target.x - center.x, y: target.y - center.y };
  return front.filter(unit => unit.attackRange <= 80
    && (unit.x - center.x) * toward.x + (unit.y - center.y) * toward.y > 0);
}

/** A defended tower keeps the host together between summon waves at the contested mine. */
export function planSummonerScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const intel = readV6Intel(snapshot, owner, options), general = v6Memory(options).general;
  const front = intel.army.filter(unit => !isBacklineKind(unit));
  const casters = intel.army.filter(unit => SUMMONING_UNIT_KINDS.has(unit.kind));
  const backline = units(snapshot, owner).filter(isBacklineKind);
  const abandoned = intel.enemies.flatMap(enemy => enemy.buildings);
  // Unarmed buildings without surviving enemy units need demolition, not a spirit screen.
  if (abandoned.length > 0 && abandoned.every(building => building.attackDamage === 0)
    && intel.enemies.every(enemy => enemy.army.length === 0 && enemy.workers.length === 0)) {
    const demolition = casters.filter(unit => !unit.deck && unit.order.type !== 'board');
    const reachable = abandoned.filter(building => demolition.some(unit => sameGround(snapshot.map, unit, building)));
    if (reachable.length > 0) {
      const center = averagePoint(demolition);
      const target = reachable.reduce((nearest, building) => distance(center, building) < distance(center, nearest) ? building : nearest);
      return [{ type: 'attack' as const, unitIds: demolition.filter(unit => sameGround(snapshot.map, unit, target)).map(unit => unit.id), targetId: target.id }];
    }
  }
  const micro = casterMeleeMicro(snapshot, owner, options);
  const screenRoles = (post: Point, screen: Unit[]) => [
    ...planCasterScreen(snapshot, owner, options, intel.home, post, screen,
      backline.filter(unit => SUMMONING_UNIT_KINDS.has(unit.kind)), false, true, micro),
    ...planCasterScreen(snapshot, owner, options, intel.home, post, screen,
      backline.filter(unit => !SUMMONING_UNIT_KINDS.has(unit.kind)), true, true, micro),
  ];
  if (general?.mode === 'attack' && general.stage === 'gather' && general.target && general.group && casters.length >= 4) {
    const group = new Set(general.group), marching = front.filter(unit => group.has(unit.id));
    const gathering = casters.filter(unit => group.has(unit.id));
    if (marching.length > 0 && gathering.length >= 4) {
      const host = summonHost(gathering, undefined);
      const screen = advancingScreen(marching, averagePoint(host), general.target);
      return [
        ...planCasterScreen(snapshot, owner, options, intel.home, v6AssaultStagePoint(general.target, averagePoint(marching)),
          screen, gathering, false, true, micro),
        ...planCasterScreen(snapshot, owner, options, intel.home, v6CasterPost(general, intel.home), front,
          backline.filter(unit => !SUMMONING_UNIT_KINDS.has(unit.kind)), true, true, micro),
        ...planCasterScreen(snapshot, owner, options, intel.home, v6CasterPost(general, intel.home), front,
          backline.filter(unit => SUMMONING_UNIT_KINDS.has(unit.kind) && !group.has(unit.id)), false, true, micro),
      ];
    }
  }
  if (general?.mode === 'attack' && general.target && !general.quick && general.stage !== 'gather' && casters.length >= 4) {
    const host = summonHost(casters, undefined);
    if (host.length >= 4) {
      const center = averagePoint(host);
      // A rear gun or a fresh summon behind the host is not its advancing screen.
      const screen = advancingScreen(front, center, general.target);
      return screenRoles(center, screen);
    }
  }
  const foes = intel.enemies.flatMap(enemy => enemy.army);
  const tower = general?.mode === 'defend' && general.target
    ? intel.ownTowers.filter(tower => distance(tower, general.target!) <= tower.attackRange
      && foes.some(foe => distance(foe, tower) <= tower.attackRange))
      .sort((a, b) => distance(a, general.target!) - distance(b, general.target!))[0]
    : undefined;
  return screenRoles(tower ?? v6CasterPost(general, intel.home), front);
}
