import type { GameSnapshot, PlayerId } from "../shared/types";
import type { SoundId } from "./sound";

// @@@sound-cues - What the battlefield sounds like, read from two snapshots in a row: every strike, shot and spell new in
// the later one, the fallen, buildings finished or lost, and the player's own soldiers trained. It reads the snapshots
// the client already has and changes nothing in them, so the simulation is the same heard or not.

export type SoundCue = { id: SoundId; x: number; y: number };

// Who looses an arrow and who a ship's gun; every other ranged attacker throws a bolt.
const ARCHERS = new Set<string>(["archer", "sparkArcher", "contractArcher", "thornSlinger", "defenseTower"]);
const GUNS = new Set<string>(["warship"]);

export function soundCues(before: GameSnapshot, after: GameSnapshot, listener: PlayerId): SoundCue[] {
  if (after.tick <= before.tick) return [];
  const cues: SoundCue[] = [];
  const seen = new Set(before.effects.map((effect) => effect.id));
  const buildingIds = new Set([...before.buildings, ...after.buildings].map((building) => building.id));
  for (const effect of after.effects) {
    if (seen.has(effect.id)) continue;
    const at = { x: effect.x, y: effect.y };
    if (effect.type === "melee") cues.push({ id: "melee", ...at });
    else if (effect.type === "hit" && effect.unitId && buildingIds.has(effect.unitId)) cues.push({ id: "buildingBlow", ...at });
    else if (effect.type === "projectile") {
      // A projectile effect with its shooter's kind is a shot leaving; without it, one landing.
      if (effect.sourceKind) cues.push({ id: GUNS.has(effect.sourceKind) ? "cannonShot" : ARCHERS.has(effect.sourceKind) ? "arrowShot" : "spellBolt", x: effect.fromX ?? effect.x, y: effect.fromY ?? effect.y });
      else cues.push({ id: "arrowHit", ...at });
    } else if (effect.type === "heal") cues.push({ id: "heal", ...at });
    else if (effect.type === "summon") cues.push({ id: "summon", ...at });
    else if (effect.type === "curse" || effect.type === "scorch") cues.push({ id: "curse", ...at });
    else if (effect.type === "chargeTrail") cues.push({ id: "charge", ...at });
    else if (effect.type === "chargeImpact") cues.push({ id: "chargeImpact", ...at });
  }
  // Soldiers aboard a transport are out of the field but not dead (see @@@transport): going aboard is no death, coming
  // ashore no recruit.
  const aboard = (snapshot: GameSnapshot) => snapshot.units.flatMap((unit) => unit.cargo ?? []).map((unit) => unit.id);
  const unitsAfter = new Set([...after.units.map((unit) => unit.id), ...aboard(after)]);
  for (const unit of before.units) if (!unitsAfter.has(unit.id)) cues.push({ id: "death", x: unit.x, y: unit.y });
  const unitsBefore = new Set([...before.units.map((unit) => unit.id), ...aboard(before)]);
  for (const unit of after.units) {
    // A soldier of the listener's own, new on the field and not a summoned spirit: one just trained or hired.
    if (!unitsBefore.has(unit.id) && unit.owner === listener && unit.kind !== "spirit") cues.push({ id: "trained", x: unit.x, y: unit.y });
  }
  const buildingsBefore = new Map(before.buildings.map((building) => [building.id, building]));
  const buildingsAfter = new Set(after.buildings.map((building) => building.id));
  for (const building of after.buildings) {
    const earlier = buildingsBefore.get(building.id);
    if (earlier && !earlier.complete && building.complete && building.owner === listener) cues.push({ id: "built", x: building.x, y: building.y });
  }
  for (const building of before.buildings) if (!buildingsAfter.has(building.id)) cues.push({ id: "buildingDown", x: building.x, y: building.y });
  return cues;
}
