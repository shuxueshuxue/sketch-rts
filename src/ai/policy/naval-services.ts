import { canBoard } from "../../shared/decks";
import { combatCapability } from "../../shared/combat-capabilities";
import { shipPassengers, shipProfile } from "../../shared/ship-geometry";
import { shipNeedsRepair } from "../../shared/ship-equipment";
import { isInCabin } from '../../shared/ship-cabin';
import { sameGround, walkableGoal } from "../../shared/terrain";
import type {
  GameCommand,
  GameSnapshot,
  PlayerId,
  Unit,
} from "../../shared/types";
import { distance } from "./spatial";
import { isEnemyOwner } from "./ownership";
import type { AiPolicyContext } from "./types";
type Services = { commands: GameCommand[]; reserved: Set<string> };
const cache = new WeakMap<GameSnapshot, Map<PlayerId, Services>>();
/** Physical boarding does the transfer, repair and capture. This layer only
 * chooses a safe task and reserves both hulls so other plans cannot interrupt. */
export function navalServices(
  snapshot: GameSnapshot,
  owner: PlayerId,
  options: AiPolicyContext,
): Services {
  let byOwner = cache.get(snapshot);
  if (!byOwner) {
    byOwner = new Map();
    cache.set(snapshot, byOwner);
  }
  const known = byOwner.get(owner);
  if (known) return known;
  const result: Services = { commands: [], reserved: new Set() };
  byOwner.set(owner, result);
  const own = snapshot.units.filter(
      (unit) => unit.owner === owner && unit.hp > 0,
    ),
    ships = own.filter(shipProfile);
  const foes = snapshot.units.filter(
    (unit) => unit.hp > 0 && isEnemyOwner(snapshot, owner, unit.owner, options),
  );
  const working = (ship: Unit) => combatCapability(snapshot, ship).armed;
  const blocked = (ship: Unit) =>
    result.reserved.has(ship.id) ||
    options.memory.naval?.outfit?.shipId === ship.id ||
    Boolean(options.memory.naval?.ferries?.[ship.id]);
  const safe = (point: Unit, range: number) =>
    !foes.some(
      (foe) =>
        combatCapability(snapshot, foe).armed && distance(foe, point) < range,
    );
  const awaitBoarding = (target: Unit) => {
    // Shore boarding sails an idle hull to its berth; holding it strands the engineer.
    if (target.owner === owner && target.order.type !== 'idle')
      result.commands.push({ type: "stop", unitIds: [target.id] });
  };
  const transfer = (crew: Unit, target: Unit) => {
    result.reserved.add(crew.id);
    result.reserved.add(target.id);
    if (crew.deck) result.reserved.add(crew.deck.shipId);
    awaitBoarding(target);
    result.commands.push({
      type: "board",
      unitIds: [crew.id],
      transportId: target.id,
    });
  };
  for (const crew of own)
    if (
      crew.order.type === "board" &&
      !options.memory.naval?.ferries?.[crew.order.transportId]
    ) {
      result.reserved.add(crew.id);
      if (crew.deck) result.reserved.add(crew.deck.shipId);
      result.reserved.add(crew.order.transportId);
      const target = ships.find(ship => crew.order.type === 'board' && ship.id === crew.order.transportId);
      if (target) awaitBoarding(target);
    }
  if ((snapshot.players[owner]?.gold ?? 0) > 30)
    for (const ship of [...ships].sort(
      (a, b) => a.hp / a.maxHp - b.hp / b.maxHp,
    )) {
      if (
        blocked(ship) ||
        !shipNeedsRepair(snapshot, ship) ||
        shipPassengers(snapshot.units, ship).some(
          (crew) => crew.owner === owner && crew.kind === "worker" && !isInCabin(crew),
        )
      )
        continue;
      const worker = own
        .filter(
          (crew) =>
            crew.kind === "worker" &&
            crew.deck &&
            !isInCabin(crew) &&
            !result.reserved.has(crew.id) &&
            crew.order.type !== "board" &&
            canBoard(ship, crew, snapshot.units),
        )
        .filter((crew) => {
          const source = ships.find(
            (source) => source.id === crew.deck!.shipId,
          );
          return (
            source &&
            !blocked(source) &&
            source.hp / source.maxHp >= 0.75 &&
            sameGround(snapshot.map, source, ship, "sea") &&
            distance(source, ship) < 1400
          );
        })
        .sort((a, b) => distance(a, ship) - distance(b, ship))[0];
      if (worker && (safe(ship, 500) || ship.hp / ship.maxHp < 0.6))
        transfer(worker, ship);
    }
  for (const ship of ships.filter(
    (ship) => !blocked(ship) && working(ship) && ship.hp / ship.maxHp >= 0.8,
  )) {
    const crew = shipPassengers(snapshot.units, ship).find(
      (crew) =>
        crew.owner === owner &&
        crew.kind !== "worker" &&
        crew.attackRange <= 80 &&
        !isInCabin(crew) &&
        !result.reserved.has(crew.id) &&
        crew.order.type !== "board",
    );
    if (!crew) continue;
    const prize = foes
      .filter(shipProfile)
      .filter(
        (prize) =>
          !result.reserved.has(prize.id) &&
          !shipPassengers(snapshot.units, prize).length &&
          distance(ship, prize) < 650 &&
          sameGround(snapshot.map, ship, prize, "sea") &&
          canBoard(prize, crew, snapshot.units),
      )
      .filter(
        (prize) =>
          !foes.some(
            (other) =>
              other.id !== prize.id &&
              combatCapability(snapshot, other).armed &&
              distance(prize, other) < 500,
          ),
      )
      .sort((a, b) => distance(ship, a) - distance(ship, b))[0];
    if (prize) transfer(crew, prize);
  }
  const dock = snapshot.buildings.find(
    (building) =>
      building.owner === owner &&
      building.kind === "shipyard" &&
      building.complete,
  );
  const harborGround = dock && walkableGoal(snapshot.map, dock.x, dock.y, "land");
  const workers = own.filter(
    (crew) =>
      crew.kind === "worker" &&
      !crew.deck &&
      Boolean(harborGround && sameGround(snapshot.map, crew, harborGround)) &&
      ["idle", "mine"].includes(crew.order.type),
  );
  if (dock && ships.length >= 2 && workers.length >= 7) {
    const ship = ships
      .filter(
        (ship) =>
          !blocked(ship) &&
          working(ship) &&
          distance(ship, dock) < 600 &&
          safe(ship, 500) &&
          !shipPassengers(snapshot.units, ship).some(
            (crew) => crew.kind === "worker",
          ),
      )
      .sort((a, b) => b.maxHp - a.maxHp)[0];
    const worker =
      ship &&
      workers
        .filter(
          (worker) =>
            !result.reserved.has(worker.id) &&
            !worker.mineSlot &&
            distance(worker, dock) < 650 &&
            canBoard(ship, worker, snapshot.units),
        )
        .sort((a, b) => distance(a, ship) - distance(b, ship))[0];
    if (ship && worker) transfer(worker, ship);
  }
  return result;
}
