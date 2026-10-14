import { describe, expect, it } from 'vitest';
import { resolveVariant } from '../shared/catalog';
import { boardUnit } from '../shared/decks';
import { GANGWAY_COOLDOWN_TICKS, GANGWAY_HP, GANGWAY_SETUP_TICKS, GANGWAY_WIDTH, type ShipGangway } from '../shared/ship-gangway';
import { SHIP_KINDS } from '../shared/ship-geometry';
import { createGame, snapshotGame } from '../shared/sim';
import type { Unit } from '../shared/types';
import { boardingTargetHull, shipBoardingAction, shipBoardingStatus, shipBoardingTargetCommand } from './ship-boarding-controls';

function fixture() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.scriptedVictory = true;
  delete game.map.terrain;
  const ship = game.spawnUnit('player', 'transport', 900, 900), target = game.spawnUnit('enemy', 'carrier', 900, 1200);
  const crew = game.spawnUnit('player', 'footman', 900, 900);
  expect(boardUnit(ship, crew, game.units)).toBe(true);
  return { game, ship, target, crew };
}

function bridge(target: Unit, phase: ShipGangway['phase'] = 'approach'): ShipGangway {
  return { targetId: target.id, phase, sourceAnchor: { x: 0, y: 0 }, targetAnchor: { x: 0, y: 0 }, width: GANGWAY_WIDTH,
    initialSpan: 20, initialHeadingDelta: 0, hp: GANGWAY_HP, readyAtTick: GANGWAY_SETUP_TICKS, cooldownUntilTick: GANGWAY_COOLDOWN_TICKS };
}

describe('ship boarding command controls', () => {
  it('keeps every owned ship kind visible without crew and excludes enemy, dead and ground selections', () => {
    const { game, target, crew } = fixture();
    for (const kind of SHIP_KINDS) {
      const empty = game.spawnUnit('player', kind, 1500, 1400);
      expect(shipBoardingAction(snapshotGame(game), 'player', [empty])).toMatchObject({ type: 'boardShip', enabled: false, problem: 'crew' });
    }
    expect(shipBoardingAction(snapshotGame(game), 'player', [target, crew])).toBeUndefined();
    target.owner = 'player'; target.hp = 0;
    expect(shipBoardingAction(snapshotGame(game), 'player', [target])).toBeUndefined();
  });

  it('uses shared walking crew eligibility for shelter, large bodies and authored mechanical crew', () => {
    const { game, ship, crew } = fixture();
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship])).toMatchObject({ enabled: true });
    crew.cabin = { shipId: ship.id };
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship])).toMatchObject({ enabled: false, problem: 'crew' });
    delete crew.cabin; crew.radius = 21;
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship])).toMatchObject({ enabled: false, problem: 'crew' });
    crew.radius = 18; crew.variant = 'automaton'; game.variants = { automaton: resolveVariant({ base: 'footman', unitClass: 'mechanical' }) };
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship])).toMatchObject({ enabled: false, problem: 'crew' });
    crew.variant = undefined; crew.kind = 'worker';
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship])).toMatchObject({ enabled: true });
  });

  it('selects ready sources once and reports the remaining saved cooldown', () => {
    const { game, ship } = fixture();
    game.tick = 120; ship.sailing!.gangwayCooldownUntilTick = game.tick + 150;
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship, ship])).toMatchObject({ enabled: false, problem: 'cooldown', cooldownTicks: 150 });
    const other = game.spawnUnit('player', 'carrier', 1300, 900), worker = game.spawnUnit('player', 'worker', 1300, 900);
    expect(boardUnit(other, worker, game.units)).toBe(true);
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship, other, other])).toEqual({ type: 'boardShip', unitIds: [other.id], enabled: true });
    game.tick += 150;
    expect(shipBoardingAction(snapshotGame(game), 'player', [ship])).toMatchObject({ enabled: true });
  });

  it('recalls existing approach, deployment or ready bridges before starting another source in a mixed selection', () => {
    const { game, ship, target } = fixture(), empty = game.spawnUnit('player', 'warship', 1300, 900);
    for (const phase of ['approach', 'deploying', 'ready'] as const) {
      ship.sailing!.gangway = bridge(target, phase);
      expect(shipBoardingAction(snapshotGame(game), 'player', [ship, empty])).toEqual({ type: 'cancelBoardShip', unitIds: [ship.id], enabled: true });
    }
  });

  it('targets friendly, hostile or neutral live hulls and resolves deck crew clicks to their hull', () => {
    const { game, ship, target } = fixture(), aboard = game.spawnUnit('enemy', 'archer', target.x, target.y);
    expect(boardUnit(target, aboard, game.units)).toBe(true);
    for (const owner of ['player', 'enemy', 'neutral'] as const) {
      target.owner = owner;
      const snapshot = snapshotGame(game);
      expect(shipBoardingTargetCommand(snapshot, 'player', [ship.id, ship.id], target)).toEqual({ type: 'boardShip', unitIds: [ship.id], targetId: target.id });
      expect(boardingTargetHull(snapshot, aboard)?.id).toBe(target.id);
    }
    expect(shipBoardingTargetCommand(snapshotGame(game), 'player', [ship.id], ship)).toBeUndefined();
    expect(shipBoardingTargetCommand(snapshotGame(game), 'player', [ship.id], aboard)).toBeUndefined();
    target.hp = 0;
    expect(boardingTargetHull(snapshotGame(game), aboard)).toBeUndefined();
    expect(shipBoardingTargetCommand(snapshotGame(game), 'player', [ship.id], target)).toBeUndefined();
  });

  it('revalidates source ownership and readiness when a target click follows a newer snapshot', () => {
    const { game, ship, target } = fixture(), stale = { ...ship };
    ship.owner = 'enemy';
    expect(shipBoardingTargetCommand(snapshotGame(game), 'player', [stale.id], target)).toBeUndefined();
    expect(shipBoardingAction(snapshotGame(game), 'player', [stale])).toBeUndefined();
    ship.owner = 'player'; ship.sailing!.gangwayCooldownUntilTick = game.tick + GANGWAY_COOLDOWN_TICKS;
    expect(shipBoardingTargetCommand(snapshotGame(game), 'player', [ship.id], target)).toBeUndefined();
    ship.sailing!.gangwayCooldownUntilTick = game.tick;
    expect(shipBoardingTargetCommand(snapshotGame(game), 'player', [ship.id], target, true)).toEqual({ type: 'boardShip', unitIds: [ship.id], targetId: target.id, queued: true });
  });

  it('keeps phase and cooldown status short and samples the current tick', () => {
    const { ship, target } = fixture();
    ship.sailing!.gangway = bridge(target);
    expect(shipBoardingStatus(ship, 0, true)).toBe('正在靠拢目标船');
    ship.sailing!.gangway.phase = 'deploying';
    expect(shipBoardingStatus(ship, GANGWAY_SETUP_TICKS - 20, false)).toBe('Deploying bridge · 1s');
    ship.sailing!.gangway.phase = 'ready';
    expect(shipBoardingStatus(ship, GANGWAY_SETUP_TICKS, true)).toBe('接舷桥已就绪');
    delete ship.sailing!.gangway; ship.sailing!.gangwayCooldownUntilTick = 100;
    expect(shipBoardingStatus(ship, 80, false)).toBe('Bridge cooldown 1s');
    expect(shipBoardingStatus(ship, 100, false)).toBe('');
  });
});
