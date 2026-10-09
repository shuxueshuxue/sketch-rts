import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { summonerTowerRush, towerRushAbilities } from './tower-rush';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
  'keeps the advancing $race host outside enemy arrows (mirror=$mirrored)', ({ race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const kind = race === 'grove' ? 'summoner' : 'pyreCaller';
    let scene = sketchScene('summon-advance-shooter-screen').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', x(500), 300).goldMine('main', x(788), 300, 10000)
      .townHall('foe', x(2400), 1500, { id: 'target' }).farms('us', 5, x(400), 2600)
      .tower('us', x(1500), 1500);
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 280 + i * 20,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 6; i++) scene = scene.unit('us', kind, x(1350 - Math.floor(i / 3) * 35), 1420 + i % 3 * 60, { id: `caller-${i}` });
    for (let i = 0; i < 10; i++) scene = scene.unit('foe', 'archer', x(1950), 1320 + i * 40, { id: `archer-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    const ability = race === 'grove' ? 'summon' : 'cinderSoul';
    for (const unit of game.units.filter(unit => unit.owner === 'us' && unit.kind === kind)) issuePlayerCommand(game, 'us',
      { type: 'cast', unitId: unit.id, ability, x: x(1550), y: unit.y });
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    memory.jobs.push({ id: summonerTowerRush.id, kind: 'target', createdTick: 0, updatedTick: 0 });
    memory.v6 = { phase: 2, general: { mode: 'attack', target: { x: x(2400), y: 1500 }, targetHallId: 'target', stage: 'strike' } };
    let damage = 0;
    game.observer = { hit(_source, target, taken) { if (target.owner === 'us' && target.kind === kind) damage += taken; } };
    for (let tick = 0; tick < 1200 && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory, teams: game.teams });
        for (const { command } of runAiCommandEntriesFromScripts(snapshot, 'us', [towerRushAbilities, summonerTowerRush], options)) issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    const host = game.units.filter(unit => unit.owner === 'us' && unit.kind === kind);
    expect(host).toHaveLength(6);
    expect(damage).toBe(0);
    expect(game.units.filter(unit => unit.owner === 'foe')).toHaveLength(0);
    expect(game.match.winner).toBeNull();
    const mined = 10000 - game.resources[0]!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(mined).toBeGreaterThan(0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  });
