import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createBuilding, createUnit } from '../../shared/map';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { shipLaunchPose } from '../../shared/ship-launch';
import * as navigation from '../../shared/ship-navigation';
import { createGame, snapshotGame, trainingRecruitPrototype } from '../../shared/sim';
import type { Building, GameMap, GameSnapshot, UnitKind } from '../../shared/types';
import { FactWorkQueue } from './fact-work';
import { createGoalGeometryReader } from './goal-geometry-source';
import type { GoalGeometryMemory, GoalPublishedValue } from './goal-grounding-ports';
import { createGoalSeaSpawnReader, type GoalSeaSpawn } from './goal-sea-spawn';
import { regionIndex, seaIdAt } from './regions';
import type { Point, SeaId } from './types';

type Case = { point: Point; anchorSeaIds: number[]; expected: Record<string, { seas: number[]; count: number }> };
const fixture: { maps: { name: string; map: GameMap; terrainSites: number; cases: Case[] }[] } = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/sea-spawn-11maps.json.gz', import.meta.url))).toString());
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
  if (event.operation === 'steerPoint') throw Error('The decision port must not steer');
}, () => withNavigationPhase('strategy-planning', run));
function scene(map = fixture.maps.find(map => map.name === 'pineshade')!.map, point = { x: 1360, y: 400 }) {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.map = structuredClone(map);
  game.units = []; game.buildings = [createBuilding('real-yard', 'player', 'shipyard', point.x, point.y, true)];
  const snapshot = snapshotGame(game); regionIndex(snapshot.map);
  return { snapshot, yard: snapshot.buildings[0]! };
}
function publish(snapshot: GameSnapshot, yard: Building, kind: UnitKind, limit = 6144) {
  const prototype = trainingRecruitPrototype(snapshot, yard, { unitKind: kind as 'transport', remaining: 0 });
  let memory: GoalGeometryMemory = { version: 1, entries: [] }, result: GoalPublishedValue<GoalSeaSpawn> | undefined;
  let workTotal = 0, peak = 0, turns = 0;
  for (; turns < 3000; turns++) {
    const work = new FactWorkQueue(snapshot.tick, limit, undefined, turns + 1);
    const read = createGoalSeaSpawnReader({ snapshot, owner: yard.owner, regionsReady: true, terrainRevision: 'frozen-terrain',
      regionAt: point => seaIdAt(snapshot.map, point), geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory }) });
    result = strict(() => read(yard, prototype)); strict(() => work.flush());
    workTotal += work.receipt.used; expect(work.receipt.used).toBeLessThanOrEqual(limit);
    peak = Math.max(peak, JSON.stringify(memory).length); expect(memory.capacity?.pressure).toBeUndefined();
    memory = JSON.parse(JSON.stringify(memory));
    if (result.state !== 'pending') break;
  }
  if (result?.state !== 'met') throw Error(`sea components not published: ${JSON.stringify(result)}`);
  return { result, work: workTotal, peak, turns: turns + 1, memory, prototype };
}

