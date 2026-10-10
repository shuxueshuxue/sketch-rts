import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

describe('archer army heavy support', () => {
  it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
    'pays for its $race front and fights with the existing shooters (mirror=$mirrored)', ({ race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
    const screen = race === 'grove' ? 'lancer' : 'ashWarden';
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    const foeShooter = race === 'grove' ? 'sparkArcher' : 'archer';
    let scene = sketchScene('archer-heavy-front').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: race === 'grove' ? 'ember' : 'grove', team: 'b' })
      .player('rear', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
      .townHall('us', x(1400), 500).goldMine('natural', x(1688), 500, 10000)
      .townHall('foe', x(3500), 3500)
      .townHall('rear', x(3500), 500)
      .building('us', UNIT_DEFS[shooter].trainedAt!, x(650), 850)
      .building('us', UNIT_DEFS[heavy].trainedAt!, x(1000), 850)
      .building('us', UNIT_DEFS[screen].trainedAt!, x(800), 650)
      .unit('us', race === 'grove' ? 'priest' : 'emberAcolyte', x(1000), 1050);
    for (let i = 0; i < 8; i++) scene = scene.building('us', 'farm', x(400 + i * 64), 1750);
    for (let i = 0; i < 10; i++) scene = scene.worker('us', x(i < 5 ? 540 : 1440), 550 + i % 5 * 20,
      { order: { type: 'mine', resourceId: i < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 10; i++) scene = scene.unit('us', shooter, x(1100 + i % 5 * 35), 1100 + Math.floor(i / 5) * 35);
    for (let i = 0; i < 4; i++) scene = scene.unit('us', screen, x(1250 + i * 35), 1150);
    for (let i = 0; i < 8; i++) scene = scene.unit('foe', foeShooter, x(2100 + i % 4 * 35), 1100 + Math.floor(i / 4) * 40,
      { order: { type: 'hold', x: x(2100 + i % 4 * 35), y: 1100 + Math.floor(i / 4) * 40 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { phase: 2 };
    let heavyDamage = 0, recruits = 0, lostCarry = 0, upkeep = 0;
    game.observer = { hit(source, target, damage) {
      if (source.owner === 'us' && source.kind === heavy && target.owner === 'foe') heavyDamage += damage;
    } };
    for (let tick = 0; tick < 3600; tick++) {
      if (tick === 900) issueCommandFrame(game, [{ playerId: 'foe', scriptId: 'mining-raid', source: 'external-agent',
        command: { type: 'attackMove',
          unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id), x: x(1400), y: 500 } }]);
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_archer', memory }, { teams: game.teams });
        recruits += entries.filter(({ command }) => command.type === 'train' && command.unitKind === heavy).length;
        issueCommandFrame(game, entries);
      }
      const carrying = game.units.filter(unit => unit.owner === 'us' && unit.carryingGold > 0)
        .map(unit => ({ unit, gold: unit.carryingGold }));
      const bank = game.players.us!.gold, spent = game.match.stats.goldSpent.us!;
      stepGame(game);
      lostCarry += carrying.filter(({ unit }) => !game.units.includes(unit)).reduce((total, { gold }) => total + gold, 0);
      const delivered = carrying.filter(({ unit }) => game.units.includes(unit) && unit.carryingGold === 0)
        .reduce((total, { gold }) => total + gold, 0);
      upkeep += delivered - (game.players.us!.gold - bank + game.match.stats.goldSpent.us! - spent);
    }
    expect(recruits).toBeGreaterThanOrEqual(2);
    expect(heavyDamage).toBeGreaterThan(0);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === shooter).length).toBeGreaterThanOrEqual(4);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(2 * UNIT_DEFS[heavy].cost);
    const mined = 20000 - game.resources.reduce((total, mine) => total + mine.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    expect(upkeep).toBeGreaterThanOrEqual(0);
    expect(game.players.us!.gold + carried + lostCarry + upkeep + game.match.stats.goldSpent.us!).toBe(500 + mined);
    expect(game.units.some(unit => unit.owner === 'foe' && unit.kind === foeShooter)).toBe(false);
    expect(game.match.winner).toBe('us');
  }, 20000);
});
