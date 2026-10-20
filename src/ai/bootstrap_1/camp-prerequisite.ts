import { sameGround } from '../../shared/terrain';
import { unitMover } from '../../shared/catalog';
import type { Unit } from '../../shared/types';
import { activeUnitClaim, recordUnitTaskClaim } from '../policy/claims';
import { distance } from '../policy/spatial';
import type { AiScript, AiPolicyContext } from '../policy/types';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyUnitClaim } from '../memory';
import { creepForce, forceFor } from '../policy/v7/creep';
import { deathTaskIndex } from '../death-ledger-context';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';

type Travel = NonNullable<AiPolicyUnitClaim['campTravel']>;
function recruits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const groups = new Map<string, { travel: Travel; members: Unit[] }>();
  for (const unit of snapshot.units) {
    const travel = options.memory.unitClaims[unit.id]?.campTravel;
    if (unit.owner !== owner || !travel?.clearingIds?.length || unit.hp <= 0) continue;
    const key = travel.clearingIds.join(',');
    const group = groups.get(key) ?? { travel, members: [] }; group.members.push(unit); groups.set(key, group);
  }
  if (!groups.size) return [];
  const tasks = deathTaskIndex(snapshot, owner, options.memory), claimed = new Set<string>();
  const choices: { unit: Unit; travel: Travel; targetId: string }[] = [];
  for (const group of groups.values()) {
    const camp = neutralCampExposure(snapshot).camps.find(camp => camp.memberIds.some(id => group.travel.clearingIds!.includes(id)));
    if (!camp) continue;
    let force = creepForce(group.members, camp.camp);
    const candidates = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unit.attackDamage > 0
      && !unit.deck && !unit.garrison && unitMover(unit.kind) === 'land' && unit.hp >= unit.maxHp * .75
      && sameGround(snapshot.map, unit, camp.camp.center) && !claimed.has(unit.id) && !activeUnitClaim(snapshot, owner, unit, options) && !tasks.byUnit.has(unit.id)
      && ['idle', 'hold'].includes(unit.order.type)).sort((a, b) => distance(a, camp.camp.center) - distance(b, camp.camp.center));
    for (const unit of candidates) {
      if (force >= forceFor(camp.camp)) break;
      force += creepForce([unit], camp.camp); claimed.add(unit.id);
      choices.push({ unit, travel: group.travel, targetId: camp.memberIds[0]! });
    }
  }
  return choices;
}

/** One executor for any retained clear-camp prerequisite. It borrows only free,
 * stationary fighters; defense, expansion, transport and accepted attacks keep theirs.
 * Training demand is consumed by the ordinary doctrine economy.
 */
const selections = new WeakMap<AiPolicyContext, ReturnType<typeof recruits>>();
export const campPrerequisite: AiScript = {
  id: 'campPrerequisite', phase: 'tactics', redirects: 'strategic',
  claimsUnits(snapshot, owner, options) { const choices = recruits(snapshot, owner, options); selections.set(options, choices); return new Set(choices.map(choice => choice.unit.id)); },
  run: (snapshot, owner, options) => (selections.get(options) ?? recruits(snapshot, owner, options)).map(({ unit, travel }) =>
    ({ type: 'move' as const, unitIds: [unit.id], ...travel.stop })),
  afterPlan(snapshot, owner, options, entries) {
    for (const choice of selections.get(options) ?? []) {
      const issued = entries.find(entry => entry.scriptId === 'campPrerequisite' && entry.command.type === 'move' && entry.command.unitIds.includes(choice.unit.id));
      if (!issued || issued.command.type !== 'move') continue;
      recordUnitTaskClaim(snapshot, options.memory, choice.unit.id, { kind: 'creep', targetId: choice.targetId, ...choice.travel.stop });
      options.memory.unitClaims[choice.unit.id]!.campTravel = { ...choice.travel, scriptId: 'campPrerequisite',
        command: { type: 'move', unitIds: [choice.unit.id], ...choice.travel.stop }, sinceTick: snapshot.tick };
    }
  },
};
