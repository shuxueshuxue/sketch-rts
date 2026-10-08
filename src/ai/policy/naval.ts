import { miningHallSite } from "../../shared/mining-site";
import { GOLD_MINE_RULES } from '../../shared/mining';
import { localToWorld, shipPassengers, shipProfile } from "../../shared/ship-geometry";
import {combatCapability} from '../../shared/combat-capabilities';
import {navalServices} from './naval-services';
import {fleetStations} from './fleet-formation';
import { clearTransferLanes } from './transfer-lanes';
import { convoyCanCarry } from './convoy-load';
import { nearestShipPose } from "../../shared/ship-navigation";
import { SHIP_WEAPONS, installedWeapons, isShipEquipment, shipMounts, shipNeedsRepair } from "../../shared/ship-equipment";
import { canEquip, canExchange, freeItemSlot, itemsFor, transferRefusal } from "../../shared/equipment";
import { deckPlacement } from "../../shared/decks";
import type { NavalPlanMemory } from "../memory";
import { bodyMass } from "../../shared/physical-body";
import { boardUnit } from "../../shared/decks";
import { isBuildPlacementClear } from "../../shared/build-placement";
import { BUILDING_DEFS, UNIT_DEFS, requiredSupplyCap, unitMover } from "../../shared/catalog";
import { canReach, carries, boardingBerth } from "../../shared/naval";
import { purchasePlacement } from "../../shared/purchase";
import { footprintHalf, groundWholes, isWalkable, sameGround, shoreSpots, walkableGoal, walkingDistance } from "../../shared/terrain";
import { seconds } from "../../shared/time";
import type { Building, GameCommand, GameSnapshot, PlayerId, ResourceNode, TrainableUnitKind, Unit } from "../../shared/types";
import { legalBuildPointNear } from "./build-layout";
import { shipsAfloat } from "./ground";
import { isEnemyOwner, isOpponentOwner } from "./ownership";
import { buildings, units } from "./snapshot";
import { distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { attackMargin } from "./v6/general";
import { engagementTargets } from "./engagements";
import { readV6Intel } from "./v6/intel";
import { TOWER_STRENGTH, effectiveCombatRating, strengthOf } from "./v6/strength";
import { canSupply, playerState } from "./world-model";
function ferryCapacity(unit:Unit){return unit.kind==="transport" || unit.kind==="carrier" ? carries(unit) : 0;}

type Point = {
    x: number;
    y: number;
};
// @@@ai-naval - Shared naval economy, combat, colonization and evacuation.
// Plans use terrain connectivity, living workers, mines and opposing forces.
// No policy reads a map identifier, seed, scripted capture point or faction starting coordinate.
// Ships and boarding crews are claimed here so land tactics cannot interrupt transport.
const WARSHIPS = 2;
const OUTFIT_RESERVE=200;
// Enemy ships this near an own hall or the shipyard are met.
const HOME_WATERS = 900;
// A shipyard stands no nearer a hall than this, off its workers' way to the mine.
const HALL_BERTH = 160;
// How many cells out from a landing a ship looks for open water to wait on.
const OFFSHORE_STEPS = 8;
// A shipyard stands this much farther off an enemy warship than its guns reach.
const GUN_MARGIN = 100;
// A target this near an enemy tower is the tower's to cover: towers are the coast's strongest defense, and a warship that
// comes within their range loses.
const TOWER_COVER = BUILDING_DEFS.defenseTower.attackRange;
// A warship below this share of its health keeps out of the raid.
const HURT = 0.4;
type IslandPlan = {
    mine: ResourceNode;
    landing: Point;
};
type RaidPlan = {
    water: Point;
};
type AssaultPlan = {
    target: Building;
    landing: Point;
};
// What the water asks to be bought next, one thing at a time: a shipyard, then the warships, then (for an island) a
// transport, and once workers stand on the island its hall. The gold is the economy's to find: V6 takes it as one of its
// goals and saves for it (see v6/economy navalGoals); the shared library's economy (V5) buys it when it can (planNavalEconomy).
// `issue` takes the workers already given a building this think, and adds the one it gives this one.
// `closeout`: the assault is all there is left to fight (no opponent's hall stands on the army's ground), so it comes
// before more bases (see v6/economy navalGoals).
export type NavalWant = {
    id: string;
    cost: number;
    issue: (builders: Set<string>) => GameCommand | undefined;
    closeout?: true;
};
/** Keep a colony's hall and, near mine depletion, a replacement ferry funded. */
export function navalBudgetReserve(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): number {
    if (!snapshot.map.terrain || groundWholes(snapshot.map) <= 1)
        return 0;
    const halls = buildings(snapshot, owner).filter(building => building.kind === "townHall");
    const home = halls[0];
    if (!home || !units(snapshot, owner).some(unit => unit.kind === "worker"))
        return 0;
    // Defense and restoring the supply line take precedence over saving for a future overseas colony.
    if (snapshot.units.some(unit => unit.kind !== "worker" && combatCapability(snapshot,unit).armed && isOpponentOwner(snapshot, owner, unit.owner, options)
        && halls.some(hall => sameGround(snapshot.map, hall, unit) && distance(hall, unit) < 700))) return 0;
    const remote = snapshot.resources.filter(mine => mine.amount > 0 && !sameGround(snapshot.map, mine, home)
        && !halls.some(hall => distance(hall, mine) < GOLD_MINE_RULES.baseRange));
    if (!remote.length)
        return 0;
    const settling = Object.values(options.memory?.naval?.ferries ?? {}).some(mission => mission.purpose === "settle" && mission.phase !== "return"
        && remote.some(mine => mine.id === mission.targetId));
    const remaining = snapshot.resources.filter(mine => mine.amount > 0 && halls.some(hall => distance(hall, mine) < GOLD_MINE_RULES.baseRange)).reduce((sum, mine) => sum + mine.amount, 0);
    const pendingHall = units(snapshot, owner).some(unit => unit.order.type === "build" && unit.order.buildingKind === "townHall");
    const approachingDepletion = remaining < 2500 && !localExpansionAvailable(snapshot, owner, options);
    return ((settling || approachingDepletion) && !pendingHall ? BUILDING_DEFS.townHall.cost : 0)
        + (approachingDepletion && !units(snapshot, owner).some(unit => ferryCapacity(unit) > 0) ? UNIT_DEFS.transport.cost : 0);
}
// The transport, population prerequisite and hall can use their own reserved
// funds; unrelated purchases preserve the colony budget.
export const navalReservePurchase = (id: string) => ["naval:islandHall", "naval:transport", "naval:shipyard", "naval:population"].includes(id);
export function navalWant(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): NavalWant | undefined {
    const outfit = outfitting(snapshot, owner, options);
    if (outfit && !outfit.itemId && playerState(snapshot, owner).gold >= SHIP_WEAPONS[outfit.kind].cost + navalBudgetReserve(snapshot, owner, options) + OUTFIT_RESERVE) {
        const dock = buildings(snapshot,owner).find(building => building.kind === 'shipyard' && building.complete);
        if (dock && "placement" in purchasePlacement(snapshot,owner,dock,outfit.kind,outfit.shipId)) return {id:'naval:gun',cost:SHIP_WEAPONS[outfit.kind].cost,issue:()=>({type:'buyShipEquipment',buildingId:dock.id,item:outfit.kind,recipientId:outfit.shipId})};
    }
    const foothold = footholdWant(snapshot, owner);
    if (foothold)
        return { ...foothold, closeout: true };
    const threat = enemyShipsNear(snapshot, owner, options);
    if (!threat.length && groundWholes(snapshot.map) > 1 && localExpansionAvailable(snapshot, owner, options)) return localExpansionWant(snapshot, owner, options);
    const assault = assaultPlan(snapshot, owner, options);
    const halls = buildings(snapshot, owner).filter((building) => building.kind === "townHall" && building.complete);
    if (!halls.length)
        return undefined;
    const plan = islandPlan(snapshot, owner, options);
    const water = assault?.landing ?? plan?.landing ?? raidPlan(snapshot, owner, options)?.water ?? threat[0];
    if (!water)
        return undefined;
    const home = halls[0];
    const closeout = Boolean(assault && home && lastFight(snapshot, owner, options, home));
    const want = navalStep(snapshot, owner, options, plan ? undefined : assault, plan, plan?.landing ?? water, halls);
    return want && closeout ? { ...want, closeout: true } : want;
}
/** A beachhead produces and defends locally instead of waiting indefinitely for the original mainland army. */
function footholdWant(snapshot: GameSnapshot, owner: PlayerId): NavalWant | undefined {
    const halls = buildings(snapshot, owner).filter(building => building.kind === "townHall" && building.complete);
    const home = halls[0];
    if (!home)
        return undefined;
    for (const hall of halls.filter(hall => !sameGround(snapshot.map, hall, home))) {
        const workers = units(snapshot, owner).filter(unit => unit.kind === "worker" && sameGround(snapshot.map, unit, hall) && (unit.order.type === "mine" || unit.order.type === "idle"));
        const posts = buildings(snapshot, owner).filter(building => sameGround(snapshot.map, building, hall));
        const race = snapshot.players[owner]!.race;
        const kind = race === "grove" ? "barracks" : "emberForge";
        const producer = posts.find(building => building.kind === kind);
        if (!producer && workers.length)
            return { id: "naval:footholdProducer", cost: BUILDING_DEFS[kind].cost, issue: used => {
                    if (used.size || units(snapshot, owner).some(unit => unit.order.type === "build"))
                        return undefined;
                    const site = legalBuildPointNear(snapshot, kind, { x: hall.x + 180, y: hall.y + 100 });
                    if (!sameGround(snapshot.map, site, hall) || !isBuildPlacementClear(snapshot, kind, site))
                        return undefined;
                    used.add(workers[0]!.id);
                    return { type: "build", unitId: workers[0]!.id, buildingKind: kind, ...site };
                } };
        const army = units(snapshot, owner).filter(unit => unit.kind !== "worker" && unitMover(unit.kind) === "land" && sameGround(snapshot.map, unit, hall));
        const troop = race === "grove" ? "footman" : "emberRavager";
        if (producer?.complete && !producer.queue.length && army.length < 8 && canSupply(snapshot, owner, troop))
            return { id: "naval:footholdArmy", cost: UNIT_DEFS[troop].cost, issue: () => ({ type: "train", buildingId: producer.id, unitKind: troop }) };
        if (!posts.some(building => building.kind === "defenseTower" && distance(building, hall) < 450) && workers.length)
            return { id: "naval:footholdTower", cost: BUILDING_DEFS.defenseTower.cost, issue: used => {
                    if (used.size || units(snapshot, owner).some(unit => unit.order.type === "build"))
                        return undefined;
                    const site = legalBuildPointNear(snapshot, "defenseTower", { x: hall.x - 160, y: hall.y + 110 });
                    if (!sameGround(snapshot.map, site, hall) || !isBuildPlacementClear(snapshot, "defenseTower", site))
                        return undefined;
                    used.add(workers[0]!.id);
                    return { type: "build", unitId: workers[0]!.id, buildingKind: "defenseTower", ...site };
                } };
    }
    return undefined;
}
// The water's next step for navalWant: a shipyard (or the coast tower it waits on), a ship, an island's hall.
function navalStep(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, assault: AssaultPlan | undefined, plan: IslandPlan | undefined, water: Point, halls: Building[]): NavalWant | undefined {
    if (plan && !islandHallOf(snapshot, owner, plan) && !snapshot.units.some(unit => unit.owner === "neutral" && distance(unit, plan.mine) < 300)) {
        const builder = units(snapshot, owner).find(unit => unit.kind === "worker" && !unit.deck && unit.order.type !== 'build' && sameGround(snapshot.map, unit, plan.mine));
        const site = builder && hallSite(snapshot, plan.mine);
        if (builder && site)
            return { id: "naval:islandHall", cost: BUILDING_DEFS.townHall.cost, issue: used => {
                    if (used.has(builder.id) || builder.order.type === 'build')
                        return undefined;
                    used.add(builder.id);
                    return { type: "build", unitId: builder.id, buildingKind: "townHall", ...site };
                } };
    }
    const engineers = units(snapshot, owner).filter(unit => unit.kind === "worker");
    if ((plan || assault) && engineers.length < 6) {
        const hall = halls.find(hall => hall.complete && !hall.queue.length);
        if (hall && canSupply(snapshot, owner, "worker"))
            return { id: "naval:engineer", cost: UNIT_DEFS.worker.cost, issue: () => ({ type: "train", buildingId: hall.id, unitKind: "worker" }) };
    }
    const yard = shipyardOf(snapshot, owner, water);
    if (!yard && !shoreSpot(snapshot, owner, water, options)) {
        // Every shore of the water under an enemy ship's guns: a tower that outshoots the nearest of them first (see
        // @@@coast-tower), one at a time, from the hall nearest the shore by walking: asked again while the first still
        // rose, one AI laid three on a shore 1500 off but 4500 to walk, and none went up (pool-elderwood-4 at 2a189fd).
        if (buildings(snapshot, owner).some((building) => building.kind === "defenseTower" && !building.complete))
            return undefined;
        const site = shoreSpot(snapshot, owner, water, options, true);
        const hall = site && nearestByWalk(snapshot, halls, site);
        const gun = site && nearestOf(snapshot.units.filter((unit) => unitMover(unit.kind) === "sea" && combatCapability(snapshot,unit).armed && isEnemyOwner(snapshot, owner, unit.owner, options)), site);
        const workers = units(snapshot, owner).filter((unit) => unit.kind === "worker" && (unit.order.type === "mine" || unit.order.type === "idle"));
        return hall && gun ? coastTower(snapshot, hall, gun, workers, site) : undefined;
    }
    if (!yard) {
        return {
            id: "naval:shipyard",
            cost: BUILDING_DEFS.shipyard.cost,
            issue: (builders) => {
                if (builders.size || units(snapshot, owner).some(unit => unit.order.type === "build"))
                    return undefined;
                const spot = shoreSpot(snapshot, owner, water, options);
                const builder = spot && nearestWorker(snapshot, owner, spot, builders);
                if (!spot || !builder)
                    return undefined;
                builders.add(builder.id);
                return { type: "build", unitId: builder.id, buildingKind: "shipyard", x: spot.x, y: spot.y };
            },
        };
    }
    const fleet = units(snapshot, owner);
    const armed = fleet.filter(unit => unitMover(unit.kind) === "sea" && combatCapability(snapshot,unit).armed && sameGround(snapshot.map, unit, water, "sea"));
    const warships = armed.length;
    // A transport on other water serves nothing here (one from an island's ferry sat on its own lake through an assault).
    const transported = fleet.some((unit) => ferryCapacity(unit) > 0 && sameGround(snapshot.map, unit, water, "sea"));
    const convoy = fleet.filter(unit => ferryCapacity(unit) > 0 && sameGround(snapshot.map, unit, water, "sea"));
    const held = outgunned(snapshot, owner, options, water);
    // @@@blockade - Water the enemy's ships hold is crossed by no transport: in the closeout the fleet grows past its escort
    // until it outweighs them (see outgunned) and strikes together (see planNavalTactics), and in any other assault nothing
    // is bought for it. Crossing all the same, one transport after another went down with the soldiers aboard, and the
    // last base an island's ships guarded stood to the end (the 1v3 bench's 500 games at eb943a6: V9's transports sunk
    // 220, soldiers drowned 414, games unfinished 115 against 87).
    const nearTowers = enemyTowers(snapshot, owner, options).some(tower => distance(tower, water) < 1100) || Boolean(assault && distance(assault.target, water) - assault.target.radius > UNIT_DEFS.warship.attackRange);
    const enemyFleet = snapshot.units.filter(unit => unitMover(unit.kind) === "sea" && combatCapability(snapshot,unit).armed && isOpponentOwner(snapshot, owner, unit.owner, options) && sameGround(snapshot.map, unit, water, "sea") && distance(unit,water)<1800);
    const advanced = playerState(snapshot, owner).supplyCap >= requiredSupplyCap("bombardShip");
    // An army larger than a single ferry must cross together. Waiting for a safe landing with one full boat while the
    // rest stands ashore is a deadlock; buy enough lift once the whole expedition can win the landing.
    const waiting = assault ? fleet.filter(unit => !unit.deck && unitMover(unit.kind) === "land" && unit.kind !== "worker" && !unit.expiresTick && !sameGround(snapshot.map, unit, assault.target)) : [];
    const passengers = convoy.flatMap(unit => shipPassengers(snapshot.units,unit));
    const crossing = [...waiting, ...passengers];
    const defense = assault ? landingDefense(snapshot, owner, options, assault.landing) : 0;
    const committedAssault = assault && convoy.some(unit => navalMemory(options).ferries?.[unit.id]?.purpose === "assault" && navalMemory(options).ferries?.[unit.id]?.targetId === assault.target.id);
    const moreLift = assault && (!plan || committedAssault) && transported && crossing.reduce((n, unit) => n + effectiveCombatRating(snapshot,unit), 0) >= defense * 1.4
        && !convoyCanCarry(snapshot, convoy, crossing);
    const guardedIsland = plan && snapshot.units.filter(unit => unit.owner === "neutral" && distance(unit, plan.mine) < 600).reduce((n, unit) => n + effectiveCombatRating(snapshot,unit), 0) > 3;
    const activeBases=halls.filter(hall=>snapshot.resources.some(mine=>mine.amount>0&&distance(mine,hall)<GOLD_MINE_RULES.baseRange)).length;
    const fleetTarget=Math.min(8,Math.max(WARSHIPS,activeBases>2?activeBases+1:WARSHIPS,enemyFleet.length+1));
    const ship: TrainableUnitKind | undefined = held
        ? (warships < Math.max(6,fleetTarget) ? "warship" : undefined)
        : !transported && (plan || assault) ? "transport"
            : moreLift ? (advanced ? "carrier" : "transport")
            : advanced && guardedIsland && !fleet.some(unit => unit.kind === "carrier" && sameGround(snapshot.map, unit, water, "sea")) ? "carrier"
            : warships < fleetTarget ? "warship"
                : advanced && nearTowers && !armed.some(unit => unit.kind === "bombardShip") ? "bombardShip"
                    : enemyFleet.length >= 3 && !armed.some(unit => unit.kind === "fireShip") ? "fireShip"
                        : warships >= 2 && !fleet.some(unit => unit.kind === "cutter") ? "cutter"
                            : advanced && assault && !fleet.some(unit => unit.kind === "carrier") && fleet.filter(unit => unitMover(unit.kind) === "land" && unit.kind !== "worker").length > 10 ? "carrier"
                                : undefined;
    if (ship && yard.complete && yard.queue.length === 0) {
        if (canSupply(snapshot, owner, ship))
            return { id: `naval:${ship}`, cost: UNIT_DEFS[ship].cost, issue: () => ({ type: "train", buildingId: yard.id, unitKind: ship }) };
        // Naval production owns its supply prerequisite too. A full land army
        // otherwise leaves the reserved expedition budget permanently unused.
        const farmPending = buildings(snapshot, owner).some(building => building.kind === "farm" && !building.complete)
            || units(snapshot, owner).some(unit => unit.order.type === "build" && unit.order.buildingKind === "farm");
        const builder = units(snapshot, owner).find(unit => unit.kind === "worker" && !unit.deck && (unit.order.type === "mine" || unit.order.type === "idle") && sameGround(snapshot.map, unit, halls[0]!));
        const site = builder && legalBuildPointNear(snapshot, "farm", { x: halls[0]!.x + 170, y: halls[0]!.y - 130 });
        if (!farmPending && builder && site && isBuildPlacementClear(snapshot, "farm", site))
            return { id: "naval:population", cost: BUILDING_DEFS.farm.cost, issue: used => {
                if (used.has(builder.id)) return undefined;
                used.add(builder.id);
                return { type: "build", unitId: builder.id, buildingKind: "farm", ...site };
            } };
    }
    if (!plan || islandHallOf(snapshot, owner, plan))
        return undefined;
    const islanders = units(snapshot, owner).filter((unit) => unit.kind === "worker" && sameGround(snapshot.map, unit, plan.mine));
    if (islanders.length === 0 || snapshot.units.some(unit => unit.owner === "neutral" && distance(unit, plan.mine) < 300))
        return undefined;
    return {
        id: "naval:islandHall",
        cost: BUILDING_DEFS.townHall.cost,
        issue: (builders) => {
            if (builders.size || units(snapshot, owner).some(unit => unit.order.type === "build"))
                return undefined;
            const builder = islanders.find((worker) => !builders.has(worker.id));
            const site = builder && hallSite(snapshot, plan.mine);
            if (!builder || !site)
                return undefined;
            builders.add(builder.id);
            return { type: "build", unitId: builder.id, buildingKind: "townHall", x: site.x, y: site.y };
        },
    };
}
// Read the current working battery, including extra and damaged guns.
// Expected purchases never count as an escort already on the water.
function navalStrength(snapshot:GameSnapshot,ships:Unit[]){
    return ships.reduce((sum,ship)=>sum+effectiveCombatRating(snapshot,ship),0);
}
function outgunned(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, water: Point) {
    const afloat = (unit: Unit) => unitMover(unit.kind) === "sea" && combatCapability(snapshot,unit).armed && sameGround(snapshot.map, unit, water, "sea");
    const theirs = snapshot.units.filter((unit) => afloat(unit) && distance(unit, water) < 900 && isEnemyOwner(snapshot, owner, unit.owner, options));
    if (theirs.length === 0)
        return false;
    const ours = units(snapshot, owner).filter(afloat);
    // The escort must exist before a ferry crosses. Future purchases cannot
    // contribute fighting power to the current blockade decision.
    return navalStrength(snapshot,theirs) * attackMargin(options) > navalStrength(snapshot,ours) + strengthOf(ours.flatMap(ship => shipPassengers(snapshot.units, ship)));
}
// The shared library's economy script: the water's next want, when the gold is there.
export function planNavalEconomy(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand | undefined {
    const want = navalWant(snapshot, owner, options);
    const reserve = want && !navalReservePurchase(want.id) ? navalBudgetReserve(snapshot, owner, options) : 0;
    return want && playerState(snapshot, owner).gold - reserve >= want.cost ? want.issue(new Set()) : undefined;
}
/** Fleet combat and ferry ownership are independent of the map generator. */
export function planNavalTactics(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
    const own = units(snapshot, owner);
    const plan = islandPlan(snapshot, owner, options);
    const assault = assaultPlan(snapshot, owner, options);
    const outfit = outfitting(snapshot, owner, options);
    const services=navalServices(snapshot,owner,options);
    const commands: GameCommand[] = [...clearTransferLanes(snapshot,owner),...services.commands];
    if (outfit && !services.reserved.has(outfit.shipId)) commands.push(...outfitCommands(snapshot, owner, outfit));
    const harbor = buildings(snapshot, owner).find(building => building.kind === "shipyard");
    const foes = [...snapshot.units, ...snapshot.buildings].filter(target => isEnemyOwner(snapshot, owner, target.owner, options));
    const convoy = own.filter(unit => ferryCapacity(unit) > 0 && shipPassengers(snapshot.units,unit).length);
    const fighters=own.filter(unit=>shipProfile(unit)&&combatCapability(snapshot,unit).armed&&!services.reserved.has(unit.id)&&unit.id!==outfit?.shipId);
    const escortShips = fighters.filter(unit => unit.kind !== "bombardShip");
    const escorts = new Map<string, Unit>();
    // Assign each gun to the least protected nearby loaded ferry instead of sending the whole fleet after a coastal farm.
    for (const ship of escortShips) {
        const boat = [...convoy].filter(boat => sameGround(snapshot.map, ship, boat, "sea") && distance(ship, boat) < 1800 && [...escorts.values()].filter(escorted=>escorted.id===boat.id).length<2)
            .sort((a,b) => [...escorts.values()].filter(boat => boat.id === a.id).length - [...escorts.values()].filter(boat => boat.id === b.id).length || distance(ship,a)-distance(ship,b))[0];
        if (boat) escorts.set(ship.id, boat);
    }
    const assigned = new Set<string>();
    const fleetGoal=assault?offshore(snapshot,assault.landing,assault.target):plan?offshore(snapshot,plan.landing,plan.mine):raidPlan(snapshot,owner,options)?.water;
    const stations=fleetStations(snapshot,fighters.filter(ship=>!escorts.has(ship.id)&&ship.hp>=ship.maxHp*HURT),fleetGoal,navalMemory(options));
    for (const ship of fighters) {
        const waiting = own.filter(unit => unit.order.type === "board" && unit.order.transportId === ship.id);
        const aboard = shipPassengers(snapshot.units, ship);
        const safe = !foes.some(foe => combatCapability(snapshot,foe).armed && distance(foe, ship) < 600);
        // Recruit only near home in safe water, retaining a land guard. Healing
        // and ranged fire on deck use the same orders/autocast as on land.
        if (harbor && safe && distance(ship, harbor) < 650 && aboard.length + waiting.length < 2) {
            const candidates = own.filter(unit => !unit.deck && !assigned.has(unit.id) && unit.order.type !== "board"
                && (unit.order.type === "idle" || unit.order.type === "hold") && unitMover(unit.kind) === "land"
                && unit.kind !== "worker" && !unit.expiresTick && distance(unit, harbor) < 600);
            const reserve = own.filter(unit => !unit.deck && unit.kind !== "worker" && unitMover(unit.kind) === "land" && unit.order.type !== "board").length - 2;
            const reserved = [...snapshot.units];
            for (const unit of waiting) { const copy = { ...unit }; if (boardUnit(ship, copy, reserved)) reserved.push(copy); }
            const recruits = candidates.sort((a,b) => Number(UNIT_DEFS[b.kind].abilities.includes("heal")) - Number(UNIT_DEFS[a.kind].abilities.includes("heal")) || distance(a,ship)-distance(b,ship)).filter(unit => {
                if (reserved.filter(unit => unit.deck?.shipId === ship.id).length >= 2 || assigned.size >= reserve) return false;
                const copy = { ...unit }; if (!boardUnit(ship, copy, reserved)) return false;
                reserved.push(copy); assigned.add(unit.id); return true;
            });
            if (recruits.length) { commands.push({ type: "board", unitIds: recruits.map(unit=>unit.id), transportId: ship.id }); continue; }
        }
        if (waiting.length && safe) { if (ship.order.type !== "idle") commands.push({type:"stop",unitIds:[ship.id]}); continue; }
        const local = foes.filter(target => canReach(snapshot.map, ship, target, snapshot.units, combatCapability(snapshot,ship).range) && distance(ship, target) < Math.max(900, combatCapability(snapshot,ship).range + 150));
        const danger = local.filter(target => "order" in target && combatCapability(snapshot,target).armed);
        const home = harbor && walkableGoal(snapshot.map, harbor.x, harbor.y, "sea");
        if (ship.hp < ship.maxHp * HURT && home && distance(ship, home) > 250) {
            if (needsMove(ship, home))
                commands.push({ type: "move", unitIds: [ship.id], ...home, avoidCombat:true });
            continue;
        }
        // Ordinary guns avoid tower coverage; bombard vessels counter the coast from outside it.
        const targets = local.filter(target => ship.kind === "bombardShip" || !covered(target, enemyTowers(snapshot, owner, options)))
            .sort((a, b) => (ship.kind === "bombardShip" ? Number("order" in a) - Number("order" in b) : Number(!("order" in a)) - Number(!("order" in b))) || distance(a, ship) - distance(b, ship));
        const boat = escorts.get(ship.id);
        const mission = boat ? navalMemory(options).ferries?.[boat.id] : undefined;
        // While loading, clear and cover the landing coast. At sea, accompany the boat. On return, cover its retreat.
        const station = boat ? mission?.phase === "loading" ? offshore(snapshot, mission.to, foes.find(target => target.id === mission.targetId) ?? mission.to) : boat
            : stations.get(ship.id) ?? fleetGoal ?? home;
        const attackers = boat ? danger.filter(target => "order" in target && (distance(target, boat) < combatCapability(snapshot,target).range + 160 || target.order.type === "attack" && target.order.targetId === boat.id)) : [];
        const gathering=stations.has(ship.id)&&!navalMemory(options).muster?.launched;
        const target = nearestOf(attackers, boat ?? ship) ?? nearestOf(danger.filter(target => "order" in target && unitMover(target.kind) === "sea" && (!gathering || distance(ship,target)<combatCapability(snapshot,ship).range+100) && (!boat || distance(target,boat)<700 || station && distance(target,station)<700)), ship) ?? (!gathering && (!boat || station && distance(ship,station)<250) ? targets.filter(target=>!boat || station && distance(target,station)<450)[0] : undefined);
        // The planner chooses the engagement area; mechanical attack-move
        // chooses and revises threats between planning frames. A player's
        // explicit attack command continues to retain its chosen target.
        if (target && (ship.order.type !== "attackMove" || distance(ship.order,target)>80))
            commands.push({ type: "attackMove", unitIds: [ship.id], x:target.x, y:target.y });
        else if (!target) {
            // A convoy follows a formation beside the ferry, never its center.
            // Continuing an old move to the ferry's center jammed the decks
            // together even after the escort was already within 200 units.
            const companions = boat ? [...escorts].filter(([, escorted]) => escorted.id === boat.id).map(([id]) => id) : [];
            const index = companions.indexOf(ship.id);
            const spacing = boat ? (shipProfile(boat)!.length + shipProfile(ship)!.length) / 2 + 60 : 0;
            const angle = (boat?.sailing?.heading ?? 0) + (index % 2 ? -1 : 1) * Math.PI / 2;
            const destination = boat && station === boat
                ? nearestShipPose(snapshot.map, ship, { x: boat.x + Math.cos(angle) * spacing, y: boat.y + Math.sin(angle) * spacing })
                : station;
            if (destination && distance(ship, destination) > (boat ? 70 : 200) && needsMove(ship, destination))
                commands.push({ type: "move", unitIds: [ship.id], x: destination.x, y: destination.y });
        }
    }
    // Landed troops clear the landing, attack enemies on their component, and protect engineers establishing a base.
    const home = buildings(snapshot, owner).find(building => building.kind === "townHall");
    const expedition = own.filter(unit => !unit.deck && unitMover(unit.kind) === "land" && unit.kind !== "worker" && home && !sameGround(snapshot.map, unit, home) && unit.order.type !== "board");
    const handled = new Set<string>();
    const interventions = engagementTargets(snapshot, owner, options);
    for (const troop of expedition) {
        const target = interventions.get(troop.id);
        if (target && (troop.order.type !== "attackMove" || distance(troop.order,target)>80)) commands.push({ type:"attackMove",unitIds:[troop.id],x:target.x,y:target.y });
    }
    for (const anchor of expedition) {
        if (handled.has(anchor.id)) continue;
        const troops = expedition.filter(unit => sameGround(snapshot.map, unit, anchor));
        for (const unit of troops) handled.add(unit.id);
        const center = { x: troops.reduce((n,u)=>n+u.x,0)/troops.length, y:troops.reduce((n,u)=>n+u.y,0)/troops.length };
        const power = troops.reduce((n,u)=>n+effectiveCombatRating(snapshot,u),0);
        const localFoes = foes.filter(target => sameGround(snapshot.map, anchor, target));
        const canFight = (point: Point) => {
            const defense = localFoes.filter(target => distance(target,point)<400).reduce((n,target)=>n+("order" in target ? effectiveCombatRating(snapshot,target) : target.attackDamage>0 ? TOWER_STRENGTH : 0),0);
            return power >= defense * 1.35;
        };
        const mine = snapshot.resources.filter(mine => mine.amount>0 && sameGround(snapshot.map,anchor,mine)
            && !buildings(snapshot,owner).some(hall=>hall.kind==="townHall" && distance(hall,mine)<GOLD_MINE_RULES.baseRange)
            && localFoes.some(target=>distance(target,mine)<400) && canFight(mine)).sort((a,b)=>distance(center,a)-distance(center,b))[0];
        const target = mine ?? localFoes.filter(target => canFight(target)).sort((a,b)=>distance(center,a)-distance(center,b))[0];
        if (!target) continue;
        const ready = troops.filter(unit=>unit.order.type!=="cast" && unit.order.type!=="attack" && (unit.order.type!=="attackMove" || distance(unit.order,target)>80));
        if (ready.length) commands.push({type:"attackMove",unitIds:ready.map(unit=>unit.id),x:target.x,y:target.y});
    }
    for (const transport of own.filter(unit => ferryCapacity(unit) > 0 && unit.id !== outfit?.shipId && !services.reserved.has(unit.id)))
        commands.push(...ferryCommands(snapshot, owner, options, transport, plan, assault));
    for (const worker of own.filter(unit => unit.deck && unit.kind === "worker" && unit.order.type === "idle")) {
        const hull = own.find(ship => ship.id === worker.deck!.shipId);
        if (hull && shipNeedsRepair(snapshot,hull) && playerState(snapshot, owner).gold > 50)
            commands.push({ type: "repairShip", unitIds: [worker.id], targetId: hull.id });
    }
    return commands;
}
export function navalUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
    const outfit = outfitting(snapshot,owner,options);
    const claimed = new Set<string>(navalServices(snapshot,owner,options).reserved);
    for(const command of clearTransferLanes(snapshot,owner))if('unitIds' in command)for(const id of command.unitIds)claimed.add(id);
    if (outfit) { if(outfit.workerId)claimed.add(outfit.workerId); claimed.add(outfit.shipId); }
    if (groundWholes(snapshot.map) <= 1 && !shipsAfloat(snapshot))
        return claimed;
    const home = buildings(snapshot, owner).find(building => building.kind === "townHall");
    const ferries = navalMemory(options).ferries ?? {};
    for (const id of Object.keys(ferries))
        if (!snapshot.units.some(unit => unit.id === id && unit.owner === owner))
            delete ferries[id];
    for (const unit of units(snapshot, owner)) {
        const landed = home && unitMover(unit.kind) === "land" && unit.kind !== "worker" && !sameGround(snapshot.map, unit, home);
        if (unitMover(unit.kind) === "sea" || unit.deck || unit.order.type === "board" || landed || Object.values(ferries).some(ferry => ferry.crewIds.includes(unit.id)))
            claimed.add(unit.id);
    }
    return claimed;
}
function ferryCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit, island: IslandPlan | undefined, assault: AssaultPlan | undefined): GameCommand[] {
    const memory = navalMemory(options);
    const ferries = (memory.ferries ??= {});
    let mission = ferries[boat.id];
    const own = units(snapshot, owner), map = snapshot.map;
    const halls = buildings(snapshot, owner).filter(building => building.kind === "townHall" && building.complete);
    if (!halls.length)
        return [];
    if ((memory.ferryRetryUntil?.[boat.id] ?? 0) > snapshot.tick) return [];
    if (!mission) {
        const evacuation = evacuationRoute(snapshot, owner, options, boat, halls);
        const rich = snapshot.resources.filter(mine => mine.amount > 0 && halls.some(hall => distance(hall, mine) < GOLD_MINE_RULES.baseRange)
            && own.filter(unit => !unit.deck && unit.order.type === 'mine' && unit.order.resourceId === mine.id).length < GOLD_MINE_RULES.workstations);
        // Deck engineers already have a job. Treating them as stranded miners
        // created empty ferry trips to a warship that could never be loaded.
        const dryWorkers = own.filter(unit => !unit.deck && unit.kind === "worker" && unit.order.type === "idle"
            && !rich.some(mine => sameGround(map, mine, unit))
            && !(playerState(snapshot,owner).gold >= BUILDING_DEFS.townHall.cost && snapshot.resources.some(mine=>mine.amount>0 && sameGround(map,mine,unit))));
        const relocation = dryWorkers.flatMap(worker => rich.map(mine => ({ worker, mine, from: coastOnWater(snapshot, worker, boat), to: coastOnWater(snapshot, mine, boat) })))
            .filter(route => route.from && route.to && !sameGround(map, route.worker, route.mine))
            .sort((a, b) => distance(a.worker, boat) - distance(b.worker, boat))[0];
        const target = evacuation?.hall ?? relocation?.mine ?? island?.mine ?? assault?.target;
        if (!target)
            return [];
        const sources = [...halls, ...own.filter(unit => !unit.deck && unitMover(unit.kind) === "land" && unit.kind !== "worker" && unit.expiresTick === undefined)];
        const candidates = sources.filter(point => !sameGround(map, point, target) && coastOnWater(snapshot, point, boat));
        const readiness = (point: Point) => own.filter(unit => !unit.deck && sameGround(map, unit, point) && unitMover(unit.kind) === "land" && (island ? unit.kind === "worker" : unit.kind !== "worker")).reduce((n, unit) => n + bodyMass(unit), 0);
        const base = evacuation?.source ?? relocation?.worker ?? candidates.sort((a, b) => Math.min(24, readiness(b)) - Math.min(24, readiness(a)) || (distance(a, boat) + distance(a, target)) - (distance(b, boat) + distance(b, target)))[0];
        if (!base)
            return [];
        const shore = evacuation?.from ?? relocation?.from ?? coastOnWater(snapshot, base, boat);
        const landing = evacuation?.to ?? relocation?.to ?? coastOnWater(snapshot, target, boat);
        if (!shore || !landing)
            return [];
        mission = ferries[boat.id] = { purpose: evacuation ? "evacuate" : relocation ? "rebase" : island ? "settle" : "assault", targetId: target.id, from: shore, to: landing, phase: "loading", crewIds: [], sinceTick: snapshot.tick };
    }
    const aboardIds=shipPassengers(snapshot.units,boat).map(unit=>unit.id).join('|'), progress=mission.progress;
    if(!progress || progress.phase!==mission.phase || progress.crew!==aboardIds || distance(boat,progress)>32)
        mission.progress={tick:snapshot.tick,x:boat.x,y:boat.y,phase:mission.phase,crew:aboardIds};
    else if(snapshot.tick-progress.tick>seconds(40)){
        (memory.ferryRetryUntil ??= {})[boat.id]=snapshot.tick+seconds(20);
        if(mission.phase==='return' && !aboardIds){delete ferries[boat.id];return [{type:'stop',unitIds:[boat.id]}];}
        mission.progress={tick:snapshot.tick,x:boat.x,y:boat.y,phase:'return',crew:aboardIds};
        return cancelFerry(snapshot,boat,mission,options);
    }
    // A cancelled trip keeps its passengers and sends them ashore at the departure coast.
    if (mission.phase === "return") {
        if (shipPassengers(snapshot.units,boat).length) return boat.order.type === "unload" && distance(boat.order, mission.from) < 80 ? [] : [{ type: "unload", unitIds: [boat.id], ...mission.from, avoidCombat:true }];
        // An empty ferry can be dispatched from its actual location. Returning
        // to a stale departure coast wastes minutes and can jam a new convoy.
        delete ferries[boat.id];
        return [];
    }
    if (mission.purpose === "settle") {
        const mine = snapshot.resources.find(resource => resource.id === mission!.targetId);
        const held = mine && snapshot.buildings.find(building => distance(building, mine) < 400 && isOpponentOwner(snapshot, owner, building.owner, options));
        if (held) {
            // Settlers are not an invasion force. Re-evaluate a real assault
            // after returning the workers, rather than landing them at a hall.
            return cancelFerry(snapshot,boat,mission,options);
        }
    }
    if (mission.purpose === "settle") {
        const mine = snapshot.resources.find(resource => resource.id === mission!.targetId);
        if (!mine || mine.amount <= 0 || !island || buildings(snapshot, owner).some(building => building.kind === "townHall" && distance(building, mine) < GOLD_MINE_RULES.baseRange)) {
            return cancelFerry(snapshot, boat, mission, options);
        }
    }
    const target = mission.purpose === "assault" || mission.purpose === "evacuate" ? snapshot.buildings.find(building => building.id === mission!.targetId) : snapshot.resources.find(resource => resource.id === mission!.targetId);
    if (!target) {
        return cancelFerry(snapshot, boat, mission, options);
    }
    const commands: GameCommand[] = [];
    if (mission.phase === "sailing") {
        if (!shipPassengers(snapshot.units,boat).length) {
            mission.phase = "return";
            mission.crewIds = [];
            return commands;
        }
        if ((mission.purpose === "assault" || mission.purpose === "settle") && !landingSafe(snapshot, owner, options, boat, mission.purpose === "assault" ? mission.to : target)) return cancelFerry(snapshot, boat, mission, options);
        if (boat.order.type !== "unload")
            commands.push({ type: "unload", unitIds: [boat.id], ...mission.to });
        return commands;
    }
    const waiting = own.filter(unit => unit.order.type === "board" && unit.order.transportId === boat.id);
    if (distance(boat, mission.from) > 100 && !shipPassengers(snapshot.units,boat).length && !waiting.length) {
        if (needsMove(boat, mission.from))
            commands.push({ type: "move", unitIds: [boat.id], ...mission.from, avoidCombat:true });
        return commands;
    }
    if (mission.purpose === "settle" && shipPassengers(snapshot.units,boat).length && !shipPassengers(snapshot.units,boat).some(unit => unit.kind === "worker") && shipPassengers(snapshot.units,boat).reduce((n, unit) => n + bodyMass(unit), 0) >= ferryCapacity(boat) - 1) {
        return [{ type: "unload", unitIds: [boat.id], ...mission.from, avoidCombat:true }];
    }
    const boarding = own.filter(unit => unit.order.type === "board" && unit.order.transportId === boat.id);
    const cargo = shipPassengers(snapshot.units,boat);
    const attached = new Set([...cargo, ...boarding].map(unit => unit.id));
    mission.crewIds = mission.crewIds.filter(id => attached.has(id));
    let room = ferryCapacity(boat) - [...cargo, ...boarding].reduce((n, unit) => n + bodyMass(unit), 0);
    const loadGround = walkableGoal(map, mission.from.x, mission.from.y);
    const workers = own.filter(unit => !unit.deck && !attached.has(unit.id) && unit.kind === "worker" && sameGround(map, unit, loadGround) && (unit.order.type === "mine" || unit.order.type === "idle"));
    const crew: Unit[] = [];
    const workerCount = [...cargo, ...boarding].filter(unit => unit.kind === "worker").length;
    const reserveMiners = snapshot.resources.some(mine => mine.amount > 0 && sameGround(map, mine, loadGround) && halls.some(hall => distance(hall, mine) < GOLD_MINE_RULES.baseRange)) ? 3 : 0;
    if (mission.purpose === "evacuate")
        crew.push(...own.filter(unit => !unit.deck && unit.kind === "worker" && sameGround(map, unit, loadGround) && !attached.has(unit.id) && unit.order.type !== "board").slice(0, Math.min(2, Math.floor(room / 75))));
    else if (mission.purpose === "rebase")
        crew.push(...workers.slice(0, Math.max(0, Math.floor(room / 75))));
    else if (mission.purpose === "settle" && workerCount < 2 && workers.length > reserveMiners)
        crew.push(...workers.slice(0, Math.min(2 - workerCount, workers.length - reserveMiners, Math.floor(room / 75))));
    else if (mission.purpose === "assault" && !workerCount && workers.length >= 6 && room > 0)
        crew.push(workers[0]!);
    room -= crew.reduce((mass, unit) => mass + bodyMass(unit), 0);
    // Reserve payload for the expedition's engineers; geometric reservations below also leave actual floor space.
    if (mission.purpose === "settle")
        room -= 75 * Math.max(0, 2 - workerCount - crew.filter(unit => unit.kind === "worker").length);
    const soldiers = own.filter(unit => !unit.deck && unit.kind !== "worker" && unitMover(unit.kind) === "land" && !unit.expiresTick && !attached.has(unit.id) && sameGround(map, unit, loadGround) && unit.order.type !== "board" && unit.order.type !== "cast").sort((a, b) => distance(a, boat) - distance(b, boat));
    // Load engineers first. Reserving only their weight did not reserve floor
    // space: nearby infantry filled the deck before distant workers arrived.
    const engineersAboard=cargo.filter(unit=>unit.kind==='worker').length;
    const engineersReady=mission.purpose!=='settle' || engineersAboard>=2
        || engineersAboard>=1 && (workerCount<2 || snapshot.tick-mission.progress!.tick>seconds(20));
    const threats = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options) && sameGround(map, unit, loadGround) && combatCapability(snapshot,unit).armed);
    let strengthLeft = strengthOf(soldiers);
    for (const soldier of mission.purpose === "rebase" || !engineersReady ? [] : soldiers) {
        if (bodyMass(soldier) > room || (mission.purpose !== "evacuate" && strengthLeft - unitStrengthForFerry(soldier) < strengthOf(threats) * 1.3))
            continue;
        crew.push(soldier);
        room -= bodyMass(soldier);
        strengthLeft -= unitStrengthForFerry(soldier);
    }
    if (crew.length) {
        const reserved=[...snapshot.units];
        for(const waiting of boarding){const copy={...waiting};if(boardUnit(boat,copy,reserved))reserved.push(copy);}
        const fitting=crew.filter(passenger=>{const copy={...passenger};if(!boardUnit(boat,copy,reserved))return false;reserved.push(copy);return true;});
        crew.splice(0,crew.length,...fitting);
        mission.crewIds.push(...crew.map(unit => unit.id));
        if (crew.length) commands.push({ type: "board", unitIds: crew.map(unit => unit.id), transportId: boat.id });
        if (boat.order.type === "move") commands.push({ type: "stop", unitIds: [boat.id] });
    }
    const hasWorkers = cargo.some(unit => unit.kind === "worker");
    const hasSoldiers = cargo.some(unit => unit.kind !== "worker");
    const guardsRemain = target && snapshot.units.some(unit => unit.owner === "neutral" && distance(unit, target) < 400);
    // Do not repeatedly drown the economy in a blockade the escort has yet to clear.
    if (outgunned(snapshot, owner, options, mission.to))
        return commands;
    if ((mission.purpose === "settle" || mission.purpose === "assault") && !landingSafe(snapshot, owner, options, boat, mission.purpose === "assault" ? mission.to : target)) {
        if (cargo.length && snapshot.tick - mission.sinceTick > seconds(120)) return cancelFerry(snapshot, boat, mission, options);
        return commands;
    }
    if (boarding.length && cargo.length && snapshot.tick - mission.progress!.tick > seconds(20) && (mission.purpose !== "settle" || hasWorkers) && (mission.purpose === "rebase" || hasSoldiers || !guardsRemain)) {
        mission.phase = "sailing";
        mission.crewIds = [];
        return [{ type: "stop", unitIds: boarding.map(unit => unit.id) }, { type: "unload", unitIds: [boat.id], ...mission.to }];
    }
    if (cargo.length && !boarding.length && !crew.length && (mission.purpose !== "settle" || hasWorkers) && (mission.purpose === "rebase" || hasSoldiers || (target && !snapshot.units.some(unit => unit.owner === "neutral" && distance(unit, target) < 400)))) {
        mission.phase = "sailing";
        mission.crewIds = [];
        commands.push({ type: "unload", unitIds: [boat.id], ...mission.to });
    }
    return commands;
}
function unitStrengthForFerry(unit: Unit) { return strengthOf([unit]); }

