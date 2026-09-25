import { sketchScene } from "../../sdk/scene";
import type { BenchmarkMatchInput } from "../../sdk/benchmark/core";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { BuildingKind, GameSnapshot, ItemKind, MapId, PlayerId, RaceId, UnitKind, UpgradeKind } from "../../shared/types";
import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";

// @@@v5-arena - A fight replayed on its own. The 1v2 benchmark decides a game by everything that happened before and
// after a fight, so a better fight often shows up as noise. The arena keeps only the armies, buildings, upgrades and
// carried items of one real moment and lets the real policies play it out for a short window: micro and squad changes
// get a signal that is not buried under the rest of the game. The subject is the player whose fights these are: V5 in its
// 1v2 benchmark, V6 in the V6 gauntlet.

export const ARENA_SECONDS = 90;

export type ArenaUnitSeed = { id: string; owner: PlayerId; kind: UnitKind; x: number; y: number; hpRatio: number; xp: number };
export type ArenaBuildingSeed = { id: string; owner: PlayerId; kind: BuildingKind; x: number; y: number; hp: number; maxHp: number };
export type ArenaItemSeed = { id: string; kind: ItemKind; carrierId: string };

export type ArenaScenario = {
  id: string;
  subject?: PlayerId;
  source: { seed: string; match: string; second: number; outcome: string };
  mapId: MapId;
  agents: Record<string, AiGameAgent>;
  players: Record<string, { team: string; race: RaceId; upgrades: Partial<Record<UpgradeKind, number>> }>;
  units: ArenaUnitSeed[];
  buildings: ArenaBuildingSeed[];
  items: ArenaItemSeed[];
};

export type ArenaResult = {
  id: string;
  outcome: string;
  subjectStart: number;
  enemyStart: number;
  subjectLost: number;
  enemyLost: number;
  subjectBuildingsLost: number;
  enemyBuildingsLost: number;
};

export function captureArenaScenario(input: {
  id: string;
  subject?: PlayerId;
  source: ArenaScenario["source"];
  match: BenchmarkMatchInput<AiGameAgent>;
  snapshot: GameSnapshot;
}): ArenaScenario {
  const { snapshot, match } = input;
  if (!match.mapId) throw new Error(`Arena capture needs the map of ${match.name}`);
  const owners = Object.keys(match.agents) as PlayerId[];
  const fighters = snapshot.units.filter((unit) => owners.includes(unit.owner as PlayerId) && unit.kind !== "worker" && unit.kind !== "spirit");
  const fighterIds = new Set(fighters.map((unit) => unit.id));
  return {
    id: input.id,
    ...(input.subject ? { subject: input.subject } : {}),
    source: input.source,
    mapId: match.mapId,
    agents: match.agents,
    players: Object.fromEntries(
      owners.map((owner) => {
        const agent = match.agents[owner]!;
        return [owner, { team: agent.team ?? owner, race: agent.race ?? snapshot.players[owner]!.race, upgrades: { ...snapshot.players[owner]!.upgrades } }];
      }),
    ),
    units: fighters.map((unit) => ({ id: unit.id, owner: unit.owner as PlayerId, kind: unit.kind, x: unit.x, y: unit.y, hpRatio: Math.min(1, unit.hp / Math.max(1, unit.maxHp)), xp: unit.xp })),
    buildings: snapshot.buildings
      .filter((building) => building.complete && owners.includes(building.owner))
      .map((building) => ({ id: building.id, owner: building.owner, kind: building.kind, x: building.x, y: building.y, hp: building.hp, maxHp: building.maxHp })),
    items: snapshot.items.flatMap((item) => (item.carrierId && fighterIds.has(item.carrierId) ? [{ id: item.id, kind: item.kind, carrierId: item.carrierId }] : [])),
  };
}

export function arenaMatch(scenario: ArenaScenario, options: { thinkInterval: number }): BenchmarkMatchInput<AiGameAgent> {
  let scene = sketchScene(`arena-${scenario.id}`).map(scenario.mapId).replaceDefaults();
  for (const [owner, player] of Object.entries(scenario.players)) {
    scene = scene.player(owner as PlayerId, { team: player.team, race: player.race }).playerState(owner as PlayerId, { gold: 0, upgrades: player.upgrades });
  }
  for (const building of scenario.buildings) scene = scene.building(building.owner, building.kind, building.x, building.y, { id: building.id, maxHp: building.maxHp, hp: building.hp });
  for (const unit of scenario.units) scene = scene.unit(unit.owner, unit.kind, unit.x, unit.y, { id: unit.id, xp: unit.xp, hpRatio: unit.hpRatio });
  // The map still lays out its own treasure, so carried copies take arena ids.
  for (const item of scenario.items) scene = scene.item(`arena-${item.id}`, item.kind, 0, 0, { carrierId: item.carrierId });
  return {
    name: `arena ${scenario.id}`,
    mapId: scenario.mapId,
    options: scene.toGameSetup(),
    agents: scenario.agents,
    commandPlanner: createAiGameCommandPlanner(),
    maxTicks: ARENA_SECONDS * 20,
    thinkInterval: options.thinkInterval,
  };
}

export function scoreArena(scenario: ArenaScenario, final: GameSnapshot): ArenaResult {
  const subject = arenaSubject(scenario);
  const alive = new Set(final.units.map((unit) => unit.id));
  const standing = new Set(final.buildings.map((building) => building.id));
  // Summoned spirits cost nothing, so losing one costs nothing.
  const value = (kind: UnitKind) => UNIT_DEFS[kind].cost;
  const units = (mine: boolean) => scenario.units.filter((unit) => (unit.owner === subject) === mine);
  const buildings = (mine: boolean) => scenario.buildings.filter((building) => (building.owner === subject) === mine);
  return {
    id: scenario.id,
    outcome: scenario.source.outcome,
    subjectStart: units(true).reduce((total, unit) => total + value(unit.kind), 0),
    enemyStart: units(false).reduce((total, unit) => total + value(unit.kind), 0),
    subjectLost: units(true).filter((unit) => !alive.has(unit.id)).reduce((total, unit) => total + value(unit.kind), 0),
    enemyLost: units(false).filter((unit) => !alive.has(unit.id)).reduce((total, unit) => total + value(unit.kind), 0),
    subjectBuildingsLost: buildings(true).filter((building) => !standing.has(building.id)).reduce((total, building) => total + BUILDING_DEFS[building.kind].cost, 0),
    enemyBuildingsLost: buildings(false).filter((building) => !standing.has(building.id)).reduce((total, building) => total + BUILDING_DEFS[building.kind].cost, 0),
  };
}

// Scenarios captured before subjects existed are V5's.
export function arenaSubject(scenario: ArenaScenario): PlayerId {
  const subject = scenario.subject ?? Object.entries(scenario.agents).find(([, agent]) => agent.version === "v5")?.[0];
  if (!subject || !scenario.agents[subject]) throw new Error(`Arena scenario ${scenario.id} has no subject player`);
  return subject;
}
