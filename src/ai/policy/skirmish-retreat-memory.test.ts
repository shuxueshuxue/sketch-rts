import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame, strikeUnit, type Game } from '../../shared/sim';
import type { AiScriptVersion } from '../../shared/types';
import { isWalkable, sameGround } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY, planAiCommandEntriesFromScripts } from './core';
import type { AiCommandEntry, PresetAiPolicyOptions } from './types';
import { planSkirmishPreservation } from './skirmish-tactics';

function skirmish(requestedVersion: AiScriptVersion = 'v2', actualV7 = false, departingEnemies = false, enemyOffset = 0) {
  const scene = sketchScene('v2-retreat-keeps-its-movement').map('bareDuel').replaceDefaults()
    .player('us', { team: 'north' }).player('foe', { team: 'south' })
    .playerState('us', { gold: 0 }).playerState('foe', { gold: 0 })
    .townHall('us', 500, 500).townHall('foe', 3300, 3300)
    .unit('us', 'footman', 1800, 1600, { id: 'front-footman' })
    .unit('us', 'lancer', 1840, 1640, { id: 'front-lancer' })
    .unit('us', 'archer', 1880, 1680, { id: 'front-archer' })
    .unit('foe', 'footman', 1940 + enemyOffset, 1600, { id: 'foe-footman' })
    .unit('foe', 'lancer', 1980 + enemyOffset, 1640, { id: 'foe-lancer' })
    .unit('foe', 'contractArcher', 2020 + enemyOffset, 1680, { id: 'foe-archer' });
  const recruits = Array.from({ length: 6 }, (_, index) => `recruit-${index}`);
  recruits.forEach((id, index) => scene.unit('us', 'footman', 2700 + index * 35, 2350, { id }));
  const game = scene.build().createGame();
  const memory = createAiPolicyMemory();
  const options: PresetAiPolicyOptions = { version: 'v2', requestedVersion, teams: game.teams, memory };
  const front = ['front-footman', 'front-lancer', 'front-archer'];
  if (departingEnemies) issuePlayerCommand(game, 'foe', { type: 'move', unitIds: ['foe-footman', 'foe-lancer', 'foe-archer'], x: 3300, y: 3300, avoidCombat: true });
  const retreat = planAiCommandEntriesFromScripts(snapshotGame(game), 'us', [actualV7 ? AI_SCRIPT_LIBRARY.v7Skirmish : AI_SCRIPT_LIBRARY.skirmishPreservation], options);
  expect(retreat).toHaveLength(1);
  const goal = requestedVersion === 'v2' && departingEnemies ? { x: 1383.0047454255778, y: 1251.2129923769842 } : { x: 500, y: 500 };
  expect(retreat[0]).toMatchObject({ scriptId: 'skirmishPreservation', command: { type: requestedVersion === 'v2' && departingEnemies ? 'move' : 'attackMove', unitIds: front } });
  const command = retreat[0]!.command;
  expect(command.type === 'move' || command.type === 'attackMove' ? command.x : 0).toBeCloseTo(goal.x);
  expect(command.type === 'move' || command.type === 'attackMove' ? command.y : 0).toBeCloseTo(goal.y);
  issue(game, retreat);
  return { game, memory, options, front, recruits, goal };
}

function issue(game: Game, entries: AiCommandEntry[]) {
  return issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
}

function run(game: Game, ticks: number) {
  for (let tick = 0; tick < ticks; tick++) stepGame(game);
}

function leaveThreatBehind(sample: ReturnType<typeof skirmish>) {
  const reinforcement = sample.game.units.find(unit => unit.id === sample.recruits[0])!;
  for (const id of ['foe-footman', 'foe-lancer', 'foe-archer']) {
    const target = sample.game.units.find(unit => unit.id === id)!;
    strikeUnit(sample.game, reinforcement, target, target.maxHp * 10, 'spell');
  }
  run(sample.game, 15);
}

function waveUnitIds(entries: AiCommandEntry[]) {
  return entries.filter(entry => entry.scriptId === 'attackWave').flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []);
}