function cancelFerry(snapshot: GameSnapshot, boat: Unit, mission: NonNullable<NonNullable<AiPolicyContext["memory"]["naval"]>["ferries"]>[string], options: AiPolicyContext): GameCommand[] {
    const boarding = snapshot.units.filter(unit => unit.order.type === "board" && unit.order.transportId === boat.id);
    mission.phase = "return";
    mission.crewIds = [];
    const memory = navalMemory(options);
    // A failed expedition re-evaluates available mines after returning instead
    // of retrying the same guarded shore forever. An expedition already sailing
    // retains its objective; this cannot reroute a live convoy mid-crossing.
    if (mission.purpose === "settle" && memory.island?.plan?.mineId === mission.targetId
        && !Object.entries(memory.ferries ?? {}).some(([id, other]) => id !== boat.id && other.targetId === mission.targetId && other.phase === "sailing"))
        delete memory.island;
    return [
        ...(boarding.length ? [{ type: "stop" as const, unitIds: boarding.map(unit => unit.id) }] : []),
        ...(shipPassengers(snapshot.units,boat).length ? [{ type: "unload" as const, unitIds: [boat.id], ...mission.from, avoidCombat:true }] : []),
    ];
}

function evacuationRoute(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit, halls: Building[]) {
    if (shipPassengers(snapshot.units,boat).length) return undefined;
    const own = units(snapshot, owner).filter(unit => unitMover(unit.kind) === "land" && !unit.expiresTick && unit.order.type !== "board");
    const enemies = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options) && combatCapability(snapshot,unit).armed && unitMover(unit.kind) === "land");
    const home = halls[0]!;
    for (const source of own.filter(unit => !sameGround(snapshot.map, unit, home))) {
        const local = own.filter(unit => sameGround(snapshot.map, source, unit) && distance(source, unit) < 850);
        const threat = enemies.filter(unit => sameGround(snapshot.map, source, unit) && distance(source, unit) < 700);
        if (!threat.length || strengthOf(threat) < strengthOf(local) * 1.4) continue;
        const from = coastOnWater(snapshot, source, boat);
        if (!from) continue;
        const destination = halls.filter(hall => !sameGround(snapshot.map, hall, source) && !enemies.some(unit => sameGround(snapshot.map, unit, hall) && distance(unit, hall) < 700))
            .map(hall => ({ hall, to: coastOnWater(snapshot, hall, boat) })).find(entry => entry.to);
        if (destination?.to) return { source, from, hall: destination.hall, to: destination.to };
    }
    return undefined;
}

