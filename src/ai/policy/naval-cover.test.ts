import { describe, expect, it } from 'vitest';
import { boardUnit } from '../../shared/decks';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround } from '../../shared/terrain';
import { seconds } from '../../shared/time';
import type { RaceId } from '../../shared/types';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from '../bootstrap_1/policy';
import { createAiPolicyMemory } from '../memory';
import { planNavalTactics } from './naval';

function crossing(race: RaceId, phase: 'loading' | 'sailing') {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], races: { player: race }, scenario: {
    players: { player: { gold: 500 } },
    replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true,
    replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true,
    addBuildings: [{ id: 'home', owner: 'player', kind: 'townHall', x: 112, y: 112 }],
    addResources: [{ id: 'island', kind: 'goldMine', x: 2256, y: 400, amount: 6000 }],
  } });
  const cols = 80, rows = 36, cell = 32;
  const cells = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => {
    const island = col >= 66 && col <= 76 && row >= 8 && row <= 24;
    const shore = col >= 65 && col <= 77 && row >= 7 && row <= 25;
    return col <= 8 || island ? '.' : col === 9 || shore ? ',' : '~';
  }).join('')).join('');
  game.map = { ...game.map, width: cols * cell, height: rows * cell, terrain: { cell, cols, rows, cells } };
  game.scriptedVictory = true;
  const boat = game.spawnUnit('player', 'transport', phase === 'loading' ? 400 : 1600, 528);
  const passenger = game.spawnUnit('player', 'footman', boat.x, boat.y);
  expect(boardUnit(boat, passenger, game.units)).toBe(true);
  const enemy = game.spawnUnit('enemy', 'warship', 1920, 720);
  enemy.order = { type: 'hold', x: enemy.x, y: enemy.y };
  const memory = createAiPolicyMemory();
  const mission = { purpose: 'settle' as const, targetId: 'island', from: { x: 304, y: 528 },
    to: { x: 2096, y: 528 }, phase, crewIds: [], sinceTick: game.tick };
  memory.naval = { island: { tick: game.tick, plan: { mineId: 'island', landing: mission.to } },
    ferries: { [boat.id]: mission } };
  // Keep a worker aboard so the colony is a legitimate departure.
  const worker = game.spawnUnit('player', 'worker', boat.x, boat.y);
  expect(boardUnit(boat, worker, game.units)).toBe(true);
  return { game, boat, passenger, worker, enemy, memory, mission };
}

describe('actual convoy cover', () => {
  for (const version of BOOTSTRAP_VERSIONS) for (const race of ['grove', 'ember'] as const) {
    it(`${version}/${race} crosses with nearby guns and returns when those escorts withdraw`, () => {
      const { game, boat, memory, mission } = crossing(race, 'sailing');
      const escorts = [game.spawnUnit('player', 'warship', 1500, 700),
        game.spawnUnit('player', 'warship', 1450, 950), game.spawnUnit('player', 'warship', 1700, 1000)];
      const context = () => bootstrapPolicyContext(snapshotGame(game), 'player', version, { memory });
      const supported = planNavalTactics(snapshotGame(game), 'player', context());
      expect(mission.phase).toBe('sailing');
      expect(supported).toContainEqual({ type: 'unload', unitIds: [boat.id], ...mission.to });
      for (const command of supported) issuePlayerCommand(game, 'player', command);
      stepGame(game);
      for (const escort of escorts) escort.hp = escort.maxHp * .3;
      const retreat = planNavalTactics(snapshotGame(game), 'player', context());
      expect(mission.phase).toBe('return');
      expect(retreat).toContainEqual({ type: 'unload', unitIds: [boat.id], ...mission.from, avoidCombat: true });
      for (const command of retreat) issuePlayerCommand(game, 'player', command);
      expect(boat.order).toMatchObject({ type: 'unload', ...mission.from, avoidCombat: true });
    });
  }

  it.each(['loading', 'sailing'] as const)('does not count a remote healthy fleet during %s', phase => {
    const { game, boat, memory, mission } = crossing('grove', phase);
    for (const [x, y] of [[500, 700], [500, 950], [700, 1000]]) game.spawnUnit('player', 'warship', x!, y!);
    const commands = planNavalTactics(snapshotGame(game), 'player', bootstrapPolicyContext(snapshotGame(game), 'player', 'v9_knight', { memory }));
    expect(mission.phase).toBe(phase === 'sailing' ? 'return' : 'loading');
    expect(commands).not.toContainEqual({ type: 'unload', unitIds: [boat.id], ...mission.to });
    for (const command of commands) issuePlayerCommand(game, 'player', command);
  });

  it('lands its living passengers back at the departure coast after losing cover', () => {
    const { game, boat, passenger, worker, memory, mission } = crossing('grove', 'sailing');
    for (let tick = 0; tick < seconds(100) && worker.deck; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game);
        for (const command of planNavalTactics(snapshot, 'player', bootstrapPolicyContext(snapshot, 'player', 'v9_archer', { memory })))
          issuePlayerCommand(game, 'player', command);
      }
      stepGame(game);
    }
    expect(game.units).toContain(boat);
    expect(game.units).toContain(passenger);
    expect(game.units).toContain(worker);
    expect(worker.deck).toBeUndefined();
    expect(passenger.deck).toBeUndefined();
    expect(sameGround(game.map, worker, mission.from)).toBe(true);
    expect(sameGround(game.map, passenger, mission.from)).toBe(true);
  }, 15000);
});
