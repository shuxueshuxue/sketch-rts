import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

describe('summon host recognizing enemy home defenders', () => {
  it.each(['grove', 'ember'] as const)('finishes the %s assault while another enemy stays behind its own hall', race => {
    const kind = race === 'grove' ? 'summoner' : 'pyreCaller';
    let scene = sketchScene('outpost-near-enemy-home').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('target', { team: 'b' }).player('other', { team: 'b' })
      .playerState('us', { gold: 0 }).townHall('us', 400, 400)
      .townHall('target', 3400, 3000, { id: 'target-hall' }).townHall('other', 3300, 1000, { id: 'other-hall' })
      .tower('us', 2550, 1050).farms('us', 8, 400, 2200);
    for (let i = 0; i < 6; i++) scene = scene.unit('us', kind, 2700 + i % 3 * 40, 2700 + Math.floor(i / 3) * 40);
    for (let i = 0; i < 4; i++) scene = scene.unit('other', 'footman', 3100 + i % 2 * 35, 1000 + Math.floor(i / 2) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    issuePlayerCommand(game, 'other', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'other').map(unit => unit.id) });
    for (const caster of game.units.filter(unit => unit.owner === 'us')) issuePlayerCommand(game, 'us', {
      type: 'cast', unitId: caster.id, ability: race === 'grove' ? 'summon' : 'cinderSoul', x: caster.x + 180, y: caster.y + 40,
    });
    for (let tick = 0; tick < 30; tick++) stepGame(game);
    memory.v6 = { phase: 2, general: { mode: 'attack', targetHallId: 'target-hall', target: { x: 3400, y: 3000 },
      group: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), groupStart: 10, stage: 'strike', stageSince: game.tick } };
    for (let tick = 0; tick < 900; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game), {
        playerId: 'us', version: 'v9_summoner', memory,
      }, { teams: game.teams, policyMode: 'combat' }));
      stepGame(game);
    }
    expect(game.buildings.some(building => building.id === 'target-hall')).toBe(false);
    expect(game.buildings.find(building => building.id === 'other-hall')!.hp).toBe(900);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === kind)).toHaveLength(6);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === kind).every(unit => unit.hp === unit.maxHp)).toBe(true);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
