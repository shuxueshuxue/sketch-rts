import { createDebugReplayTrace, type DebugReplayTrace } from "../shared/replay";
import { createRoom } from "../shared/rooms";
import { createSaveGameRecord, type SaveGameInput, type SaveGameRecord } from "../shared/savegame";
import { createGame, type Game } from "../shared/sim";
import { seconds } from "../shared/time";
import type { BuildingKind, GameSetupOptions, ItemKind, MapId, MercenaryCamp, Owner, PlayerId, RaceId, ScenarioOverride, TerrainLandmark, UnitKind, UnitOrder, WorldItem } from "../shared/types";

type ScenePlayerOptions = {
  team?: string;
  race?: RaceId;
  ai?: boolean;
};

type SceneUnitOptions = {
  id?: string;
  hp?: number;
  xp?: number;
  order?: UnitOrder;
};

type SceneBuildingOptions = {
  id?: string;
  hp?: number;
  maxHp?: number;
  complete?: boolean;
};

type SceneMercenaryOptions = Partial<Omit<MercenaryCamp, "id" | "x" | "y" | "cooldown">> & {
  cooldownSeconds?: number;
};
type SceneItemOptions = Partial<Omit<WorldItem, "id" | "kind" | "x" | "y">>;

export function sketchScene(id: string) {
  return new SceneBuilder(id);
}

export class SceneBuilder {
  private mapId: MapId = "bareDuel";
  private players = new Map<PlayerId, Required<ScenePlayerOptions>>();
  private scenario: ScenarioOverride = {};
  private counters = new Map<string, number>();

  constructor(private readonly id: string) {}

  map(mapId: MapId) {
    this.mapId = mapId;
    return this;
  }

  player(owner: PlayerId, options: ScenePlayerOptions = {}) {
    this.players.set(owner, {
      team: options.team ?? owner,
      race: options.race ?? (this.players.size % 2 === 0 ? "grove" : "ember"),
      ai: options.ai ?? false,
    });
    return this;
  }

  replaceDefaults() {
    this.scenario.replaceDefaultUnits = true;
    this.scenario.replaceDefaultBuildings = true;
    this.scenario.replaceDefaultResources = true;
    this.scenario.replaceDefaultMercenaryCamps = true;
    this.scenario.replaceDefaultLandmarks = true;
    return this;
  }

  unit(owner: Owner, kind: UnitKind, x: number, y: number, options: SceneUnitOptions = {}) {
    this.scenario.addUnits = [
      ...(this.scenario.addUnits ?? []),
      {
        id: options.id ?? this.nextId(`${owner}-${kind}`),
        owner,
        kind,
        x,
        y,
        ...(options.hp !== undefined ? { hp: options.hp } : {}),
        ...(options.xp !== undefined ? { xp: options.xp } : {}),
        ...(options.order ? { order: options.order } : {}),
      },
    ];
    return this;
  }

  worker(owner: PlayerId, x: number, y: number, options: SceneUnitOptions = {}) {
    return this.unit(owner, "worker", x, y, options);
  }

  building(owner: PlayerId, kind: BuildingKind, x: number, y: number, options: SceneBuildingOptions = {}) {
    this.scenario.addBuildings = [
      ...(this.scenario.addBuildings ?? []),
      {
        id: options.id ?? this.nextId(`${owner}-${kind}`),
        owner,
        kind,
        x,
        y,
        ...(options.hp !== undefined ? { hp: options.hp } : {}),
        ...(options.maxHp !== undefined ? { maxHp: options.maxHp } : {}),
        complete: options.complete ?? true,
      },
    ];
    return this;
  }

  townHall(owner: PlayerId, x: number, y: number, options: SceneBuildingOptions = {}) {
    return this.building(owner, "townHall", x, y, options);
  }

  tower(owner: PlayerId, x: number, y: number, options: SceneBuildingOptions = {}) {
    return this.building(owner, "defenseTower", x, y, options);
  }

  goldMine(id: string, x: number, y: number, amount: number) {
    this.scenario.addResources = [...(this.scenario.addResources ?? []), { id, kind: "goldMine", x, y, amount }];
    return this;
  }

  mercenaryCamp(id: string, x: number, y: number, options: SceneMercenaryOptions = {}) {
    this.scenario.addMercenaryCamps = [
      ...(this.scenario.addMercenaryCamps ?? []),
      {
        id,
        x,
        y,
        radius: options.radius ?? 54,
        hireKind: options.hireKind ?? "mercenary",
        cost: options.cost ?? 220,
        stock: options.stock ?? 2,
        cooldown: seconds(options.cooldownSeconds ?? 21),
        cooldownRemaining: options.cooldownRemaining ?? 0,
      },
    ];
    return this;
  }

  item(id: string, kind: ItemKind, x: number, y: number, options: SceneItemOptions = {}) {
    this.scenario.addItems = [
      ...(this.scenario.addItems ?? []),
      {
        id,
        kind,
        x,
        y,
        ...(options.carrierId ? { carrierId: options.carrierId } : {}),
        cooldownRemaining: options.cooldownRemaining ?? 0,
      },
    ];
    return this;
  }

  landmark(id: string, kind: TerrainLandmark["kind"], x: number, y: number, size: number, rotation = 0) {
    this.scenario.addLandmarks = [...(this.scenario.addLandmarks ?? []), { id, kind, x, y, size, rotation }];
    return this;
  }

  build() {
    return new BuiltScene(this.id, this.mapId, this.toGameSetup());
  }

  toGameSetup(): GameSetupOptions {
    const players = [...this.players.keys()];
    return {
      players,
      aiPlayers: players.filter((owner) => this.players.get(owner)?.ai),
      teams: Object.fromEntries(players.map((owner) => [owner, this.players.get(owner)!.team])),
      races: Object.fromEntries(players.map((owner) => [owner, this.players.get(owner)!.race])),
      scenario: clone(this.scenario),
    };
  }

  private nextId(kind: string) {
    const count = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, count);
    return `scene-${this.id}-${kind}-${count}`;
  }
}

export class BuiltScene {
  constructor(readonly id: string, readonly mapId: MapId, private readonly setup: GameSetupOptions) {}

  toGameSetup(): GameSetupOptions {
    return clone(this.setup);
  }

  createGame(): Game {
    return createGame(this.mapId, this.toGameSetup());
  }

  save(input: SaveGameInput): SaveGameRecord {
    const game = this.createGame();
    const room = {
      ...createRoom({ id: `scene-${this.id}-room`, host: { id: "scene-host", name: "Scene Host" }, mapId: this.mapId }),
      status: "inMatch" as const,
    };
    return createSaveGameRecord(game, room, input, new Date(), this.setup.aiPlayers ?? []);
  }

  debugReplay(input: SaveGameInput): DebugReplayTrace {
    const initialSave = this.save({ id: `${input.id}-initial`, ...(input.label ? { label: input.label } : {}) });
    return createDebugReplayTrace({ id: input.id, ...(input.label ? { label: input.label } : {}), initialSave });
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
