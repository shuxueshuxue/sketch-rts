import { UNIT_DEFS } from "../shared/catalog";
import type { GameSnapshot, PlayerId } from "../shared/types";
import type { SoundEvent } from "./sound";

// @@@sound-cues - What the battlefield sounds like, read from two snapshots in a row: every blow, arrow loosed and shot
// landing new in the later one, the fallen, the listener's buildings finished and any building lost. Nothing else is
// heard: few sounds, each telling something. It reads the snapshots the client already has and changes nothing in them,
// so the simulation is the same heard or not.

export type SoundCue = { id: SoundEvent; x: number; y: number };

// Who looses an arrow; other shooters (casters, ships' guns) are heard only where their shot lands.
const ARCHERS = new Set<string>(["archer", "sparkArcher", "contractArcher", "thornSlinger", "defenseTower"]);

export function soundCues(before: GameSnapshot, after: GameSnapshot, listener: PlayerId): SoundCue[] {
  if (after.tick <= before.tick) return [];
  const cues: SoundCue[] = [];
  const seen = new Set(before.effects.map((effect) => effect.id));
  for (const effect of after.effects) {
    if (seen.has(effect.id)) continue;
    if (effect.type === "melee") cues.push({ id: "melee", x: effect.x, y: effect.y });
    else if (effect.type === "projectile") {
      // A projectile effect with its shooter's kind is a shot leaving; without it, one landing.
      if (!effect.sourceKind) cues.push({ id: "arrowHit", x: effect.x, y: effect.y });
      else if (ARCHERS.has(effect.sourceKind)) cues.push({ id: "arrowShot", x: effect.fromX ?? effect.x, y: effect.fromY ?? effect.y });
    }
  }
  // Soldiers aboard a transport are out of the field but not dead (see @@@transport): going aboard is no death.
  const aboard = (snapshot: GameSnapshot) => snapshot.units.flatMap((unit) => unit.cargo ?? []).map((unit) => unit.id);
  const unitsAfter = new Set([...after.units.map((unit) => unit.id), ...aboard(after)]);
  // A ship goes down with its timbers breaking, as a building falls, not with a cry.
  for (const unit of before.units) if (!unitsAfter.has(unit.id)) cues.push({ id: UNIT_DEFS[unit.kind].naval ? "buildingDown" : "death", x: unit.x, y: unit.y });
  const buildingsBefore = new Map(before.buildings.map((building) => [building.id, building]));
  const buildingsAfter = new Set(after.buildings.map((building) => building.id));
  for (const building of after.buildings) {
    const earlier = buildingsBefore.get(building.id);
    if (earlier && !earlier.complete && building.complete && building.owner === listener) cues.push({ id: "built", x: building.x, y: building.y });
  }
  for (const building of before.buildings) if (!buildingsAfter.has(building.id)) cues.push({ id: "buildingDown", x: building.x, y: building.y });
  return cues;
}
