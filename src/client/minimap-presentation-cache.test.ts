import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { createMapPresentation } from '../shared/presentation';
import { createGame, snapshotGame } from '../shared/sim';
import type { GameSnapshot } from '../shared/types';
import { MinimapPresentationCache } from './minimap-presentation-cache';
import { drawMinimapMap } from './minimap-art';
import { LocalGameAdapter } from './net/local-adapter';

function pixels(snapshot: GameSnapshot, marks: ReturnType<typeof createMapPresentation>, viewer?: string) {
  const canvas = createCanvas(240, 220);
  drawMinimapMap(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, snapshot,
    { x: 4, y: 5, width: 220, height: 200 }, marks, viewer);
  return canvas.getContext('2d').getImageData(0, 0, 240, 220).data;
}

describe('minimap publication cache', () => {
  it('reuses local adapter publications between renders and sees a command at the next render-time step', () => {
    let now = 0;
    const game = createGame('bareDuel', { aiPlayers: [] });
    const adapter = new LocalGameAdapter(game, 'player', { now: () => now });
    const cache = new MinimapPresentationCache();
    const first = adapter.currentSnapshot(), marks = cache.read(first, first);
    const worker = first.units.find(unit => unit.owner === 'player' && unit.kind === 'worker')!;
    expect(adapter.updateToRenderTime()).toBe(false);
    const repeat = adapter.currentSnapshot();
    expect(cache.read(repeat, repeat)).toBe(marks);
    // The command waits for the next tick, so the publication still stands until then.
    adapter.sendCommand({ type: 'move', unitIds: [worker.id], x: worker.x + 200, y: worker.y });
    expect(adapter.currentSnapshot()).toBe(repeat);
    expect(cache.read(repeat, repeat)).toBe(marks);
    now = 50;
    expect(adapter.updateToRenderTime()).toBe(true);
    const commanded = adapter.currentSnapshot(), next = cache.read(commanded, commanded);
    expect(commanded.units.find(unit => unit.id === worker.id)!.order.type).toBe('move');
    expect(next).not.toBe(marks);
    expect(next).toEqual(createMapPresentation(commanded));
    expect(cache.read(commanded, commanded)).toBe(next);
  });

  it('does not mistake a same-tick checkpoint or new scene for the prior publication', () => {
    const game = createGame('verdantCrossroads', { aiPlayers: [] }), cache = new MinimapPresentationCache();
    game.tick = 12;
    const first = snapshotGame(game), marks = cache.read(first, first);
    const removed = game.units[0]!.id;
    game.units.shift();
    game.spawnUnit('player', 'mercenary', 710, 620);
    game.units[0]!.x += 300;
    game.resources.shift();
    game.mercenaryCamps = [];
    const checkpoint = snapshotGame(game), next = cache.read(checkpoint, checkpoint);
    expect(checkpoint.tick).toBe(first.tick);
    expect(next).not.toBe(marks);
    expect(next).toEqual(createMapPresentation(checkpoint));
    expect(next.some(mark => mark.sourceIds.includes(removed))).toBe(false);
    cache.reset();
    expect(cache.read(checkpoint, checkpoint)).not.toBe(next);
    const scene = snapshotGame(createGame('bareDuel', { aiPlayers: [] }));
    scene.tick = 12;
    expect(cache.read(scene, scene)).toEqual(createMapPresentation(scene));
  });

  it('keeps mutable or unknown providers live even when object, tick and array lengths are unchanged', () => {
    const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] })), cache = new MinimapPresentationCache();
    const initial = cache.read(snapshot), unit = snapshot.units[0]!;
    const oldX = unit.x;
    unit.x += 400;
    snapshot.resources[0]!.x += 400;
    snapshot.buildings[0]!.owner = 'enemy';
    const changed = cache.read(snapshot);
    expect(changed).not.toBe(initial);
    expect(changed).toEqual(createMapPresentation(snapshot));
    expect(changed.find(mark => mark.sourceIds.includes(unit.id))!.x).toBe(oldX + 400);
    // Even an earlier eligible view must not resurrect marks after an unknown read.
    const cached = cache.read(snapshot, snapshot);
    cache.read(snapshot);
    expect(cache.read(snapshot, snapshot)).not.toBe(cached);
  });

  it('accepts an explicit new publication when an owner reuses and mutates the same object', () => {
    const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] })), cache = new MinimapPresentationCache();
    const first = cache.read(snapshot, {});
    snapshot.units[0]!.x += 500;
    const republished = cache.read(snapshot, {});
    expect(republished).not.toBe(first);
    expect(republished).toEqual(createMapPresentation(snapshot));
  });

  it('preserves the full minimap pixels while cabin visibility, items and relations are painted live', () => {
    const game = createGame('verdantCrossroads', { aiPlayers: [] }), cache = new MinimapPresentationCache();
    const snapshot = snapshotGame(game), marks = cache.read(snapshot, snapshot);
    for (const viewer of [undefined, 'player', 'enemy']) {
      expect(pixels(snapshot, marks, viewer)).toEqual(pixels(snapshot, createMapPresentation(snapshot), viewer));
    }
    // These painter inputs are intentionally not part of derived marks. Keeping
    // marks cannot freeze a later cabin/colour/item change supplied to the brush.
    snapshot.units[0]!.cabin = { shipId: 'ship' };
    snapshot.units[0]!.deck = { shipId: 'ship', x: 0, y: 0 };
    snapshot.teams = { player: 'together', enemy: 'together' };
    snapshot.items.push({ ...snapshot.items[0]!, id: 'live-item', kind: 'lightningRod', x: 600, y: 800 });
    expect(cache.read(snapshot, snapshot)).toBe(marks);
    expect(pixels(snapshot, marks, 'player')).toEqual(pixels(snapshot, createMapPresentation(snapshot), 'player'));
  });
});