describe('native shipyard sea choices, without best-pose steering', () => {
  it('keeps both pineshade cutter rally choices and only sea4 for a transport, across tiny JSON slices', () => {
    const { snapshot, yard } = scene(), before = JSON.stringify(snapshot);
    for (const allowance of [7, 128, 6144]) {
      const cutter = publish(snapshot, yard, 'cutter', allowance);
      expect(cutter.result.value.options.map(option => option.seaId)).toEqual(['sea:1', 'sea:4']);
      expect(cutter.result.value.options.every(option => option.rally.kind === 'sea-component')).toBe(true);
      const transport = publish(snapshot, yard, 'transport', allowance);
      expect(transport.result.value.options).toEqual([{ seaId: 'sea:4', rally: { kind: 'unrestricted' } }]);
      expect(cutter.peak).toBeLessThan(33776); expect(transport.peak).toBeLessThan(33776);
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('native full launch follows each published rally component; witnesses are not birth poses', () => {
    const { snapshot, yard } = scene(), { result, prototype } = publish(snapshot, yard, 'cutter');
    for (const option of result.value.options) {
      if (option.rally.kind !== 'sea-component') throw Error('expected conditional choice');
      const selected = structuredClone(snapshot), dock = selected.buildings[0]!;
      dock.rallyX = option.rally.point.x; dock.rallyY = option.rally.point.y; delete dock.rallyTarget;
      const pose = shipLaunchPose(selected, dock, prototype);
      expect(pose).toBeDefined(); expect(seaIdAt(selected.map, pose!)).toBe(option.seaId);
    }
  });

  it.each(fixture.maps)('$name matches original native harbor sea sets for every measured kind/contact', entry => {
    for (const sample of entry.cases) {
      const { snapshot, yard } = scene(entry.map, sample.point);
      for (const [kind, original] of Object.entries(sample.expected)) {
        const actual = publish(snapshot, yard, kind as UnitKind).result.value.options.map(option => option.seaId);
        const expected = sample.anchorSeaIds.length === 1
          ? sample.anchorSeaIds.map(id => `sea:${id}`) : original.seas.map(id => `sea:${id}`);
        // Unique contacts are a decision proof even when the native hull has
        // to wait. Ambiguous contacts require the complete native kind set.
        expect(actual).toEqual([...expected].sort());
      }
    }
  });

  it('a unique sea needs twenty charged contacts and remains known when traffic or body fit delays birth', () => {
    const map = fixture.maps.find(map => map.name === 'brokenSea')!, point = map.cases[0]!.point;
    const { snapshot, yard } = scene(map.map, point), fits = vi.spyOn(navigation, 'hullFits');
    const first = publish(snapshot, yard, 'carrier');
    expect(first.work).toBe(20); expect(first.turns).toBe(2); expect(fits).not.toHaveBeenCalled();
    snapshot.units.push(createUnit('blocking-body', yard.owner, 'carrier', yard.x, yard.y));
    expect(publish(snapshot, yard, 'carrier').result.value).toEqual(first.result.value);
    expect(fits).not.toHaveBeenCalled(); fits.mockRestore();
  });

  it('zero budget and missing prepared regions do no native work; ownership, completion and real units cannot be forged', () => {
    const { snapshot, yard } = scene(), prototype = trainingRecruitPrototype(snapshot, yard, { unitKind: 'transport', remaining: 0 });
    const memory: GoalGeometryMemory = { version: 1, entries: [] }, work = new FactWorkQueue(snapshot.tick, 0);
    const regionAt = vi.fn((point: Point): SeaId | undefined => seaIdAt(snapshot.map, point));
    const input = { snapshot, owner: yard.owner, terrainRevision: 'same', regionsReady: true, regionAt,
      geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory }) };
    expect(strict(() => createGoalSeaSpawnReader(input)(yard, prototype)).state).toBe('pending');
    strict(() => work.flush()); expect(regionAt).not.toHaveBeenCalled(); expect(work.receipt.used).toBe(0);
    expect(createGoalSeaSpawnReader({ ...input, regionsReady: false })(yard, prototype)).toMatchObject({ state: 'pending',
      reason: { code: 'native-sea-spawn-regions-pending' } });
    snapshot.units.push(prototype); expect(createGoalSeaSpawnReader(input)(yard, prototype).state).toBe('unmet');
    snapshot.units = []; yard.complete = false; expect(createGoalSeaSpawnReader(input)(yard, prototype).state).toBe('unmet');
    yard.complete = true; yard.owner = 'enemy'; expect(createGoalSeaSpawnReader(input)(yard, prototype).state).toBe('unmet');
  });

  it('invalidates terrain, yard and kind/shape changes, while rally and moving traffic do not invalidate the possible seas', () => {
    const { snapshot, yard } = scene(), first = publish(snapshot, yard, 'transport');
    const memory = first.memory, prototype = first.prototype;
    let sequence = 50;
    const read = (terrainRevision: string) => {
      const work = new FactWorkQueue(snapshot.tick, 6144, undefined, sequence++);
      const result = strict(() => createGoalSeaSpawnReader({ snapshot, owner: yard.owner, regionsReady: true, terrainRevision,
        regionAt: point => seaIdAt(snapshot.map, point), geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory }) })(yard, prototype));
      strict(() => work.flush()); return { result, work: work.receipt.used };
    };
    yard.rallyX += 100; yard.rallyY += 60;
    snapshot.units.push(createUnit('traffic', yard.owner, 'carrier', yard.x, yard.y));
    expect(read('frozen-terrain')).toMatchObject({ result: first.result, work: 0 });
    expect(read('changed-terrain').result.state).toBe('pending');
    yard.x += 32; expect(read('changed-terrain').result.state).toBe('pending');
    prototype.deckScale = 1.2; expect(read('changed-terrain').result.state).toBe('pending');
  });
});
