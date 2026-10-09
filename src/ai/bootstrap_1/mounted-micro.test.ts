import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame, type Game } from '../../shared/sim';
import { CAMP_TEMPLATES } from '../../shared/camps';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { isWalkable, sameGround, walkingDistance } from '../../shared/terrain';
import type { Unit } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { distance } from '../policy/spatial';
import { neutralCamps, stagingPoint } from '../policy/v7/creep';
import { bootstrapGame, bootstrapMatches } from './benchmark';
import { mountedMicro, mountedTargetOrder } from './mounted-micro';
import { bootstrapPolicyContext } from './policy';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { planBootstrapGeneral } from './mine-defense';
import { mountedTasks } from './mounted-tasks';

function clearCamp(game: Game, rider: Unit, ids: ReadonlySet<string>) {
  let damage = 0;
  const turns: unknown[] = [];

  const hits: unknown[] = [];
  let arrows = 0;
  game.observer = { hit(source, target, taken) { if (source.id === rider.id) {
    arrows++;
  } if (target.id === rider.id) {
    damage += taken;
    hits.push({ tick: game.tick, kind: source.kind, taken, source: { x: source.x, y: source.y }, rider: { x: rider.x, y: rider.y }, order: structuredClone(rider.order), turns: structuredClone(turns) });
  } } };
  for (let tick = 0; tick < 24000; tick++) {
    const foes = game.units.filter(unit => ids.has(unit.id));
    if (!foes.length || !game.units.includes(rider)) break;
    if (tick % 15 === 0) {
      const target = [...foes].sort((a, b) => mountedTargetOrder(a, b) || distance(rider, a) - distance(rider, b))[0]!;
      const command = mountedMicro(snapshotGame(game), rider, target, foes, { kind: 'camp' });
      turns.push({ tick: game.tick, rider: { x: rider.x, y: rider.y, cooldown: rider.cooldown }, foes: foes.map(unit => ({ kind: unit.kind, x: unit.x, y: unit.y, hp: unit.hp, order: unit.order })), command });
      if (turns.length > 3) turns.shift();
      issueCommandFrame(game, [{ playerId: rider.owner, scriptId: 'mounted-proof', command }]);
    }
    stepGame(game);
  }
  console.log(JSON.stringify({ tick: game.tick, damage, hits, arrows, remaining: game.units.filter(unit => ids.has(unit.id)).map(unit => ({ kind: unit.kind, hp: unit.hp })) }));
  expect(game.units.includes(rider)).toBe(true);
  expect(game.units.some(unit => ids.has(unit.id))).toBe(false);
  expect(damage).toBe(0);
}

