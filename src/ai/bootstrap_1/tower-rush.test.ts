import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import type { GameCommand } from '../../shared/types';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiMemoryProvider } from '../planner-context';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { planAbilityCommands } from '../policy/spell-tactics';
import { bootstrapEconomy } from './economy';
import { bootstrapPolicyContext } from './policy';
import { summonerTowerRush, towerRushAbilities, towerRushGoal } from './tower-rush';
import { createBootstrapCommandPlanner } from '../../../scripts/bootstrap_1-planner';
import { mineGuardUnitIds } from './mine-defense';

function battlefield(miningRaid = 0, support = 0, mineCrew = 0) {
  let scene = sketchScene('summoner-construction-convoy').replaceDefaults()
    .player('us', { race: 'ember', team: 'a' }).player('fa', { race: 'grove', team: 'b' }).player('fb', { race: 'grove', team: 'b' })
    .playerState('us', { gold: 450 }).townHall('us', 400, 620).goldMine('main', 688, 620, 4000)
    .townHall('us', 900, 2000).goldMine('natural', 1188, 2000, 4000)
    .townHall('fa', 2100, 450).townHall('fb', 2400, 850)
    .building('us', 'emberForge', 450, 900).building('us', 'cinderSpire', 300, 950).building('us', 'cinderSpire', 300, 1100)
    .tower('us', 1000, 1800).building('us', 'workshop', 600, 1000).farms('us', 9, 400, 1500)
    .worker('us', 1150, 620, { id: 'builder' }).worker('us', 1130, 680, { id: 'helper' });
  for (let index = 0; index < 5; index++) scene = scene
    .worker('us', 500 + index * 35, 620, { id: `main-worker-${index}` })
    .worker('us', 950 + index * 35, 2000, { id: `natural-worker-${index}` });
  for (let index = 0; index < 6; index++) scene = scene.unit('us', 'pyreCaller', 1140 - Math.floor(index / 3) * 40,
    550 + index % 3 * 50, { id: `caller-${index}` });
  for (let index = 0; index < support; index++) scene = scene.unit('us', 'ashHexer', 1100, 700 + index * 40, { id: `support-${index}` });
  for (let index = 0; index < mineCrew; index++) scene = scene.unit('us', 'ashWarden', 620 + index * 35, 750, { id: `mine-guard-${index}` });
  if (mineCrew > 0) scene = scene.tower('us', 600, 650);
  for (const [side, owner] of ['fa', 'fb'].entries()) {
    for (let index = 0; index < 4; index++) scene = scene.unit(owner, 'archer', 1770 + side * 50, 470 + index * 70);
    for (let index = 0; index < 3; index++) scene = scene.unit(owner, 'footman', 1630 + side * 60, 510 + index * 70);
  }
  for (let index = 0; index < miningRaid; index++) scene = scene.unit('fb', 'footman', 1250 + index * 35, 2500, { id: `mining-raid-${index}` });
  const game = scene.build().createGame();
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: game.units.filter(unit => unit.id.startsWith('main-worker-')).map(unit => unit.id), resourceId: 'main' });
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: game.units.filter(unit => unit.id.startsWith('natural-worker-')).map(unit => unit.id), resourceId: 'natural' });
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker').map(unit => unit.id) });
  for (const owner of ['fa', 'fb']) issuePlayerCommand(game, owner, { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === owner).map(unit => unit.id) });
  const memory = createAiPolicyMemory();
  memory.v6 = { phase: 2, doctrine: { profileId: 'steady', strategyId: 'ember-pyre-host', decidedTick: 0 } };
  const context = () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_summoner', { memory, teams: game.teams });
  return { game, memory, context };
}