function landingSafe(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit, target: Point) {
    const guards = snapshot.units.filter(unit => combatCapability(snapshot,unit).armed && distance(unit, target) < 400 && sameGround(snapshot.map, unit, target)
        && (unit.owner === "neutral" || isOpponentOwner(snapshot, owner, unit.owner, options)));
    const defenders = landingDefense(snapshot, owner, options, target);
    if (!defenders) return true;
    const landed = units(snapshot, owner).filter(unit => unitMover(unit.kind) === "land" && sameGround(snapshot.map, unit, target) && distance(unit, target) < 700);
    const support = units(snapshot, owner).filter(unit => unitMover(unit.kind) === "sea" && combatCapability(snapshot,unit).armed
        && guards.some(guard => distance(unit, guard) <= combatCapability(snapshot,unit).range + guard.radius && canReach(snapshot.map, unit, guard, snapshot.units, combatCapability(snapshot,unit).range)));
    const convoy = units(snapshot, owner).filter(unit => ferryCapacity(unit) > 0 && sameGround(snapshot.map, unit, boat, "sea")
        && navalMemory(options).ferries?.[unit.id]?.targetId === navalMemory(options).ferries?.[boat.id]?.targetId);
    return [...convoy.flatMap(unit => shipPassengers(snapshot.units,unit)), ...landed, ...support].reduce((n, unit) => n + effectiveCombatRating(snapshot,unit), 0) >= defenders * 1.4;
}