describe('mounted micro through ordinary SDK commands', () => {
  it('leaves an abandoned raid mine and travels to the remaining live mining line', () => {
    const scene = sketchScene('mounted-raid-completion').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 500).townHall('foe', 2600, 1000, { id: 'abandoned' })
      .townHall('foe', 2600, 2300, { id: 'working' }).worker('foe', 2800, 2300)
      .unit('us', 'horseArcher', 3000, 1000, { id: 'rider' }).unit('us', 'horseArcher', 3040, 1000, { id: 'partner' });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.mounted = [{ unitIds: ['rider', 'partner'], objective: { kind: 'raid', hallId: 'abandoned', owner: 'foe' } }];
    for (let tick = 0; tick < 120; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    expect(memory.mounted!.map(assignment => assignment.objective)).toEqual([{ kind: 'raid', hallId: 'working', owner: 'foe' }]);
    expect(game.units.filter(unit => unit.kind === 'horseArcher').every(unit => unit.y > 1200 && unit.hp === unit.maxHp)).toBe(true);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
  it('takes the real Pineshade forest detour toward its raid instead of waiting at the nearest short step', () => {
    const scene = sketchScene('mounted-forest-detour').map('pineshade').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 3984, 944).townHall('foe', 1456, 3120)
      .worker('foe', 1570, 3258, { id: 'quarry' })
      .unit('us', 'horseArcher', 3715.912, 1255.124, { id: 'rider' })
      .unit('us', 'horseArcher', 3750, 1255, { id: 'partner' });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const rider = game.units.find(unit => unit.id === 'rider')!, quarry = game.units.find(unit => unit.id === 'quarry')!;
    const initial = walkingDistance(game.map, rider, quarry)!;
    for (let tick = 0; tick < 120; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    expect(memory.mounted!.some(assignment => assignment.objective.kind === 'raid' && assignment.unitIds.includes(rider.id))).toBe(true);
    expect(walkingDistance(game.map, rider, quarry)).toBeLessThan(initial - 100);
    expect(rider.hp).toBe(rider.maxHp);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
  it('keeps a camp scout working while two normally purchased reinforcements begin their own raid', () => {
    const scene = sketchScene('mounted-parallel-objectives').replaceDefaults().player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 500).townHall('foe', 3000, 2000).worker('foe', 3300, 2000)
      .building('us', 'stables', 800, 700, { id: 'stables' }).farms('us', 6, 400, 1000)
      .goldMine('guarded', 1500, 1300, 4000)
      .unit('neutral', 'graniteGolem', 1500, 1500, { id: 'guard' })
      .unit('us', 'horseArcher', 1200, 1500, { id: 'scout' });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const guard = game.units.find(unit => unit.id === 'guard')!;
    guard.homeX = guard.x; guard.homeY = guard.y;
    issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'stables', unitKind: 'horseArcher' });
    for (let tick = 0; tick < 800; tick++) {
      if (tick === 220) issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'stables', unitKind: 'horseArcher' });
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    expect(memory.mounted!.map(assignment => assignment.objective.kind).sort()).toEqual(['camp', 'raid']);
    expect(memory.mounted!.find(assignment => assignment.objective.kind === 'camp')!.unitIds).toEqual(['scout']);
    expect(memory.mounted!.find(assignment => assignment.objective.kind === 'raid')!.unitIds).toHaveLength(2);
    expect(new Set(memory.mounted!.flatMap(assignment => assignment.unitIds)).size).toBe(3);
    expect(game.match.stats.goldSpent.us).toBe(300);
    expect(game.players.us!.gold).toBe(200);
  });
  it('lets the nearby main archer line finish its assault while the mounted squad travels on a separate raid', () => {
    let scene = sketchScene('mounted-and-main-army').replaceDefaults().player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 400, 1000).townHall('foe', 3500, 3000, { id: 'assault-hall' });
    for (let index = 0; index < 8; index++) scene = scene.unit('us', 'archer', 2650 + index * 30, 2800, { id: `main-${index}` });
    for (let index = 0; index < 3; index++) scene = scene.unit('us', 'horseArcher', 700, 800 + index * 40, { id: `rider-${index}` });
    scene = scene.worker('foe', 3750, 3000, { id: 'raid-worker' });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { phase: 3, general: { mode: 'attack', targetHallId: 'assault-hall', target: { x: 3500, y: 3000 },
      group: game.units.filter(unit => unit.id.startsWith('main-')).map(unit => unit.id), groupStart: 10 } };
    for (let tick = 0; tick < 1000 && game.buildings.some(building => building.id === 'assault-hall'); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams, policyMode: 'combat' });
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [mountedTasks, { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }], context);
        expect(entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.some(id => id.startsWith('rider-'))).every(entry => entry.scriptId === 'mountedTasks')).toBe(true);
        issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
      }
      stepGame(game);
    }
    expect(game.buildings.some(building => building.id === 'assault-hall')).toBe(false);
    expect(game.units.filter(unit => unit.id.startsWith('main-'))).toHaveLength(8);
    expect(game.units.filter(unit => unit.id.startsWith('rider-'))).toHaveLength(3);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
  it.each(['ogreMage', 'graniteGolem'] as const)('clears the original Grand Estuary %s mining camp with one unupgraded rider and no damage', kind => {
    const game = bootstrapGame(bootstrapMatches('bootstrap_1-development', ['grandEstuary'])[0]!);
    const home = game.buildings.find(building => building.owner === 'p0')!;
    const camp = neutralCamps(snapshotGame(game)).filter(camp => camp.creeps.some(unit => unit.kind === kind)
      && sameGround(game.map, home, camp.center)).sort((a, b) => distance(home, a.center) - distance(home, b.center))[0]!;
    const point = [0, .5, -.5, 1, -1, 1.5, -1.5, Math.PI].map(turn => stagingPoint(camp, home, turn))
      .find(point => isWalkable(game.map, point.x, point.y) && sameGround(game.map, point, camp.center))!;
    const rider = game.spawnUnit('p0', 'horseArcher', point.x, point.y);
    clearCamp(game, rider, new Set(camp.creeps.map(unit => unit.id)));
  }, 30000);

  it.each(['spider-red-1', 'murloc-red-2', 'dragon-red-1'])('pays for range and speed research with ordinary mining and clears %s without damage', template => {
    let scene = sketchScene('mounted-red-camp').replaceDefaults().player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 500).townHall('foe', 3500, 3500).building('us', 'workshop', 700, 500).building('us', 'stables', 900, 500)
      .building('us', 'barracks', 1100, 500)
      .farms('us', 8, 400, 1200).goldMine('main', 750, 500, 10000).unit('us', 'horseArcher', 1700, 1900, { id: 'rider' });
    for (let index = 0; index < 3; index++) scene = scene.unit('us', 'worker', 530, 480 + index * 20, { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (const [index, kind] of CAMP_TEMPLATES.find(camp => camp.id === template)!.kinds.entries()) {
      const angle = index * Math.PI / 2;
      scene = scene.unit('neutral', kind, 2000 + Math.cos(angle) * 55, 2000 + Math.sin(angle) * 55, { id: `creep-${index}` });
    }
    const game = scene.build().createGame();
    for (const unit of game.units.filter(unit => unit.owner === 'neutral')) { unit.homeX = unit.x; unit.homeY = unit.y; }
    issuePlayerCommand(game, 'us', { type: 'research', buildingId: game.buildings.find(building => building.kind === 'workshop')!.id, upgradeKind: 'rangeTraining' });
    for (let tick = 0; tick < 1000; tick++) stepGame(game);
    expect(game.players.us!.upgrades.rangeTraining).toBe(1);
    expect(game.match.stats.goldSpent.us).toBe(195);
    issuePlayerCommand(game, 'us', { type: 'research', buildingId: game.buildings.find(building => building.kind === 'stables')!.id, upgradeKind: 'speedTraining' });
    for (let tick = 0; tick < 1000; tick++) stepGame(game);
    expect(game.players.us!.upgrades.speedTraining).toBe(1);
    issuePlayerCommand(game, 'us', { type: 'research', buildingId: game.buildings.find(building => building.kind === 'workshop')!.id, upgradeKind: 'rangeTraining' });
    for (let tick = 0; tick < 1300; tick++) stepGame(game);
    expect(game.players.us!.upgrades.rangeTraining).toBe(2);
    if (template === 'murloc-red-2') {
      for (const [index, rules] of UPGRADE_DEFS.weaponTraining.levels.entries()) {
        while (game.players.us!.gold < rules.cost) stepGame(game);
        issuePlayerCommand(game, 'us', { type: 'research', buildingId: game.buildings.find(building => building.kind === 'barracks')!.id, upgradeKind: 'weaponTraining' });
        for (let tick = 0; tick <= rules.researchTime; tick++) stepGame(game);
        expect(game.players.us!.upgrades.weaponTraining).toBe(index + 1);
      }
    }
    clearCamp(game, game.units.find(unit => unit.id === 'rider')!, new Set(game.units.filter(unit => unit.owner === 'neutral').map(unit => unit.id)));
    expect(game.match.stats.goldSpent.us).toBe(template === 'murloc-red-2' ? 1210 : 685);
  }, 30000);

  it('keeps three riders independent while killing a partly tower-covered mining line and its melee pursuers', () => {
    let scene = sketchScene('mounted-tower-pocket').replaceDefaults().player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .playerState('us', { gold: 0 }).townHall('us', 500, 500).townHall('foe', 2200, 1000)
      .building('foe', 'defenseTower', 2200, 1160).goldMine('foe-mine', 2500, 1000, 10000);
    for (let index = 0; index < 3; index++) scene = scene.unit('us', 'horseArcher', 2800, 900 + index * 50, { id: `rider-${index}` });
    for (let index = 0; index < 5; index++) scene = scene.unit('foe', 'worker', 2460 + index * 20, 1020 + index * 25,
      { id: `worker-${index}`, order: { type: 'mine', resourceId: 'foe-mine', phase: 'toMine', timer: 0 } });
    for (let index = 0; index < 8; index++) scene = scene.unit('foe', 'footman', 2390, 780 + index * 40, { id: `defender-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    let damage = 0;
    const hits: unknown[] = [];
    game.observer = { hit(source, target, taken) { if (target.id.startsWith('rider-')) {
      damage += taken;
      if (hits.length < 10) hits.push({ tick: game.tick, kind: source.kind, damage: taken, source: { x: source.x, y: source.y }, target: { x: target.x, y: target.y }, order: structuredClone((target as Unit).order) });
    } } };
    for (let tick = 0; tick < 14400 && game.units.some(unit => unit.owner === 'foe'); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), commands = planAiOwnerCommandEntries(snapshot,
          { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams });
        expect(commands.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.some(id => id.startsWith('rider-'))).every(entry => entry.scriptId === 'mountedTasks')).toBe(true);
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
    console.log(JSON.stringify({ tick: game.tick, damage, hits, riders: game.units.filter(unit => unit.owner === 'us').length, foes: game.units.filter(unit => unit.owner === 'foe').map(unit => ({ kind: unit.kind, hp: unit.hp })) }));
    expect(game.units.filter(unit => unit.owner === 'us')).toHaveLength(3);
    expect(game.units.filter(unit => unit.owner === 'foe')).toHaveLength(0);
    expect(damage).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
});
