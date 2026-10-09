import type { Building, BuildingKind, GameSnapshot, MercenaryCamp, Owner, PlayerId, ResourceNode, Unit, WorldItem } from "../../shared/types";
import { createRangeIndex } from "./range-index";
import { bindGangwayCrewRules } from '../../shared/ship-gangway';

export type SnapshotQueryOptions = {
  /** Preset policies treat service weapons as equipment rather than treasure. */
  excludeIssuedWeapons?: boolean;
  teams?: Partial<Record<PlayerId, string>>;
};

export type EntityPoint = {
  x: number;
  y: number;
};

export type SnapshotEntitySet<T extends EntityPoint> = {
  all: T[];
  nearestTo(point: EntityPoint): T | undefined;
};

export type SnapshotPlayerEntityView = {
  units: Unit[];
  workers: Unit[];
  combatUnits: Unit[];
  buildings: Building[];
  completeBuildings: Building[];
};

export type SnapshotPlayerView = {
  owner: PlayerId;
  team: string;
  own: SnapshotPlayerEntityView;
  allied: SnapshotPlayerEntityView;
  enemy: SnapshotPlayerEntityView;
  neutral: Pick<SnapshotPlayerEntityView, "units">;
  resources: SnapshotEntitySet<ResourceNode>;
  mercenaryCamps: SnapshotEntitySet<MercenaryCamp>;
  items: {
    ground: WorldItem[];
    carried: WorldItem[];
  };
};

export type SnapshotQuery = {
  snapshot: GameSnapshot;
  teamFor(owner: Owner): string;
  isOpponent(owner: PlayerId, other: Owner): boolean;
  activePlayerIds(): PlayerId[];
  opponentPlayerIds(owner: PlayerId): PlayerId[];
  unitById(id: string): Unit | undefined;
  buildingById(id: string): Building | undefined;
  resourceById(id: string): ResourceNode | undefined;
  mercenaryCampById(id: string): MercenaryCamp | undefined;
  itemById(id: string): WorldItem | undefined;
  targetById(id: string): Unit | Building | ResourceNode | MercenaryCamp | WorldItem | undefined;
  resources(): ResourceNode[];
  activeResources(): ResourceNode[];
  mercenaryCamps(): MercenaryCamp[];
  items(): WorldItem[];
  groundItems(): WorldItem[];
  carriedItemsFor(owner: PlayerId): WorldItem[];
  buildings(): Building[];
  unitsFor(owner: PlayerId): Unit[];
  combatUnitsFor(owner: PlayerId): Unit[];
  buildingsFor(owner: PlayerId): Building[];
  completeBuildingsFor(owner: PlayerId, kind?: BuildingKind): Building[];
  neutralUnitsNear(point: EntityPoint, range: number): Unit[];
  opponentUnitsNear(owner: PlayerId, point: EntityPoint, range: number): Unit[];
  opponentBuildingsNear(owner: PlayerId, point: EntityPoint, range: number): Building[];
  hostileUnitsNear(owner: PlayerId, point: EntityPoint, range: number): Unit[];
  hostileCombatUnitsFor(owner: PlayerId): Unit[];
  forPlayer(owner: PlayerId): SnapshotPlayerView;
};

