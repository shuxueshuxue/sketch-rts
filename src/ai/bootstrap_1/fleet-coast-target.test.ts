import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { checksumGame } from '../../shared/sim/checksum';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapNaval } from './expedition-recovery';
import { bootstrapPolicyContext } from './policy';
import quarterHour from './fixtures/naval-reinforcements-sapphire-25m.json';

const ships = ['unit-player-5-warship-1826', 'unit-player-5-warship-2589'];
const camp = 'satellite-guard-3-0';
function actualFleet() {
  const game = createGame('bareDuel', { players: Object.keys(quarterHour.snapshot.players), aiPlayers: [] });
  restoreSnapshotIntoGame(game, structuredClone(quarterHour.snapshot) as unknown as GameSnapshot, 500000);
  game.scriptedVictory = true;
  return game;
}

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s releases both batteries from the real inland camp instead of preserving a useless shared target', version => {
  const game = actualFleet(), memory = createAiPolicyMemory();
  memory.naval = { combat: Object.fromEntries(ships.map(id => [id, { targetId: camp, commandTargetId: camp }])) };
  const snapshot = snapshotGame(game), before = checksumGame(game);
  const commands = planBootstrapNaval(snapshot, 'player-5', bootstrapPolicyContext(snapshot, 'player-5', version, { memory, teams: game.teams }));
  expect(checksumGame(game)).toBe(before);
  for (const id of ships) {
    expect(memory.naval.combat?.[id]?.targetId).not.toBe(camp);
    expect(commands.some(command => command.type === 'move' && command.unitIds.includes(id))).toBe(true);
  }
});

it('drops an impossible automatically acquired camp on the next simulation frame, including a cold snapshot restore', () => {
  for (const cold of [false, true]) {
    const game = actualFleet();
    if (cold) restoreSnapshotIntoGame(game, JSON.parse(JSON.stringify(snapshotGame(game))), game.nextId);
    for (const id of ships) expect(game.units.find(unit => unit.id === id)!.order).toMatchObject({ type: 'attackMove', targetId: camp });
    stepGame(game);
    for (const id of ships) expect(game.units.find(unit => unit.id === id)!.order).not.toHaveProperty('targetId', camp);
    expect(game.units.find(unit => unit.id === camp)!.hp).toBe(350);
  }
});

it('turns both actual batteries onto a newly arrived enemy transport and sinks it with real cannon hits', () => {
  const game = actualFleet();
  // Opportunity projection: only this ordinary enemy hull is added to the
  // original world. Both batteries, guns, crew, coast and camp stay intact.
  const target = game.spawnUnit('enemy', 'transport', 3620, 5080);
  target.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
  target.order = { type: 'hold', x: target.x, y: target.y };
  const fired = new Set<string>(), seen = new Set(game.effects.map(effect => effect.id));
  let hits = 0;
  for (let tick = 0; tick < 500 && target.hp > 0; tick++) {
    stepGame(game);
    for (const effect of game.effects) if (!seen.has(effect.id)) {
      seen.add(effect.id);
      if (effect.type === 'muzzleFlash' && ships.includes(effect.sourceId ?? '')) fired.add(effect.sourceId!);
      if (effect.type === 'hit' && effect.unitId === target.id && (effect.damage ?? 0) > 0) hits++;
    }
  }
  expect([...fired].sort()).toEqual([...ships].sort());
  expect(hits).toBeGreaterThan(5);
  expect(target.hp).toBeLessThanOrEqual(0);
  expect(game.units.find(unit => unit.id === camp)!.hp).toBe(350);
});

it('keeps an inland camp available to a bombard vessel in a real working mortar station', () => {
  const game = actualFleet(), target = game.units.find(unit => unit.id === camp)!;
  // Opportunity projection: an ordinary bombard hull arrives offshore.
  const mortar = game.spawnUnit('player-5', 'bombardShip', 3500, 4980);
  mortar.sailing = { heading: Math.PI, speed: 0, load: 0, balance: 0 };
  mortar.order = { type: 'attackMove', x: target.x, y: target.y, targetId: camp };
  let hit = false;
  for (let tick = 0; tick < 400 && !hit; tick++) {
    stepGame(game);
    hit ||= game.effects.some(effect => effect.type === 'hit' && effect.unitId === camp
      && effect.sourceKind === 'bombardShip' && (effect.damage ?? 0) > 0);
  }
  expect(hit).toBe(true);
});
