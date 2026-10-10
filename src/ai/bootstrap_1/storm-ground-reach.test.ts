import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { STORM_STAFF } from '../../shared/item-rules';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { distance } from '../policy/spatial';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    (['reach', 'cluster', 'barrier', 'beyond'] as const).map(layout => ({ version, race, mirror, layout })))));

it.each(cases)('$version casts on $race ground coverage: $layout (mirror=$mirror)', ({ version, race, mirror, layout }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('storm-ground-coverage').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('ally', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('ally', x(500), 3000).townHall('foe', x(3500), 3500)
    .unit('us', race === 'grove' ? 'archer' : 'sparkArcher', x(1600), 1600, { id: 'carrier' })
    .item('staff', 'stormStaff', 0, 0, { carrierId: 'carrier' });
  const gap = layout === 'beyond' ? STORM_STAFF.range + STORM_STAFF.radius + 20 : 430;
  if (layout === 'cluster') scene = scene.unit('foe', 'footman', x(1700), 1600, { id: 'near' });
  const targetCount = layout === 'cluster' ? 3 : 1;
  for (let index = 0; index < targetCount; index++) scene = scene.unit('foe', 'footman', x(1600 + gap), 1600 + (index - 1) * 30, { id: `target-${index}` });
  scene = scene.unit('ally', 'footman', x(2020), 1700, { id: 'ally' });
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  if (layout === 'barrier') {
    const cells = [...game.map.terrain.cells], col = Math.floor(x(1900) / 32);
    for (let row = 0; row < 128; row++) cells[row * 128 + col] = '#';
    game.map.terrain.cells = cells.join('');
    expect(walkingDistance(game.map, game.units.find(unit => unit.id === 'carrier')!, game.units.find(unit => unit.id === 'target-0')!, 'land')).toBeUndefined();
  }
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory: createAiPolicyMemory(), policyMode: 'combat' }, { teams: game.teams })
    .filter(entry => entry.scriptId === 'items');
  const casts = entries.filter(entry => entry.command.type === 'useItem');
  const carrier = game.units.find(unit => unit.id === 'carrier')!, ally = game.units.find(unit => unit.id === 'ally')!;
  const before = new Map(game.units.map(unit => [unit.id, unit.hp]));
  if (layout === 'beyond') {
    expect(casts).toHaveLength(0);
  } else {
    expect(casts).toHaveLength(1);
    const command = casts[0]!.command;
    expect(command.type).toBe('useItem');
    if (command.type !== 'useItem') throw new Error('Expected ground cast');
    const point = { x: command.x!, y: command.y! };
    expect(distance(carrier, point)).toBeLessThanOrEqual(STORM_STAFF.range);
    expect(distance(carrier, game.units.find(unit => unit.id === 'target-0')!)).toBeGreaterThan(STORM_STAFF.range);
    expect(distance(point, game.units.find(unit => unit.id === 'target-0')!)).toBeLessThanOrEqual(STORM_STAFF.radius);
  }
  issueCommandFrame(game, entries);
  const targets = game.units.filter(unit => unit.id.startsWith('target-'));
  expect(targets.filter(unit => unit.hp < before.get(unit.id)!)).toHaveLength(layout === 'beyond' ? 0 : targetCount);
  expect(game.items.find(item => item.id === 'staff')!.cooldownRemaining).toBe(layout === 'beyond' ? 0 : STORM_STAFF.cooldown);
  expect(carrier.hp).toBe(before.get(carrier.id));
  expect(ally.hp).toBe(before.get(ally.id));
  expect(game.players.us!.gold).toBe(500);
  expect(game.match.stats.goldSpent.us).toBe(0);
  stepGame(game);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
