import { describe, expect, it } from 'vitest';
import { boardUnit, syncDecks } from './decks';
import { createUnit } from './map';
import { keepShipsOnWater } from './sailing';
import { hullContact, shipPassengers, shipProfile } from './ship-geometry';
import { createGame, issuePlayerCommand, stepGame, type Game } from './sim';
import type { Terrain } from './terrain';
import type { ScenarioUnitSeed, Unit, UnitKind } from './types';

// See @@@board-phase: a boarding says where it stands on its order, and ends with a reason when it cannot finish.
type Phase = Extract<Unit['order'], { type: 'board' }>['phase'];
const phaseOf = (unit: Unit) => unit.order.type === 'board' ? unit.order : undefined;

function sea() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = [];
  game.effects = []; game.projectiles = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 4096, height: 4096, wind: { direction: Math.PI / 2, speed: 80 }, terrain: { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) } };
  return game;
}
function pair(owner: Unit['owner']) {
  const game = sea(), source = game.spawnUnit('player', 'transport', 1500, 1500), target = game.spawnUnit(owner, 'transport', 1500, 1900);
  source.sailing!.heading = target.sailing!.heading = 0;
  target.y = source.y + (shipProfile(source)!.beam + shipProfile(target)!.beam) / 2 + 12;
  for (const ship of [source, target]) ship.order = { type: 'hold', x: ship.x, y: ship.y };
  return { game, source, target };
}
function crew(game: Game, ship: Unit, kind: UnitKind = 'footman') {
  const unit = createUnit(`crew-${game.units.length}-${kind}`, ship.owner, kind, ship.x, ship.y); game.units.push(unit);
  expect(boardUnit(ship, unit, game.units)).toBe(true);
  unit.order = { type: 'hold', x: unit.x, y: unit.y }; return unit;
}

describe('a boarding order says where it stands', () => {
  it('waits while the hulls are apart, then crosses, and ends aboard as idle', () => {
    const { game, source, target } = pair('player'), walker = crew(game, source);
    syncDecks(game.units);
    expect(hullContact(source, target)).toBeUndefined();
    issuePlayerCommand(game, 'player', { type: 'board', unitIds: [walker.id], transportId: target.id });
    stepGame(game);
    expect(phaseOf(walker)).toMatchObject({ phase: 'waiting', blockedBy: 'ships-apart' });
    const seen = new Set<Phase>();
    for (let tick = 0; tick < 900 && walker.order.type === 'board'; tick++) { stepGame(game); seen.add(phaseOf(walker)?.phase); }
    expect(seen.has('crossing')).toBe(true);
    expect(walker.order.type).toBe('idle');
    expect(walker.deck?.shipId).toBe(target.id);
  });

  it('queues behind the crew nearer the entry and fights the defender there, keeping its board order', () => {
    const { game, source, target } = pair('enemy'), attackers = [crew(game, source), crew(game, source)], blocker = crew(game, target);
    syncDecks(game.units);
    issuePlayerCommand(game, 'player', { type: 'boardShip', unitIds: [source.id], targetId: target.id });
    const phases = new Set<Phase>(), struck = new Set<string>();
    for (let tick = 0; tick < 600 && blocker.hp === blocker.maxHp; tick++) {
      stepGame(game);
      for (const unit of attackers) { const order = phaseOf(unit); phases.add(order?.phase); if (order?.strikeId) struck.add(order.strikeId); }
    }
    expect(blocker.hp).toBeLessThan(blocker.maxHp);
    expect(phases.has('queued')).toBe(true);
    expect(phases.has('fighting')).toBe(true);
    expect([...struck]).toEqual([blocker.id]);
    for (const unit of attackers) expect(unit.order.type).toBe('board');
  });
});

// A strip of land, shallows and sea, as in naval.test.ts.
function coast(): Terrain {
  let cells = '';
  for (let row = 0; row < 20; row += 1) for (let col = 0; col < 30; col += 1) cells += col <= 8 ? '.' : col === 9 ? ',' : '~';
  return { cell: 32, cols: 30, rows: 20, cells };
}
const at = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 });

describe('a boarding from the shore', () => {
  it('approaches, and those the transport cannot take end with no-room instead of a bare idle', () => {
    const units: ScenarioUnitSeed[] = [{ id: 'transport', owner: 'player', kind: 'transport', ...at(11, 9) },
      ...[8, 9, 10, 11].map((row, index) => ({ id: `w${index}`, owner: 'player' as const, kind: 'worker' as const, ...at(5, row) })),
      { id: 'f1', owner: 'player', kind: 'footman', ...at(4, 9) }, { id: 'f2', owner: 'player', kind: 'footman', ...at(4, 10) },
      { id: 'g1', owner: 'player', kind: 'rockGolem', ...at(3, 10) }];
    const game = createGame('bareDuel', { players: ['player', 'enemy'], scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true,
      addBuildings: [{ id: 'hall-a', owner: 'player', kind: 'townHall', ...at(2, 2) }, { id: 'hall-b', owner: 'enemy', kind: 'townHall', ...at(2, 17) }], addUnits: units } });
    const terrain = coast();
    game.map = { ...game.map, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell, terrain };
    keepShipsOnWater(game.map, game.units);
    const passengers = game.units.filter((unit) => unit.id !== 'transport');
    issuePlayerCommand(game, 'player', { type: 'board', unitIds: passengers.map((unit) => unit.id), transportId: 'transport' });
    stepGame(game);
    for (const unit of passengers) expect(phaseOf(unit)?.phase).toBe('approaching');
    const refused = new Set<string>();
    for (let tick = 0; tick < 800; tick++) {
      stepGame(game);
      for (const effect of game.effects) if (effect.type === 'orderEnded' && effect.orderType === 'board' && effect.reason === 'no-room') refused.add(effect.unitId!);
    }
    const aboard = shipPassengers(game.units, game.units.find((unit) => unit.id === 'transport')!).map((unit) => unit.id);
    expect(aboard.length).toBeGreaterThan(1);
    expect([...refused].sort()).toEqual(passengers.map((unit) => unit.id).filter((id) => !aboard.includes(id)).sort());
  });
});
