import { ABILITY_DEFS, UNIT_DEFS, healingBuildingKindForRace, isHealingBuildingKind } from "../../../shared/catalog";
import type { BuildingKind, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { buildings, units } from "../snapshot";
import { averagePoint, distance, type Point } from "../spatial";
import type { V6Intel } from "../v6/intel";

// @@@v8-well - Before its healers come (tier two, about 7:00), nothing heals V8's army: clearing the natural's camp alone
// costs it a median 165 health by 3:00 (500 games), and every fight after starts from there. So while V8 has no healer and
// its fighters miss V8_WELL_WOUNDS health, it raises its race's well (moon well, ember shrine: 5 health to the most
// wounded soldier every 1.5 s) at its rally, where the army stands between fights. By hand, a shrine there with the army
// waiting beside it until whole flipped wispQuarry ember (0 of 5 nudged replays won from 2:55, 5 of 5 with it); as a rule
// the waiting cost V8 more than it healed (6129 of 8000 nudged tune games against 6301: V5 expanded meanwhile), and the
// well alone, the army going about its business, won 6466 against 6301, 6368 against 6267 on 40 unseen seeds and 1615
// against 1582 of 2000 on the final seeds.
export const V8_WELL_WOUNDS = 150;
// From home toward the enemy halls: the general's rally (RALLY_STEP).
const WELL_STEP = 380;

export function v8WellPoint(intel: V6Intel): Point {
  const enemies = intel.enemies.flatMap((enemy) => enemy.bases.map((base) => base.hall));
  if (enemies.length === 0) return intel.home;
  const toward = averagePoint(enemies);
  const gap = distance(intel.home, toward);
  return gap < 1 ? intel.home : { x: intel.home.x + ((toward.x - intel.home.x) / gap) * WELL_STEP, y: intel.home.y + ((toward.y - intel.home.y) / gap) * WELL_STEP };
}

function isHealer(unit: Unit) {
  return UNIT_DEFS[unit.kind].abilities.some((ability) => ABILITY_DEFS[ability].behavior === "heal");
}

// The well V8 should raise now, if any.
export function v8WantsWell(snapshot: GameSnapshot, owner: PlayerId): BuildingKind | undefined {
  const race = snapshot.players[owner]?.race;
  if (!race || buildings(snapshot, owner).some((building) => isHealingBuildingKind(building.kind))) return undefined;
  const own = units(snapshot, owner);
  if (own.some(isHealer)) return undefined;
  const wounds = own.filter((unit) => unit.kind !== "worker" && unit.attackDamage > 0 && unit.expiresTick === undefined).reduce((total, unit) => total + unit.maxHp - unit.hp, 0);
  return wounds >= V8_WELL_WOUNDS ? healingBuildingKindForRace(race) : undefined;
}
