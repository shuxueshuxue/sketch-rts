import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../../shared/sim';
import { createAiPolicyMemory } from '../../memory';
import { planV6General } from '../v6/general';

function scene(race: 'grove' | 'ember', distant: boolean) {
  let setup = sketchScene('rising-hall-travel-window').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', 500, 500).townHall('foe', 2800, 2800)
    .townHall('foe', 1500, 1500, { id: 'site', complete: false })
    .worker('foe', 1500, 1580, { id: 'builder' });
  for (let index = 0; index < 5; index++) setup = setup.unit('us', race === 'grove' ? 'lancer' : 'emberRavager',
    (distant ? 3000 : 1240) - index % 2 * 40, 1420 + Math.floor(index / 2) * 45, { id: `fighter-${index}` });
  const game = setup.build().createGame(), memory = createAiPolicyMemory();
  memory.v6 = { phase: 0, doctrine: { profileId: 'steady', strategyId: race === 'grove' ? 'grove-cavalry-line' : 'ember-ravager-line', decidedTick: 0 } };
  issuePlayerCommand(game, 'foe', { type: 'repair', unitIds: ['builder'], buildingId: 'site' });
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id) });
  stepGame(game);
  const plan = () => planV6General(snapshotGame(game), 'us', { version: 'v2', requestedVersion: 'v8', memory, teams: game.teams });
  return { game, memory, plan };
}

describe('construction raid timing', () => {
  it.each(['grove', 'ember'] as const)('rejects a distant %s quick strike whose target completes before ordinary attacks can raze it', race => {
    const { game, memory, plan } = scene(race, true);
    expect(game.buildings.find(building => building.id === 'site')!.buildProgress).toBeGreaterThan(0);
    plan();
    expect(memory.v6!.general?.quick).toBeUndefined();
    expect(memory.v6!.plays?.['general:attack:rising']).toBeUndefined();
    // Execute the tempting raid directly to prove its construction window was missed.
    issuePlayerCommand(game, 'us', { type: 'attack', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), targetId: 'site' });
    let completed = false;
    for (let tick = 0; tick < 800 && game.buildings.some(building => building.id === 'site'); tick++) {
      stepGame(game);
      completed ||= game.buildings.some(building => building.id === 'site' && building.complete);
    }
    expect(completed).toBe(true);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker')).toHaveLength(5);
  });

  it.each(['grove', 'ember'] as const)('lets a nearby %s squad destroy a normally growing site before it completes', race => {
    const { game, memory, plan } = scene(race, false);
    const initial = plan();
    expect(memory.v6!.general).toMatchObject({ targetHallId: 'site', quick: true });
    for (const command of initial) issuePlayerCommand(game, 'us', command);
    let completed = false;
    for (let tick = 0; tick < 500 && game.buildings.some(building => building.id === 'site'); tick++) {
      if (tick % 15 === 0) for (const command of plan()) issuePlayerCommand(game, 'us', command);
      stepGame(game);
      completed ||= game.buildings.some(building => building.id === 'site' && building.complete);
    }
    expect(game.buildings.some(building => building.id === 'site')).toBe(false);
    expect(completed).toBe(false);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker')).toHaveLength(5);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
