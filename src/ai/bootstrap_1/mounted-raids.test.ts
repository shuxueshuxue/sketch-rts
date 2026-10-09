import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { distance } from '../policy/spatial';
import { recordAiMemoryForCommands } from '../policy/claims';

describe('bootstrap_1 mounted raid recruitment', () => {
  it.each([
    { label: 'temporarily covered miner with an exposed hauling lane', mineX: 2500, amount: 10000, mining: true, retained: true },
    { label: 'fully covered hauling lane', mineX: 2300, amount: 10000, mining: true, retained: false },
    { label: 'depleted exposed mine', mineX: 2500, amount: 0, mining: true, retained: false },
    { label: 'covered worker no longer mining', mineX: 2500, amount: 10000, mining: false, retained: false },
  ])('keeps raid ownership only for a $label', ({ mineX, amount, mining, retained }) => {
    const game = sketchScene('mounted-mining-window').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', 500, 500).townHall('foe', 2200, 1000, { id: 'raid-hall' })
      .building('foe', 'defenseTower', 2200, 1160).goldMine('mine', mineX, 1000, amount)
      .unit('us', 'horseArcher', 2660, 900, { id: 'rider' })
      .worker('foe', 2350, 1000, { id: 'miner', order: mining
        ? { type: 'mine', resourceId: 'mine', phase: 'return', timer: 0 } : { type: 'idle' } })
      .build().createGame();
    const memory = createAiPolicyMemory();
    const assignment = { unitIds: ['rider'], objective: { kind: 'raid' as const, hallId: 'raid-hall', owner: 'foe' } };
    memory.mounted = [assignment];
    const entries = planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams });
    expect(memory.mounted).toEqual(retained ? [assignment] : []);
    const mounted = entries.filter(entry => entry.scriptId === 'mountedTasks');
    if (retained) {
      expect(mounted).toEqual([{ playerId: 'us', scriptId: 'mountedTasks', command: { type: 'holdPosition', unitIds: ['rider'] } }]);
      expect(entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes('rider'))).toEqual(mounted);
      issueCommandFrame(game, entries);
      expect(game.units.find(unit => unit.id === 'rider')!.order).toEqual({ type: 'hold', x: 2660, y: 900 });
    } else expect(mounted).toEqual([]);
  });

  it('keeps an injured raider in its existing squad until a recovery order takes command', () => {
    const game = sketchScene('mounted-injury-command-continuation').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', 400, 400).townHall('foe', 2600, 2300, { id: 'raid-hall' })
      .unit('us', 'horseArcher', 2180, 2000, { id: 'rider' })
      .worker('foe', 2850, 2300, { id: 'miner' })
      .unit('foe', 'footman', 2400, 1950, { id: 'caster' })
      .item('staff', 'stormStaff', 0, 0, { carrierId: 'caster' }).build().createGame();
    const memory = createAiPolicyMemory();
    const plan = () => planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams });
    issueCommandFrame(game, plan());
    expect(memory.mounted![0]!.unitIds).toEqual(['rider']);
    issuePlayerCommand(game, 'foe', { type: 'useItem', unitId: 'caster', itemId: 'staff', x: 2180, y: 2000 });
    const rider = game.units.find(unit => unit.id === 'rider')!;
    expect(rider.hp).toBe(85);
    const evasion = plan();
    expect(memory.mounted![0]!.unitIds).toEqual(['rider']);
    expect(evasion.some(entry => entry.scriptId === 'shellEvasion' && entry.command.type === 'move'
      && entry.command.unitIds.includes('rider'))).toBe(true);
    const snapshot = snapshotGame(game);
    const recovery = { type: 'move' as const, unitIds: ['rider'], x: 700, y: 700 };
    issuePlayerCommand(game, 'us', recovery);
    recordAiMemoryForCommands(snapshot, 'skirmishPreservation', [recovery], memory);
    plan();
    expect(memory.mounted).toEqual([]);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it('starts with one rider and admits normally purchased reinforcements into that same raid', () => {
    const game = sketchScene('mounted-raid-recruitment').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 1000).townHall('foe', 3500, 3500, { id: 'raid-hall' })
      .building('us', 'stables', 500, 1300, { id: 'stables' }).farms('us', 8, 400, 1800)
      .unit('us', 'horseArcher', 700, 1400, { id: 'lead' })
      .worker('foe', 3750, 3500, { id: 'miner' }).build().createGame();
    const memory = createAiPolicyMemory();
    for (let tick = 0; tick < 660; tick++) {
      if (tick === 0 || tick === 220) issuePlayerCommand(game, 'us',
        { type: 'train', buildingId: 'stables', unitKind: 'horseArcher' });
      if (tick % 15 === 0) {
        issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
          { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams }));
        if (tick === 0) expect(memory.mounted).toEqual([{ unitIds: ['lead'],
          objective: { kind: 'raid', hallId: 'raid-hall', owner: 'foe' } }]);
      }
      stepGame(game);
    }
    const riders = game.units.filter(unit => unit.kind === 'horseArcher');
    expect(riders).toHaveLength(3);
    expect(memory.mounted).toHaveLength(1);
    expect(new Set(memory.mounted![0]!.unitIds)).toEqual(new Set(riders.map(unit => unit.id)));
    expect(game.match.stats.goldSpent.us).toBe(300);
  });

  it('lets a lone rider clear an exposed mining line and its melee pursuers without taking damage', () => {
    let scene = sketchScene('mounted-tower-pocket').replaceDefaults().player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .playerState('us', { gold: 0 }).townHall('us', 500, 500).townHall('foe', 2200, 1000)
      .building('foe', 'defenseTower', 2200, 1160).goldMine('foe-mine', 2500, 1000, 10000)
      .unit('us', 'horseArcher', 2800, 900, { id: 'rider' });
    for (let index = 0; index < 5; index++) scene = scene.unit('foe', 'worker', 2460 + index * 20, 1020 + index * 25,
      { id: `worker-${index}`, order: { type: 'mine', resourceId: 'foe-mine', phase: 'toMine', timer: 0 } });
    for (let index = 0; index < 8; index++) scene = scene.unit('foe', 'footman', 2390, 780 + index * 40, { id: `defender-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    let damage = 0;
    const hits: unknown[] = [];
    game.observer = { hit(source, target, taken) { if (target.id === 'rider') {
      damage += taken;
      hits.push({ tick: game.tick, source: source.id, damage: taken });
    } } };
    for (let tick = 0; tick < 12000 && game.units.some(unit => unit.owner === 'foe'); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), commands = planAiOwnerCommandEntries(snapshot,
          { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams });
        expect(commands.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes('rider')).every(entry => entry.scriptId === 'mountedTasks')).toBe(true);
        issueCommandFrame(game, commands);
        const riders = game.units.filter(unit => unit.owner === 'us');
        if (!riders.length) break;
        for (const defender of game.units.filter(unit => unit.kind === 'footman')) {
          const target = [...riders].sort((a, b) => distance(a, defender) - distance(b, defender))[0]!;
          issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: [defender.id], targetId: target.id });
        }
      }
      stepGame(game);
    }

    expect(game.units.filter(unit => unit.owner === 'us')).toHaveLength(1);
    expect(game.units.filter(unit => unit.owner === 'foe')).toHaveLength(0);
    expect(damage).toBe(0);
    expect(hits).toEqual([]);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
});
