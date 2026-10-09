import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint } from '../../shared/terrain';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy } from './economy';
import { bootstrapPolicyContext } from './policy';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
  'buys the first $race healer before another tower consumes its ready budget (mirror=$mirrored)', ({ race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const body = race === 'grove' ? 'knight' : 'ashChieftain';
    const healer = race === 'grove' ? 'priest' : 'emberAcolyte';
    const gold = UNIT_DEFS[healer].cost;
    let scene = sketchScene('ready-recovery-under-pressure').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold })
      .townHall('us', x(500), 500, { id: 'hall' }).goldMine('main', x(788), 500, 10000)
      .townHall('foe', x(3500), 3500).farms('us', 8, x(400), 1900)
      .building('us', UNIT_DEFS[healer].trainedAt!, x(700), 800)
      .unit('foe', 'archer', x(900), 900, { id: 'raider' });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 470 + i * 25,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 6; i++) scene = scene.unit('us', body, x(640 + i % 3 * 35), 780 + Math.floor(i / 3) * 35,
      { hp: 20, id: `wounded-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    memory.v6 = { phase: 1 };
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['raider'], targetId: 'hall' });
    const purchases: { tick: number; type: string; kind: string }[] = [];
    for (let tick = 0; tick < 2400; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us',
          [bootstrapEconomy, AI_SCRIPT_LIBRARY.abilities], context);
        for (const { command } of entries) if (command.type === 'train' || command.type === 'build') purchases.push({
          tick: game.tick, type: command.type, kind: command.type === 'train' ? command.unitKind : command.buildingKind });
        issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
      }
      stepGame(game);
    }
    expect(purchases[0]).toEqual({ tick: 0, type: 'train', kind: healer });
    expect(game.units.some(unit => unit.owner === 'us' && unit.kind === healer)).toBe(true);
    expect(game.units.filter(unit => unit.id.startsWith('wounded-')).reduce((sum, unit) => sum + unit.hp, 0)).toBeGreaterThan(120);
    expect(game.match.winner).toBeNull();
    const mined = 10000 - game.resources[0]!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(gold + mined);
  });
