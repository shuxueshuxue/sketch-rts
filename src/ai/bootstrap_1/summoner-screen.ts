import type { GameSnapshot, PlayerId } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { planCasterScreen, v6CasterPost } from '../policy/v6/backline';
import { readV6Intel } from '../policy/v6/intel';
import { v6Memory } from '../policy/v6/memory';

/** A defended tower keeps the host together between summon waves at the contested mine. */
export function planSummonerScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const intel = readV6Intel(snapshot, owner, options), general = v6Memory(options).general;
  const foes = intel.enemies.flatMap(enemy => enemy.army);
  const tower = general?.mode === 'defend' && general.target
    ? intel.ownTowers.filter(tower => distance(tower, general.target!) <= tower.attackRange
      && foes.some(foe => distance(foe, tower) <= tower.attackRange))
      .sort((a, b) => distance(a, general.target!) - distance(b, general.target!))[0]
    : undefined;
  return planCasterScreen(snapshot, owner, options, intel.home, tower ?? v6CasterPost(general, intel.home));
}
