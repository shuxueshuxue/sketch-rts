import { installedWeapons, mountedWeaponPose, SHIP_WEAPONS } from "./ship-equipment";
import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, removeUnit, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { boardUnit, deckPlacement, syncDecks } from './decks';
import { localToWorld, shipProfile, shipWeaponPose } from './ship-geometry';
import { UNIT_DEFS } from './catalog';
import { nearestShipPose } from './ship-navigation';
import { DECK_HULL_DAMAGE } from './deck-combat';
import { checksumGame } from './sim/checksum';
import type { Unit } from './types';
function match(terrain?: 'water' | 'coast') {
    const game = createGame('bareDuel', { players: ['player', 'enemy', 'ally'], teams: { player: 'blue', enemy: 'red', ally: 'red' }, aiPlayers: [] });
    game.units = [];
    game.buildings = [];
    game.scriptedVictory = true;
    game.players.player!.gold = 1000;
    game.players.enemy!.gold = 1000;
    game.map = { ...game.map, width: 2000, height: 1600 };
    if (terrain)
        game.map.terrain = { cell: 40, cols: 50, rows: 40, cells: Array.from({ length: 2000 }, (_, i) => terrain === 'water' ? '~' : i % 50 < 20 ? '.' : i % 50 === 20 ? ',' : '~').join('') };
    else
        delete game.map.terrain;
    return game;
}
function place(game: ReturnType<typeof match>, ship: Unit, unit: Unit, x = 20, y = 0) {
    expect(boardUnit(ship, unit, game.units)).toBe(true);
    unit.deck = { shipId: ship.id, ...deckPlacement(ship, unit, game.units, { x, y })! };
    unit.cooldown = 9999;
    unit.attackDamage = 0;
    unit.order = { type: 'hold', x: unit.x, y: unit.y };
    syncDecks(game.units);
}
function run(game: ReturnType<typeof match>, steps: number) { for (let i = 0; i < steps; i++)
    stepGame(game); }
function firstShot(game: ReturnType<typeof match>) { for (let i = 0; i < 400 && !game.projectiles.length; i++)
    stepGame(game); expect(game.projectiles).toHaveLength(1); return game.projectiles[0]!; }
