import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { walkingDistance } from '../../shared/terrain';
import { EXPERIENCE_BOOK_XP, xpStarThresholds } from '../../shared/unit-value';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version deliberately retrieves books to grow and return a $race veteran (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const kind = version === 'v9_archer' ? race === 'grove' ? 'archer' : 'sparkArcher'
    : version === 'v9_summoner' ? race === 'grove' ? 'summoner' : 'pyreCaller'
      : race === 'grove' ? 'knight' : 'ashChieftain';
  const books = Math.ceil(xpStarThresholds(UNIT_DEFS[kind])[2]! / EXPERIENCE_BOOK_XP);
  let scene = sketchScene('loot-veteran-return').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).townHall('peer', x(3500), 3500).farms('us', 7, x(400), 1500);
  for (let index = 0; index < 3; index++) scene = scene.worker('us', x(560 + index * 35), 600);
  for (let index = 0; index < 6; index++) scene = scene.unit('us', kind, x(650 + index * 25), 650);
  for (let index = 0; index < books; index++) scene = scene.item(`book-${index}`, 'experienceBook', x(1220 + index * 20), 850);
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  memory.v6 = { phase: 3 };
  const original = game.units.filter(unit => unit.owner === 'us');
  const collectors = new Set<string>();
  let used = 0;
  for (let tick = 0; tick < 3600; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory },
        { teams: game.teams, policyMode: 'combat' });
      for (const { command } of entries) {
        if (command.type === 'pickupItem') collectors.add(command.unitId);
        if (command.type === 'useItem' && command.itemId.startsWith('book-')) used++;
      }
      sdk.issue(entries, {}, { checksum: false });
    }
    stepGame(game);
  }
  const diagnostic = JSON.stringify({ used, collectors: [...collectors], task: memory.loot,
    army: game.units.filter(unit => unit.kind === kind).map(unit => ({ id: unit.id, level: unit.level, xp: unit.xp, x: unit.x, y: unit.y, order: unit.order, queue: unit.orderQueue })) });
  expect(used, diagnostic).toBe(books);
  expect(collectors.size, diagnostic).toBe(1);
  const veteran = game.units.find(unit => collectors.has(unit.id))!;
  expect(veteran.level, diagnostic).toBe(3);
  expect(walkingDistance(game.map, veteran, { x: x(500), y: 500 }, 'land'), diagnostic).toBeLessThanOrEqual(V7_GATHERED_RANGE);
  expect(memory.loot, diagnostic).toBeUndefined();
  expect(original.every(unit => game.units.includes(unit))).toBe(true);
  expect(game.players.us!.gold).toBe(500);
  expect(game.match.stats.unitsLost.us).toBe(0);
});

it('retrieves a book with the farther unit whose road is shorter, then returns to its reachable base', () => {
  const game = sketchScene('loot-road-selection').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', 500, 500).townHall('us', 2200, 500).townHall('peer', 3500, 3500)
    .unit('us', 'footman', 1200, 700, { id: 'near-over-wall' })
    .unit('us', 'footman', 1700, 1200, { id: 'short-road' })
    .item('book', 'experienceBook', 1500, 700).build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
    index % 128 === 40 && Math.floor(index / 128) < 110 ? 'T' : '.').join('') };
  const book = game.items[0]!, near = game.units.find(unit => unit.id === 'near-over-wall')!, far = game.units.find(unit => unit.id === 'short-road')!;
  expect(Math.hypot(near.x - book.x, near.y - book.y)).toBeLessThan(Math.hypot(far.x - book.x, far.y - book.y));
  expect(walkingDistance(game.map, near, book, 'land')).toBeGreaterThan(walkingDistance(game.map, far, book, 'land')!);
  const memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game), collectors = new Set<string>();
  let returned = false;
  memory.v6 = { phase: 3 };
  for (let tick = 0; tick < 1600; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_archer', memory },
        { teams: game.teams, policyMode: 'combat' });
      for (const { command } of entries) if (command.type === 'pickupItem') collectors.add(command.unitId);
      sdk.issue(entries, {}, { checksum: false });
    }
    stepGame(game);
    returned ||= far.xp === EXPERIENCE_BOOK_XP
      && walkingDistance(game.map, far, { x: 2200, y: 500 }, 'land')! <= V7_GATHERED_RANGE;
  }
  expect([...collectors]).toEqual(['short-road']);
  expect(far.xp).toBe(EXPERIENCE_BOOK_XP);
  expect(returned).toBe(true);
  expect(memory.loot).toBeUndefined();
  expect(game.match.stats.unitsLost.us).toBe(0);
});
