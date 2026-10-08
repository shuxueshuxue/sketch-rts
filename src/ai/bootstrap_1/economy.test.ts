import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planV6Economy } from '../policy/v6/economy';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapEconomy } from './economy';

function expansionScene(archers: number, farms: number, gold: number) {
  let scene = sketchScene('population-before-third-mine').replaceDefaults()
    .player('us', { race: 'ember' }).player('foe', { race: 'grove' }).playerState('us', { gold })
    .townHall('us', 500, 500).goldMine('main', 788, 500, 4000)
    .townHall('us', 1400, 500).goldMine('natural', 1688, 500, 4000)
    .goldMine('third', 2300, 500, 4000).townHall('foe', 2800, 2800)
    .building('us', 'emberForge', 500, 850).building('us', 'emberForge', 700, 850)
    .building('us', 'cinderSpire', 900, 850).building('us', 'workshop', 1100, 850)
    .farms('us', farms, 400, 1300);
  for (let index = 0; index < 11; index++) scene = scene.worker('us', 1800 + index * 25, 700);
  for (let index = 0; index < archers; index++) scene = scene.unit('us', 'sparkArcher', 2250 + index * 35, 700);
  for (let index = 0; index < 4; index++) scene = scene.unit('us', 'ashWarden', 2250 + index * 40, 800);
  for (let index = 0; index < 3; index++) scene = scene.unit('us', 'ashHexer', 2250 + index * 40, 900);
  return scene.build().createGame();
}

function context(game: ReturnType<typeof expansionScene>) {
  const memory = createAiPolicyMemory();
  memory.v6 = { phase: 3 };
  return bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_archer', { memory });
}

