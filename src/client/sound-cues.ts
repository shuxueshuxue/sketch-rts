import { UNIT_DEFS } from "../shared/catalog";
import { RANGED_ATTACK_RANGE_THRESHOLD } from "../shared/sim";
import type { GameSnapshot, PlayerId, UnitKind, WorldEffect } from "../shared/types";
import type { SoundEvent } from "./sound";

// @@@sound-cues - What the battlefield sounds like, read from two snapshots in a row: every weapon blow new in the later
// one (a melee striker's blow with the striker's kind, an arrow's landing), every arrow loosed, the fallen, buildings
// raised, the listener's buildings finished and any building lost. A pack sounds the ones it has (see @@@sound). It
// reads the snapshots the client already has and changes nothing in them, so the simulation is the same heard or not.

export type SoundCue = { id: SoundEvent; x: number; y: number; kind?: UnitKind };

// Who looses arrows: the bowmen and the defense tower. Casters' bolts, dragons' fire and ships' guns are not arrows.
const ARCHERS = new Set<string>(["archer", "sparkArcher", "contractArcher", "horseArcher", "thornSlinger", "murlocHunter", "defenseTower"]);

export function soundCues(before: GameSnapshot, after: GameSnapshot, listener: PlayerId): SoundCue[] {
  if (after.tick <= before.tick) return [];
  const cues: SoundCue[] = [];
  const seen = new Set(before.effects.map((effect) => effect.id));
  for (const effect of after.effects) {
    if (seen.has(effect.id) || !effect.sourceKind) continue;
    const at = { x: effect.x, y: effect.y };
    // A projectile effect carrying its shooter is the shot leaving; a hit carries whose weapon dealt it.
    if (["board", "unload"].includes(effect.type)) { if (effect.owner === listener) cues.push({ id: effect.type as "board" | "unload", ...at, kind: effect.sourceKind as UnitKind }); }
    else if (["heal", "summon", "curse", "stomp", "web", "bloodlust"].includes(effect.type)) cues.push({ id: "spell", ...at, kind: effect.sourceKind as UnitKind });
    else if (effect.sourceKind in UNIT_DEFS && UNIT_DEFS[effect.sourceKind as UnitKind].naval && ["projectile", "grapeshot", "siegeBolt", "shellFlight"].includes(effect.type)) cues.push({ id: "shipShot", x: effect.fromX ?? effect.x, y: effect.fromY ?? effect.y, kind: effect.sourceKind as UnitKind });
    else if (effect.sourceKind in UNIT_DEFS && UNIT_DEFS[effect.sourceKind as UnitKind].naval && effect.type === "hit") cues.push({ id: "shipHit", ...at, kind: effect.sourceKind as UnitKind });
    else if (effect.type === "projectile" && ARCHERS.has(effect.sourceKind)) cues.push({ id: "arrowShot", x: effect.fromX ?? effect.x, y: effect.fromY ?? effect.y });
    else if (effect.type === "hit" && ARCHERS.has(effect.sourceKind)) cues.push({ id: "arrowHit", ...at });
    else if (effect.type === "hit" && meleeStriker(effect.sourceKind)) cues.push({ id: "melee", ...at, kind: effect.sourceKind });
    else if (effect.type === "hit") cues.push({ id: "impact", ...at });
  }
  // Old cargo snapshots also preserve living passenger IDs; live deck crew stay in units.
  const aboard = (snapshot: GameSnapshot) => snapshot.units.flatMap((unit) => unit.cargo ?? []).map((unit) => unit.id);
  const unitsAfter = new Set([...after.units.map((unit) => unit.id), ...aboard(after)]);
  // A ship goes down with its timbers breaking, as a building falls, not with a cry.
  for (const unit of before.units) if (!unitsAfter.has(unit.id)) cues.push({ id: UNIT_DEFS[unit.kind].naval ? "shipSink" : "death", x: unit.x, y: unit.y, kind: unit.kind });
  const buildingsBefore = new Map(before.buildings.map((building) => [building.id, building]));
  const buildingsAfter = new Set(after.buildings.map((building) => building.id));
  for (const building of after.buildings) {
    const earlier = buildingsBefore.get(building.id);
    if (!earlier) cues.push({ id: "construction", x: building.x, y: building.y });
    else if (!earlier.complete && building.complete && building.owner === listener) cues.push({ id: "built", x: building.x, y: building.y });
  }
  for (const building of before.buildings) if (!buildingsAfter.has(building.id)) cues.push({ id: "buildingDown", x: building.x, y: building.y });
  return cues;
}

function meleeStriker(kind: NonNullable<WorldEffect["sourceKind"]>): kind is UnitKind {
  return kind in UNIT_DEFS && UNIT_DEFS[kind as UnitKind].attackRange <= RANGED_ATTACK_RANGE_THRESHOLD;
}