describe('default V2 skirmish retreat memory', () => {
  it('remembers a real fallback as retreat rather than clearing movement ownership', () => {
    const sample = skirmish();
    for (const id of sample.front) {
      expect(sample.memory.unitClaims[id]).toMatchObject({ kind: 'retreat', targetId: 'retreat', ...sample.goal, sinceTick: 0 });
    }
  });

  it('keeps the retreating front out of the next wave while fresh reinforcements can advance', () => {
    const sample = skirmish();
    leaveThreatBehind(sample);
    const entries = planAiCommandEntriesFromScripts(snapshotGame(sample.game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], sample.options);
    const wave = waveUnitIds(entries);
    expect(wave.length).toBeGreaterThanOrEqual(5);
    for (const id of sample.front) expect(wave).not.toContain(id);
    for (const id of sample.recruits) expect(wave).toContain(id);
    for (const id of sample.front) {
      const unit = sample.game.units.find(unit => unit.id === id)!;
      expect(unit.hp).toBeGreaterThan(0);
      expect(unit.order).toMatchObject({ type: 'attackMove', ...sample.goal });
      expect(Math.hypot(unit.x - sample.goal.x, unit.y - sample.goal.y)).toBeGreaterThan(110);
      const initial = id === 'front-footman' ? { x: 1800, y: 1600 } : id === 'front-lancer' ? { x: 1840, y: 1640 } : { x: 1880, y: 1680 };
      expect(Math.hypot(unit.x - 500, unit.y - 500)).toBeLessThan(Math.hypot(initial.x - 500, initial.y - 500));
    }
  });

  it('lets fighters rejoin after their actual fallback reaches safety, without waiting for claim expiry', () => {
    const sample = skirmish();
    leaveThreatBehind(sample);
    run(sample.game, 680);
    for (const id of sample.front) {
      expect(sample.game.units.find(unit => unit.id === id)?.order.type).toBe('idle');
      const unit = sample.game.units.find(unit => unit.id === id)!;
      expect(Math.hypot(unit.x - sample.goal.x, unit.y - sample.goal.y)).toBeLessThanOrEqual(110);
      expect(sample.memory.unitClaims[id]?.expiresTick).toBeGreaterThan(sample.game.tick);
    }
    const entries = planAiCommandEntriesFromScripts(snapshotGame(sample.game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], sample.options);
    for (const id of sample.front) expect(waveUnitIds(entries)).toContain(id);
    issue(sample.game, entries);
    const start = sample.game.units.find(unit => unit.id === sample.front[0])!;
    const before = { x: start.x, y: start.y };
    run(sample.game, 40);
    expect(Math.hypot(start.x - before.x, start.y - before.y)).toBeGreaterThan(40);
  });

  it('actually falls back while live enemies walk away, instead of pursuing them toward their base', () => {
    const sample = skirmish();
    const before = new Map(sample.front.map(id => {
      const unit = sample.game.units.find(unit => unit.id === id)!;
      return [id, Math.hypot(unit.x - 500, unit.y - 500)];
    }));
    issuePlayerCommand(sample.game, 'foe', { type: 'move', unitIds: ['foe-footman', 'foe-lancer', 'foe-archer'], x: 3300, y: 3300, avoidCombat: true });
    const disengagements: AiCommandEntry[] = [];
    for (let tick = 0; tick < 140; tick++) {
      if (sample.game.tick % 15 === 0) {
        const entries = planAiCommandEntriesFromScripts(snapshotGame(sample.game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], sample.options);
        disengagements.push(...entries.filter(entry => entry.scriptId === 'skirmishPreservation'));
        issue(sample.game, entries);
      }
      stepGame(sample.game);
    }
    expect(disengagements.length).toBeGreaterThan(1);
    const first = disengagements[0]!.command;
    expect(first).toMatchObject({ type: 'move', avoidCombat: true });
    expect(first.type === 'move' ? Math.hypot(first.x - 1840, first.y - 1640) : 0).toBeCloseTo(600);
    expect(first.type === 'move' ? Math.hypot(first.x - 500, first.y - 500) : Infinity).toBeLessThan(Math.hypot(1340, 1140));
    for (const id of ['foe-footman', 'foe-lancer', 'foe-archer']) expect(sample.game.units.find(unit => unit.id === id)?.hp).toBeGreaterThan(0);
    for (const id of sample.front) {
      const unit = sample.game.units.find(unit => unit.id === id)!;
      expect(unit.hp).toBeGreaterThan(0);
      expect(Math.hypot(unit.x - 500, unit.y - 500)).toBeLessThan(before.get(id)! - 100);
    }
  });

  it('keeps its local goal fixed while the same threat remains during the fallback', () => {
    const sample = skirmish('v2', false, true);
    run(sample.game, 15);
    const entries = planAiCommandEntriesFromScripts(snapshotGame(sample.game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation], sample.options);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.command).toMatchObject({ type: 'move', ...sample.goal, avoidCombat: true });
  });

  it.each([false, true])('distinguishes an outward attack-move from active target combat (engaged=%s)', engaged => {
    const sample = skirmish('v2', false, false, 60);
    const foes = ['foe-footman', 'foe-lancer', 'foe-archer'];
    issuePlayerCommand(sample.game, 'foe', { type: 'attackMove', unitIds: foes, x: 3300, y: 3300 });
    if (engaged) run(sample.game, 1);
    for (const id of foes) {
      const order = sample.game.units.find(unit => unit.id === id)!.order;
      expect(order.type).toBe('attackMove');
      expect(order.type === 'attackMove' && order.targetId !== undefined).toBe(engaged);
    }
    const entries = planAiCommandEntriesFromScripts(snapshotGame(sample.game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation], sample.options);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.command.type).toBe(engaged ? 'attackMove' : 'move');
  });

  it('does not reuse an expired retreat goal through the direct planner', () => {
    const sample = skirmish('v2', false, true);
    run(sample.game, 15);
    for (const id of sample.front) sample.memory.unitClaims[id]!.expiresTick = sample.game.tick - 1;
    const commands = planSkirmishPreservation(snapshotGame(sample.game), 'us', sample.options);
    expect(commands).toHaveLength(1);
    const command = commands[0]!;
    expect(command).toMatchObject({ type: 'move', avoidCombat: true });
    expect(command.type === 'move' ? Math.hypot(command.x - sample.goal.x, command.y - sample.goal.y) : 0).toBeGreaterThan(40);
  });

  it('projects a local fallback across a water gap onto the actual units reachable shore', () => {
    const sample = skirmish();
    sample.game.map = { ...sample.game.map, width: 4096, height: 4096,
      terrain: { cell: 64, cols: 64, rows: 64, cells: Array.from({ length: 64 }, () => '.'.repeat(23) + '~' + '.'.repeat(40)).join('') } };
    issuePlayerCommand(sample.game, 'foe', { type: 'move', unitIds: ['foe-footman', 'foe-lancer', 'foe-archer'], x: 3300, y: 3300 });
    const entries = planAiCommandEntriesFromScripts(snapshotGame(sample.game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation], sample.options);
    expect(entries).toHaveLength(1);
    const command = entries[0]!.command;
    expect(command).toMatchObject({ type: 'move', avoidCombat: true });
    if (command.type !== 'move') throw new Error('Expected a real fallback');
    expect(command.x).toBeGreaterThan(1536);
    expect(isWalkable(sample.game.map, command.x, command.y)).toBe(true);
    for (const id of sample.front) expect(sameGround(sample.game.map, sample.game.units.find(unit => unit.id === id)!, command)).toBe(true);
    issue(sample.game, entries);
    run(sample.game, 280);
    for (const id of sample.front) {
      const unit = sample.game.units.find(unit => unit.id === id)!;
      expect(unit.order.type).toBe('idle');
      expect(Math.hypot(unit.x - command.x, unit.y - command.y)).toBeLessThanOrEqual(110);
    }
  });

  it('uses home when the local group already has less than one fallback leg to travel', () => {
    const game = sketchScene('v2-retreat-near-home').map('bareDuel').replaceDefaults()
      .player('us', { team: 'north' }).player('foe', { team: 'south' })
      .townHall('us', 500, 500).townHall('foe', 3300, 3300)
      .unit('us', 'footman', 1250, 500).unit('us', 'footman', 750, 500)
      .unit('foe', 'footman', 1360, 500).unit('foe', 'lancer', 1400, 540).unit('foe', 'archer', 1430, 540).unit('foe', 'footman', 1440, 510)
      .build().createGame();
    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: 'v2', requestedVersion: 'v2', teams: game.teams, memory: createAiPolicyMemory() });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.command).toMatchObject({ type: 'move', x: 500, y: 500, avoidCombat: true });
    const front = game.units.find(unit => unit.owner === 'us' && unit.x === 1250)!;
    issue(game, entries);
    run(game, 40);
    expect(front.hp).toBeGreaterThan(0);
    expect(front.x).toBeLessThan(1150);
    expect(game.units.filter(unit => unit.owner === 'foe' && unit.hp > 0)).toHaveLength(4);
  });

  it.each(['v3', 'v5', 'v7', 'v9'] as const)('preserves the existing same-id movement semantics for requested %s', requestedVersion => {
    const sample = skirmish(requestedVersion);
    const memory = createAiPolicyMemory();
    const entries = planAiCommandEntriesFromScripts(snapshotGame(sample.game), 'us', [AI_SCRIPT_LIBRARY.skirmishPreservation], { ...sample.options, requestedVersion, memory });
    expect(entries[0]?.command.type).toBe('attackMove');
    for (const id of sample.front) expect(memory.unitClaims[id]).toBeUndefined();
  });

  it('keeps the actual V7 same-id wrapper outside V2 retreat ownership', () => {
    const sample = skirmish('v7', true);
    for (const id of sample.front) expect(sample.memory.unitClaims[id]).toBeUndefined();
  });
});
