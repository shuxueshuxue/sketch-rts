import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { UNIT_DEFS } from '../../shared/catalog';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext, bootstrapScripts } from './policy';
import { planBootstrapGeneral } from './mine-defense';
import { strengthOf } from '../policy/v6/strength';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const).flatMap(race =>
  [false, true].flatMap(mirror => (['raid', 'shot', 'ally', 'empty'] as const).map(state => ({ version, race, mirror, state }))))))(
  '$version/$race protects the actual $state hauling job before continuing an assault (mirror=$mirror)', ({ version, race, mirror, state }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    const attacker = state === 'shot' ? 'archer' : 'footman';
    let scene = sketchScene('unbased-job-army-defense').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: state === 'ally' ? 'a' : 'b' })
      .townHall('us', x(500), 500).goldMine('spent', x(788), 500, 0)
      .goldMine('job', x(2600), 1600, state === 'empty' ? 0 : 6000)
      .townHall('foe', x(state === 'ally' ? 2888 : 3500), state === 'ally' ? 1600 : 3500, { id: 'target' })
      .farms('us', 8, x(500), 3500);
    for (let i = 0; i < 4; i++) scene = scene.worker('us', x(2200), 1600 + i * 15, { id: `miner-${i}`,
      order: { type: 'mine', resourceId: 'job', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 10; i++) scene = scene.unit('us', heavy, x((state === 'shot' ? 1900 : 1600) + i % 5 * 30), 1700 + Math.floor(i / 5) * 30, { id: `army-${i}` });
    for (let i = 0; i < 6; i++) scene = scene.unit('foe', attacker, x(3000 + i % 3 * 30), 1600 + Math.floor(i / 3) * 30, { id: `raider-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const target = game.buildings.find(building => building.id === 'target')!;
    const army = game.units.filter(unit => unit.id.startsWith('army-'));
    memory.v6 = { general: { mode: 'attack', target: { x: target.x, y: target.y }, targetHallId: target.id,
      group: army.map(unit => unit.id), groupStart: strengthOf(army), stage: 'strike' } };
    issuePlayerCommand(game, 'foe', { type: 'attackMove', unitIds: game.units.filter(unit => unit.id.startsWith('raider-')).map(unit => unit.id), x: x(2200), y: 1600 });
    let defended = false;
    const safety = bootstrapScripts(version).filter(script => script.id === 'miningJobSafety');
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        for (const { command } of runAiCommandEntriesFromScripts(snapshot, 'us',
          [...safety, { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }], options)) issuePlayerCommand(game, 'us', command);
        defended ||= memory.v6!.general!.mode === 'defend';
      }
      stepGame(game);
    }
    expect(defended).toBe(state === 'raid' || state === 'shot');
    if (state === 'raid' || state === 'shot') {
      expect(game.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(4);
      expect(game.units.some(unit => unit.id.startsWith('raider-'))).toBe(false);
      const lostArmy = 10 - game.units.filter(unit => unit.id.startsWith('army-')).length;
      expect(lostArmy * UNIT_DEFS[heavy].cost).toBeLessThan(6 * UNIT_DEFS[attacker].cost);
    }
    expect(game.match.stats.goldSpent.us).toBe(0);
    const mined = (state === 'empty' ? 0 : 6000) - game.resources.find(resource => resource.id === 'job')!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried).toBeCloseTo(500 + mined, 6);
  }, 30000);
