import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, stepGame } from './sim';
import { UNIT_DEFS } from './catalog';
import { strikeGap } from './combat-geometry';
import { installedWeapons, mountedWeaponPose, SHIP_WEAPONS } from './ship-equipment';
import { continuingShipAim } from './ship-attack-station';
import { createRoom } from './rooms';
import { createSaveGameRecord, restoreGameFromSave } from './savegame';
import { RULES_VERSION, savedRulesVersion } from './rules-version';
import type { UnitKind } from './types';

function pursuit(ai: boolean, kind: UnitKind = 'archer') {
  const game = createGame('bareDuel', { aiPlayers: ai ? ['player', 'enemy'] : [], scenario: {
    replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true,
    replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true,
  } });
  game.scriptedVictory = true;
  const shooter = game.spawnUnit('player', kind, 1000, 1000);
  const target = game.spawnUnit('enemy', 'footman', 1000 + shooter.attackRange - 9.2, 1000);
  // A controlled retreat isolates reticle cancellation from the two units' different top speeds.
  target.speed = 24; target.hp = target.maxHp = 10_000;
  issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [shooter.id], targetId: target.id });
  issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [target.id], x: 3500, y: 1000 });
  return { game, shooter, target };
}

function hold(target: ReturnType<typeof pursuit>['target']) { target.order = { type: 'hold', x: target.x, y: target.y }; }

function sea(kind: 'warship' | 'bombardShip') {
  const { game } = pursuit(true);
  game.units = []; game.items = [];
  game.map = { ...game.map, width: 4000, height: 4000, terrain: { cell: 40, cols: 100, rows: 100, cells: '~'.repeat(10_000) } };
  const ship = game.spawnUnit('player', kind, 1000, 1000);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  const gun = installedWeapons(game, ship)[0]!;
  const def = SHIP_WEAPONS[gun.kind as keyof typeof SHIP_WEAPONS];
  const pivot = mountedWeaponPose(ship, gun)!.pivot;
  const target = game.spawnUnit('enemy', 'transport', 2000, pivot.y);
  const gap = (distance: number) => { target.x += distance - strikeGap(pivot, target); hold(target); };
  gap(def.range - 8);
  issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: target.id });
  return { game, ship, gun, def, pivot, target, gap };
}

