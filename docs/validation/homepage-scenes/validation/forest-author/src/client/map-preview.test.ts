import { describe, expect, it } from 'vitest';
import { createRoom, roomToGameSetup, updateRoomSlot } from '../shared/rooms';
import { createGame, snapshotGame } from '../shared/sim';
import { poolMap } from '../shared/map-pool';
import type { RoomState } from '../shared/types';
import { mapPreview } from './map-preview';

const host = { id: 'preview-host', name: 'Host' };
const seats = (room: RoomState) => room.slots.filter(slot => slot.controller !== 'closed').map(slot => ({ playerId: slot.playerId, team: slot.team }));
const starts = (snapshot: ReturnType<typeof snapshotGame>) => snapshot.buildings.filter(building => building.kind === 'townHall').map(({ owner, x, y }) => ({ owner, x, y }));

describe('room map preview', () => {
  it('shares only immutable physical data across three-to-one, free-for-all and regrouped balanced alliances', () => {
    const room = createRoom({ id: 'preview-shared-physical', host, mapId: 'twoShores', layoutSeed: 'preview-shared-physical-seed', humanCount: 1, aiCount: 3 });
    const original = seats(room);
    const baseline = mapPreview(room.mapId, original, room.layoutSeed);
    const variants = [
      original.map((seat, index) => ({ ...seat, team: index === 0 ? 'one' : 'three' })),
      original.map(seat => ({ ...seat, team: seat.playerId })),
      original.map((seat, index) => ({ ...seat, team: index < 2 ? 'pair-a' : 'pair-b' })),
    ];
    for (const edited of variants) {
      const preview = mapPreview(room.mapId, edited, room.layoutSeed);
      const teams = Object.fromEntries(edited.map(seat => [seat.playerId, seat.team]));
      const actual = snapshotGame(createGame(room.mapId, { players: edited.map(seat => seat.playerId), teams, aiPlayers: [], layout: { ...poolMap(room.mapId)!.layout, seed: room.layoutSeed! } }));

      expect(preview.snapshot).toEqual(actual);
      expect({ ...actual, teams: baseline.snapshot.teams }).toEqual(baseline.snapshot);
      expect(preview.snapshot.map).toBe(baseline.snapshot.map);
      expect(preview.snapshot.units).toBe(baseline.snapshot.units);
      expect(preview.snapshot.buildings).toBe(baseline.snapshot.buildings);
      expect(preview.snapshot.teams).not.toBe(baseline.snapshot.teams);
    }
    expect(baseline.snapshot.teams).toEqual(Object.fromEntries(original.map(seat => [seat.playerId, seat.team])));
  });

  it('isolates diplomacy and caller arrays while preventing mutation of shared physical data', () => {
    const room = createRoom({ id: 'preview-isolated', host, mapId: 'twoShores', layoutSeed: 'preview-isolated-seed', humanCount: 1, aiCount: 3 });
    const input = seats(room);
    const first = mapPreview(room.mapId, input, room.layoutSeed);
    const expectedTeam = input[0]!.team;
    first.snapshot.teams!.player = 'caller-edit';
    first.seats[0] = 'caller-seat';
    expect(Reflect.set(first.snapshot.map, 'width', 1)).toBe(false);
    expect(Reflect.set(first.snapshot.units[0]!, 'x', 1)).toBe(false);
    expect(Reflect.set(first.facts, 'size', 1)).toBe(false);
    expect(() => first.snapshot.resources.pop()).toThrow(TypeError);
    const next = mapPreview(room.mapId, input, room.layoutSeed);

    expect(next.snapshot.teams!.player).toBe(expectedTeam);
    expect(next.seats).toEqual(input.map(seat => seat.playerId));
    expect(next.snapshot.map).toBe(first.snapshot.map);
    expect(next.snapshot).not.toBe(first.snapshot);
    input[0]!.team = 'later-input-edit';
    expect(next.snapshot.teams!.player).toBe(expectedTeam);
  });

  it('does not share physical maps across a changed seed, seat order, player identity or non-shore diplomacy', () => {
    const room = createRoom({ id: 'preview-distinct', host, mapId: 'twoShores', layoutSeed: 'preview-distinct-seed', humanCount: 1, aiCount: 3 });
    const input = seats(room);
    const baseline = mapPreview(room.mapId, input, room.layoutSeed);
    for (const preview of [
      mapPreview(room.mapId, input, 'preview-distinct-other-seed'),
      mapPreview(room.mapId, [...input].reverse(), room.layoutSeed),
      mapPreview(room.mapId, input.map((seat, index) => ({ ...seat, playerId: `different-${index}` })), room.layoutSeed),
    ]) expect(preview.snapshot.map).not.toBe(baseline.snapshot.map);
    const ring = mapPreview('pineshade', input.slice(0, 2), 'preview-ring-seed');
    const changedRing = mapPreview('pineshade', input.slice(0, 2).map(seat => ({ ...seat, team: seat.playerId })), 'preview-ring-seed');
    expect(changedRing.snapshot.map).not.toBe(ring.snapshot.map);
  });

  it('bounds cached physical maps and regenerates an evicted map without changing its value', () => {
    const room = createRoom({ id: 'preview-bounded', host, mapId: 'twoShores', layoutSeed: 'preview-bounded-seed', humanCount: 1, aiCount: 3 });
    const input = seats(room);
    const first = mapPreview(room.mapId, input, room.layoutSeed);
    // Small ungenerated maps exercise the bound without constructing another 24 large terrains.
    for (let index = 0; index < 24; index++) mapPreview('bareDuel', [{ playerId: 'player', team: `bound-${index}` }, { playerId: 'enemy', team: 'other' }]);
    const rebuilt = mapPreview(room.mapId, input, room.layoutSeed);

    expect(rebuilt.snapshot.map).not.toBe(first.snapshot.map);
    expect(rebuilt.snapshot).toEqual(first.snapshot);
  });

  it('previews a seeded named-shore room with uneven alliances exactly as the match will start', () => {
    const room = createRoom({ id: 'preview-shores', host, mapId: 'twoShores', layoutSeed: 'preview-custom-shores', humanCount: 1, aiCount: 3 });
    const edited = updateRoomSlot(room, 'slot-2', { team: room.slots[0]!.team });
    const preview = mapPreview(edited.mapId, seats(edited), edited.layoutSeed);
    const setup = roomToGameSetup(edited);
    const game = createGame(setup.mapId, setup.options);
    const baseline = mapPreview(room.mapId, seats(room), room.layoutSeed);

    expect(game.teams).toEqual(Object.fromEntries(seats(edited).map(seat => [seat.playerId, seat.team])));
    expect(preview.snapshot.map).toEqual(snapshotGame(game).map);
    expect(starts(preview.snapshot)).toEqual(starts(snapshotGame(game)));
    expect(preview.snapshot.map.terrain).toEqual(baseline.snapshot.map.terrain);
    expect(starts(preview.snapshot)).toEqual(starts(baseline.snapshot));
    expect(preview.facts.players).toBe(4);
  });

  it('keeps seeded physical seats fixed for free-for-all while honoring a changed room seed', () => {
    const room = createRoom({ id: 'preview-free-for-all', host, mapId: 'twoShores', layoutSeed: 'preview-ffa-first', humanCount: 1, aiCount: 3 });
    const normal = mapPreview(room.mapId, seats(room), room.layoutSeed);
    const freeForAll = seats(room).map(seat => ({ ...seat, team: seat.playerId }));
    const preview = mapPreview(room.mapId, freeForAll, room.layoutSeed);
    const changed = mapPreview(room.mapId, freeForAll, 'preview-ffa-second');

    expect(preview.snapshot.map.terrain).toEqual(normal.snapshot.map.terrain);
    expect(starts(preview.snapshot)).toEqual(starts(normal.snapshot));
    expect(changed.snapshot.map.terrain?.cells).not.toBe(preview.snapshot.map.terrain?.cells);
    expect(changed.seats).toEqual(preview.seats);
  });

  it('preserves the team constraints of explicit custom layouts outside the named-shore contract', () => {
    const room = createRoom({ id: 'preview-custom-layout', host, mapId: 'twoShores', humanCount: 1, aiCount: 3 });
    const edited = updateRoomSlot(room, 'slot-2', { team: room.slots[0]!.team });
    const { options } = roomToGameSetup(edited);

    expect(() => createGame('ladder', { ...options, layout: { seed: 'custom-ladder-sides', kind: 'sides', idea: 'twoShores' } })).toThrow(/same size/);
    expect(() => createGame('twoShores', { ...options, layout: { seed: 'custom-named-map-idea', kind: 'sides', idea: 'openSides' } })).toThrow(/same size/);
  });
});