describe('live naval combat', () => {
    it('treats a hull order as a crew fight, with ordinary crew damage and incidental hull damage', () => {
        const game = match(), ship = game.spawnUnit('enemy', 'warship', 900, 800), crew = game.spawnUnit('enemy', 'archer', 900, 800), archer = game.spawnUnit('player', 'archer', 1100, 800);
        ship.cooldown = 9999;
        place(game, ship, crew, 0, 20);
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [archer.id], targetId: ship.id });
        const shot = firstShot(game), hp = crew.hp, hull = ship.hp;
        expect(shot.targetId).toBe(crew.id);
        archer.cooldown = 9999;
        run(game, shot.remaining);
        expect(crew.hp).toBeCloseTo(hp - shot.damage); // No ship-provided ranged mitigation.
        expect(ship.hp).toBeCloseTo(hull - shot.damage * DECK_HULL_DAMAGE.arrow);
        removeUnit(game, crew.id);
        archer.cooldown = 0;
        const next = firstShot(game);
        expect(next.targetId).toBe(ship.id);
    });
    it('launches a cannon round from the traversed muzzle and hits crew ahead of their hull', () => {
        const game = match(), gun = game.spawnUnit('player', 'warship', 1150, 800), ship = game.spawnUnit('enemy', 'transport', 900, 800), crew = game.spawnUnit('enemy', 'archer', 900, 800);
        place(game, ship, crew, -5, 20);
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [gun.id], targetId: ship.id });
        const shot = firstShot(game), pose = mountedWeaponPose(gun, installedWeapons(game, gun)[0]!)!;
        expect(shot.fromX).toBeCloseTo(pose.muzzle.x);
        expect(shot.fromY).toBeCloseTo(pose.muzzle.y);
        const flash = game.effects.find(e => e.type === 'muzzleFlash')!;
        expect(flash.unitId).toBe(gun.id);
        expect(flash.fromHeight).toBe(pose.height);
        const hp = crew.hp, hull = ship.hp;
        gun.cooldown = 9999;
        run(game, shot.remaining);
        expect(crew.hp).toBeLessThan(hp);
        expect(ship.hp).toBeCloseTo(hull - shot.damage * SHIP_WEAPONS.shipCannon.weapon.hullDamageShare!);
    });
    it('aggregates one shell blast across several passengers without stacking hull damage', () => {
        const game = match(), gun = game.spawnUnit('player', 'catapult', 1320, 900), ship = game.spawnUnit('enemy', 'carrier', 900, 900), a = game.spawnUnit('enemy', 'archer', 900, 900), b = game.spawnUnit('enemy', 'archer', 900, 900);
        place(game, ship, a, -10, -25);
        place(game, ship, b, 20, 20);
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [gun.id], targetId: a.id });
        const shot = firstShot(game), hull = ship.hp;
        gun.cooldown = 9999;
        run(game, shot.remaining);
        expect(a.hp).toBeLessThan(a.maxHp);
        expect(b.hp).toBeLessThan(b.maxHp);
        expect(ship.hp).toBeCloseTo(hull - shot.damage * DECK_HULL_DAMAGE.shell);
        expect(game.deckDamageBatch).toBeUndefined();
    });
    it('halves transport passenger attacks and removes the modifier after leaving', () => {
        const game = match(), ship = game.spawnUnit('player', 'transport', 900, 800), archer = game.spawnUnit('player', 'archer', 900, 800), enemy = game.spawnUnit('enemy', 'footman', 1150, 800);
        place(game, ship, archer);
        archer.attackDamage = UNIT_DEFS.archer.attackDamage;
        archer.cooldown = 0;
        enemy.cooldown = 9999;
        enemy.order = { type: 'hold', x: enemy.x, y: enemy.y };
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [archer.id], targetId: enemy.id });
        const shot = firstShot(game);
        expect(shot.damage).toBe(Math.round(archer.attackDamage * .5));
        game.projectiles = [];
        delete archer.deck;
        archer.cooldown = 0;
        const next = firstShot(game);
        expect(next.damage).toBe(archer.attackDamage);
    });
    it('repairs with idle deck workers using gold, while explicit movement takes precedence', () => {
        const game = match(), ship = game.spawnUnit('player', 'transport', 900, 800), worker = game.spawnUnit('player', 'worker', 900, 800);
        place(game, ship, worker);
        worker.cooldown = 0;
        worker.order = { type: 'idle' };
        ship.hp -= 50;
        const hp = ship.hp, gold = game.players.player!.gold;
        stepGame(game);
        expect(ship.hp).toBeGreaterThan(hp);
        expect(game.players.player!.gold).toBe(gold - 1);
        const repaired = ship.hp;
        issuePlayerCommand(game, 'player', { type: 'move', unitIds: [worker.id], ...localToWorld(ship, { x: 40, y: 10 }) });
        stepGame(game);
        expect(ship.hp).toBe(repaired);
    });
});
describe('connected physical surfaces and capture', () => {
    it('walks between touching decks at normal speed and takes an empty hostile ship', () => {
        const game = match('water'), a = game.spawnUnit('player', 'transport', 800, 800), b = game.spawnUnit('enemy', 'transport', 800, 880), unit = game.spawnUnit('player', 'footman', 800, 800);
        b.x=a.x;b.y=a.y+shipProfile(a)!.beam+.05; // Real broadside contact without intersecting hulls.
        place(game, a, unit, 20, 0);
        unit.speed = UNIT_DEFS.footman.speed;
        const goal = deckPlacement(b, unit, game.units, { x: 20, y: 0 }, false)!;
        issuePlayerCommand(game, 'player', { type: 'move', unitIds: [unit.id], ...localToWorld(b, goal) });
        for (let i = 0; i < 90; i++) {
            const old = { x: unit.x, y: unit.y };
            stepGame(game);
            expect(Math.hypot(unit.x - old.x, unit.y - old.y)).toBeLessThanOrEqual(unit.speed / 20 + .2);
        }
        expect(unit.deck?.shipId).toBe(b.id);
        expect(b.owner).toBe('player');
    });
    it('cannot jump a water gap or capture a deck still held by defenders or their allies', () => {
        const game = match('water'), a = game.spawnUnit('player', 'transport', 800, 800), b = game.spawnUnit('enemy', 'transport', 800, 910), unit = game.spawnUnit('player', 'footman', 800, 800);
        place(game, a, unit);
        issuePlayerCommand(game, 'player', { type: 'move', unitIds: [unit.id], ...localToWorld(b, { x: 20, y: 0 }) });
        run(game, 90);
        expect(unit.deck?.shipId).toBe(a.id);
        expect(b.owner).toBe('enemy');
        b.y = 880;
        const defender = game.spawnUnit('ally', 'worker', 800, 880);
        place(game, b, defender, 40, 5);
        run(game, 120);
        expect(unit.deck?.shipId).toBe(b.id);
        expect(b.owner).toBe('enemy');
        removeUnit(game, defender.id);
        stepGame(game);
        expect(b.owner).toBe('player');
    });
    it('lets shore soldiers enter an accessible hostile deck and return to ground', () => {
        const game = match('coast'), ship = game.spawnUnit('enemy', 'transport', 840, 900), unit = game.spawnUnit('player', 'footman', 780, 930);
        ship.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
        const goal = deckPlacement(ship, unit, game.units, { x: 30, y: 0 }, false)!;
        issuePlayerCommand(game, 'player', { type: 'move', unitIds: [unit.id], ...localToWorld(ship, goal) });
        run(game, 100);
        expect(unit.deck?.shipId).toBe(ship.id);
        expect(ship.owner).toBe('player');
        issuePlayerCommand(game, 'player', { type: 'move', unitIds: [unit.id], x: 760, y: 930 });
        run(game, 100);
        expect(unit.deck).toBeUndefined();
        expect(unit.x).toBeLessThan(800);
    });
    it('keeps deep water impassable and resumes a saved crossing deterministically', () => {
        const game = match('coast'), ship = game.spawnUnit('enemy', 'transport', 920, 900), unit = game.spawnUnit('player', 'footman', 780, 930);
        ship.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
        issuePlayerCommand(game, 'player', { type: 'move', unitIds: [unit.id], ...localToWorld(ship, { x: 30, y: 0 }) });
        run(game, 100);
        expect(unit.deck).toBeUndefined();
        Object.assign(ship,nearestShipPose(game.map,ship,{x:840,y:900})!);
        run(game, 10);
        const restored = createGame('bareDuel');
        restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
        restored.scriptedVictory = true;
        for (let i = 0; i < 80; i++) {
            stepGame(game);
            stepGame(restored);
            expect(checksumGame(restored)).toBe(checksumGame(game));
        }
        expect(unit.deck?.shipId).toBe(ship.id);
    });
});
