import type { Building, BuildingKind, GameSnapshot, MercenaryCamp, Owner, PlayerId, ResourceNode, Unit, WorldItem } from "../../shared/types";

export type SnapshotQueryOptions = {
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
  forPlayer(owner: PlayerId): SnapshotPlayerView;
};

export function createSnapshotQuery(snapshot: GameSnapshot, options: SnapshotQueryOptions = {}): SnapshotQuery {
  const teamFor = (owner: Owner) => (owner === "neutral" ? "neutral" : options.teams?.[owner] ?? owner);
  const isOpponent = (owner: PlayerId, other: Owner) => other !== "neutral" && teamFor(owner) !== teamFor(other);
  return {
    snapshot,
    teamFor,
    isOpponent,
    activePlayerIds() {
      return Object.keys(snapshot.players).filter((owner) => snapshot.units.some((unit) => unit.owner === owner) || snapshot.buildings.some((building) => building.owner === owner));
    },
    opponentPlayerIds(owner) {
      return this.activePlayerIds().filter((candidate) => isOpponent(owner, candidate));
    },
    unitById(id) {
      return snapshot.units.find((unit) => unit.id === id);
    },
    buildingById(id) {
      return snapshot.buildings.find((building) => building.id === id);
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
    mercenaryCamps() {
      return snapshot.mercenaryCamps;
    },
    items() {
      return snapshot.items;
    },
    groundItems() {
      return snapshot.items.filter((item) => !item.carrierId);
    },
    carriedItemsFor(owner) {
      const ownUnitIds = new Set(this.unitsFor(owner).map((unit) => unit.id));
      return snapshot.items.filter((item) => item.carrierId && ownUnitIds.has(item.carrierId));
    },
    buildings() {
      return snapshot.buildings;
    },
    unitsFor(owner) {
      return snapshot.units.filter((unit) => unit.owner === owner);
    },
    combatUnitsFor(owner) {
      return this.unitsFor(owner).filter((unit) => unit.kind !== "worker");
    },
    buildingsFor(owner) {
      return snapshot.buildings.filter((building) => building.owner === owner);
    },
    completeBuildingsFor(owner, kind) {
      return this.buildingsFor(owner).filter((building) => building.complete && (kind === undefined || building.kind === kind));
    },
    neutralUnitsNear(point, range) {
      return snapshot.units.filter((unit) => unit.owner === "neutral" && distance(unit, point) <= range);
    },
    opponentUnitsNear(owner, point, range) {
      return snapshot.units.filter((unit) => isOpponent(owner, unit.owner) && distance(unit, point) <= range);
    },
    opponentBuildingsNear(owner, point, range) {
      return snapshot.buildings.filter((building) => isOpponent(owner, building.owner) && distance(building, point) <= range);
    },
    forPlayer(owner) {
      const ownTeam = teamFor(owner);
      return {
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
    },
  };
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
