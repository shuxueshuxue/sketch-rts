import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mineDefense, planBootstrapGeneral } from './mine-defense';
import { readV6Intel } from '../policy/v6/intel';

function twoFronts(raiders = 4, guard: 'lancer' | 'knight' | 'ashWarden' = 'lancer', race: 'grove' | 'ember' = 'grove') {
  const shooter = race === 'grove' ? 'horseArcher' : 'sparkArcher';
  let scene = sketchScene('independent-mine-defense').replaceDefaults()
    .player('us', { team: 'a', race }).player('fa', { team: 'b', race: 'grove' }).player('fb', { team: 'b', race: 'grove' })
    .townHall('us', 400, 1000).townHall('us', 1600, 1600, { id: 'mine-hall' })
    .goldMine('main', 688, 1000, 4000).goldMine('natural', 1888, 1600, 4000)
    .townHall('fa', 3500, 3000, { id: 'attack-hall' }).townHall('fb', 3500, 800)
    .farms('us', 8, 400, 2200);
  for (let i = 0; i < 5; i++) scene = scene.worker('us', 1650 + i * 35, 1700, { id: `miner-${i}` });
  for (let i = 0; i < 2; i++) scene = scene.unit('us', guard, 1750 + i * 50, 1800, { id: `guard-melee-${i}` });
  for (let i = 0; i < 3; i++) scene = scene.unit('us', shooter, 1650 + i * 50, 1850, { id: `guard-ranged-${i}` });
  for (let i = 0; i < 10; i++) scene = scene.unit('us', shooter, 2650 + i % 3 * 40, 2800 + Math.floor(i / 3) * 40,
    { id: `striker-${i}`, order: { type: 'attackMove', x: 3500, y: 3000 } });
  for (let i = 0; i < raiders; i++) scene = scene.unit('fb', 'footman', 1560 + i % 3 * 35, 1120 - Math.floor(i / 3) * 35,
    { id: `raider-${i}`, order: { type: 'attackMove', x: 1600, y: 1600 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: game.units.filter(unit => unit.kind === 'worker').map(unit => unit.id), resourceId: 'natural' });
  memory.v6 = { phase: 3, general: { mode: 'attack', targetHallId: 'attack-hall', target: { x: 3500, y: 3000 },
    group: game.units.filter(unit => unit.id.startsWith('striker')).map(unit => unit.id), groupStart: 15 } };
  return { game, memory, context: () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams, policyMode: 'combat' }) };
}

