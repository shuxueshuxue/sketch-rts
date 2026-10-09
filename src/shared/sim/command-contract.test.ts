import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame } from '../sim';
import { applyCommandFrame } from './frame';
import { boardUnit } from '../decks';
import { checkCommandLegality } from './command-validation';
import { seconds } from '../time';

describe("simulation command contract", () => {
  it("keeps map lifecycle commands out of gameplay command surfaces", () => {
    const lifecycleCommand = "start" + "Map";
    const commandSurfaceFiles = [
      "src/shared/types.ts",
      "src/shared/sim.ts",
      "src/shared/sim/frame.ts",
      "src/shared/sim/command-validation.ts",
      "src/server/index.ts",
      "src/sdk/client.test.ts",
      "scripts/sdk-smoke.ts",
    ];

    const offenders = commandSurfaceFiles.filter((file) => readFileSync(file, "utf8").includes(lifecycleCommand));

    expect(offenders).toEqual([]);
  });

  it('preserves another owner’s course when an admitted boarding issuer is captured before its frame', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.units = []; game.buildings = []; game.items = [];
    game.map.terrain = { cell: 64, cols: 64, rows: 64, cells: '~'.repeat(64 * 64) };
    const source = game.spawnUnit('player', 'warship', 1000, 1000);
    const target = game.spawnUnit('enemy', 'warship', 2000, 1000);
    const crew = game.spawnUnit('player', 'worker', source.x, source.y);
    expect(boardUnit(source, crew, game.units)).toBe(true);
    const boarding = { type: 'boardShip' as const, unitIds: [source.id], targetId: target.id };
    expect(checkCommandLegality(game, 'player', boarding)).toBeUndefined();
    source.owner = 'enemy';
    target.order = { type: 'move', x: 3000, y: 1800 };
    const before = snapshotGame(game);
    applyCommandFrame(game, { roomId: 'boarding-contract', tick: game.tick, sequence: 1, commands: [
      { playerId: 'player', command: boarding },
      { playerId: 'player', command: { type: 'cancelBoardShip', unitIds: [source.id] } },
    ] });
    expect(snapshotGame(game)).toEqual(before);
  });

  it('enforces boarding cooldown for direct commands and drops a now cooling request from its accepted frame', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.units = []; game.buildings = []; game.items = [];
    game.map.terrain = { cell: 64, cols: 64, rows: 64, cells: '~'.repeat(64 * 64) };
    const source = game.spawnUnit('player', 'warship', 1000, 1000);
    const target = game.spawnUnit('player', 'warship', 2000, 1000);
    const crew = game.spawnUnit('player', 'worker', source.x, source.y);
    expect(boardUnit(source, crew, game.units)).toBe(true);
    const command = { type: 'boardShip' as const, unitIds: [source.id], targetId: target.id };
    expect(checkCommandLegality(game, 'player', command)).toBeUndefined();
    source.sailing!.gangwayCooldownUntilTick = game.tick + seconds(20);
    const before = snapshotGame(game);
    expect(() => issuePlayerCommand(game, 'player', command)).toThrow('Boarding is cooling down');
    applyCommandFrame(game, { roomId: 'boarding-contract', tick: game.tick, sequence: 1,
      commands: [{ playerId: 'player', command }] });
    expect(snapshotGame(game)).toEqual(before);
    expect(() => issuePlayerCommand(game, 'player', { type: 'cancelBoardShip', unitIds: [source.id] })).not.toThrow();
  });
});