describe('bootstrap_1 production budget', () => {
  it('builds a covered third mining hall with ordinary funds instead of buying population for idle producers', () => {
    const control = expansionScene(8, 6, 400), candidate = expansionScene(8, 6, 400);
    const before = snapshotGame(candidate);
    expect(before.players.us!.supplyCap - before.players.us!.supplyUsed).toBe(11);
    const oldCommands = planV6Economy(snapshotGame(control), 'us', context(control));
    const commands = planBootstrapEconomy(before, 'us', context(candidate));
    for (const command of oldCommands) issuePlayerCommand(control, 'us', command);
    for (const command of commands) issuePlayerCommand(candidate, 'us', command);
    for (let tick = 0; tick < 1200; tick++) { stepGame(control); stepGame(candidate); }
    expect(control.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall')).toHaveLength(2);
    expect(candidate.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
    expect(candidate.players.us!.gold).toBe(400 - BUILDING_DEFS.townHall.cost);
    expect(candidate.players.us!.supplyCap).toBe(before.players.us!.supplyCap + BUILDING_DEFS.townHall.supplyProvided);
  });

  it('finishes a real farm before resuming training when the next unit cannot fit', () => {
    const game = expansionScene(7, 4, 2000), options = context(game);
    expect(game.players.us!.supplyCap - game.players.us!.supplyUsed).toBe(1);
    const commands = planBootstrapEconomy(snapshotGame(game), 'us', options);
    expect(commands.some(command => command.type === 'build' && command.buildingKind === 'farm')).toBe(true);
    expect(commands.some(command => command.type === 'train')).toBe(false);
    for (const command of commands) issuePlayerCommand(game, 'us', command);
    for (let tick = 0; tick < 1200; tick++) stepGame(game);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'farm' && building.complete)).toBe(true);
    const resumed = planBootstrapEconomy(snapshotGame(game), 'us', options);
    expect(resumed.some(command => command.type === 'train')).toBe(true);
  });

  it('trains a real unit with the remaining gold when a duplicate research request cannot be issued', () => {
    let scene = sketchScene('one-research-slot').replaceDefaults()
      .player('us', { race: 'grove' }).player('foe', { race: 'grove' }).playerState('us', { gold: 280 })
      .townHall('us', 500, 500).goldMine('main', 788, 500, 4000).townHall('foe', 2600, 2600)
      .building('us', 'barracks', 400, 850).building('us', 'barracks', 650, 850)
      .building('us', 'archeryRange', 900, 850).farms('us', 5, 400, 1300);
    for (let index = 0; index < 6; index++) scene = scene.worker('us', 500 + index * 40, 650);
    for (let index = 0; index < 8; index++) scene = scene.unit('us', 'archer', 1100 + index * 40, 800);
    const game = scene.build().createGame();
    const commands = planBootstrapEconomy(snapshotGame(game), 'us', {
      version: 'v2', requestedVersion: 'v9', memory: createAiPolicyMemory(), armyWants: [],
      doctrines: [{ id: 'research-before-recruiting', race: 'grove', weight: 1, standIn: 'archer', raids: [], phases: [{
        advanceShare: 1, advanceSupply: 1000, wants: [
          { upgrade: 'weaponTraining', level: 1, priority: 80 },
          { upgrade: 'reinforcedPlating', level: 1, priority: 79 },
          { unit: 'archer', count: 12, priority: 74 },
        ],
      }] }],
    });
    expect(commands.filter(command => command.type === 'research')).toHaveLength(1);
    expect(commands.filter(command => command.type === 'train' && command.unitKind === 'archer')).toHaveLength(1);
    for (const command of commands) issuePlayerCommand(game, 'us', command);
    expect(game.buildings.flatMap(building => building.researchQueue)).toHaveLength(1);
    expect(game.buildings.flatMap(building => building.queue)).toHaveLength(1);
    expect(game.players.us!.gold).toBe(280 - UPGRADE_DEFS.weaponTraining.levels[0]!.cost - UNIT_DEFS.archer.cost);
  });

  it('recruits another summoner instead of researching weapons that do not strengthen its spirits', () => {
    let scene = sketchScene('spirit-host-investment').replaceDefaults()
      .player('us', { race: 'ember' }).player('foe', { race: 'grove' }).playerState('us', { gold: 180 })
      .townHall('us', 500, 500).goldMine('main', 788, 500, 4000)
      .townHall('us', 1400, 500).goldMine('natural', 1688, 500, 4000).townHall('foe', 2800, 2800)
      .building('us', 'emberForge', 500, 850)
      .building('us', 'cinderSpire', 700, 850).building('us', 'cinderSpire', 900, 850)
      .building('us', 'defenseTower', 1450, 700)
      .farms('us', 5, 400, 1300);
    for (let index = 0; index < 11; index++) scene = scene.worker('us', 500 + index * 35, 650);
    for (let index = 0; index < 10; index++) scene = scene.unit('us', 'pyreCaller', 1500 + index * 35, 1000, { id: `caller-${index}` });
    const control = scene.build().createGame(), candidate = scene.build().createGame();
    for (const [index, game] of [control, candidate].entries()) {
      const memory = createAiPolicyMemory(); memory.v6 = { phase: 2 };
      const options = bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_summoner', { memory, teams: game.teams });
      if (index === 0) options.armyWants = [...options.armyWants!, { upgrade: 'weaponTraining', level: 3, priority: 59 }];
      const commands = planBootstrapEconomy(snapshotGame(game), 'us', options);
      for (const command of commands) issuePlayerCommand(game, 'us', command);
      for (let tick = 0; tick < 700; tick++) stepGame(game);
      const caster = game.units.find(unit => unit.id === 'caller-0')!;
      issuePlayerCommand(game, 'us', { type: 'cast', unitId: caster.id, ability: 'cinderSoul', x: caster.x + 54, y: caster.y + 28 });
    }
    expect(control.players.us!.upgrades.weaponTraining).toBe(1);
    expect(candidate.players.us!.upgrades.weaponTraining).toBe(0);
    expect(control.units.filter(unit => unit.owner === 'us' && unit.kind === 'pyreCaller')).toHaveLength(10);
    expect(candidate.units.filter(unit => unit.owner === 'us' && unit.kind === 'pyreCaller')).toHaveLength(11);
    for (const game of [control, candidate]) {
      const spirit = game.units.find(unit => unit.owner === 'us' && unit.kind === 'spirit')!;
      expect(spirit.attackDamage).toBe(UNIT_DEFS.spirit.attackDamage);
      expect(spirit.maxHp).toBe(UNIT_DEFS.spirit.hp);
    }
    expect(candidate.players.us!.gold).toBe(180 - UNIT_DEFS.pyreCaller.cost);
  });
});
