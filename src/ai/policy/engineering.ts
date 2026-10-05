import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS, requiredSupplyCap } from "../../shared/catalog";
import type { GameSnapshot, PlayerId, TrainableUnitKind } from "../../shared/types";
import { sameGround } from "../../shared/terrain";
import { safeMainBuildPoint } from "./build-layout";
import { isOpponentOwner } from "./ownership";
import type { AiPolicyContext } from "./types";
import type { NavalWant } from "./naval";
import { canSupply } from "./world-model";
/** Pick a support weapon from the opponent's force and defenses, with a bounded share of the army. */
export function engineeringWant(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): NavalWant | undefined {
    const player = snapshot.players[owner]!;
    if (player.supplyCap < requiredSupplyCap("siegeRam"))
        return undefined;
    const own = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== "worker" && !UNIT_DEFS[unit.kind].naval);
    if (own.length < 8)
        return undefined;
    const engines = own.filter(unit => UNIT_DEFS[unit.kind].weapon);
    const queued = snapshot.buildings.filter(building => building.owner === owner).flatMap(building => building.queue).filter(job => UNIT_DEFS[job.unitKind].weapon);
    if (engines.length + queued.length >= Math.max(1, Math.floor(own.length / 5)))
        return undefined;
    const home = snapshot.buildings.find(building => building.owner === owner && building.kind === "townHall");
    if (!home)
        return undefined;
    const foes = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options) && sameGround(snapshot.map, unit, home));
    const towers = snapshot.buildings.filter(building => building.kind === "defenseTower" && isOpponentOwner(snapshot, owner, building.owner, options) && sameGround(snapshot.map, building, home));
    const kind: TrainableUnitKind = towers.length >= 2 ? "catapult" : foes.filter(unit => unit.attackRange > 200).length >= 4 ? "ballista" : foes.length >= 12 ? "organGun" : "siegeRam";
    const workshop = snapshot.buildings.find(building => building.owner === owner && building.kind === "workshop");
    if (!workshop)
        return { id: "engineering:workshop", cost: BUILDING_DEFS.workshop.cost, issue: used => {
                if (used.size || snapshot.units.some(unit => unit.owner === owner && unit.order.type === "build"))
                    return undefined;
                const worker = snapshot.units.find(unit => unit.owner === owner && unit.kind === "worker" && (unit.order.type === "mine" || unit.order.type === "idle") && sameGround(snapshot.map, unit, home));
                if (!worker || !RACE_DEFS[player.race].buildableBuildings.includes("workshop"))
                    return undefined;
                used.add(worker.id);
                return { type: "build", unitId: worker.id, buildingKind: "workshop", ...safeMainBuildPoint(snapshot, owner, 12, "workshop") };
            } };
    return workshop.complete && !workshop.queue.length && canSupply(snapshot, owner, kind)
        ? { id: `engineering:${kind}`, cost: UNIT_DEFS[kind].cost, issue: () => ({ type: "train", buildingId: workshop.id, unitKind: kind }) }
        : undefined;
}
