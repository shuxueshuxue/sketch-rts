import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint, walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].map(intercept => ({ version, race, mirror, intercept })))));

it.each(cases)('$version preserves its $race book courier when an enemy moves onto the route (mirror=$mirror, intercept=$intercept)',
  ({ version, race, mirror, intercept }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('loot-trip-new-enemy-contact').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 1000, { id: 'home' }).townHall('foe', x(3500), 3500)
      .worker('foe', x(3500), 3400)
      .unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(900), 1000, { id: 'courier' })
      .unit('foe', 'archer', x(1900), 2100, { id: 'interceptor' })
      .item('book', 'experienceBook', x(2000), 1000).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'foe', intercept
      ? { type: 'attackMove', unitIds: ['interceptor'], x: x(1900), y: 1100 }
      : { type: 'holdPosition', unitIds: ['interceptor'] });
    const memory = createAiPolicyMemory(), courier = game.units.find(unit => unit.id === 'courier')!;
    let pickups = 0, returns = 0, consumed = 0;
    let returned = false;
    for (let tick = 0; tick < 900; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
        pickups += entries.filter(entry => entry.command.type === 'pickupItem' && entry.command.itemId === 'book').length;
        returns += entries.filter(entry => entry.scriptId === 'lootRecovery' && entry.command.type === 'move' && entry.command.avoidCombat).length;
        consumed += entries.filter(entry => entry.command.type === 'useItem' && entry.command.itemId === 'book').length;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
      returned ||= pickups > 0 && memory.loot === undefined && walkingDistance(game.map, courier,
        game.buildings.find(building => building.id === 'home')!, 'land')! <= V7_GATHERED_RANGE;
    }
    const diagnostic = JSON.stringify({ memory: memory.loot, hp: courier.hp, maxHp: courier.maxHp, order: courier.order, x: courier.x, y: courier.y, pickups, returns, consumed });
    expect(pickups, diagnostic).toBeGreaterThan(0);
    expect(game.units.some(unit => unit.id === 'courier'), diagnostic).toBe(true);
    expect(courier.hp, diagnostic).toBe(courier.maxHp);
    expect(returned, diagnostic).toBe(true);
    expect(memory.loot, diagnostic).toBeUndefined();
    expect(consumed, diagnostic).toBe(intercept ? 0 : 1);
    expect(returns, diagnostic).toBeGreaterThan(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