describe('bootstrap_1 independent mine defense', () => {
  it.each(['grove', 'ember'] as const)('assigns a %s detachment to a mining perimeter tower without recalling the distant attack', race => {
    const { game, context, memory } = twoFronts(4, race === 'grove' ? 'lancer' : 'ashWarden', race);
    game.buildings.push(...sketchScene('mining-perimeter').replaceDefaults().player('us', { race })
      .tower('us', 1600, 1380, { id: 'perimeter' }).build().createGame().buildings);
    for (const unit of game.units.filter(unit => unit.id.startsWith('raider-'))) unit.y -= 300;
    issuePlayerCommand(game, 'fb', { type: 'attackMove', unitIds: game.units.filter(unit => unit.id.startsWith('raider-')).map(unit => unit.id), x: 1600, y: 1380 });
    expect(mineDefense.claimsUnits!(snapshotGame(game), 'us', context()).size).toBeGreaterThanOrEqual(3);
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) {
        const commands = runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
          [mineDefense, { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }], context());
        if (tick === 0) {
          expect(memory.v6!.general!.mode).toBe('attack');
          expect(commands.some(entry => entry.scriptId === 'mineDefense')).toBe(true);
        }
        issueCommandFrame(game, commands.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent', plannerOrigin: 'local-command-planner' })));
      }
      stepGame(game);
    }
    expect(game.buildings.some(building => building.id === 'attack-hall')).toBe(false);
    expect(game.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(5);
    expect(game.buildings.find(building => building.id === 'mine-hall')!.hp).toBe(900);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it('protects the working mine before fighting a larger group at a forward outpost', () => {
    function fight(prioritizeMine: boolean) {
      const { game, context } = twoFronts(8, 'knight');
      for (const unit of game.units.filter(unit => unit.id.startsWith('raider-'))) unit.y -= 520;
      const outpost = sketchScene('outpost-battle').replaceDefaults().player('us').player('fa')
        .tower('us', 3000, 2600, { id: 'outpost' });
      let scene = outpost;
      for (let i = 0; i < 11; i++) scene = scene.unit('fa', 'footman', 3100 + i % 4 * 35, 2200 + Math.floor(i / 4) * 35,
        { id: `outpost-foe-${i}` });
      const battle = scene.build().createGame();
      game.buildings.push(...battle.buildings);
      game.units.push(...battle.units);
      issuePlayerCommand(game, 'fa', { type: 'holdPosition', unitIds: battle.units.map(unit => unit.id) });
      const general = prioritizeMine ? { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral } : AI_SCRIPT_LIBRARY.v6General;
      for (let tick = 0; tick < 1400; tick++) {
        if (tick % 15 === 0) for (const { command } of runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [mineDefense, general], context())) {
          issuePlayerCommand(game, 'us', command);
        }
        stepGame(game);
      }
      return game;
    }
    const control = fight(false), candidate = fight(true);
    expect(control.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(0);
    expect(candidate.buildings.find(building => building.id === 'mine-hall')!.hp).toBe(900);
    expect(candidate.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(5);
    expect(candidate.players.us!.gold).toBeGreaterThan(control.players.us!.gold);
  });
  it.each(['grove', 'ember'] as const)('lets the %s host use real summons for the near raid without recalling the distant attack', race => {
    const kind = race === 'grove' ? 'summoner' : 'pyreCaller', ability = race === 'grove' ? 'summon' : 'cinderSoul';
    let scene = sketchScene('summoned-mine-guard').replaceDefaults()
      .player('us', { race, team: 'a' }).player('fa', { race: 'grove', team: 'b' }).player('fb', { race: 'grove', team: 'b' })
      .townHall('us', 400, 1000).townHall('us', 1600, 1600, { id: 'mine-hall' })
      .goldMine('natural', 1888, 1600, 4000).townHall('fa', 3500, 3000, { id: 'attack-hall' }).townHall('fb', 3500, 800)
      .farms('us', 8, 400, 2200);
    for (let i = 0; i < 5; i++) scene = scene.worker('us', 1650 + i * 35, 1700, { id: `miner-${i}` });
    for (let i = 0; i < 6; i++) scene = scene.unit('us', kind, 1650 + i * 35, 1720, { id: `home-caster-${i}` })
      .unit('us', kind, 2650 + i * 35, 2800, { id: `away-caster-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.unit('fb', 'footman', 1560 + i * 35, 1120,
      { id: `raider-${i}`, order: { type: 'attackMove', x: 1600, y: 1600 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    issuePlayerCommand(game, 'us', { type: 'mine', unitIds: game.units.filter(unit => unit.kind === 'worker').map(unit => unit.id), resourceId: 'natural' });
    for (const caster of game.units.filter(unit => unit.owner === 'us' && unit.kind === kind)) {
      issuePlayerCommand(game, 'us', { type: 'cast', unitId: caster.id, ability,
        x: caster.x + 54, y: caster.id.startsWith('home') ? caster.y - 210 : caster.y + 28 });
    }
    stepGame(game);
    const strikers = game.units.filter(unit => unit.owner === 'us' && unit.kind === 'spirit' && unit.y > 2500);
    issuePlayerCommand(game, 'us', { type: 'attackMove', unitIds: strikers.map(unit => unit.id), x: 3500, y: 3000 });
    memory.v6 = { phase: 3, general: { mode: 'attack', targetHallId: 'attack-hall', target: { x: 3500, y: 3000 },
      group: game.units.filter(unit => unit.owner === 'us' && unit.y > 2500).map(unit => unit.id), groupStart: 8 } };
    const options = () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_summoner', { memory, teams: game.teams, policyMode: 'combat' });
    const claimed = mineDefense.claimsUnits!(snapshotGame(game), 'us', options());
    expect(claimed.size).toBeGreaterThanOrEqual(3);
    expect(game.units.filter(unit => claimed.has(unit.id)).every(unit => unit.kind === 'spirit')).toBe(true);
    for (let tick = 0; tick < 1400 && !game.match.winner; tick++) {
      if (tick % 15 === 0) for (const { command } of runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
        [mineDefense, AI_SCRIPT_LIBRARY.abilities, AI_SCRIPT_LIBRARY.v6Backline, { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }], options())) {
        issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    expect(game.units.filter(unit => unit.id.startsWith('miner'))).toHaveLength(5);
    expect(game.units.filter(unit => unit.id.startsWith('raider'))).toHaveLength(0);
    expect(game.buildings.find(building => building.id === 'mine-hall')!.hp).toBe(900);
    expect(game.buildings.some(building => building.id === 'attack-hall')).toBe(false);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it('does not assign spirits whose normal lifetime expires before they can reach the hall', () => {
    let scene = sketchScene('expiring-mine-guard').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', 400, 1000).townHall('us', 1600, 1600).townHall('foe', 3500, 3000).farms('us', 8, 400, 2200);
    for (let i = 0; i < 12; i++) scene = scene.unit('us', 'summoner', 1700 + i * 35, 1850, { id: `caster-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.unit('foe', 'footman', 1560 + i * 35, 1120);
    const game = scene.build().createGame();
    issuePlayerCommand(game, 'us', { type: 'setAutocast', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), ability: 'summon', enabled: false });
    for (const caster of game.units.filter(unit => unit.owner === 'us')) issuePlayerCommand(game, 'us',
      { type: 'cast', unitId: caster.id, ability: 'summon', x: caster.x + 54, y: caster.y + 28 });
    stepGame(game);
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id) });
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    for (let tick = 0; tick < 1160; tick++) stepGame(game);
    expect(game.units.filter(unit => unit.kind === 'spirit').length).toBeGreaterThanOrEqual(6);
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory: createAiPolicyMemory(), teams: game.teams });
    expect(mineDefense.claimsUnits!(snapshot, 'us', options).size).toBe(0);
  });

  it('defends the miners while the distant main army completes its attack', () => {
    const { game, context } = twoFronts(4, 'knight');
    issuePlayerCommand(game, 'us', { type: 'setAutocast', unitIds: game.units.filter(unit => unit.kind === 'knight').map(unit => unit.id), ability: 'charge', enabled: false });
    let guardCharged = false;
    for (let tick = 0; tick < 1200 && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game);
        for (const { command } of runAiCommandEntriesFromScripts(snapshot, 'us',
          [mineDefense, { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }], context())) {
          if (command.type === 'cast' && command.ability === 'charge') guardCharged = true;
          issuePlayerCommand(game, 'us', command);
        }
      }
      stepGame(game);
    }
    expect(game.buildings.find(building => building.id === 'mine-hall')!.hp).toBeGreaterThan(700);
    expect(guardCharged).toBe(true);
    expect(game.units.filter(unit => unit.kind === 'worker')).toHaveLength(5);
    expect(game.units.filter(unit => unit.id.startsWith('raider'))).toHaveLength(0);
    expect(game.buildings.some(building => building.id === 'attack-hall')).toBe(false);
  });

  it('keeps a raid that exceeds a detachment in the main commander’s defense scope', () => {
    const { game, context, memory } = twoFronts(18), snapshot = snapshotGame(game);
    expect(mineDefense.claimsUnits!(snapshot, 'us', context()).size).toBe(0);
    const commands = planBootstrapGeneral(snapshot, 'us', context());
    expect(commands.some(command => 'unitIds' in command && command.unitIds.some(id => id.startsWith('striker')))).toBe(true);
    expect(['defend', 'guard']).toContain(memory.v6!.general!.mode);
  });

  it('releases the guard as soon as the raid is removed, without changing enemy intel', () => {
    const { game, context } = twoFronts();
    const snapshot = snapshotGame(game), options = context(), intel = structuredClone(readV6Intel(snapshot, 'us', options));
    expect(mineDefense.claimsUnits!(snapshot, 'us', options).size).toBeGreaterThan(0);
    planBootstrapGeneral(snapshot, 'us', options);
    expect(readV6Intel(snapshot, 'us', options)).toEqual(intel);
    game.units = game.units.filter(unit => !unit.id.startsWith('raider'));
    expect(mineDefense.claimsUnits!(snapshotGame(game), 'us', context()).size).toBe(0);
  });
});
