import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint } from '../../shared/terrain';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy } from './economy';
import { miningWorkforce } from './workforce';
import { bootstrapPolicyContext } from './policy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
  'funds $race recovery after its shared counter queue (mirror=$mirrored)', ({ race, mirrored }) => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  const shooter = race === 'grove' ? 'archer' : 'sparkArcher', body = race === 'grove' ? 'lancer' : 'ashWarden';
  const healer = race === 'grove' ? 'priest' : 'emberAcolyte', counter = race === 'grove' ? 'witch' : 'ashHexer';
  let scene = sketchScene('shared-counter-recovery-funding').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000).townHall('foe', x(3500), 3500)
    .farms('us', 8, x(400), 1700).building('us', UNIT_DEFS[shooter].trainedAt!, x(750), 900)
    .building('us', UNIT_DEFS[counter].trainedAt!, x(1000), 900);
  for (let i = 0; i < 3; i++) scene = scene.worker('us', x(540), 530 + i * 20,
    { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  for (let i = 0; i < 6; i++) scene = scene.unit('us', shooter, x(1050 + i * 35), 1100, { id: `wounded-${i}`, hp: 20 });
  for (let i = 0; i < 4; i++) scene = scene.unit('us', body, x(1050 + i * 35), 1200)
    .unit('foe', 'summoner', x(3250 + i * 35), 3300, { id: `caller-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  memory.v6 = { phase: 1 };
  issueCommandFrame(game, Array.from({ length: 4 }, (_, i) => ({ playerId: 'foe', source: 'external-agent' as const, scriptId: 'initial-summons',
    command: { type: 'cast' as const, unitId: `caller-${i}`, ability: 'summon' as const, x: x(3250 + i * 35), y: 3400 } })));
  const support: string[] = [];
  for (let tick = 0; tick < 3600; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us',
        [AI_SCRIPT_LIBRARY.economy, miningWorkforce, bootstrapEconomy, AI_SCRIPT_LIBRARY.abilities], context);
      for (const entry of entries) if (entry.command.type === 'train'
        && (entry.command.unitKind === healer || entry.command.unitKind === counter)) support.push(entry.command.unitKind);
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
    }
    stepGame(game);
  }
  expect(support[0]).toBe(counter);
  expect(game.units.some(unit => unit.owner === 'us' && unit.kind === healer)).toBe(true);
  expect(game.units.filter(unit => unit.id.startsWith('wounded-'))).toHaveLength(6);
  expect(game.units.filter(unit => unit.id.startsWith('wounded-')).reduce((sum, unit) => sum + unit.hp, 0)).toBeGreaterThan(120);
  const carrying = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carrying + game.match.stats.goldSpent.us!).toBe(500 + 10000 - game.resources[0]!.amount);
});
