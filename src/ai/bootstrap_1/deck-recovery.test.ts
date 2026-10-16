import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { combatDeckRecovery, aimedVolleyCount, deckRetreatSpeed } from './deck-recovery';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';
import { setBuildingBodies } from '../../shared/terrain';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { bootstrapGame, bootstrapMatches } from './benchmark';
import { planAiOwnerCommandEntries } from '../planner-context';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { SLOW_PACE } from '../../shared/catalog';
import type { GameCommand, Unit } from '../../shared/types';

const victimId = 'unit-p0-raider-2245', tankId = 'unit-p0-knight-2183', shipId = 'unit-p0-warship-1962';
function load(tick = 35595) {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/deck-${tick === 43725 ? 'landing' : 'camp'}-0f5bf-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot = frame.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory: frame.memories.p0, teams: { p0: 'a', p1: 'b' } });
  return { frame, snapshot, options, victim: snapshot.units.find((u: Unit) => u.id === victimId)!, ship: snapshot.units.find((u: Unit) => u.id === shipId)! };
}
function selected(commands: GameCommand[]) { return commands.flatMap(c => 'unitIds' in c ? c.unitIds : []); }

describe('combat deck casualty recovery', () => {
  it.each([0, 1, 4])('counts native attacks at the exact saved cooldown boundary %i', cooldown => {
    const game = createGame('bareDuel', { players: ['player', 'enemy'], scenario: { replaceDefaultUnits: true, replaceDefaultResources: true,
      replaceDefaultMercenaryCamps: true, addUnits: [
        { id: 'attacker', owner: 'player', kind: 'footman', x: 1000, y: 1000 },
        { id: 'target', owner: 'enemy', kind: 'worker', x: 1040, y: 1000 },
      ] } });
    const attacker = game.units.find(u => u.id === 'attacker')!;
    attacker.cooldown = cooldown;
    issuePlayerCommand(game, 'player', { type: 'holdPosition', unitIds: [attacker.id] });
    let attacks = 0;
    game.observer = { hit(source) { if (source.id === attacker.id) attacks++; } };
    const window = Math.max(1, cooldown);
    for (let i = 0; i < window; i++) stepGame(game);
    expect(attacks).toBe(aimedVolleyCount(window, cooldown, attacker.attackCooldown));
    expect(attacks).toBe(1);
  });
  it('uses shared slow pace and rejects an immobilized deck withdrawal', () => {
    const { snapshot, options, victim } = load();
    victim.effects.push({ type: 'slow', remaining: 100 });
    expect(deckRetreatSpeed(victim)).toBe(victim.speed * SLOW_PACE);
    expect(combatDeckRecovery(snapshot, 'p0', options, []).map(c => c.type)).toEqual(['move', 'holdPosition']);
    victim.effects.push({ type: 'root', remaining: 10 });
    expect(deckRetreatSpeed(victim)).toBe(0);
  });
  it('does not use a front that will expire or is already under lethal pending fire', () => {
    for (const condition of ['expiry', 'projectile'] as const) {
      const { snapshot, options } = load();
      const guard = snapshot.units.find((u: Unit) => u.id === tankId)!;
      if (condition === 'expiry') guard.expiresTick = snapshot.tick + 1;
      else snapshot.projectiles.push({ id: 'pending-front-shot', owner: 'neutral', attackerId: 'guard-2-0', targetId: guard.id,
        fromX: 5200, fromY: 6000, toX: guard.x, toY: guard.y, damage: 1000, remaining: 1, duration: 3,
        damageProfile: { school: 'magic', delivery: 'ranged', origin: 'unit', element: 'fire' } });
      expect(combatDeckRecovery(snapshot, 'p0', options, [])).toEqual([]);
    }
  });
  it('releases its own native posture when the actual engagement ends even though camp bodies remain alive', () => {
    const { frame, snapshot, options } = load();
    const commands = combatDeckRecovery(snapshot, 'p0', options, []);
    const match = bootstrapMatches('bootstrap_1-knight-v5-official-sapphire-20261015-01', ['sapphireArchipelago'], 36000, false)
      .find(m => m.subject === 'v9_knight' && m.side === 0 && Object.values(m.agents).slice(1).map(a => a.version).join('+') === 'v5')!;
    const game = bootstrapGame(match); restoreSnapshotIntoGame(game, snapshot, frame.nextId);
    for (const command of commands) issuePlayerCommand(game, 'p0', command);
    const native = snapshotGame(game);
    delete options.memory.naval!.combat![shipId];
    for (const foe of native.units.filter(u => u.id.startsWith('guard-2-'))) foe.order = { type: 'idle' };
    expect(combatDeckRecovery(native, 'p0', options, [])).toEqual([{ type: 'stop', unitIds: [victimId] }]);
    expect(options.memory.naval!.deckRecovery).toBeUndefined();
  });
  it('honors a legitimate late ability switch in the full real 35595 owner pipeline', () => {
    const { snapshot, frame } = load();
    const scripts = [...bootstrapScripts('v9_knight'), { id: 'explicitLateChargeSwitch', phase: 'tactics' as const,
      run: (): GameCommand => ({ type: 'setAutocast', unitIds: [victimId], ability: 'charge', enabled: true }) }];
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_knight', scripts, memory: structuredClone(frame.memories.p0) }, { teams: { p0: 'a', p1: 'b' } });
    expect(entries).toContainEqual({ playerId: 'p0', scriptId: 'explicitLateChargeSwitch', command: { type: 'setAutocast', unitIds: [victimId], ability: 'charge', enabled: true } });
    expect(entries.filter(e => ['move', 'holdPosition'].includes(e.command.type) && 'unitIds' in e.command && e.command.unitIds.includes(victimId))).toEqual([]);
  });
  it('does not add naval micro to an explicit items-only request', () => {
    const { snapshot, frame } = load();
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_knight', scriptIds: ['items'], memory: frame.memories.p0 });
    expect(entries.some(e => e.scriptId === 'naval')).toBe(false);
    expect(frame.memories.p0.naval.deckRecovery).toBeUndefined();
  });

  it.each([35460, 35520, 35580])('retains the actual %i native attack/idle pipeline while its aimed volley is survivable', tick => {
    const { snapshot, options } = load(tick);
    expect(combatDeckRecovery(snapshot, 'p0', options, [])).toEqual([]);
    expect(options.memory.naval!.deckRecovery).toBeUndefined();
  });
  it('withdraws only the actually focused crew, leaving the existing healthy melee front moving', () => {
    const { snapshot, options } = load();
    const commands = combatDeckRecovery(snapshot, 'p0', options, []);
    expect(commands.map(c => c.type)).toEqual(['move', 'holdPosition']);
    expect(new Set(selected(commands))).toEqual(new Set([victimId]));
    expect(selected(commands)).not.toContain(tankId);
    expect(options.memory.naval!.deckRecovery![victimId]!.foeIds).toHaveLength(3);
  });
  it.each(['move', 'attack', 'cast', 'repairShip', 'unloadPassenger', 'unload', 'boardShip'] as const)('gives a new %s assignment priority', type => {
    const { snapshot, options, victim, ship } = load();
    const command: GameCommand = type === 'cast' ? { type, unitId: victim.id, ability: 'charge', targetId: 'guard-2-0' }
      : type === 'unloadPassenger' ? { type, passengerId: victim.id, transportId: ship.id }
      : type === 'move' || type === 'unload' ? { type, unitIds: [type === 'unload' ? ship.id : victim.id], x: 5000, y: 6000 }
      : { type, unitIds: [type === 'boardShip' ? ship.id : victim.id], targetId: 'guard-2-0' };
    expect(combatDeckRecovery(snapshot, 'p0', options, [command])).toEqual([command]);
  });
  it('leaves explicit attacks, nonempty queues, enabled charges, and ferry landing crew to their controller', () => {
    for (const change of ['explicit', 'queued', 'charge', 'ferry'] as const) {
      const { snapshot, options, victim } = load();
      if (change === 'explicit') victim.order = { type: 'attack', targetId: 'guard-2-0' };
      if (change === 'queued') victim.orderQueue = [{ type: 'board', transportId: 'unit-p0-carrier-5812' }];
      if (change === 'charge') victim.autocast = { charge: true };
      if (change === 'ferry') options.memory.naval!.ferries![shipId] = { purpose: 'assault', phase: 'sailing', crewIds: [victim.id], targetId: 'enemy', from: victim, to: victim, sinceTick: 35000 };
      expect(combatDeckRecovery(snapshot, 'p0', options, [])).toEqual([]);
    }
  });
  it('requires an existing viable same-deck front rather than redirecting the other ship crew', () => {
    const { snapshot, options } = load();
    snapshot.units.find((u: Unit) => u.id === tankId)!.hp = 1;
    expect(combatDeckRecovery(snapshot, 'p0', options, [])).toEqual([]);
  });
  it('recognizes its own native queued move and releases before a new unload or after landing', () => {
    const { frame, snapshot, options } = load();
    const orders = combatDeckRecovery(snapshot, 'p0', options, []);
    const match = bootstrapMatches('bootstrap_1-knight-v5-official-sapphire-20261015-01', ['sapphireArchipelago'], 36000, false)
      .find(m => m.subject === 'v9_knight' && m.side === 0 && Object.values(m.agents).slice(1).map(a => a.version).join('+') === 'v5')!;
    const game = bootstrapGame(match); restoreSnapshotIntoGame(game, snapshot, frame.nextId);
    for (const command of orders) issuePlayerCommand(game, 'p0', command);
    const native = snapshotGame(game);
    expect(combatDeckRecovery(native, 'p0', options, [])).toEqual([]);
    const unload: GameCommand = { type: 'unloadPassenger', passengerId: victimId, transportId: shipId };
    expect(combatDeckRecovery(native, 'p0', options, [unload])).toEqual([{ type: 'stop', unitIds: [victimId] }, unload]);
    expect(options.memory.naval!.deckRecovery).toBeUndefined();
  });
  it('preserves the actual 43725 first enemy-island public unload party', () => {
    const { snapshot, options } = load(43725);
    const mission = options.memory.naval!.ferries!['unit-p0-transport-1046']!;
    expect(mission.purpose).toBe('assault');
    const commands: GameCommand[] = snapshot.units.filter((u: Unit) => u.deck?.shipId === 'unit-p0-transport-1046').map((u: Unit) => u.id).map((passengerId: string) => ({ type: 'unloadPassenger', transportId: 'unit-p0-transport-1046', passengerId }));
    expect(commands.length).toBeGreaterThan(0);
    expect(combatDeckRecovery(snapshot, 'p0', options, commands)).toEqual(commands);
  });
  it('never clears an unrelated hold when releasing a task', () => {
    const { snapshot, options, victim } = load();
    combatDeckRecovery(snapshot, 'p0', options, []);
    victim.order = { type: 'hold', x: 0, y: 0 }; victim.orderQueue = [];
    expect(combatDeckRecovery(snapshot, 'p0', options, [])).toEqual([]);
    expect(options.memory.naval!.deckRecovery).toBeUndefined();
  });
});
