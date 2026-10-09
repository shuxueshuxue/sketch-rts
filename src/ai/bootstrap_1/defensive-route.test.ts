import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';

const cases = (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirrored =>
  [false, true].map(cliff => ({ race, mirrored, cliff }))));

it.each(cases)('keeps the $race mining front covered across a detour and pursues in open ground (mirror=$mirrored, cliff=$cliff)',
  ({ race, mirrored, cliff }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('defense-nearby-across-detour').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).player('raid', { team: 'b' })
      .townHall('us', x(800), 1000, { id: 'hall' }).goldMine('main', x(1088), 1000, 10000)
      .townHall('foe', x(3500), 3000).townHall('raid', x(500), 3500)
      .tower('us', x(850), 760).tower('us', x(650), 1050).farms('us', 8, x(400), 3000);
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(970), 950 + i * 20,
      { id: `miner-${i}`, order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 4; i++) scene = scene.unit('us', heavy, x(940), 950 + i * 40, { id: `screen-${i}` })
      .unit('foe', 'footman', x(1390), 1000 + i * 40, { id: `other-bank-${i}` });
    for (let i = 0; i < 2; i++) scene = scene.unit('raid', 'knight', x(60), 1000 + i * 45, { id: `raider-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    let cells = '';
    for (let row = 0; row < 128; row++) for (let col = 0; col < 128; col++) {
      const worldCol = mirrored ? 127 - col : col;
      cells += cliff && worldCol >= 37 && worldCol <= 39 && row < 70 ? '#' : '.';
    }
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    issuePlayerCommand(game, 'raid', { type: 'attack', unitIds: ['raider-0', 'raider-1'], targetId: 'miner-0' });
    let lostGold = 0;
    game.observer = { hit(_source, target) {
      if ('order' in target && target.owner === 'us' && target.hp <= 0) lostGold += target.carryingGold;
    } };
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us',
          [{ ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }, AI_SCRIPT_LIBRARY.abilities,
            AI_SCRIPT_LIBRARY.v7FocusFire, AI_SCRIPT_LIBRARY.v7Skirmish], context);
        issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
      }
      stepGame(game);
    }
    // The raiders' explicit worker target remains a separate micro task; the four other miners keep working.
    for (let i = 1; i < 5; i++) expect(game.units.some(unit => unit.id === `miner-${i}`)).toBe(true);
    expect(game.buildings.find(building => building.id === 'hall')!.hp).toBe(900);
    expect(game.units.filter(unit => unit.id.startsWith('raider-'))).toHaveLength(0);
    if (cliff) {
      expect(game.units.filter(unit => unit.id.startsWith('other-bank-'))).toHaveLength(4);
      expect(game.units.filter(unit => unit.id.startsWith('screen-')).every(unit =>
        Math.hypot(unit.x - x(800), unit.y - 1000) < 650)).toBe(true);
    } else expect(game.units.filter(unit => unit.id.startsWith('other-bank-'))).toHaveLength(0);
    expect(game.match.winner).toBeNull();
    const mined = 10000 - game.resources[0]!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us! + lostGold).toBe(500 + mined);
  });