function landingDefense(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, target: Point) {
    const guards = snapshot.units.filter(unit => combatCapability(snapshot,unit).armed && distance(unit, target) < 400 && sameGround(snapshot.map, unit, target)
        && (unit.owner === "neutral" || isOpponentOwner(snapshot, owner, unit.owner, options)));
    const towers = enemyTowers(snapshot, owner, options).filter(tower => sameGround(snapshot.map, tower, target) && distance(tower, target) < 600);
    return guards.reduce((n, unit) => n + effectiveCombatRating(snapshot,unit), 0) + towers.length * TOWER_STRENGTH;
}

/** A clear, reachable land mine is cheaper than a new overseas economy. */
function localExpansionAvailable(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
    const halls = buildings(snapshot, owner).filter(hall => hall.kind === "townHall" && hall.complete);
    return snapshot.resources.some(mine => mine.amount > 0 && halls.some(hall => sameGround(snapshot.map, hall, mine))
        && !halls.some(hall => distance(hall, mine) < GOLD_MINE_RULES.baseRange)
        && !snapshot.buildings.some(hall => hall.kind === "townHall" && distance(hall, mine) < 400 && isOpponentOwner(snapshot, owner, hall.owner, options))
        && !snapshot.units.some(unit => combatCapability(snapshot,unit).armed && distance(unit, mine) < 400 && isOpponentOwner(snapshot, owner, unit.owner, options))
        && !snapshot.units.some(unit => unit.owner === "neutral" && sameGround(snapshot.map, unit, mine) && distance(unit, mine) < 400));
}
/** Let an established colony expand on its own land even when the opening doctrine's base target is already met. */
function localExpansionWant(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): NavalWant | undefined {
    const halls = buildings(snapshot, owner).filter(hall => hall.kind === "townHall");
    if (halls.some(hall => !hall.complete) || units(snapshot, owner).some(unit => unit.order.type === "build")) return undefined;
    const mines = snapshot.resources.filter(mine => mine.amount > 0 && halls.some(hall => hall.complete && sameGround(snapshot.map, hall, mine))
        && !halls.some(hall => distance(hall, mine) < GOLD_MINE_RULES.baseRange)
        && !snapshot.units.some(unit => combatCapability(snapshot,unit).armed && distance(unit, mine) < 400 && isEnemyOwner(snapshot, owner, unit.owner, options))
        && !snapshot.buildings.some(building => distance(building, mine) < 400 && isOpponentOwner(snapshot, owner, building.owner, options)))
        .sort((a,b)=>Math.min(...halls.map(hall=>distance(hall,a)))-Math.min(...halls.map(hall=>distance(hall,b))));
    for (const mine of mines) {
        const site = hallSite(snapshot, mine), worker = site && nearestWorker(snapshot, owner, site, new Set());
        if (!site || !worker || !sameGround(snapshot.map, worker, mine)) continue;
        return { id:"naval:islandHall", cost:BUILDING_DEFS.townHall.cost, issue: used => {
            if (used.size) return undefined;
            used.add(worker.id);
            return {type:"build",unitId:worker.id,buildingKind:"townHall",...site};
        }};
    }
    return undefined;
}
function needsMove(unit: Unit, point: Point) {
    return unit.order.type !== "move" || distance(unit.order, point) > 80;
}
/** A nearby pond is not necessarily the sea the ferry is on. */
function coastOnWater(snapshot: GameSnapshot, ground: Point, water: Point): Point | undefined {
    const map = snapshot.map;
    const nearest = walkableGoal(map, ground.x, ground.y, "sea");
    if (sameGround(map, nearest, water, "sea"))
        return nearest;
    const shore = shoreSpots(map, BUILDING_DEFS.shipyard.radius)
        .filter(point => sameGround(map, point, ground) && sameGround(map, walkableGoal(map, point.x, point.y, "sea"), water, "sea"))
        .sort((a, b) => distance(a, ground) - distance(b, ground))[0];
    return shore && walkableGoal(map, shore.x, shore.y, "sea");
}
// Open water off a landing: the first point straight out from what the landing is by (an island's mine, the assault's
// target) that a ship sails and no land unit walks, so ships waiting there keep off the shallows of the beach. Waiting on
// a landing's shallows, V8's warships and its emptied transport walled in its own workers on their way to the island's
// hall site (three of the pool's games at ddec752).
function offshore(snapshot: GameSnapshot, landing: Point, from: Point): Point {
    const map = snapshot.map;
    const step = map.terrain?.cell ?? 32;
    const length = distance(landing, from) || 1;
    for (let k = 1; k <= OFFSHORE_STEPS; k += 1) {
        const point = { x: landing.x + ((landing.x - from.x) / length) * step * k, y: landing.y + ((landing.y - from.y) / length) * step * k };
        if (isWalkable(map, point.x, point.y, "sea") && !isWalkable(map, point.x, point.y))
            return point;
    }
    return landing;
}
// @@@coast-tower - Where every shore of a water is under an enemy ship's guns, a tower goes up where it outshoots the
// nearest of them (a tower reaches 480, a warship 390): within a tower's reach of the ship and beyond the ship's own, on
// the owner's ground, the build layout's clear spot nearest the point on the way from the ship to `ground` (the owner's
// hall). The ship sunk or gone, a shore is free for the shipyard (see shoreSpot). An island's warships, parked off its
// besieger's beach, sank every shipyard placed there within two seconds, and its last base stood to the end
// (pool-templeSpring-3, -5 at 88ba501; a tower inland of the shore, which the ships did not reach, ended one of them).
function coastTower(snapshot: GameSnapshot, ground: Point, ship: Point, workers: Unit[], shore: Point): NavalWant | undefined {
    const site = towerSite(snapshot, ground, ship) ?? shoreTower(snapshot, ground, shore);
    if (!site)
        return undefined;
    return {
        id: "naval:coastTower",
        cost: BUILDING_DEFS.defenseTower.cost,
        issue: (builders) => {
            if (builders.size || workers.some(unit => unit.order.type === "build"))
                return undefined;
            const builder = nearestByWalk(snapshot, workers.filter((worker) => !builders.has(worker.id)), site);
            if (!builder)
                return undefined;
            builders.add(builder.id);
            return { type: "build", unitId: builder.id, buildingKind: "defenseTower", x: site.x, y: site.y };
        },
    };
}
// Where no tower outshoots the ship (it lies out on the water, beyond a tower's reach of any ground), one by the shore the
// shipyard would take, which it then rises under: the island's two warships blockading its besieger's water from out
// there left it no shore, no shipyard and no closeout (pool-elderwood-6 at eb943a6).
function shoreTower(snapshot: GameSnapshot, ground: Point, shore: Point): Point | undefined {
    const at = legalBuildPointNear(snapshot, "defenseTower", shore);
    return sameGround(snapshot.map, at, ground) && isBuildPlacementClear(snapshot, "defenseTower", at) && distance(at, shore) <= TOWER_COVER ? at : undefined;
}
function towerSite(snapshot: GameSnapshot, ground: Point, ship: Point): Point | undefined {
    const length = distance(ground, ship) || 1;
    const beyond = UNIT_DEFS.warship.attackRange + BUILDING_DEFS.defenseTower.radius;
    const midway = (beyond + TOWER_COVER) / 2;
    const at = legalBuildPointNear(snapshot, "defenseTower", { x: ship.x + ((ground.x - ship.x) / length) * midway, y: ship.y + ((ground.y - ship.y) / length) * midway });
    const reach = distance(at, ship);
    return sameGround(snapshot.map, at, ground) && isBuildPlacementClear(snapshot, "defenseTower", at) && reach > beyond && reach <= TOWER_COVER ? at : undefined;
}
function islandHallOf(snapshot: GameSnapshot, owner: PlayerId, plan: IslandPlan): Building | undefined {
    return buildings(snapshot, owner).find((building) => building.kind === "townHall" && distance(building, plan.mine) <= GOLD_MINE_RULES.baseRange);
}
function hallSite(snapshot: GameSnapshot, mine: Point): Point | undefined {
    return miningHallSite(snapshot,mine);
}
// The plans below are found once per owner, and looked for again every PLAN_RETRY: an island's while none is found (its
// shore may have been built over, or its halls may since stand by another water), the enemy's door always (its buildings
// and towers come and go). They are kept in the owner's memory (a game saved with its AIs' memory plays on as it would
// have: kept by the terrain beside it, a replay from a save took other naval commands than the game had, and a second
// game on the same terrain object took the first one's plans).
const PLAN_RETRY = seconds(20);
type Outfit = NonNullable<NavalPlanMemory['outfit']>;
/** Purchased guns enter the hold and install directly; a worker is only needed to collect loose equipment. */
function outfitting(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Outfit | undefined {
    const memory = navalMemory(options), own = units(snapshot,owner);
    const dock = buildings(snapshot,owner).find(building => building.kind === 'shipyard' && building.complete);
    if (!dock) { delete memory.outfit; return; }
    const dangerous = (ship: Unit) => snapshot.units.some(unit => isEnemyOwner(snapshot,owner,unit.owner,options) && combatCapability(snapshot,unit).armed && distance(unit,ship) < 650);
    let job = memory.outfit;
    if (job) {
        const ship = own.find(unit => unit.id === job!.shipId), worker = own.find(unit => unit.id === job!.workerId);
        const filled = ship && snapshot.items.some(item => item.shipId === ship.id && item.mountId === job!.mountId);
        if (!ship || job.workerId && !worker || dangerous(ship) || filled) { delete memory.outfit; job = undefined; }
        else {
            const progress=job.progress;
            if(!progress || distance(ship,progress)>16 || worker && Math.hypot(worker.x-progress.workerX,worker.y-progress.workerY)>16 || progress.itemId!==job.itemId)
                job.progress={tick:snapshot.tick,x:ship.x,y:ship.y,workerX:worker?.x ?? ship.x,workerY:worker?.y ?? ship.y,...(job.itemId?{itemId:job.itemId}:{})};
            else if(snapshot.tick-progress.tick>seconds(30)){
                delete memory.outfit;memory.outfitRetryUntil=snapshot.tick+seconds(20);return;
            }
        }
    }
    if (!job) {
        if((memory.outfitRetryUntil ?? 0)>snapshot.tick)return;
        // Outfitting is a surplus dock errand. Never interrupt an opening army
        // or an active landing to buy another gun.
        if (own.filter(unit => unit.kind !== 'worker' && unitMover(unit.kind) === 'land').length < 6) return;
        const candidates = own.filter(ship => shipProfile(ship) && distance(ship,dock) < 900 && ship.hp >= ship.maxHp*.65 && !dangerous(ship)
            && !memory.ferries?.[ship.id]
            && installedWeapons(snapshot,ship).length < (ship.kind === 'carrier' ? 5 : ship.kind === 'warship' ? 3 : ship.kind === 'transport' || ship.kind === 'cutter' ? 1 : 2))
            .sort((a,b)=>Number(['warship','carrier'].includes(b.kind))-Number(['warship','carrier'].includes(a.kind)) || installedWeapons(snapshot,a).length-installedWeapons(snapshot,b).length || b.maxHp-a.maxHp);
        for (const ship of candidates) {
            const mount = shipMounts(ship).find(mount => !snapshot.items.some(item => item.shipId === ship.id && item.mountId === mount.id) && (mount.accepts.includes('shipCannon') || mount.accepts.includes('shipMortar')));
            if (!mount) continue;
            const kind = mount.accepts.includes('shipCannon') ? 'shipCannon' : 'shipMortar';
            const worker = own.filter(unit => unit.kind === 'worker' && canEquip(unit) && !unit.deck && unit.order.type !== 'build' && distance(unit,dock) < 550 && !itemsFor(snapshot,unit).length).sort((a,b)=>distance(a,dock)-distance(b,dock))[0];
            const available = snapshot.items.some(item => item.kind === kind && (item.shipId === ship.id && !item.mountId || worker && !item.carrierId && !item.shipId && distance(item,dock) < 300));
            if (!available && playerState(snapshot,owner).gold < SHIP_WEAPONS[kind].cost + navalBudgetReserve(snapshot,owner,options) + OUTFIT_RESERVE) continue;
            const groundGun=worker && snapshot.items.some(item=>item.kind===kind&&!item.carrierId&&!item.shipId&&distance(item,dock)<300);
            job = memory.outfit = {shipId:ship.id,...(groundGun?{workerId:worker!.id}:{}),mountId:mount.id,kind}; break;
        }
    }
    if (job) {
        const item = snapshot.items.find(item => item.id === job!.itemId && (job!.workerId && item.carrierId === job!.workerId || item.shipId === job!.shipId || job!.workerId && !item.carrierId && !item.shipId))
            ?? snapshot.items.find(item => item.kind === job!.kind && !item.mountId && (job!.workerId && item.carrierId === job!.workerId || item.shipId === job!.shipId || job!.workerId && !item.carrierId && !item.shipId && distance(item,dock)<300));
        if (item) job.itemId = item.id; else delete job.itemId;
        if (!item && playerState(snapshot,owner).gold < SHIP_WEAPONS[job.kind].cost + navalBudgetReserve(snapshot,owner,options) + OUTFIT_RESERVE) { delete memory.outfit; return; }
    }
    return job;
}
function outfitCommands(snapshot: GameSnapshot, owner: PlayerId, job: Outfit): GameCommand[] {
    const worker = snapshot.units.find(unit=>unit.id===job.workerId)!, ship = snapshot.units.find(unit=>unit.id===job.shipId)!;
    const dock = buildings(snapshot,owner).find(building=>building.kind==='shipyard' && building.complete)!;
    const commands: GameCommand[] = [];
    const item = snapshot.items.find(item=>item.id===job.itemId);
    if (!item) {
        if(!('placement' in purchasePlacement(snapshot,owner,dock,job.kind,ship.id)) && needsMove(ship,dock))commands.push({type:'move',unitIds:[ship.id],x:dock.x,y:dock.y});
        return commands;
    }
    if (!item.carrierId && !item.shipId) {
        if(worker && freeItemSlot(snapshot,worker,item.kind) && (worker.order.type !== 'pickupItem' || worker.order.itemId !== item.id))commands.push({type:'pickupItem',unitId:worker.id,itemId:item.id});
        return commands;
    }
    const destination = {shipId:ship.id,mountId:job.mountId};
    if(item.shipId===ship.id || worker && canExchange(snapshot,worker,ship)) {
        const mount=shipMounts(ship).find(m=>m.id===job.mountId)!;
        const blocked=snapshot.units.filter(unit=>unit.deck?.shipId===ship.id && Math.hypot(unit.deck.x-mount.x,unit.deck.y-mount.y)<unit.radius+mount.radius+1);
        for(const crew of blocked.filter(unit=>unit.owner===owner)) {
            const spot=deckPlacement(ship,crew,snapshot.units,{x:-shipProfile(ship)!.length*.25,y:0});
            if(spot)commands.push({type:'move',unitIds:[crew.id],...localToWorld(ship,spot)});
        }
        if(!blocked.length && !transferRefusal(snapshot,owner,item.id,destination))commands.push({type:'transferItem',itemId:item.id,destination});
    } else if(worker && (worker.order.type!=='board' || worker.order.transportId!==ship.id))commands.push({type:'board',unitIds:[worker.id],transportId:ship.id});
    return commands;
}
function navalMemory(options: AiPolicyContext) {
    return (options.memory.naval ??= {});
}
// The nearest mine with gold left that the owner's workers cannot walk to but a ship from its own shore can reach, with
// the water a ship lands at.
function islandPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): IslandPlan | undefined {
    const map = snapshot.map;
    if (!map.terrain || groundWholes(map) <= 1)
        return undefined;
    const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
    if (!home)
        return undefined;
    if (localExpansionAvailable(snapshot, owner, options)) return undefined;
    const ownedHalls = buildings(snapshot, owner).filter(hall => hall.kind === "townHall" && hall.complete);
    const memory = navalMemory(options);
    const settling = Object.values(memory.ferries ?? {}).some(mission => mission.purpose === "settle" && mission.phase !== "return");
    const localGold = snapshot.resources.filter(mine => mine.amount > 0 && ownedHalls.some(hall => sameGround(map, hall, mine) && distance(hall, mine) < GOLD_MINE_RULES.baseRange)).reduce((n, mine) => n + mine.amount, 0);
    // Population gates a new expedition; casualties do not cancel a colony already loading or sailing.
    if (!settling && ownedHalls.length < 2 && localGold > 1800 && playerState(snapshot, owner).supplyUsed < 20) return undefined;
    const income = units(snapshot, owner).some(unit => unit.kind === "worker" && snapshot.resources.some(mine => mine.amount > 0 && sameGround(map, unit, mine) && buildings(snapshot, owner).some(hall => hall.kind === "townHall" && hall.complete && distance(hall, mine) < GOLD_MINE_RULES.baseRange)));
    if (!income && playerState(snapshot, owner).gold < BUILDING_DEFS.townHall.cost)
        return undefined;
    let known = memory.island;
    const heldByUs = (mine: ResourceNode) => buildings(snapshot, owner).some(building => building.kind === "townHall" && distance(building, mine) <= GOLD_MINE_RULES.baseRange);
    if (known?.plan) {
        const mine = snapshot.resources.find(mine => mine.id === known!.plan!.mineId);
        if (!mine || mine.amount <= 0 || heldByUs(mine) || snapshot.buildings.some(building => building.kind === "townHall" && distance(building, mine) < 400 && isOpponentOwner(snapshot, owner, building.owner, options)))
            known = undefined;
    }
    if (!known || (!known.plan && snapshot.tick - known.tick >= PLAN_RETRY)) {
        // A mine an opponent's hall holds is no island to take but a base to assault (see @@@ai-closeout).
        const held = (mine: ResourceNode) => snapshot.buildings.some((building) => building.kind === "townHall" && distance(building, mine) <= 400 && isOpponentOwner(snapshot, owner, building.owner, options));
        const plan = snapshot.resources
            .filter((mine) => mine.amount > 0 && !sameGround(map, home, mine) && !held(mine) && !heldByUs(mine))
            .map((mine) => ({ mine, landing: walkableGoal(map, mine.x, mine.y, "sea") }))
            .filter((entry) => isWalkable(map, entry.landing.x, entry.landing.y, "sea") && Boolean(shoreSpot(snapshot, owner, entry.landing, options, true)))
            .sort((a, b) => {
                const guard = (mine: ResourceNode) => snapshot.units.filter(unit => unit.owner === "neutral" && distance(unit, mine) < 400).reduce((n, unit) => n + effectiveCombatRating(snapshot,unit), 0);
                return guard(a.mine) * 500 + distance(a.mine, home) - guard(b.mine) * 500 - distance(b.mine, home);
            })[0];
        known = { tick: snapshot.tick, ...(plan ? { plan: { mineId: plan.mine.id, landing: { x: plan.landing.x, y: plan.landing.y } } } : {}) };
        memory.island = known;
    }
    const plan = known.plan;
    const live = plan && snapshot.resources.find((mine) => mine.id === plan.mineId && mine.amount > 0);
    return plan && live ? { mine: live, landing: plan.landing } : undefined;
}
// The assault (see @@@ai-closeout): of the opponents whose every building stands off the owner's home's ground, the
// building nearest its home that water by it joins to a shore of the owner's (or its shipyard), with that water. Looked for again
// every PLAN_RETRY, and at once when its target falls.
function assaultPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): AssaultPlan | undefined {
    const map = snapshot.map;
    if (!map.terrain || groundWholes(map) <= 1)
        return undefined;
    const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
    if (!home)
        return undefined;
    const memory = navalMemory(options);
    let known = memory.assault;
    const standing = known?.plan && snapshot.buildings.some((building) => building.id === known!.plan!.targetId);
    if (!known || snapshot.tick - known.tick >= PLAN_RETRY || (known.plan && !standing)) {
        // The opponents walled off by water, every building of theirs off the home's ground (another opponent may still stand
        // on it, for the army: four players' games ended with the island's last hall untouched while two fought on), and the
        // halls the others hold off it (see @@@transport-attack).
        const foes = snapshot.buildings.filter((building) => isOpponentOwner(snapshot, owner, building.owner, options));
        const ashore = new Set(foes.filter((building) => sameGround(map, home, building)).map((building) => building.owner));
        const targets = foes.filter((building) => !ashore.has(building.owner) || (building.kind === "townHall" && !sameGround(map, home, building)));
        let assault: AssaultPlan | undefined;
        if (targets.length > 0) {
            for (const target of targets.sort((a, b) => distance(a, home) - distance(b, home))) {
                const landing = walkableGoal(map, target.x, target.y, "sea");
                if (!isWalkable(map, landing.x, landing.y, "sea"))
                    continue;
                if (shipyardOf(snapshot, owner, landing) || shoreSpot(snapshot, owner, landing, options, true)) {
                    assault = { target, landing };
                    break;
                }
            }
        }
        known = { tick: snapshot.tick, ...(assault ? { plan: { targetId: assault.target.id, landing: { x: assault.landing.x, y: assault.landing.y } } } : {}) };
        memory.assault = known;
    }
    const live = known.plan && snapshot.buildings.find((building) => building.id === known!.plan!.targetId);
    if (!known.plan || !live)
        return undefined;
    const free = lastFight(snapshot, owner, options, home) || soleOpponent(snapshot, owner, options);
    return free || readyToCross(snapshot, owner, options, home, live) ? { target: live, landing: known.plan.landing } : undefined;
}
// Whether one opponent is all there is left (see @@@transport-attack).
function soleOpponent(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
    return new Set(snapshot.buildings.filter((building) => isOpponentOwner(snapshot, owner, building.owner, options)).map((building) => building.owner)).size <= 1;
}
// Whether the fight is the last: no opponent's hall stands on the army's ground.
function lastFight(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, home: Building) {
    return !snapshot.buildings.some((building) => building.kind === "townHall" && isOpponentOwner(snapshot, owner, building.owner, options) && sameGround(snapshot.map, building, home));
}
// @@@transport-attack - Any opponent's base the army cannot walk to is a transport's target: the last of one walled off by
// water (see @@@ai-closeout) and a hall another holds on an island while it still stands ashore. While more than one
// opponent is left and one still holds a hall on the army's ground, the soldiers cross only as the AI's general would set
// out against a base: no enemy army in its bases (the intel's intrusion), and its soldiers at home outweighing the
// target's ground's soldiers and towers by the general's own attack margin (see attackMargin). Crossing whenever a shore
// was there, V9 shipped soldiers to an island while two rivals fought it on its own ground (I1 on the 1v3 bench: 238 of
// 500 against 267; with the edge, 263 against 271).
function readyToCross(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, home: Building, target: Building) {
    if (readV6Intel(snapshot, owner, options).intrusion)
        return false;
    const map = snapshot.map;
    const soldiers = units(snapshot, owner).filter((unit) => unitMover(unit.kind) === "land" && unit.kind !== "worker" && sameGround(map, unit, home));
    const defenders = snapshot.units.filter((unit) => unitMover(unit.kind) === "land" && unit.kind !== "worker" && isOpponentOwner(snapshot, owner, unit.owner, options) && sameGround(map, unit, target));
    const towers = snapshot.buildings.filter((building) => building.kind === "defenseTower" && building.complete && isOpponentOwner(snapshot, owner, building.owner, options) && sameGround(map, building, target)).length;
    return strengthOf(soldiers) >= (strengthOf(defenders) + towers * TOWER_STRENGTH) * attackMargin(options);
}
// The water at the enemy's door: by an enemy hall that no tower covers and a warship reaches from water the owner has a
// shore on; on the water its shipyard is on first (one shipyard serves the raid), then by the hall nearest its home.
function raidPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): RaidPlan | undefined {
    const map = snapshot.map;
    if (!map.terrain || shoreSpots(map, BUILDING_DEFS.shipyard.radius).length === 0)
        return undefined;
    const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
    if (!home)
        return undefined;
    const memory = navalMemory(options);
    let known = memory.raid;
    if (!known || snapshot.tick - known.tick >= PLAN_RETRY) {
        const towers = enemyTowers(snapshot, owner, options);
        const yards = buildings(snapshot, owner).filter((building) => building.kind === "shipyard");
        const doors = snapshot.buildings
            .filter((building) => building.kind === "townHall" && isOpponentOwner(snapshot, owner, building.owner, options) && !covered(building, towers))
            .map((hall) => ({ hall, water: doorstep(snapshot, hall) }))
            .filter((door): door is {
            hall: Building;
            water: Point;
        } => door.water !== undefined)
            .map((door) => ({ ...door, served: yards.some((yard) => sameGround(map, walkableGoal(map, yard.x, yard.y, "sea"), door.water, "sea")) }))
            .sort((a, b) => Number(b.served) - Number(a.served) || distance(a.hall, home) - distance(b.hall, home));
        // A water once found to have no shore of the owner's is not searched again.
        const shoreless: Point[] = [];
        let raid: RaidPlan | undefined;
        for (const { water, served } of doors) {
            if (shoreless.some((dry) => sameGround(map, dry, water, "sea")))
                continue;
            if (!served && !shoreSpot(snapshot, owner, water, options)) {
                shoreless.push(water);
                continue;
            }
            raid = { water };
            break;
        }
        known = { tick: snapshot.tick, ...(raid ? { water: { x: raid.water.x, y: raid.water.y } } : {}) };
        memory.raid = known;
    }
    return known.water ? { water: known.water } : undefined;
}
// The water a warship shoots the thing from, if any is within its range of it.
function doorstep(snapshot: GameSnapshot, thing: Unit | Building): Point | undefined {
    const map = snapshot.map;
    const water = walkableGoal(map, thing.x, thing.y, "sea");
    if (!isWalkable(map, water.x, water.y, "sea"))
        return undefined;
    const wall = "order" in thing ? 0 : thing.radius;
    return distance(water, thing) - wall <= UNIT_DEFS.warship.attackRange ? water : undefined;
}
function enemyTowers(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
    return snapshot.buildings.filter((building) => building.kind === "defenseTower" && building.complete && isOpponentOwner(snapshot, owner, building.owner, options));
}
// Whether a tower reaches the thing: a building of the given radius at its wall (see @@@building-reach).
function covered(thing: Point, towers: Building[], radius = 0) {
    return towers.some((tower) => distance(tower, thing) <= TOWER_COVER + radius);
}
// The owner's shipyard on the given water, if it has one.
function shipyardOf(snapshot: GameSnapshot, owner: PlayerId, water: Point): Building | undefined {
    return buildings(snapshot, owner).find((building) => building.kind === "shipyard" && sameGround(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, "sea"), water, "sea"));
}
// The shore spot (see shoreSpots) on the owner's own ground and on the given water, free to build on, nearest its halls
// there by walking: as far off as the shore lies, but on its own side, a shorter walk from one of its halls than from any
// enemy's on its ground.
function shoreSpot(snapshot: GameSnapshot, owner: PlayerId, water: Point, options: AiPolicyContext, despiteGuns = false): Point | undefined {
    const map = snapshot.map;
    const halls = buildings(snapshot, owner).filter((building) => building.kind === "townHall");
    const home = halls[0];
    if (!home)
        return undefined;
    const ours = halls;
    // Only the enemy halls on its own ground: one on an island sends nobody walking at the shipyard (a corner island's last
    // hall kept every shore of its lake its own, and no assault ever set out, see @@@ai-closeout).
    const theirs = snapshot.buildings.filter((building) => building.kind === "townHall" && isOpponentOwner(snapshot, owner, building.owner, options));
    // How far its workers walk there from the nearest of the halls (a spot no walk reaches is none): by the straight line a
    // shore across the map's middle came first, 1780 off but 3782 to walk, and its builders died on the way one after
    // another (pool-templeSpring-5 at f18cf97).
    const gapOf = (spot: Point, from: Building[]) => Math.min(Infinity, ...from.map((hall) => walkingDistance(map, spot, hall) ?? Infinity));
    // None on water an enemy's armed ship sails, nor within the reach of one on other water (its range, the shipyard's
    // radius and GUN_MARGIN), unless its own towers cover the shore: a site starts at a few health and the ships come and
    // sink it before its builder gets there (two warships guarding an island's last hall sank five shipyards, 170 gold each
    // and a third of the army's income: pool-templeSpring-5), and a raider keeps off what towers cover (see @@@coast-tower:
    // with no shore at all, the island's last base that one warship guarded was never assaulted, five of the pool's games at
    // 26e9560). `despiteGuns`: whether the water has a shore of the owner's at all, for the plans that go there.
    const guns = snapshot.units.filter((unit) => unitMover(unit.kind) === "sea" && combatCapability(snapshot,unit).armed && isEnemyOwner(snapshot, owner, unit.owner, options));
    const towers = buildings(snapshot, owner).filter((building) => building.kind === "defenseTower" && building.complete);
    const held = guns.some((ship) => sameGround(map, ship, water, "sea"));
    // None an enemy's tower reaches, for the plans too: a site starts at a few health, and the tower struck down one placed
    // there every four seconds while its builder walked over, ten of them (the 1v3 bench's v5-extra-11 ladder-32 at c29edfa);
    // and a tower reaches a site at its wall, so one 486 from a site's center still struck down 30 (v5-extra-15 ladder-13).
    const enemy = enemyTowers(snapshot, owner, options);
    // Whether a gun reaches a site there: its range, the shipyard's radius and GUN_MARGIN. Its own towers' cover holds a site
    // only while they reach every gun that reaches it: a warship 121 off a shore the owner's tower covered, out of that
    // tower's reach, sank the 21 sites placed there one after another (the 1v3 bench's v5-extra-13 ladder-57 at fbd8f95).
    const reaches = (ship: Unit, spot: Point) => distance(ship, spot) <= combatCapability(snapshot,ship).range + BUILDING_DEFS.shipyard.radius + GUN_MARGIN;
    let best:Point|undefined,bestGap=Infinity;
    for (const spot of shoreSpots(map, BUILDING_DEFS.shipyard.radius)) {
        const gap=gapOf(spot,ours);
        // Once a valid berth is known, farther candidates cannot win. Keep
        // row-order ties identical to the former stable sort.
        if(gap<HALL_BERTH || gap>=bestGap || gap>=gapOf(spot,theirs) || covered(spot,enemy,BUILDING_DEFS.shipyard.radius))continue;
        if(!despiteGuns && !((covered(spot,towers)&&!guns.some(ship=>reaches(ship,spot)&&!covered(ship,towers))) || (!held&&!guns.some(ship=>reaches(ship,spot)))))continue;
        if (!halls.some(hall => sameGround(map, spot, hall)) || !isBuildPlacementClear(snapshot, "shipyard", spot))
            continue;
        if (sameGround(map, walkableGoal(map, spot.x, spot.y, "sea"), water, "sea"))
            {best=spot;bestGap=gap;}
    }
    return best;
}
function enemyShipsNear(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Unit[] {
    if (!shipsAfloat(snapshot))
        return [];
    const ships = snapshot.units.filter((unit) => unitMover(unit.kind) === "sea" && unit.owner !== "neutral" && isEnemyOwner(snapshot, owner, unit.owner, options));
    if (ships.length === 0)
        return ships;
    const posts = buildings(snapshot, owner).filter((building) => building.kind === "townHall" || building.kind === "shipyard");
    return ships.filter((ship) => posts.some((post) => distance(ship, post) <= HOME_WATERS));
}
function nearestWorker(snapshot: GameSnapshot, owner: PlayerId, point: Point, builders: Set<string>) {
    return nearestOf(units(snapshot, owner).filter((unit) => !unit.deck && unit.kind === "worker" && (unit.order.type === "mine" || unit.order.type === "idle") && !builders.has(unit.id) && sameGround(snapshot.map, unit, point)), point);
}
// The thing with the shortest walk to the point, none that no walk reaches (see walkingDistance: one field toward the
// point serves them all).
function nearestByWalk<T extends Point>(snapshot: GameSnapshot, things: T[], to: Point): T | undefined {
    let best: T | undefined;
    let bestWalk = Infinity;
    for (const thing of things) {
        const walk = walkingDistance(snapshot.map, thing, to);
        if (walk !== undefined && walk < bestWalk) {
            best = thing;
            bestWalk = walk;
        }
    }
    return best;
}
function nearestOf<T extends Point>(things: T[], from: Point): T | undefined {
    let best: T | undefined;
    for (const thing of things)
        if (!best || distance(thing, from) < distance(best, from))
            best = thing;
    return best;
}
