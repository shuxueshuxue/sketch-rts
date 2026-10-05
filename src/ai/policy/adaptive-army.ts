import { UNIT_DEFS, unitMover } from "../../shared/catalog";
import { sameGround } from "../../shared/terrain";
import type { GameSnapshot, PlayerId } from "../../shared/types";
import { isOpponentOwner } from "./ownership";
import type { AiPolicyContext } from "./types";
import type { V6Want } from "./v6/doctrine";
import { isV7Policy, isV8Policy } from "./versions";

// Bounded support roles supplement the version's doctrine; there is no quota to buy one of every unit.
export function adaptiveArmyWants(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): V6Want[] {
  if (!isV7Policy(options)) return [];
  const army = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== "worker" && unitMover(unit.kind) === "land" && unit.expiresTick === undefined);
  if (army.length < 6) return [];
  const bases = snapshot.buildings.filter(building => building.owner === owner && building.kind === "townHall");
  const foes = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options) && unit.kind !== "worker" && unitMover(unit.kind) === "land" && bases.some(base => sameGround(snapshot.map, base, unit)));
  const melee = foes.filter(unit => unit.attackRange <= 100).length;
  const cavalry = foes.filter(unit => UNIT_DEFS[unit.kind].abilities.includes("charge")).length;
  const backline = foes.filter(unit => unit.attackRange > 100 || UNIT_DEFS[unit.kind].weapon).length;
  const supports = army.filter(unit => unit.attackRange > 100).length;
  const count = Math.min(2, Math.max(1, Math.floor(army.length / 8)));
  const wants: V6Want[] = [];
  if (snapshot.players[owner]!.race === "grove") {
    if (cavalry >= 3) wants.push({ unit: "lancer", count: Math.min(4, cavalry), priority: 74 });
    if (supports >= 3 && (melee >= 3 || army.length >= 10)) wants.push({ unit: "golem", count, priority: 68 });
    if (!isV8Policy(options) && melee >= 4 && melee >= foes.length * .6) wants.push({ unit: "horseArcher", count, priority: 66 });
  } else {
    if (supports >= 2 || backline >= 3) wants.push({ unit: "ashWarden", count, priority: 69 });
    if (backline >= 3) wants.push({ unit: "cinderRunner", count, priority: 67 });
  }
  return wants;
}
