import { nearestShipPose } from "../../shared/ship-navigation";
import { shipProfile } from "../../shared/ship-geometry";
import { sameGround } from "../../shared/terrain";
import { seconds } from "../../shared/time";
import type { GameSnapshot, Unit } from "../../shared/types";
import type { NavalPlanMemory } from "../memory";
import { distance, type Point } from "./spatial";
export function fleetStations(
  snapshot: GameSnapshot,
  ships: Unit[],
  goal: Point | undefined,
  memory: NavalPlanMemory,
): Map<string, Point> {
  const stations = new Map<string, Point>();
  if (!goal || ships.length < 3) {
    delete memory.muster;
    return stations;
  }
  const fleet = ships.filter((ship) =>
    sameGround(snapshot.map, ship, goal, "sea"),
  );
  if (fleet.length < 3) return stations;
  const center = {
    x: fleet.reduce((s, ship) => s + ship.x, 0) / fleet.length,
    y: fleet.reduce((s, ship) => s + ship.y, 0) / fleet.length,
  };
  const leader = [...fleet].sort(
    (a, b) =>
      b.maxHp - a.maxHp || distance(a, center) - distance(b, center) || a.id.localeCompare(b.id),
  )[0]!;
  if (
    !memory.muster ||
    distance(memory.muster.goal, goal) > 300 ||
    !fleet.some((ship) => ship.id === memory.muster!.leader)
  ) {
    const at = nearestShipPose(snapshot.map, leader, leader) ?? leader;
    memory.muster = {
      at: { x: at.x, y: at.y },
      goal: { x: goal.x, y: goal.y },
      leader: leader.id,
      sinceTick: snapshot.tick,
      launched: false,
      heading: Math.atan2(goal.y - at.y, goal.x - at.x),
    };
  }
  const muster = memory.muster;
  if (
    fleet.filter((ship) => distance(ship, muster.at) < 450).length /
      fleet.length >=
      0.75 ||
    snapshot.tick - muster.sinceTick > seconds(30)
  )
    muster.launched = true;
  const anchor = muster.launched ? goal : muster.at,
    heading = muster.heading ??= Math.atan2(goal.y - muster.at.y, goal.x - muster.at.x);
  const beam = Math.max(...fleet.map((ship) => shipProfile(ship)!.beam)) + 70,
    length = Math.max(...fleet.map((ship) => shipProfile(ship)!.length)) + 70;
  // The flagship leads down the middle. Stable slots survive snapshot list
  // reordering and retain their course as the center of the fleet advances.
  const ordered = [...fleet].sort((a, b) => Number(b.id === muster.leader) - Number(a.id === muster.leader) || a.id.localeCompare(b.id));
  ordered.forEach((ship, i) => {
    const side = [0, -1, 1][i % 3]! * beam,
      back = Math.floor(i / 3) * length;
    const at = nearestShipPose(snapshot.map, ship, {
      x: anchor.x - Math.sin(heading) * side - Math.cos(heading) * back,
      y: anchor.y + Math.cos(heading) * side - Math.sin(heading) * back,
    });
    if (at) stations.set(ship.id, at);
  });
  return stations;
}
