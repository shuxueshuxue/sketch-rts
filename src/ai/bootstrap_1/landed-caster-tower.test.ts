import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies } from '../../shared/terrain';
import { strikeGap } from '../../shared/combat-geometry';
import { createAiPolicyMemory } from '../memory';
import { enemyBuildings } from '../policy/snapshot';
import { planCasterScreen } from '../policy/v6/backline';
import { planLandedCombat } from './landed-combat';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';

/** A counterfactual component scene, not a historical match or original death cause. */
function field(towerOwner: 'us' | 'foe' = 'foe') {
  const game = sketchScene('counterfactual-landed-caster-tower').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 3300, 3500)
    .unit('us', 'summoner', 2250, 1700, { id: 'caster' })
    .unit('us', 'footman', 2600, 1660, { id: 'screen-1' })
    .unit('us', 'footman', 2600, 1700, { id: 'screen-2' })
    .unit('us', 'footman', 2600, 1740, { id: 'screen-3' })
    .unit('foe', 'footman', 2900, 1700, { id: 'foe' })
    .tower(towerOwner, 2600, 2050, { id: 'local-tower' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 < 25 || index % 128 >= 65 ? '.' : '~').join('') };
  setBuildingBodies(game.map, game.buildings);
  for (const owner of ['us', 'foe']) issuePlayerCommand(game, owner, {
    type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === owner).map(unit => unit.id),
  });
  return game;
}

it.each(BOOTSTRAP_VERSIONS)('%s preserves a safe landed summoner outside a real uncolonized enemy tower', version => {
  const game = field(), snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  const caster = game.units.find(unit => unit.id === 'caster')!, tower = game.buildings.find(building => building.id === 'local-tower')!;
  expect(sameGround(game.map, caster, tower)).toBe(true);
  expect(enemyBuildings(snapshot, 'us', game.teams)).not.toContainEqual(tower);
  expect(strikeGap(tower, caster)).toBeGreaterThan(tower.attackRange);
  const context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
  const commands = planLandedCombat(snapshot, 'us', context, new Set());
  expect(commands.filter(command => 'unitIds' in command && command.unitIds.includes(caster.id))).toEqual([]);
  for (const command of commands) issuePlayerCommand(game, 'us', command);
  for (let tick = 0; tick < 120; tick++) stepGame(game);
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId, memory }));
  const restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId);
  for (let tick = 0; tick < 120; tick++) { stepGame(game); stepGame(restored); }
  expect(caster.hp).toBe(95);
  expect(caster.x).toBe(2250); expect(caster.y).toBe(1700);
  expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
  expect(checkpoint.memory).toEqual(memory);
});

it('keeps the shared mainland helper default and ignores a friendly island tower', () => {
  const game = field(), snapshot = snapshotGame(game), caster = game.units.find(unit => unit.id === 'caster')!;
  const context = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory: createAiPolicyMemory(), teams: game.teams });
  const front = game.units.filter(unit => unit.id.startsWith('screen-'));
  expect(planCasterScreen(snapshot, 'us', context, caster, caster, front, [caster], false, true, () => undefined))
    .toEqual([{ type: 'move', unitIds: ['caster'], x: 2400, y: 1700 }]);
  const friendly = field('us'), friendlySnapshot = snapshotGame(friendly);
  expect(planLandedCombat(friendlySnapshot, 'us', bootstrapPolicyContext(friendlySnapshot, 'us', 'v9_summoner', {
    memory: createAiPolicyMemory(), teams: friendly.teams,
  }), new Set())).toEqual([{ type: 'move', unitIds: ['caster'], x: 2400, y: 1700 }]);
});
