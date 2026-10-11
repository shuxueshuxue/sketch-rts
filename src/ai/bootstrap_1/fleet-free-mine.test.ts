import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { boardUnit } from '../../shared/decks';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { coastOnWater, planNavalTactics } from '../policy/naval';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function field(race: 'grove' | 'ember', mirror: boolean, ally: boolean, sailing: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('fleet-free-mine').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('friend', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(432), 432, { id: 'home' }).goldMine('home-ore', x(656), 432, 6000)
    .goldMine('old-ore', x(3600), 640, 6000).goldMine('free-ore', x(3600), 3600, 6000)
    .worker('us', x(400), 432).worker('us', x(400), 464).worker('us', x(400), 496)
    .unit('us', 'transport', x(2000), sailing ? 3000 : 2048, { id: 'ferry' })
    .worker('us', x(2000), sailing ? 3000 : 2048, { id: 'settler1' })
    .worker('us', x(2000), sailing ? 3000 : 2048, { id: 'settler2' });
  if (!sailing) scene = scene.unit('neutral', 'mossGnawer', x(3600), 640, { id: 'guard' });
  if (ally) scene = scene.townHall('friend', x(3696), 3376, { id: 'allied-hall' })
    .goldMine('available-ore', x(3600), 2400, 6000);
  const game = scene.build().createGame();
  game.scriptedVictory = true; game.tick = 1000;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return col < 23 || col >= 104 ? '.' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const boat = game.units.find(unit => unit.id === 'ferry')!;
  boat.sailing = { heading: mirror ? Math.PI : 0, speed: 0, load: 0, balance: 0 };
  for (const id of ['settler1', 'settler2']) expect(boardUnit(boat, game.units.find(unit => unit.id === id)!, game.units)).toBe(true);
  const oldMine = game.resources.find(mine => mine.id === 'old-ore')!, snapshot = snapshotGame(game);
  const from = coastOnWater(snapshot, game.buildings.find(hall => hall.id === 'home')!, boat)!;
  const to = coastOnWater(snapshot, oldMine, boat)!;
  const memory = createAiPolicyMemory();
  memory.naval = { island: { tick: 0, plan: { mineId: oldMine.id, landing: to } }, ferries: {
    ferry: { purpose: 'settle', targetId: oldMine.id, from, to, phase: sailing ? 'sailing' : 'loading',
      crewIds: ['settler1', 'settler2'], sinceTick: 900 },
  } };
  return { game, boat, memory, expected: ally ? 'available-ore' : 'free-ore' };
}

it.each(cases.flatMap(test => [false, true].map(ally => ({ ...test, ally }))))(
  '$version redirects its loaded $race expedition to unguarded income without claiming a friendly mine (mirror=$mirror, ally=$ally)',
  ({ version, race, mirror, ally }) => {
    const { game, boat, memory, expected } = field(race, mirror, ally, false), start = { x: boat.x, y: boat.y };
    const options = bootstrapPolicyContext(snapshotGame(game), 'us', version, { memory, teams: game.teams });
    const commands = planNavalTactics(snapshotGame(game), 'us', options);
    expect(memory.naval!.island!.plan!.mineId).toBe(expected);
    expect(memory.naval!.ferries!.ferry).toMatchObject({ targetId: expected, phase: 'sailing' });
    const sail = commands.filter(command => command.type === 'unload' && command.unitIds.includes(boat.id));
    expect(sail).toHaveLength(1);
    issueCommandFrame(game, sail.map(command => ({ playerId: 'us', command })));
    for (let tick = 0; tick < 600; tick++) stepGame(game);
    expect(Math.hypot(boat.x - start.x, boat.y - start.y)).toBeGreaterThan(100);
    expect(boat.hp).toBe(boat.maxHp);
    expect(game.match.stats.unitsLost.us).toBe(0);
    for (const id of ['settler1', 'settler2']) expect(game.units.find(unit => unit.id === id)!.hp).toBe(70);
  });

it.each(cases)('$version keeps a $race expedition already sailing on its current objective (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const { game, memory } = field(race, mirror, false, true);
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
    planNavalTactics(snapshot, 'us', options);
    expect(memory.naval!.island!.plan!.mineId).toBe('old-ore');
    expect(memory.naval!.ferries!.ferry).toMatchObject({ targetId: 'old-ore', phase: 'sailing' });
  });