describe('aiming range motion buffer', () => {
  it.each([false, true])('finishes repeated shots while pursuing a retreating melee unit (AI=%s)', ai => {
    const { game, shooter } = pursuit(ai);
    const shots: number[] = [], seen = new Set<string>();
    let interrupted = 0;
    for (let i = 0; i < 200; i++) {
      const tracking = shooter.aim?.tracking;
      stepGame(game);
      if (tracking && !shooter.aim) interrupted++;
      for (const projectile of game.projectiles) if (projectile.attackerId === shooter.id && !seen.has(projectile.id)) {
        seen.add(projectile.id); shots.push(game.tick);
      }
    }
    expect(shots.length, JSON.stringify({ shots, interrupted })).toBeGreaterThanOrEqual(4);
    expect(shots[0]).toBeLessThan(30);
    expect(interrupted).toBe(0);
  });

  it.each(['attack', 'attackMove', 'hold'] as const)('stands still through the same extended windup under %s', type => {
    const { game, shooter, target } = pursuit(false);
    hold(target);
    if (type === 'hold') issuePlayerCommand(game, 'player', { type: 'holdPosition', unitIds: [shooter.id] });
    if (type === 'attackMove') {
      target.x = 1220; hold(target); // Automatic acquisition stays at its original 230-unit range.
      issuePlayerCommand(game, 'player', { type: 'attackMove', unitIds: [shooter.id], x: 3000, y: 1000 });
    }
    for (let tick = 0; tick < 3 && !shooter.aim; tick++) stepGame(game);
    const station = shooter.x;
    expect(shooter.aim).toMatchObject({ targetId: target.id, tracking: true });
    target.x = shooter.x + shooter.attackRange * 1.2; hold(target);
    for (let tick = 0; tick < 40 && game.projectiles.length === 0; tick++) {
      stepGame(game);
      expect(shooter.x).toBe(station);
    }
    expect(game.projectiles.some(p => p.attackerId === shooter.id)).toBe(true);
    // The next windup cannot start outside ordinary range. Hold stays put; a pursuit closes the gap.
    stepGame(game);
    if (type === 'hold') expect(shooter.x).toBe(station);
    else expect(shooter.x).toBeGreaterThan(station);
  });

  it('does not start beyond ordinary range or borrow a different target or prepared point', () => {
    const { game, shooter, target } = pursuit(false);
    target.x = 1380; hold(target);
    stepGame(game);
    expect(shooter.aim).toBeUndefined();
    target.x = shooter.x + 310; hold(target);
    stepGame(game);
    expect(shooter.aim?.targetId).toBe(target.id);
    const other = game.spawnUnit('enemy', 'footman', shooter.x + 380, 1000);
    hold(other);
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [shooter.id], targetId: other.id });
    const x = shooter.x;
    stepGame(game);
    expect(shooter.x).toBeGreaterThan(x);
    expect(game.projectiles).toHaveLength(0);
    delete shooter.aim?.targetId;
    stepGame(game);
    expect(shooter.x).toBeGreaterThan(x + 3);
  });

  it('resumes pursuit and invalidates movement normally beyond the buffered range', () => {
    const { game, shooter, target } = pursuit(false);
    hold(target); stepGame(game);
    target.x = 1500; hold(target);
    for (let tick = 0; tick < 3; tick++) stepGame(game);
    expect(shooter.x).toBeGreaterThan(1006);
    expect(shooter.aim).toBeUndefined();
    expect(game.projectiles).toHaveLength(0);
  });

  it('honors a weapon rule opting out of the buffer', () => {
    const prior = UNIT_DEFS.archer.aimRangeBuffer;
    UNIT_DEFS.archer.aimRangeBuffer = 0;
    try {
      const { game, shooter } = pursuit(true);
      let shots = 0;
      for (let tick = 0; tick < 200; tick++) {
        stepGame(game);
        shots += game.projectiles.filter(projectile => projectile.attackerId === shooter.id).length;
      }
      expect(shots).toBe(0);
    } finally {
      if (prior === undefined) delete UNIT_DEFS.archer.aimRangeBuffer;
      else UNIT_DEFS.archer.aimRangeBuffer = prior;
    }
  });

  it('finishes a catapult shell without changing its splash or minimum range', () => {
    const { game, shooter, target } = pursuit(true, 'catapult');
    hold(target); stepGame(game);
    target.x = 1000 + shooter.attackRange * 1.15; hold(target);
    for (let tick = 0; tick < 90 && game.projectiles.length === 0; tick++) {
      stepGame(game);
      expect(shooter.x).toBe(1000);
    }
    const shot = game.projectiles.find(p => p.attackerId === shooter.id)!;
    expect(shot.weapon).toMatchObject({ delivery: 'shell', minRange: 180, radius: 90 });
    expect(shot.toX - shooter.x).toBeGreaterThan(shooter.attackRange);
    expect(shot.toX - shooter.x).toBeLessThanOrEqual(shooter.attackRange * 1.25);
    const near = pursuit(true, 'catapult');
    hold(near.target); stepGame(near.game);
    near.target.x = 1100; hold(near.target); stepGame(near.game);
    expect(near.shooter.x).toBeLessThan(1000);
    expect(near.game.projectiles).toHaveLength(0);
  });

  it.each(['warship', 'bombardShip'] as const)('finishes a fitted %s windup from its pivot without chasing or extending a new shot', kind => {
    const { game, ship, gun, def, target, gap } = sea(kind);
    stepGame(game);
    expect(gun.aim).toMatchObject({ targetId: target.id, tracking: true });
    gap(def.range * 1.15);
    for (let tick = 0; tick < 80 && game.projectiles.length === 0; tick++) {
      stepGame(game);
      expect(ship.x).toBe(1000); expect(ship.y).toBe(1000);
    }
    expect(game.projectiles.some(p => p.attackerId === ship.id)).toBe(true);
    expect(gun.aim?.tracking).toBe(false);
    const fresh = sea(kind);
    fresh.gap(def.range * 1.15);
    issuePlayerCommand(fresh.game, 'player', { type: 'holdPosition', unitIds: [fresh.ship.id] });
    for (let tick = 0; tick < 10; tick++) stepGame(fresh.game);
    expect(fresh.gun.aim).toBeUndefined();
    expect(fresh.game.projectiles).toHaveLength(0);
  });

  it('keeps mounted dead zones, traverse arcs and friendly firing lanes authoritative', () => {
    const { game, ship, gun, def, target, gap, pivot } = sea('warship');
    stepGame(game);
    gap(def.range * 1.15);
    expect(continuingShipAim(game, ship, target, [])).toBe(true);
    const blocker = game.spawnUnit('player', 'transport', pivot.x + def.range * .9, pivot.y);
    blocker.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
    expect(continuingShipAim(game, ship, target, [blocker])).toBe(false);
    gap(def.range * 1.3);
    expect(continuingShipAim(game, ship, target, [])).toBe(false);
    const mortar = sea('bombardShip');
    stepGame(mortar.game); mortar.gap(30);
    expect(continuingShipAim(mortar.game, mortar.ship, mortar.target, [])).toBe(false);
    target.x = pivot.x; target.y = pivot.y + def.range;
    expect(continuingShipAim(game, ship, target, [])).toBe(false);
    expect(gun.aim?.targetId).toBe(target.id);
  });

  it('reads a rules-6 save without an aim target lock and preserves current locks in saves', () => {
    const { game, shooter, target } = pursuit(false);
    hold(target); stepGame(game);
    const room = { ...createRoom({ id: 'aim-save', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
    const save = createSaveGameRecord(game, room, { id: 'aim-save' });
    expect(restoreGameFromSave(save).units[0]!.aim?.targetId).toBe(target.id);
    save.rulesVersion = 6;
    for (const unit of save.snapshot.units) if (unit.aim) delete unit.aim.targetId;
    const restored = restoreGameFromSave(save);
    expect(restored.units[0]!.aim?.targetId).toBeUndefined();
    stepGame(restored);
    expect(restored.units[0]!.aim?.targetId).toBe(target.id);
    expect(shooter.aim?.targetId).toBe(target.id);
    expect(savedRulesVersion(6)).toBe(6);
    expect(RULES_VERSION).toBe(7);
  });
});
