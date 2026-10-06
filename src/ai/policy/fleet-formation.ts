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
      distance(a, center) - distance(b, center) || a.id.localeCompare(b.id),
  )[0]!;
  if (
    !memory.muster ||
    distance(memory.muster.goal, goal) > 300 ||
    !fleet.some((ship) => ship.id === memory.muster!.leader)
  ) {
    const at = nearestShipPose(snapshot.map, leader, center) ?? leader;
    memory.muster = {
      at: { x: at.x, y: at.y },
      goal: { x: goal.x, y: goal.y },
      leader: leader.id,
      sinceTick: snapshot.tick,
      launched: false,
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
    heading = Math.atan2(goal.y - center.y, goal.x - center.x);
  const beam = Math.max(...fleet.map((ship) => shipProfile(ship)!.beam)) + 70,
    length = Math.max(...fleet.map((ship) => shipProfile(ship)!.length)) + 70;
  fleet.forEach((ship, i) => {
    const side = ((i % 3) - 1) * beam,
      back = Math.floor(i / 3) * length;
    const at = nearestShipPose(snapshot.map, ship, {
      x: anchor.x - Math.sin(heading) * side - Math.cos(heading) * back,
      y: anchor.y + Math.cos(heading) * side - Math.sin(heading) * back,
    });
    if (at) stations.set(ship.id, at);
  });
  return stations;
}
