import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { canReach } from '../../shared/naval';
import { combatCapability } from '../../shared/combat-capabilities';
import { setBuildingBodies } from '../../shared/terrain';
import { hullFits } from '../../shared/ship-navigation';
import { terrainBlocksPlacement } from '../../shared/build-placement';
import { bootstrapPolicyContext } from './policy';
import { createAiPolicyMemory } from '../memory';
import { assaultBeachExposure } from './assault-beach';

it('recognizes the real repaired mortar range before its cached short-weapon range changes', () => {
  // Synthetic native coast: a damaged mortar + carried cannon are scenario
  // seeds. Public installation derived 312, then paid public repairs restored
  // the 576 mortar. No attackRange field was assigned by the driver.
  const f = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/assault-beach-native-repaired-mortar.json.gz', import.meta.url))).toString());
  const s = f.snapshot;
  setBuildingBodies(s.map, s.buildings);
  const ship = s.units.find((u: any) => u.id === 'unit-enemy-bombardShip-1000')!;
  const boat = s.units.find((u: any) => u.id === 'unit-player-transport-1002')!;
  expect(f.provenance.before.unitRange).toBe(312);
  expect(f.provenance.before.mortarDurability).toBe(0);
  expect(ship.attackRange).toBe(312);
  expect(combatCapability(s, ship).range).toBe(576);
  expect(f.provenance.query.guards).toEqual([]);
  expect(hullFits(s.map, ship)).toBe(true);
  expect(hullFits(s.map, boat)).toBe(true);
  expect(terrainBlocksPlacement(s.map, 'townHall', s.buildings[0]!)).toBe(false);
  const context = bootstrapPolicyContext(s, 'player', 'v9_archer', { teams: s.teams, memory: createAiPolicyMemory() });
  const point = { x: 1030, y: 640 };
  const query = assaultBeachExposure(s, 'player', context, boat, point, point, true)!;
  expect(query.landed).toHaveLength(1);
  expect(canReach(s.map, ship, query.landed[0]!, s.units)).toBe(false);
  expect(canReach(s.map, ship, query.landed[0]!, s.units, 576)).toBe(true);
  expect(query.guards.map(u => u.id)).toContain(ship.id);

  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, f.snapshot, f.nextId);
  // This native unit experiment uses scenario-controlled victory; that
  // runtime setup flag is not part of GameSnapshot.
  game.scriptedVictory = true;
  expect(JSON.parse(JSON.stringify(snapshotGame(game)))).toEqual(f.snapshot);
  for (const entry of f.commands) issuePlayerCommand(game, entry.owner, entry.command);
  for (let i = 0; i < 15; i++) stepGame(game);
  expect(game.tick).toBe(30);
  // The 15-tick native window launches the mortar without changing rules.
  expect(JSON.parse(JSON.stringify(snapshotGame(game)))).toEqual(f.expectedAfter30.snapshot);
  expect(game.nextId).toBe(f.expectedAfter30.nextId);
  expect(game.projectiles.some(p => p.targetId === 'scenario-own-hall')).toBe(true);
  const hits: any[] = [];
  game.observer = { hit(source, target, damage, before) {
    hits.push({ tick: game.tick, sourceId: source.id, targetId: target.id, damage, before, after: target.hp });
  } };
  for (let i = 0; i < 32; i++) stepGame(game);
  expect(game.tick).toBe(62);
  // The existing hall is a legal native target; its shell also wounds the
  // passenger at the landing body the old beach query labelled clear.
  expect(hits).toEqual(f.expectedHits);
  expect(game.units.find(u => u.id === 'unit-player-archer-1003')!.hp).toBe(69);
});
