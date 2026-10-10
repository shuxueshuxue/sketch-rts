import { strikePoint } from '../../shared/combat-geometry';
import { shipWeaponPose } from '../../shared/ship-geometry';
import { unitMover } from '../../shared/catalog';
import { resolveUnitDamage } from '../../shared/damage';
import { weaponDamageProfile } from '../../shared/damage-types';
import { boltIntersection, crewBeforeHulls, weaponDamage } from '../../shared/weapons';
import { clusteredWeaponScore, planAbilityCommandsWithWeaponScore, type WeaponTargetScore } from '../policy/spell-tactics';
import type { AiScript } from '../policy/types';

const scoreWeaponTarget: WeaponTargetScore = (snapshot, caster, def, targets, target) => {
  // The other authored weapon skill is an area shell; a piercing bolt scores its ordered ray instead.
  if (def.weapon.delivery !== 'bolt') return clusteredWeaponScore(snapshot, caster, def, targets, target);
  const pose = shipWeaponPose(caster);
  const from = pose ? pose.muzzle : caster;
  const to = strikePoint(from, target);
  const intersections = targets.map(other => ({ target: other, along: boltIntersection(from, to, other, def.weapon.radius!) }))
    .filter(hit => hit.along !== undefined).sort((a, b) => a.along! - b.along!);
  const eligible = new Set(crewBeforeHulls(intersections.map(hit => hit.target)));
  return intersections.filter(hit => eligible.has(hit.target)).slice(0, def.weapon.maxHits!).reduce((score, { target }, index) => {
    const unit = 'order' in target;
    const damage = weaponDamage(def.weapon, def.damage, !unit, unit && unitMover(target.kind) === 'sea', def.weapon.pierceShare! ** index);
    const taken = unit ? resolveUnitDamage(snapshot, target, damage, weaponDamageProfile(def.weapon)).damage : damage;
    return score + Math.min(target.hp, taken);
  }, 0);
};

export const planBootstrapAbilities: typeof import('../policy/spell-tactics').planAbilityCommands = (snapshot, owner, options) =>
  planAbilityCommandsWithWeaponScore(snapshot, owner, options, scoreWeaponTarget);

export const bootstrapAbilities: AiScript = { id: 'abilities', phase: 'tactics', run: planBootstrapAbilities };
