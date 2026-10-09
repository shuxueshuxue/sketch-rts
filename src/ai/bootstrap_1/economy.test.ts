import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS } from '../../shared/catalog';
import type { TrainableUnitKind } from '../../shared/types';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planV6Economy } from '../policy/v6/economy';
import { planAbilityCommands } from '../policy/spell-tactics';
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
  it.each(['grove', 'ember'] as const)('recruits %s medical support and heals its damaged shooting line with ordinary commands', race => {
    const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
    const screen = race === 'grove' ? 'lancer' : 'ashWarden';
    const healer = race === 'grove' ? 'priest' : 'emberAcolyte';
    let scene = sketchScene('shooting-line-medical-support').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 500 })
      .townHall('us', 500, 500).townHall('foe', 3000, 3000).farms('us', 8, 400, 1500)
      .building('us', UNIT_DEFS[shooter].trainedAt!, 800, 850);
    if (UNIT_DEFS[healer].trainedAt !== UNIT_DEFS[shooter].trainedAt) scene = scene.building('us', UNIT_DEFS[healer].trainedAt!, 1000, 850);
    for (let index = 0; index < 6; index++) scene = scene.unit('us', shooter, 850 + index * 35, 900, { id: `shooter-${index}`, hp: 20 });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', screen, 850 + index * 35, 1020);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { phase: 1 };
    for (let tick = 0; tick < 600; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
        for (const command of [...planBootstrapEconomy(snapshot, 'us', options), ...planAbilityCommands(snapshot, 'us', options)]) issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    expect(game.units.some(unit => unit.owner === 'us' && unit.kind === healer)).toBe(true);
    expect(game.units.filter(unit => unit.id.startsWith('shooter-')).some(unit => unit.hp > 20)).toBe(true);
    expect(game.players.us!.gold).toBe(500 - game.match.stats.goldSpent.us!);
  });

  it.each(['grove', 'ember'] as const)('keeps the explicit %s opening squad while tech is locked instead of substituting extra basic soldiers', race => {
    const basic: TrainableUnitKind = race === 'grove' ? 'footman' : 'emberRavager';
    const caster: TrainableUnitKind = race === 'grove' ? 'summoner' : 'pyreCaller';
    let scene = sketchScene('explicit-opening-before-caster-tier').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .playerState('us', { gold: BUILDING_DEFS.farm.cost + UNIT_DEFS[basic].cost })
      .townHall('us', 500, 500).goldMine('main', 788, 500, 4000)
      .townHall('us', 1400, 500).goldMine('natural', 1688, 500, 4000).townHall('foe', 3500, 3000)
      .building('us', UNIT_DEFS[basic].trainedAt!, 700, 850).farms('us', 3, 400, 1500);
    for (let i = 0; i < 11; i++) scene = scene.worker('us', 400 + i * 35, 800);
    for (let i = 0; i < 4; i++) scene = scene.unit('us', basic, 1400 + i * 35, 1000);
    const options = () => ({ version: 'v2' as const, requestedVersion: 'v7' as const, memory: createAiPolicyMemory(), armyWants: [],
      doctrines: [{ id: 'explicit-opening-and-tech', race, weight: 1, standIn: basic, raids: [], phases: [{
        advanceShare: 1, advanceSupply: 1000, wants: [
          { unit: basic, count: 4, priority: 66 }, { unit: caster, count: 8, priority: 65 },
        ],
      }] }],
    });
    const control = scene.build().createGame(), candidate = scene.build().createGame();
    for (const [index, game] of [control, candidate].entries()) {
      for (const command of (index === 0 ? planV6Economy : planBootstrapEconomy)(snapshotGame(game), 'us', options())) issuePlayerCommand(game, 'us', command);
      for (let tick = 0; tick < 250; tick++) stepGame(game);
    }
    expect(candidate.units.filter(unit => unit.kind === basic)).toHaveLength(4);
    expect(control.units.filter(unit => unit.kind === basic)).toHaveLength(5);
    expect(candidate.units.some(unit => unit.kind === caster)).toBe(false);
    expect(candidate.buildings.filter(building => building.kind === 'farm' && building.complete)).toHaveLength(4);
    expect(candidate.match.stats.goldSpent.us).toBe(BUILDING_DEFS.farm.cost);
    expect(candidate.players.us!.gold).toBe(UNIT_DEFS[basic].cost);
  });

  it.each(['grove', 'ember'] as const)('adds the %s heavy unit factory and trains through both real queues', race => {
    const grove = race === 'grove';
    const heavy = grove ? 'knight' : 'ashChieftain';
    const producer = UNIT_DEFS[heavy].trainedAt!;
    const basic = grove ? 'raider' : 'emberRavager';
    const healer = grove ? 'priest' : 'emberAcolyte';
    const hexer = grove ? 'witch' : 'ashHexer';
    const lab = grove ? 'barracks' : 'emberForge';
    let scene = sketchScene('heavy-production-chain').replaceDefaults()
      .player('us', { race }).player('foe', { race: 'grove' }).playerState('us', { gold: 2000 })
      .townHall('us', 500, 500).goldMine('main', 788, 500, 4000)
      .townHall('us', 1400, 500).goldMine('natural', 1688, 500, 4000).townHall('foe', 2800, 2800)
      .building('us', producer, 500, 850).building('us', lab, 700, 850)
      .building('us', 'defenseTower', 1450, 700)
      .building('us', UNIT_DEFS[healer].trainedAt!, 900, 850).farms('us', 10, 400, 1600);
    for (let index = 0; index < 11; index++) scene = scene.worker('us', 500 + index * 30, 650);
    for (let index = 0; index < (grove ? 8 : 10); index++) scene = scene.unit('us', basic, 1400 + index * 30, 1000);
    for (let index = 0; index < 3; index++) scene = scene.unit('us', healer, 1400 + index * 40, 1150).unit('us', hexer, 1400 + index * 40, 1250);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { phase: 2 };
    for (let pass = 0; pass < 2; pass++) {
      const options = bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_knight', { memory });
      for (const command of planBootstrapEconomy(snapshotGame(game), 'us', options)) issuePlayerCommand(game, 'us', command);
      for (let tick = 0; tick < 800; tick++) stepGame(game);
    }
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === producer && building.complete)).toHaveLength(2);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === heavy).length).toBeGreaterThanOrEqual(3);
    if (!grove) expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'emberForge')).toHaveLength(1);
  });

  it.each([
    { gold: 190, factory: 0, research: 0 },
    { gold: 365, factory: 1, research: 0 },
    { gold: 455, factory: 0, research: 1 },
  ])('leaves a normal recruitment wave funded before adding another factory ($gold gold)', ({ gold, factory, research }) => {
    let scene = sketchScene('factory-before-first-knight').replaceDefaults()
      .player('us', { race: 'grove' }).player('foe', { race: 'grove' }).playerState('us', { gold })
      .townHall('us', 500, 500).townHall('foe', 2800, 2800)
      .building('us', 'stables', 700, 850).building('us', 'barracks', 900, 850).farms('us', 10, 400, 1500);
    for (let index = 0; index < 6; index++) scene = scene.worker('us', 500 + index * 30, 650);
    for (let index = 0; index < 5; index++) scene = scene.unit('us', 'lancer', 700 + index * 40, 500);
    const control = scene.build().createGame(), candidate = scene.build().createGame();
    const options = () => ({
      version: 'v2' as const, requestedVersion: 'v9' as const, memory: createAiPolicyMemory(), armyWants: [],
      doctrines: [{ id: 'recruiting-and-capacity', race: 'grove' as const, weight: 1, standIn: 'lancer' as const, raids: [], phases: [{
        advanceShare: 1, advanceSupply: 1000, wants: [
          { upgrade: 'weaponTraining' as const, level: research, priority: 90 },
          { building: 'stables' as const, count: 2, priority: 80 },
          { unit: 'knight' as const, count: 6, priority: 74 },
        ],
      }] }],
    });
    for (const command of planV6Economy(snapshotGame(control), 'us', options())) issuePlayerCommand(control, 'us', command);
    for (const command of planBootstrapEconomy(snapshotGame(candidate), 'us', options())) issuePlayerCommand(candidate, 'us', command);
    for (let tick = 0; tick < 800; tick++) { stepGame(control); stepGame(candidate); }
    expect(candidate.units.filter(unit => unit.owner === 'us' && unit.kind === 'knight')).toHaveLength(1);
    expect(candidate.buildings.filter(building => building.owner === 'us' && building.kind === 'stables' && building.complete)).toHaveLength(1 + factory);
    expect(candidate.match.stats.goldSpent.us).toBe(UNIT_DEFS.knight.cost + factory * BUILDING_DEFS.stables.cost + research * UPGRADE_DEFS.weaponTraining.levels[0]!.cost);
    expect(control.units.filter(unit => unit.owner === 'us' && unit.kind === 'knight')).toHaveLength(gold === 365 ? 1 : 0);
  });

  it.each([false, true])('spends on a summoner or an advance tower according to a real incoming attack (%s)', incoming => {
    let scene = sketchScene('mining-hall-attack-intent').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' }).playerState('us', { gold: 180 })
      .townHall('us', 500, 500).goldMine('main', 788, 500, 4000).townHall('foe', 2800, 500)
      .building('us', 'barracks', 700, 850).building('us', 'sanctum', 900, 850).farms('us', 6, 400, 1500);
    for (let index = 0; index < 6; index++) scene = scene.worker('us', 500 + index * 30, 650);
    for (let index = 0; index < 4; index++) scene = scene.unit('us', 'footman', 600 + index * 35, 500);
    for (let index = 0; index < 8; index++) scene = scene.unit('foe', 'archer', 1800 + index * 30, 500);
    const game = scene.build().createGame();
    if (incoming) issuePlayerCommand(game, 'foe', { type: 'attackMove', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id), x: 500, y: 500 });
    const memory = createAiPolicyMemory(); memory.v6 = { phase: 1 };
    const options = bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_summoner', { memory, teams: game.teams });
    const control = planV6Economy(snapshotGame(game), 'us', options);
    expect(control.some(command => command.type === 'build' && command.buildingKind === 'defenseTower')).toBe(true);
    for (const command of planBootstrapEconomy(snapshotGame(game), 'us', options)) issuePlayerCommand(game, 'us', command);
    for (let tick = 0; tick < 250; tick++) stepGame(game);
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'defenseTower' && building.complete)).toHaveLength(incoming ? 1 : 0);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'summoner')).toHaveLength(incoming ? 0 : 1);
    expect(game.match.stats.goldSpent.us).toBe(incoming ? BUILDING_DEFS.defenseTower.cost : UNIT_DEFS.summoner.cost);
  });

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
