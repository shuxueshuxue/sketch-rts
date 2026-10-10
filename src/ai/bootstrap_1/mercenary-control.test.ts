import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { bootstrapPolicyContext } from './policy';
import { mercenaryControl } from './mercenary-control';
import { controlledMercenaryGoals } from './mercenary-goals';
import { unitControlsMercenaryCamp } from '../../shared/mercenary-camp';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    (['camp', 'planner'] as const).map(economy => ({ version, race, mirror, economy })))));

it.each(cases)('$version collects and rallies $race mercenaries ($economy, mirror=$mirror)', ({ version, race, mirror, economy }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const kind = version === 'v9_archer' ? race === 'grove' ? 'archer' : 'sparkArcher'
    : version === 'v9_summoner' ? race === 'grove' ? 'summoner' : 'pyreCaller'
      : race === 'grove' ? 'knight' : 'ashChieftain';
  let scene = sketchScene('mercenary-expedition-rally').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('peer', { race: 'grove', team: 'a' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 4000).townHall('peer', x(3500), 3500)
    .farms('us', 7, x(400), 1000).building('us', UNIT_DEFS[kind].trainedAt!, x(500), 800)
    .unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(650), 600, { id: 'scout' })
    .mercenaryCamp('cleared-camp', x(2200), 700, { hireKind: 'mercenary', cost: 160, stock: 2, cooldownSeconds: 16 });
  for (let index = 0; index < 6; index++) scene = scene.worker('us', x(560 + index * 22), 500);
  for (let index = 0; index < 6; index++) scene = scene.unit('us', kind, x(500 + index * 14), 600);
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  memory.v6 = { phase: 3 };
  const original = game.units.filter(unit => unit.owner === 'us'), travelers = new Set<string>();
  expect(game.players.us!.gold).toBe(500);
  let paid = 0;
  for (let tick = 0; tick < 2400; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game);
      const options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = economy === 'planner'
        ? planAiOwnerCommandEntries(snapshot, { playerId: 'us', version, memory }, { teams: game.teams })
        : [...controlledMercenaryGoals(snapshot, 'us', options).flatMap(goal => {
          if (goal.cost > game.players.us!.gold) return [];
          const command = goal.issue();
          return command ? [{ scriptId: 'v6Economy', command }] : [];
        }), ...mercenaryControl.run(snapshot, 'us', options).map(command => ({ scriptId: mercenaryControl.id, command }))];
      for (const entry of entries) {
        if (entry.command.type === 'hire') paid += 160;
        if (entry.scriptId === 'mercenaryControl' && entry.command.type === 'move'
          && entry.command.x === x(2200) && entry.command.y === 700) entry.command.unitIds.forEach(id => travelers.add(id));
      }
      sdk.issue(entries.map(entry => ({ ...entry, playerId: 'us' })), {}, { checksum: false });
    }
    stepGame(game);
  }
  const mercenaries = game.units.filter(unit => unit.owner === 'us' && unit.kind === 'mercenary');
  const diagnostic = JSON.stringify({ gold: game.players.us!.gold, paid, travelers: [...travelers],
    mercenaries: mercenaries.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, order: unit.order })) });
  expect(travelers.size, diagnostic).toBe(1);
  if (economy === 'camp') {
    expect(paid, diagnostic).toBe(320);
    expect(mercenaries, diagnostic).toHaveLength(2);
  } else {
    expect(paid, diagnostic).toBeGreaterThanOrEqual(160);
    expect(mercenaries, diagnostic).toHaveLength(paid / 160);
  }
  expect(original.every(unit => game.units.includes(unit)), diagnostic).toBe(true);
  expect(mercenaries.every(unit =>
    Math.hypot(unit.x - x(500), unit.y - 500) <= V7_GATHERED_RANGE), diagnostic).toBe(true);
  const camp = game.mercenaryCamps[0]!;
  expect(game.units.filter(unit => travelers.has(unit.id)).every(unit =>
    Math.hypot(unit.x - x(500), unit.y - 500) <= V7_GATHERED_RANGE
      || economy === 'planner' && unit.order.type === 'hold' && unitControlsMercenaryCamp(unit, camp)
        && mercenaries.length < 2), diagnostic).toBe(true);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(paid);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.winner).toBeNull();
});
