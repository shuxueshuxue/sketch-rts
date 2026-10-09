import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UNIT_DEFS } from '../../shared/catalog';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

describe('summon host support against artillery', () => {
  it.each(['grove', 'ember'] as const)('pays for a lasting %s front while continuing to summon', race => {
    const caller = race === 'grove' ? 'summoner' : 'pyreCaller';
    const screen = race === 'grove' ? 'lancer' : 'ashWarden';
    let scene = sketchScene('summon-artillery-counter').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'ember', team: 'b' })
      .townHall('us', 500, 500).goldMine('main', 788, 500, 10000)
      .townHall('us', 1400, 500).goldMine('natural', 1688, 500, 10000)
      .townHall('foe', 3500, 3500).unit('foe', 'catapult', 3200, 3500, { order: { type: 'hold', x: 3200, y: 3500 } })
      .building('us', UNIT_DEFS[screen].trainedAt!, 700, 850)
      .building('us', UNIT_DEFS[caller].trainedAt!, 1000, 850).farms('us', 8, 400, 1600);
    for (let i = 0; i < 11; i++) scene = scene.worker('us', i < 5 ? 540 : 1440, 550 + i % 5 * 20,
      { order: { type: 'mine', resourceId: i < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 10; i++) scene = scene.unit('us', caller, 800 + i % 5 * 35, 1000 + Math.floor(i / 5) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
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
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBeLessThanOrEqual(500 + mined - carried);
  });
});
