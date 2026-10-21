import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { distance } from '../policy/spatial';
import { assessAllocatedForce } from './allocated-force';
import type { ActionIntent } from './allocation-types';
import { strategicTargetCamp } from './target-camp';

export const ASSEMBLY_RANGE = 180;
export type ForceAssemblyIntent = Extract<ActionIntent, { kind: 'assemble-force' }>;
type Assessment = Readonly<{ status: 'known'; unitIds: readonly string[]; onStationUnitIds: readonly string[];
  assembledForce: number; requiredForce: number; sufficient: boolean }>
  | Readonly<{ status: 'blocked'; reasonCode: string; unitIds: readonly string[] }>;

/** Present world and supplied authority only. The framework uses this before
 * grant creation to reopen a completed coordinator; the executor uses the same
 * cohort assessment afterward. Forecast recruits never enter this input. */
export function assessForceAssemblyPosts(input: Readonly<{ snapshot: GameSnapshot; owner: PlayerId;
  intent: ForceAssemblyIntent; unitIds: readonly string[]; interruptedUnitIds?: readonly string[] }>): Assessment {
  const { snapshot, owner, intent } = input;
  const blocked = (reasonCode: string, unitIds: readonly string[] = []): Assessment => ({ status: 'blocked', reasonCode, unitIds });
  if (!Number.isFinite(intent.requiredForce) || intent.requiredForce <= 0) return blocked('invalid-force-assembly-requirement');
  if (new Set(intent.posts.map(post => post.id)).size !== intent.posts.length
    || intent.posts.some(post => !post.target.landId)) return blocked('invalid-force-assembly-posts');
  const selected = new Set(input.unitIds), interrupted = new Set(input.interruptedUnitIds ?? []);
  const cohort = snapshot.units.filter(unit => selected.has(unit.id) && unit.owner === owner && unit.hp > 0
    && unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0
    && unit.expiresTick === undefined && !unit.deck && !unit.cabin && !interrupted.has(unit.id));
  const ambiguous = cohort.filter(unit => intent.posts.filter(post => post.unitIds.includes(unit.id)).length !== 1);
  if (ambiguous.length) return blocked('assembly-member-post-ambiguous', ambiguous.map(unit => unit.id).sort());
  const camp = strategicTargetCamp(snapshot, intent.campTarget);
  if (!camp) return blocked('assembly-camp-no-longer-observed');
  const arrived = cohort.filter(unit => {
    const post = intent.posts.find(post => post.unitIds.includes(unit.id))!;
    return sameGround(snapshot.map, unit, post.target.point) && distance(unit, post.target.point) <= ASSEMBLY_RANGE;
  });
  const assessment = assessAllocatedForce(owner, arrived, { metric: 'camp-force', camp, requiredForce: intent.requiredForce });
  return { status: 'known', unitIds: cohort.map(unit => unit.id).sort(), onStationUnitIds: assessment.unitIds,
    assembledForce: assessment.force, requiredForce: assessment.requiredForce, sufficient: assessment.sufficient };
}