describe('bootstrap_1 summoner tower rush', () => {
  it('waits when committing the mine guard would be necessary to cover the assault’s actual opposition', () => {
    const { game, context } = battlefield(0, 0, 4);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us' && unit.kind === 'spirit').map(unit => unit.id) });
    for (let tick = 0; tick < 800; tick++) stepGame(game);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    for (let index = 0; index < 3; index++) game.spawnUnit('fb', 'footman', 380 + index * 30, 990);
    const snapshot = snapshotGame(game), guards = mineGuardUnitIds(snapshot, 'us', context());
    expect(guards.size).toBe(3);
    expect(towerRushGoal(snapshot, 'us', context())).toBeUndefined();
    // Without the mine raid these three are available and the normal priced advance can start.
    game.units = game.units.filter(unit => !(unit.owner === 'fb' && unit.kind === 'footman' && unit.y === 990));
    expect(towerRushGoal(snapshotGame(game), 'us', context())).toBeDefined();
  });
  it('keeps support casters under the backline commander during the tower host’s advance', () => {
    const { game, context, memory } = battlefield(0, 2);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us' && unit.kind === 'spirit').map(unit => unit.id) });
    for (let tick = 0; tick < 800; tick++) stepGame(game);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    const goal = towerRushGoal(snapshotGame(game), 'us', context())!;
    issuePlayerCommand(game, 'us', goal.issue(new Set())!);
    const postOrders: string[] = [];
    for (let tick = 0; tick < 300; tick++) {
      if (tick % 15 === 0) for (const entry of runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
        [towerRushAbilities, summonerTowerRush, AI_SCRIPT_LIBRARY.v6Backline, AI_SCRIPT_LIBRARY.v6General], context())) {
        const command = entry.command;
        if ('unitIds' in command && command.unitIds.some(id => id.startsWith('support-'))) {
          expect(entry.scriptId).not.toBe(summonerTowerRush.id);
          if (entry.scriptId === 'v6Backline') postOrders.push(...command.unitIds);
        }
        issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    expect(memory.jobs.some(job => job.id === summonerTowerRush.id)).toBe(true);
    expect(new Set(postOrders)).toEqual(new Set(['support-0', 'support-1']));
    expect(game.units.filter(unit => unit.id.startsWith('support-'))).toHaveLength(2);
  });
  it.each([1, 3])('compares %i real mining attackers with local defenders before releasing the assault', attackers => {
    const { game, context, memory } = battlefield(attackers);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us' && unit.kind === 'spirit').map(unit => unit.id) });
    for (let tick = 0; tick < 800; tick++) stepGame(game);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    const goal = towerRushGoal(snapshotGame(game), 'us', context())!;
    expect(goal).toBeDefined();
    issuePlayerCommand(game, 'us', goal.issue(new Set())!);
    issuePlayerCommand(game, 'fb', { type: 'attackMove', unitIds: game.units.filter(unit => unit.id.startsWith('mining-raid-')).map(unit => unit.id), x: 1188, y: 2000 });
    const defenders = new Set<string>();
    let released = false;
    for (let tick = 0; tick < 400; tick++) {
      if (tick % 15 === 0) {
        const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
          [towerRushAbilities, summonerTowerRush, AI_SCRIPT_LIBRARY.v6Backline, AI_SCRIPT_LIBRARY.v6General], context());
        if (!memory.jobs.some(job => job.id === summonerTowerRush.id)) {
          released = true;
          for (const entry of entries) if (entry.scriptId === 'v6General' && (entry.command.type === 'move' || entry.command.type === 'attackMove')) {
            for (const id of entry.command.unitIds) defenders.add(id);
          }
        }
        for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
      }
      stepGame(game);
    }
    expect(released).toBe(attackers === 3);
    if (attackers === 3) {
      expect(defenders.size).toBeGreaterThanOrEqual(4);
      expect(memory.v6!.general!.mode).toBe('defend');
    } else expect(defenders.size).toBe(0);
  });

  it.each(['grove', 'ember'] as const)('continues a %s tower advance through clear ground to an ordinary enemy hall', race => {
    const kind = race === 'grove' ? 'summoner' : 'pyreCaller';
    let scene = sketchScene('tower-advance-spacing').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' }).playerState('us', { gold: 750 })
      .townHall('us', 400, 900).townHall('foe', 2500, 700).farms('us', 8, 400, 1900)
      .worker('us', 1050, 800, { id: 'builder' });
    for (let index = 0; index < 6; index++) scene = scene.unit('us', kind, 1050 - index % 2 * 35,
      600 + Math.floor(index / 2) * 50);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { phase: 2 };
    const sites: { x: number; y: number }[] = [];
    for (let tick = 0; tick < 2400 && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        const context = bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_summoner', { memory, teams: game.teams });
        for (const command of towerRushAbilities.run(snapshotGame(game), 'us', context) as GameCommand[]) issuePlayerCommand(game, 'us', command);
        const goal = towerRushGoal(snapshotGame(game), 'us', context);
        if (goal && game.players.us!.gold >= goal.cost) {
          const command = goal.issue(new Set())!;
          if (command.type !== 'build') throw new Error('Expected a construction command');
          if (sites.length > 0) expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'defenseTower'
            && building.complete && Math.hypot(command.x - building.x, command.y - building.y) <= building.attackRange)).toBe(true);
          sites.push(command);
          issuePlayerCommand(game, 'us', command);
        }
        for (const command of summonerTowerRush.run(snapshotGame(game), 'us', context) as GameCommand[]) issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    expect(sites.length).toBeGreaterThanOrEqual(4);
    expect(game.match.winner).toBe('us');
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === kind)).toHaveLength(6);
    expect(game.match.stats.goldSpent.us).toBe(sites.length * 125);
  });

  it('lets two normal summon waves cover priced construction and keeps each mine crew working', () => {
    const { game, context } = battlefield();
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us' && unit.kind === 'spirit').map(unit => unit.id) });
    expect(towerRushGoal(snapshotGame(game), 'us', context())).toBeUndefined();
    for (let tick = 0; tick < 800; tick++) stepGame(game);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    const snapshot = snapshotGame(game);
    const goal = towerRushGoal(snapshot, 'us', context())!;
    expect(goal.cost).toBe(125);
    const command = goal.issue(new Set())!;
    expect(command.type).toBe('build');
    if (command.type !== 'build') throw new Error('Expected a construction command');
    expect(['builder', 'helper']).toContain(command.unitId);
    const spentBefore = game.match.stats.goldSpent.us!;
    issuePlayerCommand(game, 'us', command);
    // Walking to a site does not pay for it until the worker actually lays the foundation.
    for (let tick = 0; tick < 600 && !game.buildings.some(building => building.kind === 'defenseTower'
      && building.x === command.x && building.y === command.y); tick++) stepGame(game);
    expect(game.match.stats.goldSpent.us! - spentBefore).toBe(goal.cost);
    const site = game.buildings.find(building => building.kind === 'defenseTower' && building.x === command.x && building.y === command.y)!;
    expect(site.complete).toBe(false);
    const helpers = summonerTowerRush.run(snapshotGame(game), 'us', context());
    if (!Array.isArray(helpers)) throw new Error('Expected convoy commands');
    for (const helper of helpers.filter(command => command.type === 'repair')) issuePlayerCommand(game, 'us', helper);
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(site.complete).toBe(true);
    for (const resourceId of ['main', 'natural']) expect(game.units.filter(unit => unit.owner === 'us'
      && unit.order.type === 'mine' && unit.order.resourceId === resourceId)).toHaveLength(5);
  });

  it('keeps a real host advancing while recruits arrive, despite the older backline and general orders', async () => {
    const { game, context, memory } = battlefield();
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us' && unit.kind === 'spirit').map(unit => unit.id) });
    for (let tick = 0; tick < 800; tick++) stepGame(game);
    const memories = createAiMemoryProvider();
    const opponents = await createBootstrapCommandPlanner(memories);
    for (const command of planAbilityCommands(snapshotGame(game), 'us', context())) issuePlayerCommand(game, 'us', command);
    for (const owner of ['fa', 'fb']) issuePlayerCommand(game, owner, { type: 'attackMove', unitIds: game.units.filter(unit => unit.owner === owner).map(unit => unit.id), x: 1150, y: 620 });
    const forward: string[] = [];
    let advanced = false;
    for (let tick = 0; tick < 1600 && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        for (const owner of ['fa', 'fb']) for (const entry of opponents({ game, snapshot: snapshotGame(game), owner,
          agent: { version: 'v5', policyMode: 'combat', controller: 'external-agent', team: 'b' }, source: 'external-agent',
          plannerOrigin: 'local-command-planner', teams: game.teams })) issuePlayerCommand(game, owner, entry.command);
        for (const entry of runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
          [bootstrapEconomy, towerRushAbilities, summonerTowerRush, AI_SCRIPT_LIBRARY.v6Backline, AI_SCRIPT_LIBRARY.v6General], context())) {
          if (entry.command.type === 'build' && entry.command.buildingKind === 'defenseTower' && entry.command.x > 1200) forward.push(entry.command.unitId);
          issuePlayerCommand(game, 'us', entry.command);
        }
        if (memory.jobs.some(job => job.id === summonerTowerRush.id) && game.buildings.some(building => building.kind === 'townHall'
          && (building.owner === 'fa' || building.owner === 'fb'))) advanced = true;
      }
      stepGame(game);
    }
    expect(advanced).toBe(true);
    expect(game.match.winner).toBe('us');
    expect(game.buildings.filter(building => building.owner === 'fa' || building.owner === 'fb')).toHaveLength(0);
    expect(forward.length).toBeGreaterThanOrEqual(2);
    expect(forward.every(id => id === 'builder' || id === 'helper')).toBe(true);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'pyreCaller').length).toBeGreaterThanOrEqual(6);
    expect(game.units.filter(unit => unit.owner === 'fa' || unit.owner === 'fb')).toHaveLength(0);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'defenseTower' && building.x > 1200 && building.complete)).toBe(true);
  }, 15000);
});
