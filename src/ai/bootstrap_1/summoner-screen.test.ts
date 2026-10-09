import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planV6CasterScreen } from '../policy/v6/backline';
import { bootstrapPolicyContext } from './policy';
import { planSummonerScreen } from './summoner-screen';
import { planAiOwnerCommandEntries } from '../planner-context';
import { issueCommandFrame } from '../../sdk/commands/frame';

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
  it.each(['grove', 'ember'] as const)('follows the actual %s screen ahead without averaging rear troops and fresh rear summons into it', race => {
    const caster = race === 'grove' ? 'summoner' : 'pyreCaller';
    const body = race === 'grove' ? 'footman' : 'emberRavager';
    const gun = race === 'grove' ? 'ballista' : 'catapult';
    let scene = sketchScene('summoner-forward-screen').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 800).townHall('foe', 3500, 800).farms('us', 8, 400, 2200)
      .unit('us', gun, 1600, 800);
    for (let index = 0; index < 3; index++) scene = scene.unit('us', body, 1650, 750 + index * 40)
      .unit('us', 'spirit', 2100, 750 + index * 40);
    for (let index = 0; index < 6; index++) scene = scene.unit('us', caster, 1800 - index % 2 * 35, 700 + Math.floor(index / 2) * 50,
      { id: `caster-${index}` }).unit('us', 'spirit', 1750, 680 + index * 40);
    const control = scene.build().createGame(), candidate = scene.build().createGame();
    for (const [index, game] of [control, candidate].entries()) {
      const memory = createAiPolicyMemory();
      memory.v6 = { general: { mode: 'attack', target: { x: 3500, y: 800 } } };
      const options = bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_summoner', { memory, teams: game.teams });
      for (const command of (index === 0 ? planV6CasterScreen : planSummonerScreen)(snapshotGame(game), 'us', options)) issuePlayerCommand(game, 'us', command);
      for (let tick = 0; tick < 30; tick++) stepGame(game);
      const casters = game.units.filter(unit => unit.id.startsWith('caster-'));
      expect(casters).toHaveLength(6);
      expect(casters.every(unit => {
        const startX = 1800 - Number(unit.id.slice('caster-'.length)) % 2 * 35;
        return index === 0 ? unit.x < startX : unit.x > startX;
      })).toBe(true);
      expect(casters.every(unit => unit.hp === unit.maxHp)).toBe(true);
      expect(game.match.stats.goldSpent.us).toBe(0);
    }
  });
  it.each(['grove', 'ember'] as const)('marches the %s host from outside tower-rush reach and pays for its first forward tower', race => {
    const caster = race === 'grove' ? 'summoner' : 'pyreCaller';
    const body = race === 'grove' ? 'footman' : 'emberRavager';
    const gun = race === 'grove' ? 'ballista' : 'catapult';
    let scene = sketchScene('summoner-march-to-construction').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 250).goldMine('main', 688, 250, 10000)
      .townHall('foe', 3400, 800).farms('us', 8, 400, 2200)
      .worker('us', 800, 900, { id: 'builder' }).unit('us', gun, 600, 800);
    for (let index = 0; index < 5; index++) scene = scene.worker('us', 440, 220 + index * 20,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let index = 0; index < 3; index++) scene = scene.unit('us', body, 550, 750 + index * 40);
    for (let index = 0; index < 6; index++) scene = scene.unit('us', caster, 800 - index % 2 * 35, 700 + Math.floor(index / 2) * 50);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { phase: 2, general: { mode: 'attack', targetHallId: game.buildings.find(building => building.owner === 'foe')!.id,
      target: { x: 3400, y: 800 }, group: game.units.filter(unit => unit.kind !== 'worker').map(unit => unit.id), groupStart: 10 } };
    const sites: { x: number; y: number }[] = [];
    for (let tick = 0; tick < 2400 && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_summoner', memory }, { teams: game.teams });
        for (const entry of entries) if (entry.command.type === 'build' && entry.command.buildingKind === 'defenseTower') sites.push(entry.command);
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    const forward = game.buildings.filter(building => building.owner === 'us' && building.kind === 'defenseTower' && building.x > 1500);
    console.log(JSON.stringify({ race, tick: game.tick, sites, forward: forward.map(building => ({ x: building.x, complete: building.complete })),
      casters: game.units.filter(unit => unit.kind === caster).map(unit => ({ x: unit.x, y: unit.y })), spent: game.match.stats.goldSpent.us }));
    expect(sites.some(site => site.x > 1500)).toBe(true);
    expect(forward.some(building => building.complete)).toBe(true);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === caster).length).toBeGreaterThanOrEqual(6);
    const mined = 10000 - game.resources[0]!.amount;
    const carrying = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBeLessThanOrEqual(500 + mined - carrying);
  });
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
