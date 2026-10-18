import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { SdkCommandFrameRuntime } from '../sdk/commands/frame';
import { lootRecovery } from '../ai/bootstrap_1/loot-recovery';
import { bootstrapPolicyContext } from '../ai/bootstrap_1/policy';
import { createAiPolicyMemory } from '../ai/memory';
import { V7_GATHERED_RANGE } from '../ai/policy/v7/creep';
import { snapshotGame, stepGame } from './sim';
import { setBuildingBodies, walkingDistance } from './terrain';
import { standingBodies } from './structure-bodies';
import type { Building, GameMap, ResourceNode, Unit } from './types';
import recorded from './test-fixtures/loot-return-ladder-18-8440.json';

function returningWarden() {
  // The recorded 41c9c208 unit's only order is its queued trip home. Keep the
  // terrain/footprints but remove other units and AI to isolate native steering.
  const fixture = structuredClone(recorded);
  const game = sketchScene('loot-return-flow').map('bareDuel').replaceDefaults()
    .player('v9_archer', { race: 'ember', team: 'a' }).player('p1', { team: 'b' })
    .build().createGame();
  game.scriptedVictory = true;
  game.map = fixture.map as GameMap;
  game.buildings = fixture.buildings as Building[];
  game.resources = fixture.resources as ResourceNode[];
  game.units = [fixture.unit as Unit];
  game.tick = fixture.provenance.tick;
  setBuildingBodies(game.map, standingBodies(snapshotGame(game)));
  return { game, unit: game.units[0]!, home: game.buildings.find(b => b.id === fixture.homeId)! };
}

it('finishes the ladder-18 loot return with one unchanged move order', () => {
  const { game, unit, home } = returningWarden();
  for (let tick = 0; tick < 2400 && unit.order.type !== 'idle'; tick++) stepGame(game);
  expect(unit.order.type, JSON.stringify({ x: unit.x, y: unit.y, order: unit.order })).toBe('idle');
  expect(walkingDistance(game.map, unit, home, 'land')).toBeLessThanOrEqual(V7_GATHERED_RANGE);
});

it('releases the returning loot task after native movement gets home', () => {
  const { game, unit, home } = returningWarden(), memory = createAiPolicyMemory();
  const sdk = new SdkCommandFrameRuntime(game);
  memory.loot = { unitId: unit.id, itemId: 'already-consumed-book', homeId: home.id, returning: true };
  let commands = 0;
  for (let tick = 0; tick < 2400 && memory.loot; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, unit.owner, 'v9_archer', { memory, teams: game.teams });
      const planned = lootRecovery.run(snapshot, unit.owner, options);
      const entries = (Array.isArray(planned) ? planned : planned ? [planned] : [])
        .map(command => ({ playerId: unit.owner, scriptId: lootRecovery.id, command }));
      commands += entries.length;
      sdk.issue(entries, {}, { checksum: false });
    }
    stepGame(game);
  }
  expect(memory.loot).toBeUndefined();
  expect(walkingDistance(game.map, unit, home, 'land')).toBeLessThanOrEqual(V7_GATHERED_RANGE);
  expect(commands).toBe(0); // No repeated orders or task cancellation is needed.
});
