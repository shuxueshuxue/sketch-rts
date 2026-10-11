import { afterEach, describe, expect, it, vi } from 'vitest';
import * as mining from '../../shared/mining';

afterEach(() => vi.restoreAllMocks());
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

describe('summon host support against artillery', () => {
  it.each((['grove', 'ember'] as const).flatMap(race => (['catapult', 'ballista'] as const)
    .flatMap(artillery => [false, true].map(mirrored => ({ race, artillery, mirrored }))))) (
    'pays for a lasting $race front against $artillery while continuing to summon (mirror=$mirrored)', ({ race, artillery, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const caller = race === 'grove' ? 'summoner' : 'pyreCaller';
    const screen = race === 'grove' ? 'lancer' : 'ashWarden';
    let scene = sketchScene('summon-artillery-counter').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: artillery === 'ballista' ? 'grove' : 'ember', team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
      .townHall('us', x(1400), 500).goldMine('natural', x(1688), 500, 10000)
      .townHall('foe', x(3500), 3500).unit('foe', artillery, x(3200), 3500, { order: { type: 'hold', x: x(3200), y: 3500 } })
      .building('us', UNIT_DEFS[screen].trainedAt!, x(700), 850)
      .building('us', UNIT_DEFS[caller].trainedAt!, x(1000), 850);
    for (let i = 0; i < 8; i++) scene = scene.building('us', 'farm', x(400 + i * 64), 1600);
    for (let i = 0; i < 11; i++) scene = scene.worker('us', x(i < 5 ? 540 : 1440), 550 + i % 5 * 20,
      { order: { type: 'mine', resourceId: i < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 10; i++) scene = scene.unit('us', caller, x(800 + i % 5 * 35), 1000 + Math.floor(i / 5) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    // This scene has only our miners. Observe real deliveries and their settlement-time
    // population, including changes caused by recruits and summons during the step.
    const deliveries = vi.spyOn(mining, 'upkeepGoldIncome');
    memory.v6 = { phase: 2 };
    let spells = 0;
    const recruits: string[] = [];
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_summoner', memory }, { teams: game.teams });
        for (const { command } of entries) {
          if (command.type === 'cast' && ['summon', 'cinderSoul'].includes(command.ability)) spells++;
          if (command.type === 'train' && command.unitKind === screen) recruits.push(command.buildingId);
        }
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(recruits.length).toBeGreaterThanOrEqual(4);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === screen).length).toBeGreaterThanOrEqual(3);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === caller).length).toBeGreaterThanOrEqual(10);
    expect(spells).toBeGreaterThanOrEqual(10);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(4 * UNIT_DEFS[screen].cost);
    const mined = 20000 - game.resources.reduce((total, mine) => total + mine.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    const delivered = deliveries.mock.calls.reduce((total, [gold]) => total + gold, 0);
    // Keep both conservation checks exact: ore first, then spendable integer cents.
    expect(delivered + carried).toBe(mined);
    expect(deliveries.mock.calls.some(([, supply]) => supply > 40)).toBe(true);
    expect(new Set(deliveries.mock.calls.map(([, supply]) => supply)).size).toBeGreaterThan(1);
    const creditedCents = deliveries.mock.calls.reduce((total, [gold, supply]) =>
      total + Math.round(gold * 100 * (supply <= 40 ? 1 : 30 / (supply - 10))), 0);
    expect(creditedCents).toBeLessThan(delivered * 100);
    expect(Math.round(game.players.us!.gold * 100) + Math.round(game.match.stats.goldSpent.us! * 100))
      .toBe(50000 + creditedCents);
  });
});
