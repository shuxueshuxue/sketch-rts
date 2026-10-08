import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planV6CasterScreen } from '../policy/v6/backline';
import { bootstrapPolicyContext } from './policy';
import { planSummonerScreen } from './summoner-screen';

function defendedMine(race: 'grove' | 'ember') {
  let scene = sketchScene('summoner-mine-post').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', 400, 600).townHall('us', 1400, 1600).goldMine('natural', 1688, 1600, 4000)
    .townHall('foe', 3500, 3000).farms('us', 4, 400, 2200)
    .tower('us', 1500, 1600, { id: 'mine-tower' })
    .unit('us', race === 'grove' ? 'summoner' : 'pyreCaller', 1350, 1600, { id: 'caster' });
  for (let i = 0; i < 3; i++) scene = scene.unit('foe', 'footman', 1900, 1540 + i * 60);
  for (let i = 0; i < 2; i++) scene = scene.unit('foe', 'ballista', 3000, 1500 + i * 80, { id: `battery-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  memory.v6 = { general: { mode: 'defend', target: { x: 1850, y: 1600 }, leash: 450 } };
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
  issuePlayerCommand(game, 'us', { type: 'cast', unitId: 'caster', ability: race === 'grove' ? 'summon' : 'cinderSoul', x: 1200, y: 1600 });
  stepGame(game);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.kind === 'spirit').map(unit => unit.id) });
  const context = () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_summoner', { memory, teams: game.teams });
  return { game, context };
}

describe('bootstrap_1 summon host staging', () => {
  it.each(['grove', 'ember'] as const)('keeps the %s caster at its firing mine tower between waves, then leaves when the tower falls', race => {
    const control = defendedMine(race), candidate = defendedMine(race);
    for (let tick = 0; tick < 400; tick++) for (const [index, { game, context }] of [control, candidate].entries()) {
      if (tick % 15 === 0) for (const command of (index === 0 ? planV6CasterScreen : planSummonerScreen)(snapshotGame(game), 'us', context())) {
        issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    const caster = candidate.game.units.find(unit => unit.id === 'caster')!;
    expect(Math.hypot(caster.x - 1500, caster.y - 1600)).toBeLessThan(250);
    expect(control.game.units.find(unit => unit.id === 'caster')!.x).toBeLessThan(700);
    expect(caster.hp).toBe(caster.maxHp);
    expect(candidate.game.units.filter(unit => unit.owner === 'foe' && unit.kind === 'footman').length).toBeLessThan(3);
    issuePlayerCommand(candidate.game, 'foe', { type: 'attack', unitIds: ['battery-0', 'battery-1'], targetId: 'mine-tower' });
    for (let tick = 0; tick < 1400 && candidate.game.buildings.some(building => building.id === 'mine-tower'); tick++) {
      if (tick % 15 === 0) for (const command of planSummonerScreen(snapshotGame(candidate.game), 'us', candidate.context())) issuePlayerCommand(candidate.game, 'us', command);
      stepGame(candidate.game);
    }
    expect(candidate.game.buildings.some(building => building.id === 'mine-tower')).toBe(false);
    const retreat = planSummonerScreen(snapshotGame(candidate.game), 'us', candidate.context());
    expect(retreat).toContainEqual({ type: 'move', unitIds: ['caster'], x: 400, y: 600 });
    expect(candidate.game.match.stats.goldSpent.us).toBe(0);
  });
});