// @@@query-memo - A query reads a snapshot, which nobody changes while it is read (the AI planners never write their
// snapshot's units, buildings or items), so each owner's units, combat units, buildings, hostile combat units and player
// view, and the active players, are worked out once per query. Every call still returns arrays (and view objects) of its
// own, in the same order: callers sort and splice what they get. The same holds for the lookups a planner makes once per
// unit, which were a scan of every unit each and made a big army's think grow with its square: units and buildings by id
// come from a map of the first one per id (the one find returns; ids are unique anyway), neutrals near a point from the
// neutral units alone, and opponents or hostiles near a point from a range index of that owner's opponents or hostiles
// (@@@range-index). Each answers what the scan answered, in the same order.
export function createSnapshotQuery(snapshot: GameSnapshot, options: SnapshotQueryOptions = {}): SnapshotQuery {
  bindGangwayCrewRules(snapshot.units,snapshot);
  const teamFor = (owner: Owner) => (owner === "neutral" ? "neutral" : options.teams?.[owner] ?? owner);
  const isOpponent = (owner: PlayerId, other: Owner) => other !== "neutral" && teamFor(owner) !== teamFor(other);
  const visibleItems=options.excludeIssuedWeapons ? snapshot.items.filter(item=>item.kind!=="issuedWeapon") : snapshot.items;
  let ground:WorldItem[]|undefined;
  const carriedByOwner=new Map<PlayerId,WorldItem[]>();
  let activePlayers: PlayerId[] | undefined;
  const unitsByOwner = new Map<PlayerId, Unit[]>();
  const combatUnitsByOwner = new Map<PlayerId, Unit[]>();
  const buildingsByOwner = new Map<PlayerId, Building[]>();
  const hostileCombatUnitsByOwner = new Map<PlayerId, Unit[]>();
  const viewByOwner = new Map<PlayerId, SnapshotPlayerView>();
  let unitsById: Map<string, Unit> | undefined;
  let buildingsById: Map<string, Building> | undefined;
  let neutralUnits: Unit[] | undefined;
  const nearIndexes = new Map<string, (point: EntityPoint, range: number) => Unit[]>();
  const unitsNear = (key: string, matches: (unit: Unit) => boolean) => {
    let near = nearIndexes.get(key);
    if (!near) nearIndexes.set(key, (near = createRangeIndex(snapshot.units.filter(matches))));
    return near;
  };
  return {
    snapshot,
    teamFor,
    isOpponent,
    activePlayerIds() {
      activePlayers ??= Object.keys(snapshot.players).filter((owner) => snapshot.units.some((unit) => unit.owner === owner) || snapshot.buildings.some((building) => building.owner === owner));
      return activePlayers.slice();
    },
    opponentPlayerIds(owner) {
      return this.activePlayerIds().filter((candidate) => isOpponent(owner, candidate));
    },
    unitById(id) {
      unitsById ??= firstById(snapshot.units);
      return unitsById.get(id);
    },
    buildingById(id) {
      buildingsById ??= firstById(snapshot.buildings);
      return buildingsById.get(id);
    },
    resourceById(id) {
      return snapshot.resources.find((resource) => resource.id === id);
    },
    mercenaryCampById(id) {
      return snapshot.mercenaryCamps.find((camp) => camp.id === id);
    },
    itemById(id) {
      return snapshot.items.find((item) => item.id === id);
    },
    targetById(id) {
      return this.unitById(id) ?? this.buildingById(id) ?? this.resourceById(id) ?? this.mercenaryCampById(id) ?? this.itemById(id);
    },
    resources() {
      return snapshot.resources;
    },
    activeResources() {
      return snapshot.resources.filter((resource) => resource.amount > 0);
    },
    mercenaryCamps() {
      return snapshot.mercenaryCamps;
    },
    items() {
      return visibleItems;
    },
    groundItems() {
      ground ??= visibleItems.filter((item) => !item.carrierId && !item.shipId);
      return ground.slice();
    },
    carriedItemsFor(owner) {
      let carried=carriedByOwner.get(owner);
      if(!carried){const ownUnitIds = new Set(this.unitsFor(owner).map((unit) => unit.id));carried=visibleItems.filter((item) => item.carrierId && ownUnitIds.has(item.carrierId));carriedByOwner.set(owner,carried);}
      return carried.slice();
    },
    buildings() {
      return snapshot.buildings;
    },
    unitsFor(owner) {
      let units = unitsByOwner.get(owner);
      if (!units) unitsByOwner.set(owner, (units = snapshot.units.filter((unit) => unit.owner === owner)));
      return units.slice();
    },
    combatUnitsFor(owner) {
      let units = combatUnitsByOwner.get(owner);
      if (!units) combatUnitsByOwner.set(owner, (units = this.unitsFor(owner).filter((unit) => unit.kind !== "worker")));
      return units.slice();
    },
    buildingsFor(owner) {
      let buildings = buildingsByOwner.get(owner);
      if (!buildings) buildingsByOwner.set(owner, (buildings = snapshot.buildings.filter((building) => building.owner === owner)));
      return buildings.slice();
    },
    completeBuildingsFor(owner, kind) {
      return this.buildingsFor(owner).filter((building) => building.complete && (kind === undefined || building.kind === kind));
    },
    neutralUnitsNear(point, range) {
      neutralUnits ??= snapshot.units.filter((unit) => unit.owner === "neutral");
      return neutralUnits.filter((unit) => distance(unit, point) <= range);
    },
    opponentUnitsNear(owner, point, range) {
      return unitsNear(`opponent ${owner}`, (unit) => isOpponent(owner, unit.owner))(point, range);
    },
    opponentBuildingsNear(owner, point, range) {
      return snapshot.buildings.filter((building) => isOpponent(owner, building.owner) && distance(building, point) <= range);
    },
    hostileUnitsNear(owner, point, range) {
      return unitsNear(`hostile ${owner}`, (unit) => isOpponent(owner, unit.owner) || unit.owner === "neutral")(point, range);
    },
    hostileCombatUnitsFor(owner) {
      let units = hostileCombatUnitsByOwner.get(owner);
      if (!units) hostileCombatUnitsByOwner.set(owner, (units = snapshot.units.filter((unit) => (isOpponent(owner, unit.owner) || unit.owner === "neutral") && unit.kind !== "worker")));
      return units.slice();
    },
    forPlayer(owner) {
      let view = viewByOwner.get(owner);
      if (!view) {
        const ownTeam = teamFor(owner);
        view = {
          owner,
          team: ownTeam,
          own: entityView(snapshot, (candidate) => candidate === owner),
          allied: entityView(snapshot, (candidate) => candidate !== owner && candidate !== "neutral" && teamFor(candidate) === ownTeam),
          enemy: entityView(snapshot, (candidate) => candidate !== "neutral" && teamFor(candidate) !== ownTeam),
          neutral: { units: snapshot.units.filter((unit) => unit.owner === "neutral") },
          resources: entitySet(snapshot.resources),
          mercenaryCamps: entitySet(snapshot.mercenaryCamps),
          items: {
            ground: this.groundItems(),
            carried: this.carriedItemsFor(owner),
          },
        };
        viewByOwner.set(owner, view);
      }
      // resources and mercenaryCamps stay the snapshot's own arrays, as before (see claims.ts, which sorts them in place).
      return {
        owner: view.owner,
        team: view.team,
        own: copyEntityView(view.own),
        allied: copyEntityView(view.allied),
        enemy: copyEntityView(view.enemy),
        neutral: { units: view.neutral.units.slice() },
        resources: entitySet(snapshot.resources),
        mercenaryCamps: entitySet(snapshot.mercenaryCamps),
        items: { ground: view.items.ground.slice(), carried: view.items.carried.slice() },
      };
    },
  };
}

