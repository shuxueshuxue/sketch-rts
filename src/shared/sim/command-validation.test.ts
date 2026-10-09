import { describe, expect, it } from "vitest";
import { createBuilding } from "../map";
import { createGame, snapshotGame } from "../sim";
import { boardUnit } from '../decks';
import { seconds } from '../time';
import { resolveVariant } from '../catalog';
import { checkCommandLegality, commandValidationError, narrowFrameCommandToLiveOperands } from "./command-validation";

function boardingScene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = [];
  game.map.terrain = { cell: 64, cols: 64, rows: 64, cells: '~'.repeat(64 * 64) };
  const source = game.spawnUnit('player', 'warship', 800, 1000);
  const target = game.spawnUnit('enemy', 'warship', 3000, 1000);
  const crew = game.spawnUnit('player', 'worker', source.x, source.y);
  expect(boardUnit(source, crew, game.units)).toBe(true);
  return { game, source, target, crew, command: { type: 'boardShip' as const, unitIds: [source.id], targetId: target.id } };
}

describe("command admission validation", () => {
  it("rejects heal on enemies and curse on allies at admission", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const priest = game.spawnUnit("player", "priest", 900, 900);
    const witch = game.spawnUnit("player", "witch", 930, 900);
    const ally = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const enemy = game.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    expect(ally).toBeDefined();
    expect(enemy).toBeDefined();

    expect(commandValidationError(snapshotGame(game), "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: enemy!.id })).toBe("Heal requires an allied unit target");
    expect(commandValidationError(snapshotGame(game), "player", { type: "cast", unitId: witch.id, ability: "curse", targetId: ally!.id })).toBe("Curse requires an enemy unit target");
  });

  it("allows heal on a different owner when room teams mark that owner as allied", () => {
    const game = createGame("bareDuel", { aiPlayers: [], teams: { player: "north", enemy: "north" } });
    const priest = game.spawnUnit("player", "priest", 900, 900);
    const alliedWorker = game.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    expect(alliedWorker).toBeDefined();

    expect(commandValidationError(snapshotGame(game), "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: alliedWorker!.id })).toBeUndefined();
  });

  it("admits following an own or an ally's unit, and refuses following an enemy's", () => {
    const allied = createGame("bareDuel", { aiPlayers: [], teams: { player: "north", enemy: "north" } });
    const footman = allied.spawnUnit("player", "footman", 900, 900);
    const alliedWorker = allied.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker")!;
    const ownWorker = allied.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    expect(commandValidationError(snapshotGame(allied), "player", { type: "follow", unitIds: [footman.id], targetId: alliedWorker.id })).toBeUndefined();
    expect(commandValidationError(snapshotGame(allied), "player", { type: "follow", unitIds: [footman.id], targetId: ownWorker.id })).toBeUndefined();

    const duel = createGame("bareDuel", { aiPlayers: [] });
    const rival = duel.spawnUnit("player", "footman", 900, 900);
    const enemyWorker = duel.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker")!;
    expect(commandValidationError(snapshotGame(duel), "player", { type: "follow", unitIds: [rival.id], targetId: enemyWorker.id })).toBe(`Unknown friendly unit ${enemyWorker.id}`);
  });

  it("rejects rally commands for buildings that do not train units", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const farm = createBuilding("player-rallyless-farm", "player", "farm", 900, 900, true);
    game.buildings.push(farm);

    expect(commandValidationError(snapshotGame(game), "player", { type: "setRally", buildingIds: [farm.id], x: 960, y: 900, target: { type: "point" } })).toBe("farm has no training rally point");
  });

  it('admits distant boarding approaches and friendly transfers without granting control of another owner’s hull', () => {
    const { game, source, target, command } = boardingScene();
    expect(commandValidationError(game, 'player', command)).toBeUndefined();
    target.owner = 'player';
    expect(commandValidationError(game, 'player', command)).toBeUndefined();
    source.owner = 'enemy';
    expect(commandValidationError(game, 'player', command)).toBe(`Unknown player unit ${source.id}`);
  });

  it('requires living exposed walking crew and honors the exact boarding cooldown boundary', () => {
    const { game, source, crew, command } = boardingScene();
    crew.cabin = { shipId: source.id };
    expect(commandValidationError(game, 'player', command)).toContain('exposed walking crew');
    crew.cabin = undefined; crew.radius = 21;
    expect(commandValidationError(game, 'player', command)).toContain('exposed walking crew');
    crew.radius = 20;
    expect(commandValidationError(game, 'player', command)).toBeUndefined();
    game.variants = { machine: resolveVariant({ base: 'worker', unitClass: 'mechanical' }) };
    crew.variant = 'machine';
    expect(commandValidationError(game, 'player', command)).toContain('exposed walking crew');
    delete crew.variant;
    crew.hp = 0;
    expect(commandValidationError(game, 'player', command)).toContain('exposed walking crew');
    crew.hp = crew.maxHp;
    source.sailing!.gangwayCooldownUntilTick = game.tick + seconds(20);
    expect(checkCommandLegality(game, 'player', command)).toEqual({ message: 'Boarding is cooling down', transient: true });
    expect(commandValidationError(game, 'player', { type: 'cancelBoardShip', unitIds: [source.id] })).toBeUndefined();
    game.tick += seconds(20);
    expect(commandValidationError(game, 'player', command)).toBeUndefined();
    expect(commandValidationError(game, 'player', { type: 'cancelBoardShip', unitIds: [source.id] })).toBeUndefined();
  });

  it('rejects self boarding, unreachable separate waters, and incompatible deck heights', () => {
    const { game, source, target, command } = boardingScene();
    expect(commandValidationError(game, 'player', { ...command, targetId: source.id })).toContain('another living ship');
    target.deckScale = 8;
    expect(commandValidationError(game, 'player', command)).toContain('height');
    delete target.deckScale;
    game.map.terrain = { ...game.map.terrain!, cells: Array.from({ length: 64 }, () => '~'.repeat(31) + '#' + '~'.repeat(32)).join('') };
    expect(commandValidationError(game, 'player', command)).toBe('Ships are in separate waters');
  });

  it('drops stale targets and captured issuers from accepted boarding frames', () => {
    const { game, source, target, command } = boardingScene();
    target.hp = 0;
    expect(checkCommandLegality(game, 'player', command)?.transient).toBe(true);
    expect(narrowFrameCommandToLiveOperands(game, 'player', command)).toBeUndefined();
    target.hp = target.maxHp;
    const second = game.spawnUnit('player', 'transport', 1000, 1500);
    source.owner = 'enemy';
    expect(narrowFrameCommandToLiveOperands(game, 'player', { ...command, unitIds: [source.id, second.id] }))
      .toEqual({ ...command, unitIds: [second.id] });
    second.hp = 0;
    expect(narrowFrameCommandToLiveOperands(game, 'player', { type: 'cancelBoardShip', unitIds: [second.id] })).toBeUndefined();
  });
});
