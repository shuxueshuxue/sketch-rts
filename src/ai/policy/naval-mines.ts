import { combatCapability } from '../../shared/combat-capabilities';
import { isTransportKind } from '../../shared/transport-role';
import { walkingDistance } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, ResourceNode } from '../../shared/types';
import { isEnemyOwner } from './ownership';
import { distance } from './spatial';
import type { AiPolicyContext } from './types';
import { effectiveCombatRating, structureRating } from './v6/strength';

type MineCoast = { mine: ResourceNode; landing: { x: number; y: number }; departure: { x: number; y: number } };

/** Uncontested income first; compare actual sea roads from the fleet and its reachable departure coast. */
export function chooseNavalMine(snapshot: GameSnapshot, owner: PlayerId, candidates: MineCoast[], options: AiPolicyContext) {
  const fleet = snapshot.units.filter(unit => unit.owner === owner && isTransportKind(unit.kind) && unit.hp > 0);
  const threats = [
    ...snapshot.units.filter(unit => unit.hp > 0 && isEnemyOwner(snapshot, owner, unit.owner, options)
      && combatCapability(snapshot, unit).armed).map(unit => ({ body: unit, rating: effectiveCombatRating(snapshot, unit) })),
    ...snapshot.buildings.filter(building => building.hp > 0 && building.attackDamage > 0
      && isEnemyOwner(snapshot, owner, building.owner, options)).map(building => ({ body: building, rating: structureRating(building) })),
  ];
  return candidates.map(candidate => {
    // Every landing asks about the same small fleet/departure set. Build
    // fields at those origins; the unweighted 5/7 sea distance is symmetric.
    let origin: { x: number; y: number } | undefined, shortest = Infinity;
    for (const point of [...fleet, candidate.departure]) {
      const distance = walkingDistance(snapshot.map, candidate.landing, point, 'sea');
      if (distance !== undefined && distance < shortest) { origin = point; shortest = distance; }
    }
    const road = origin ? shortest : walkingDistance(snapshot.map, origin!, candidate.landing, 'sea')!;
    const threat = threats.filter(({ body }) => distance(body, candidate.mine) < 400)
      .reduce((score, { rating }) => score + rating, 0);
    return { candidate, threat, road };
  }).sort((a, b) => a.threat - b.threat || a.road - b.road)[0]?.candidate;
}
