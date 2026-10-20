import { describe, expect, it } from 'vitest';
import { UNIT_DEFS, UPGRADE_DEFS, canResearchAt } from './catalog';
import { createBuilding } from './map';
import { createGame, issuePlayerCommand, refreshUnitStats, stepGame } from './sim';
import { createRoom } from './rooms';
import { createSaveGameRecord, restoreGameFromSave } from './savegame';
import { RULES_VERSION, assertCurrentRulesVersion } from './rules-version';
import { researchCommandButtonsForSelection } from '../client/research-controls';

const hulls = { transport: 270, warship: 320, shipOfTheLine: 740, cutter: 110, bombardShip: 260, fireShip: 340, carrier: 480 } as const;
function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.scriptedVictory = true;
  game.map.width = game.map.height = 4000;
  game.map.terrain = { cell: 40, cols: 100, rows: 100, cells: '~'.repeat(10000) };
  return game;
}
const room = () => ({ ...createRoom({ id: 'ships', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const });

describe('shipbuilding balance', () => {
  it.each(Object.entries(hulls))('%s gains 25%% base HP and ignores barracks attack/health research', (name, oldHp) => {
    const kind = name as keyof typeof hulls;
    const game = scene(), ship = game.spawnUnit('player', kind, 1000, 1000);
    expect(UNIT_DEFS[kind].hp).toBe(oldHp * 1.25);
    const attack = ship.attackDamage;
    game.players.player.upgrades.weaponTraining = 3;
    game.players.player.upgrades.reinforcedPlating = 3;
    refreshUnitStats(game, ship);
    expect(ship.attackDamage).toBe(attack);
    expect(ship.maxHp).toBe(Math.round(oldHp * 1.25));
    const soldier = game.spawnUnit('player', 'footman', 2000, 2000);
    expect(soldier.attackDamage).toBe(Math.round(UNIT_DEFS.footman.attackDamage * 1.45));
    for (let level = 1; level <= 3; level++) {
      game.players.player.upgrades.shipbuilding = level;
      refreshUnitStats(game, ship);
      expect(ship.maxHp).toBe(Math.round(oldHp * 1.25 * (1 + level / 3)));
      expect(ship.speed).toBeCloseTo(UNIT_DEFS[kind].speed * (1 + level / 5), 2);
      const fresh = game.spawnUnit('player', kind, 3000, 3000);
      expect([fresh.maxHp, fresh.speed]).toEqual([ship.maxHp, ship.speed]);
    }
  });

  it.each(['grove', 'ember'] as const)('%s buys three levels at the dock, updates wounded ships and persists research', race => {
    const game = scene(); game.players.player.race = race; game.players.player.gold = 3000;
    const dock = createBuilding('dock', 'player', 'shipyard', 1000, 1000, true);
    game.buildings.push(dock);
    const ship = game.spawnUnit('player', 'warship', 1400, 1000);
    ship.hp -= 100;
    expect(canResearchAt(race, 'shipyard', 'shipbuilding')).toBe(true);
    expect(canResearchAt(race, race === 'grove' ? 'barracks' : 'emberForge', 'shipbuilding')).toBe(false);
    expect(researchCommandButtonsForSelection([dock], game.players.player).map(b => b.upgradeKind)).toEqual(['shipbuilding']);
    for (let level = 1; level <= 3; level++) {
      const gold = game.players.player.gold;
      issuePlayerCommand(game, 'player', { type: 'research', buildingId: dock.id, upgradeKind: 'shipbuilding' });
      expect(game.players.player.gold).toBe(gold - 500 * level);
      for (let t = 0; t <= UPGRADE_DEFS.shipbuilding.levels[level - 1]!.researchTime; t++) stepGame(game);
      expect(game.players.player.upgrades.shipbuilding).toBe(level);
      expect(ship.hp).toBe(ship.maxHp - 100);
    }
    expect(game.players.player.gold).toBe(0);
    expect(researchCommandButtonsForSelection([dock], game.players.player)).toEqual([]);
    expect(() => issuePlayerCommand(game, 'player', { type: 'research', buildingId: dock.id, upgradeKind: 'shipbuilding' })).toThrow('max level');
    const restored = restoreGameFromSave(createSaveGameRecord(game, room(), { id: 'new' }));
    expect(restored.players.player.upgrades.shipbuilding).toBe(3);
    expect(restored.units.find(u => u.id === ship.id)).toMatchObject({ hp: ship.hp, maxHp: 800, speed: 96 });
  });

  it('combines independent mobility training once and leaves non-ships untouched', () => {
    const game = scene();
    game.players.player.upgrades.speedTraining = 3;
    game.players.player.upgrades.shipbuilding = 3;
    const ship = game.spawnUnit('player', 'warship', 1000, 1000);
    const footman = game.spawnUnit('player', 'footman', 2000, 2000);
    expect(ship.speed).toBe(124.8);
    expect(ship.maxHp).toBe(800);
    expect(footman.maxHp).toBe(UNIT_DEFS.footman.hp);
    expect(footman.speed).toBeCloseTo(UNIT_DEFS.footman.speed * 1.3, 2);
    refreshUnitStats(game, ship);
    expect(ship.speed).toBe(124.8);
  });

  it('imports rules 3 explicitly without healing old ships or modifying the source save; old replay remains rejected', () => {
    const game = scene(), ship = game.spawnUnit('player', 'warship', 1400, 1000);
    const neutral = game.spawnUnit('neutral', 'warship', 2400, 1000);
    const save = createSaveGameRecord(game, room(), { id: 'old' });
    Object.assign(save.snapshot.units.find(u => u.id === neutral.id)!, { hp: 80, maxHp: 320 });
    save.rulesVersion = 3;
    const old = save.snapshot.units.find(u => u.id === ship.id)!;
    Object.assign(old, { hp: 100, maxHp: 464, attackDamage: 29 });
    save.snapshot.players.player.upgrades.weaponTraining = 3;
    save.snapshot.players.player.upgrades.reinforcedPlating = 3;
    delete (save.snapshot.players.player.upgrades as Partial<typeof game.players.player.upgrades>).shipbuilding;
    const bytes = JSON.stringify(save);
    const loaded = restoreGameFromSave(save);
    expect(loaded.units.find(u => u.id === ship.id)).toMatchObject({ hp: 100, maxHp: 400, attackDamage: 20 });
    expect(loaded.players.player.upgrades.shipbuilding).toBe(0);
    expect(loaded.units.find(u => u.id === neutral.id)).toMatchObject({ hp: 80, maxHp: 400 });
    expect(JSON.stringify(save)).toBe(bytes);
    expect(RULES_VERSION).toBe(9);
    expect(() => assertCurrentRulesVersion(3, 'Replay')).toThrow('Cross-version');
  });
});
