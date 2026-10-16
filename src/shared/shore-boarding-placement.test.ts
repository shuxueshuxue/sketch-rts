import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { boardUnit, canBoard, deckLoad, deckPlacement, deckPointFits } from './decks';
import { alongside } from './naval';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame } from './sim';
import { checkCommandLegality } from './sim/command-validation';
import { isInCabin, shipCabinUsage } from './ship-cabin';
import { shipPassengers, shipProfile } from './ship-geometry';
import type { GameSnapshot, Unit } from './types';

// Complete actual 208201 clinical save: manual loading, original a7 runtime,
// 25 true passengers, 10 in cabin. This is not an autonomous policy result.
const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/cabin-clinical-208201.json.gz', import.meta.url))).toString()) as {
  snapshot: GameSnapshot; nextId: number;
};
const HULL = 'unit-p0-carrier-25442', WALKER = 'unit-p0-ashHexer-23349';
function scene() {
  const snapshot = structuredClone(saved.snapshot);
  const hull = snapshot.units.find(unit => unit.id === HULL)!;
  const walker = snapshot.units.find(unit => unit.id === WALKER)!;
  return { snapshot, hull, walker };
}

describe('shore boarding uses actual attachment placement', () => {
  it('admits the real narrow free point missed by the coarser query', () => {
    const { snapshot, hull, walker } = scene();
    const untouched = structuredClone(snapshot);
    expect(shipPassengers(snapshot.units, hull)).toHaveLength(25);
    expect(shipPassengers(snapshot.units, hull).filter(isInCabin)).toHaveLength(10);
    expect(shipCabinUsage(snapshot, hull)).toEqual({ capacity: 21, used: 20, free: 1, overCapacity: 0 });
    expect(deckLoad(snapshot.units, hull)).toBe(4768);
    expect(deckPlacement(hull, walker, snapshot.units)).toBeUndefined();
    expect(alongside(walker, hull)).toBe(false);

    expect(canBoard(hull, walker, snapshot.units)).toBe(true);
    expect(snapshot).toEqual(untouched);
    const copy = structuredClone(snapshot);
    const copyHull = copy.units.find(unit => unit.id === HULL)!;
    const copyWalker = copy.units.find(unit => unit.id === WALKER)!;
    expect(boardUnit(copyHull, copyWalker, copy.units)).toBe(true);
    expect(copyWalker.deck).toEqual({ shipId: HULL, x: 116.16, y: 0.03999999999999204 });
    expect(deckPointFits(copyHull, copyWalker, copyWalker.deck!, copy.units)).toBe(true);
    expect(deckLoad(copy.units, copyHull)).toBe(4853);
  });

  it('passes public validation and issues a board order without attaching the distant walker', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
    expect(snapshotGame(game)).toEqual(saved.snapshot);
    expect(game.nextId).toBe(saved.nextId);
    const walker = game.units.find(unit => unit.id === WALKER)!;
    const hull = game.units.find(unit => unit.id === HULL)!;
    const before = { x: walker.x, y: walker.y, hp: walker.hp };
    const command = { type: 'board' as const, unitIds: [WALKER], transportId: HULL };
    expect(checkCommandLegality(game, 'p0', command)).toBeUndefined();
    issuePlayerCommand(game, 'p0', command);
    expect(walker.order).toMatchObject({ type: 'board', transportId: HULL });
    expect(walker.deck).toBeUndefined();
    expect({ x: walker.x, y: walker.y, hp: walker.hp }).toEqual(before);
    expect(shipPassengers(game.units, hull)).toHaveLength(25);
    expect(game.tick).toBe(208201);
    expect(game.nextId).toBe(saved.nextId);
  });

  it.each([
    ['another owner on shore', (_hull: Unit, walker: Unit) => { walker.owner = 'p1'; }],
    ['already on the same deck', (hull: Unit, walker: Unit) => { walker.deck = { shipId: hull.id, x: 0, y: 0 }; }],
    ['inside the same cabin', (hull: Unit, walker: Unit) => { walker.deck = { shipId: hull.id, x: 0, y: 0 }; walker.cabin = { shipId: hull.id }; }],
    ['unknown source deck', (_hull: Unit, walker: Unit) => { walker.deck = { shipId: 'missing-source', x: 0, y: 0 }; }],
    ['payload full', (hull: Unit) => { hull.holdMass = shipProfile(hull)!.loadCapacity; }],
  ] as const)('keeps the original refusal for %s', (_label, change) => {
    const { snapshot, hull, walker } = scene();
    change(hull, walker);
    expect(canBoard(hull, walker, snapshot.units)).toBe(false);
  });
});
