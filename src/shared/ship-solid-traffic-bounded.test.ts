import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createUnit } from './map';
import * as geometry from './navigation-math';
import { beginShipCollisionFrame, shipSolidTraffic } from './ship-collisions';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import type { GameMap } from './types';

const fixture = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/solid-traffic40350/${name}.json.gz`, import.meta.url))).toString());
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('bounded exact solid traffic memo', () => {
  it('recomputes an evicted exact shape without changing its vertices or collision result', () => {
    const map: GameMap = { ...createGame('bareDuel').map, width: 4096, height: 4096,
      terrain: { cols: 128, rows: 128, cell: 32, cells: ','.repeat(128 * 128) } };
    const ship = createUnit('ship', 'player', 'transport', 1000, 1000);
    ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
    const soldier = createUnit('soldier', 'enemy', 'footman', 1150, 1000), units = [ship, soldier];
    beginShipCollisionFrame(units, map);
    const traffic = shipSolidTraffic(map, ship, units);
    const from = { x: 1000, y: 1000, heading: 0 }, to = { x: 1400, y: 1000, heading: 0 };
    const sum = vi.spyOn(geometry, 'minkowskiSum');
    try {
      const first = traffic(from, to);
      expect(sum).toHaveBeenCalledTimes(1);
      const args = structuredClone(sum.mock.calls[0]);
      const polygon = structuredClone(sum.mock.results[0]!.value);
      expect(traffic(from, to)).toBe(first);
      expect(sum).toHaveBeenCalledTimes(1);
      for (let i = 1; i <= 160; i++) traffic({ ...from, heading: i / 200 }, { ...to, heading: i / 200 });
      const before = sum.mock.calls.length;
      expect(traffic(from, to)).toBe(first);
      expect(sum).toHaveBeenCalledTimes(before + 1);
      expect(sum.mock.calls.at(-1)).toStrictEqual(args);
      expect(sum.mock.results.at(-1)!.value).toStrictEqual(polygon);
      expect(traffic(from, to)).toBe(first);
      expect(sum).toHaveBeenCalledTimes(before + 1);
    } finally { sum.mockRestore(); }
  });

  it('completes the real 40350 native step with the complete uncached world and id result', () => {
    const before = fixture('pre-step'), expected = fixture('uncached-after-step');
    const game = createGame('bareDuel');
    restoreSnapshotIntoGame(game, before.snapshot, before.nextId);
    expect(json(snapshotGame(game))).toEqual(before.snapshot);
    expect(game.nextId).toBe(before.nextId);
    stepGame(game);
    expect(game.tick).toBe(40351);
    expect(json(snapshotGame(game))).toEqual(expected.snapshot);
    expect(game.nextId).toBe(expected.nextId);
  }, 15_000);
});
