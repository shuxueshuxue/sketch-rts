import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { routeTravelTicks } from '../../shared/route-selection';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { strengthOf } from '../policy/v6/strength';
import { readV6Intel } from '../policy/v6/intel';

function field(race: 'grove' | 'ember', mirror = false, tower = false, allied = false, hostThreat = false) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('idle-spirit-income-raid').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).playerState('us', { gold: 0 })
    .player('foe', { team: allied ? 'a' : 'b' }).townHall('us', x(500), 500)
    .townHall('foe', x(1850), 500).goldMine('income', x(1550), 500, 10000)
    .worker('foe', x(1500), 520, { id: 'miner', order: { type: 'mine', resourceId: 'income', phase: 'toMine', timer: 0 } })
    .worker('foe', x(3500), 3500, { id: 'other-worker' });
  for (let i = 0; i < 2; i++) scene = scene.unit('us', 'summoner', x(600), 450 + i * 100, { id: `host-${i}` });
  if (tower) scene = scene.tower('foe', x(1550), 800);
  if (hostThreat) scene = scene.unit('foe', 'footman', x(1150), 1150, {
    id: 'incoming', order: { type: 'attackMove', x: x(600), y: 500 },
  });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  for (let i = 0; i < 2; i++) issuePlayerCommand(game, 'us', {
    type: 'cast', unitId: `host-${i}`, ability: 'summon', x: x(800), y: 450 + i * 100,
  });
  stepGame(game);
  return game;
}

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version spends ordinary $race spirits on exposed mining without risking the host (mirror=$mirror)', ({ version, race, mirror }) => {
    const game = field(race, mirror), memory = createAiPolicyMemory();
    memory.v6 = { general: { mode: 'hold', target: { x: mirror ? 3596 : 500, y: 500 }, holdingSince: 0 } };
    const spirits = game.units.filter(unit => unit.owner === 'us' && unit.kind === 'spirit');
    expect(spirits).toHaveLength(2);
    let dispatched = false;
    for (let tick = 0; tick < 650 && game.units.some(unit => unit.id === 'miner'); tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game),
          { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
        dispatched ||= entries.some(entry => entry.scriptId === 'summonedRaids');
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    const diagnostic = JSON.stringify({ tick: game.tick, dispatched, units: game.units, memory });
    expect(dispatched, diagnostic).toBe(true);
    expect(game.units.some(unit => unit.id === 'miner'), diagnostic).toBe(false);
    expect(game.units.filter(unit => unit.id.startsWith('host-'))).toHaveLength(2);
    expect(game.units.filter(unit => unit.id.startsWith('host-')).every(unit =>
      Math.abs(unit.x - (mirror ? 3596 : 500)) < 600), diagnostic).toBe(true);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

it.each(['attack', 'guard', 'defend', 'creep'] as const)('keeps the existing %s front rather than opening a raid', mode => {
  const game = field('grove'), memory = createAiPolicyMemory();
  const army = game.units.filter(unit => unit.owner === 'us');
  memory.v6 = { general: { mode, target: { x: 900, y: 500 },
    ...(mode === 'attack' ? { group: army.map(unit => unit.id), groupStart: strengthOf(army),
      targetHallId: game.buildings.find(building => building.owner === 'foe')!.id } : {}) } };
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_summoner', memory, policyMode: 'combat' }, { teams: game.teams });
  expect(entries.filter(entry => entry.scriptId === 'summonedRaids')).toHaveLength(0);
});

it.each([{ tower: true, allied: false }, { tower: false, allied: true }])(
  'rejects tower coverage and allied income (tower=$tower allied=$allied)', ({ tower, allied }) => {
    const game = field('grove', false, tower, allied), memory = createAiPolicyMemory();
    memory.v6 = { general: { mode: 'hold', target: { x: 500, y: 500 } } };
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_summoner', memory, policyMode: 'combat' }, { teams: game.teams });
    expect(entries.filter(entry => entry.scriptId === 'summonedRaids')).toHaveLength(0);
  });

it('does not send an aging spirit on a road it cannot finish before expiry', () => {
  const game = field('grove'), memory = createAiPolicyMemory();
  for (let tick = 0; tick < 1100; tick++) stepGame(game);
  expect(game.units.filter(unit => unit.kind === 'spirit')).toHaveLength(2);
  memory.v6 = { general: { mode: 'hold', target: { x: 500, y: 500 } } };
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_summoner', memory, policyMode: 'combat' }, { teams: game.teams });
  expect(entries.filter(entry => entry.scriptId === 'summonedRaids')).toHaveLength(0);
});

it('uses the detoured road rather than the short straight distance for spirit lifetime', () => {
  const game = field('grove'), memory = createAiPolicyMemory();
  const cells = Array<string>(128 * 128).fill('.');
  for (let y = 0; y < 80; y++) cells[y * 128 + 31] = '#';
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: cells.join('') };
  setBuildingBodies(game.map, game.buildings);
  const spirit = game.units.find(unit => unit.kind === 'spirit')!, worker = game.units.find(unit => unit.id === 'miner')!;
  const remaining = spirit.expiresTick! - game.tick;
  expect(Math.hypot(spirit.x - worker.x, spirit.y - worker.y) / spirit.speed * SIM_TICKS_PER_SECOND).toBeLessThan(remaining);
  expect(routeTravelTicks(game.map, spirit, worker, 'land', spirit.speed)).toBeGreaterThan(remaining);
  memory.v6 = { general: { mode: 'hold', target: { x: 500, y: 500 } } };
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_summoner', memory, policyMode: 'combat' }, { teams: game.teams });
  expect(entries.filter(entry => entry.scriptId === 'summonedRaids')).toHaveLength(0);
});

it.each([false, true])('keeps the screen when an enemy arrives before the next summon (mirror=%s)', mirror => {
  const game = field('grove', mirror, false, false, true), memory = createAiPolicyMemory();
  memory.v6 = { general: { mode: 'hold', target: { x: mirror ? 3596 : 500, y: 500 } } };
  const snapshot = snapshotGame(game);
  expect(readV6Intel(snapshot, 'us', { memory, teams: game.teams }).intrusion).toBeUndefined();
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'us', version: 'v9_summoner', memory, policyMode: 'combat' }, { teams: game.teams });
  expect(entries.filter(entry => entry.scriptId === 'summonedRaids')).toHaveLength(0);
  issueCommandFrame(game, entries);
  for (let tick = 0; tick < 650 && game.units.some(unit => unit.id === 'incoming'); tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version: 'v9_summoner', memory, policyMode: 'combat' }, { teams: game.teams }));
    stepGame(game);
  }
  expect(game.units.some(unit => unit.id === 'incoming')).toBe(false);
  expect(game.units.filter(unit => unit.id.startsWith('host-'))).toHaveLength(2);
});