function firstById<T extends { id: string }>(entities: T[]) {
  const byId = new Map<string, T>();
  for (const entity of entities) if (!byId.has(entity.id)) byId.set(entity.id, entity);
  return byId;
}

function entityView(snapshot: GameSnapshot, ownerMatches: (owner: Owner) => boolean): SnapshotPlayerEntityView {
  const units = snapshot.units.filter((unit) => ownerMatches(unit.owner));
  const buildings = snapshot.buildings.filter((building) => ownerMatches(building.owner));
  return {
    units,
    workers: units.filter((unit) => unit.kind === "worker"),
    combatUnits: units.filter((unit) => unit.kind !== "worker"),
    buildings,
    completeBuildings: buildings.filter((building) => building.complete),
  };
}

function copyEntityView(view: SnapshotPlayerEntityView): SnapshotPlayerEntityView {
  return {
    units: view.units.slice(),
    workers: view.workers.slice(),
    combatUnits: view.combatUnits.slice(),
    buildings: view.buildings.slice(),
    completeBuildings: view.completeBuildings.slice(),
  };
}

function entitySet<T extends EntityPoint>(all: T[]): SnapshotEntitySet<T> {
  return {
    all,
    nearestTo(point) {
      return nearestEntity(all, point);
    },
  };
}

function nearestEntity<T extends EntityPoint>(candidates: T[], point: EntityPoint): T | undefined {
  return candidates.map((candidate) => ({ candidate, distance: distance(candidate, point) })).sort((a, b) => a.distance - b.distance)[0]?.candidate;
}

function distance(a: EntityPoint, b: EntityPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
