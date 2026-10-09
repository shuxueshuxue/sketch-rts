import { describe, expect, it } from 'vitest';
import { resolveVariant, UNIT_DEFS } from './catalog';
import { boardUnit, deckLoad, deckPlacement, deckPointFits } from './decks';
import { createUnit } from './map';
import { bodyMass } from './physical-body';
import { cabinDoor, cabinEntryRefusal, cabinGroupSelection, cabinSpaceRequired, enterCabinStep, isCabinProtected, isInCabin, leaveCabin, shipCabinCapacity, shipCabinUsage, updateCabinPassengers } from './ship-cabin';
import { AUTHORED_DEFAULT_SHIP_SCALE, authoredShipScale, localToWorld, shipProfile } from './ship-geometry';
import { SHIP_HULL_COST, SHIP_WEAPONS } from './ship-equipment';
import { createGame, issuePlayerCommand, refreshUnitStats, restoreSnapshotIntoGame, snapshotGame, spawnVariantUnit, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import type { Unit, UnitKind } from './types';

function sea() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.scriptedVictory = true;
  game.map.width = game.map.height = 4000;
  game.map.terrain = { cell: 40, cols: 100, rows: 100, cells: '~'.repeat(10000) };
  return game;
}
function aboard(game: ReturnType<typeof sea>, ship: Unit, kind: UnitKind = 'footman') {
  const unit = game.spawnUnit('player', kind, ship.x, ship.y);
  expect(boardUnit(ship, unit, game.units)).toBe(true);
  unit.order = { type: 'hold', x: unit.x, y: unit.y };
  return unit;
}
function shelter(game: ReturnType<typeof sea>, ship: Unit, unit: Unit) {
  const point = deckPlacement(ship, unit, game.units, cabinDoor(ship), true, 2)!;
  expect(point).toBeDefined(); unit.deck = { shipId: ship.id, ...point }; Object.assign(unit, localToWorld(ship, point));
  issuePlayerCommand(game, 'player', { type: 'enterCabin', unitIds: [unit.id] }); enterCabinStep(game, unit);
  expect(isInCabin(unit)).toBe(true);
}

describe('cabin capacity by population and physical body', () => {
  it.each([['transport',11],['carrier',21],['warship',5],['bombardShip',4],['fireShip',3],['shipOfTheLine',8],['cutter',0]] as const)('%s has %i cabin space after the two-thirds reduction', (kind, capacity) => {
    expect(shipCabinCapacity(createUnit('ship','player',kind,1000,1000))).toBe(capacity);
  });

  it('gives worker, infantry, commanders and neutral bodies meaningful different costs', () => {
    const snapshot = {}, worker = createUnit('worker','player','worker',0,0), footman = createUnit('footman','player','footman',0,0);
    expect(cabinSpaceRequired(snapshot,worker)).toBe(1); expect(cabinSpaceRequired(snapshot,footman)).toBe(2);
    expect(cabinSpaceRequired(snapshot,createUnit('chief','player','ashChieftain',0,0))).toBe(3);
    expect(cabinSpaceRequired(snapshot,createUnit('ogre','neutral','ogreWarrior',0,0))).toBe(4);
    footman.bodyRadius = footman.radius = 27;
    expect(cabinSpaceRequired(snapshot,footman)).toBe(4);
  });

  it('uses variant population and body scale while zero-population heroes still pay and combat upgrades do not add room cost', () => {
    const game = sea(); game.variants = {
      commander: resolveVariant({base:'footman',supplyUsed:5}),
      hero: resolveVariant({base:'footman',supplyUsed:0,radius:24,heroic:true}),
      freeWorker: resolveVariant({base:'worker',supplyUsed:0}),
    };
    const commander = spawnVariantUnit(game,'player','commander',1000,1000), hero = spawnVariantUnit(game,'player','hero',1000,1000), worker = spawnVariantUnit(game,'player','freeWorker',1000,1000);
    expect(cabinSpaceRequired(game,commander)).toBe(5); expect(cabinSpaceRequired(game,hero)).toBe(3); expect(cabinSpaceRequired(game,worker)).toBe(1);
    hero.gearMass = 800; expect(cabinSpaceRequired(game,hero)).toBe(3);
    game.players.player.upgrades.weaponTraining = 3; game.players.player.upgrades.reinforcedPlating = 3; commander.level = 3;
    refreshUnitStats(game,commander); expect(cabinSpaceRequired(game,commander)).toBe(5);
  });

  it('scales campaign compartment area once in authored units', () => {
    const ship = createUnit('campaign','player','transport',1000,1000);
    expect(shipCabinCapacity(ship)).toBe(11);
    ship.deckScale = AUTHORED_DEFAULT_SHIP_SCALE * 2; expect(shipCabinCapacity(ship)).toBe(44);
    ship.deckScale = AUTHORED_DEFAULT_SHIP_SCALE / 2; expect(shipCabinCapacity(ship)).toBe(2);
    ship.deckScale = AUTHORED_DEFAULT_SHIP_SCALE / 10; expect(shipCabinCapacity(ship)).toBe(1);
  });

  it.each([['transport',5,11],['warship',2,5]] as const)('%s admits %i infantry while preserving their payload and real exits', (kind, count, capacity) => {
    const game = sea(), ship = game.spawnUnit('player',kind,1600,1600), people:Unit[]=[];
    for (let i=0;i<count;i++) { const unit=aboard(game,ship); shelter(game,ship,unit); people.push(unit); }
    expect(shipCabinUsage(game,ship)).toEqual({capacity,used:count*2,free:1,overCapacity:0});
    const waiting=aboard(game,ship); expect(cabinEntryRefusal(game,waiting)).toBe('capacity');
    const worker=aboard(game,ship,'worker'); shelter(game,ship,worker);
    expect(shipCabinUsage(game,ship).free).toBe(0);
    const mass=deckLoad(game.units,ship); expect(mass).toBeGreaterThan(people.reduce((sum,unit)=>sum+bodyMass(unit),0));
    expect(leaveCabin(game,people[0]!)).toBe(true); expect(deckPointFits(ship,people[0]!,people[0]!.deck!,game.units)).toBe(true);
    expect(deckLoad(game.units,ship)).toBe(mass); expect(shipCabinUsage(game,ship).free).toBe(2);
  });

  it('reserves group space once per hull and admits a smaller later choice when a commander does not fit', () => {
    const game=sea(), ship=game.spawnUnit('player','transport',1600,1600), a=aboard(game,ship), b=aboard(game,ship), c=aboard(game,ship,'worker');
    game.variants={large:resolveVariant({base:'footman',supplyUsed:6}),small:resolveVariant({base:'footman',supplyUsed:5}),commander:resolveVariant({base:'footman',supplyUsed:9})}; a.variant='large'; b.variant='small';
    expect(cabinGroupSelection(game,[a,a,b,c])).toEqual([a.id,b.id]);
    shelter(game,ship,a);
    b.variant='commander';
    expect(cabinEntryRefusal(game,b)).toBe('capacity'); expect(cabinGroupSelection(game,[b,c])).toEqual([c.id]);
  });

  it('applies the shared group budget to a real command and replays its admitted orders', () => {
    const game=sea(), ship=game.spawnUnit('player','transport',1600,1600), a=aboard(game,ship), b=aboard(game,ship), c=aboard(game,ship,'worker');
    game.variants={large:resolveVariant({base:'footman',supplyUsed:6}),small:resolveVariant({base:'footman',supplyUsed:5})}; a.variant='large'; b.variant='small';
    c.order={type:'idle'};
    const skippedOrder={...c.order};
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[a.id,a.id,b.id,c.id]});
    expect([a.order,b.order]).toEqual([{type:'enterCabin',shipId:ship.id},{type:'enterCabin',shipId:ship.id}]);
    expect(c.order).toEqual(skippedOrder);
    const saved=snapshotGame(game), restored=sea(); restoreSnapshotIntoGame(restored,saved,game.nextId);
    for(let tick=0;tick<200 && (!isInCabin(a)||!isInCabin(b));tick++) {
      stepGame(game); stepGame(restored); expect(checksumGame(restored)).toBe(checksumGame(game));
      expect(shipCabinUsage(game,ship).used).toBeLessThanOrEqual(11);
    }
    expect(isInCabin(a)&&isInCabin(b)).toBe(true); expect(isInCabin(c)).toBe(false);
    expect(shipCabinUsage(game,ship)).toEqual({capacity:11,used:11,free:0,overCapacity:0});
  });

  it('keeps physical payload and hatch clearance authoritative even when compartment space is free', () => {
    const game=sea(), ship=game.spawnUnit('player','transport',1600,1600), unit=game.spawnUnit('player','worker',ship.x,ship.y);
    ship.holdMass=shipProfile(ship)!.loadCapacity;
    expect(shipCabinUsage(game,ship).free).toBe(11); expect(boardUnit(ship,unit,game.units)).toBe(false);
    ship.holdMass=0; expect(boardUnit(ship,unit,game.units)).toBe(true);
    unit.bodyRadius=unit.radius=120;
    expect(cabinEntryRefusal(game,unit)).toBe('capacity');
  });

  it('rejects a permanently disconnected heavy passenger without starving a reachable companion', () => {
    const game=sea(), ship=game.spawnUnit('player','shipOfTheLine',1600,1600), heavy=aboard(game,ship,'ogreLord');
    const footman=game.spawnUnit('player','footman',ship.x,ship.y), foredeck={x:154.176,y:0};
    expect(deckPointFits(ship,footman,foredeck,game.units)).toBe(true);
    footman.deck={shipId:ship.id,...foredeck}; Object.assign(footman,localToWorld(ship,foredeck));
    expect(cabinSpaceRequired(game,heavy)).toBe(6); expect(shipCabinUsage(game,ship).free).toBe(8);
    expect(cabinEntryRefusal(game,heavy)).toBe('door');
    expect(cabinGroupSelection(game,[heavy,footman])).toEqual([footman.id]);
    const initial={...heavy.deck!}, previous={...heavy.order};
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[heavy.id,footman.id]});
    expect(heavy.order).toEqual(previous);
    for(let tick=0;tick<200&&!isInCabin(footman);tick++)stepGame(game);
    expect(isInCabin(footman)).toBe(true); expect(isInCabin(heavy)).toBe(false); expect(heavy.deck).toEqual(initial);
    // An old queued order is cancelled by the same static check, so it also
    // cannot monopolize the hatch when a snapshot resumes.
    heavy.order={type:'enterCabin',shipId:ship.id}; enterCabinStep(game,heavy);
    expect(heavy.order.type).toBe('idle');
  });

  it('rechecks physical routes when a campaign hull scale changes rather than imposing a fleet-wide body limit', () => {
    const game=sea(), ship=game.spawnUnit('player','shipOfTheLine',1600,1600), heavy=aboard(game,ship,'ogreLord');
    expect(cabinEntryRefusal(game,heavy)).toBe('door');
    ship.deckScale=authoredShipScale(ship)*2;
    heavy.deck!.x*=2; heavy.deck!.y*=2; Object.assign(heavy,localToWorld(ship,heavy.deck!));
    expect(cabinEntryRefusal(game,heavy)).toBeUndefined();
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[heavy.id]});
    for(let tick=0;tick<400&&!isInCabin(heavy);tick++)stepGame(game);
    expect(isInCabin(heavy)).toBe(true); expect(shipCabinUsage(game,ship).used).toBe(6);
  });

  it('keeps over-capacity saved occupants alive and sheltered, denies new entry, and permits a safe exit through replay', () => {
    const game=sea(), ship=game.spawnUnit('player','warship',1600,1600), occupants:Unit[]=[];
    for(let i=0;i<5;i++) { const unit=aboard(game,ship); unit.cabin={shipId:ship.id}; occupants.push(unit); }
    const waiting=aboard(game,ship,'worker');
    expect(shipCabinUsage(game,ship)).toEqual({capacity:5,used:10,free:0,overCapacity:5});
    updateCabinPassengers(game); expect(occupants.every(unit=>isCabinProtected(game,unit))).toBe(true);
    expect(cabinEntryRefusal(game,waiting)).toBe('capacity');
    const saved=snapshotGame(game), restored=sea(); restoreSnapshotIntoGame(restored,saved,game.nextId);
    expect(shipCabinUsage(restored,restored.units.find(unit=>unit.id===ship.id)!)).toEqual(shipCabinUsage(game,ship));
    for(const replay of [game,restored]) issuePlayerCommand(replay,'player',{type:'leaveCabin',unitIds:[occupants[0]!.id]});
    for(let tick=0;tick<10;tick++) { stepGame(game); stepGame(restored); expect(checksumGame(restored)).toBe(checksumGame(game)); }
    expect(game.units).toHaveLength(7); expect(isInCabin(occupants[0]!)).toBe(false);
    expect(deckPointFits(ship,occupants[0]!,occupants[0]!.deck!,game.units)).toBe(true);
    expect(shipCabinUsage(game,ship).used).toBe(8); expect(saved.units.filter(unit=>unit.cabin)).toHaveLength(5);
  });
});

describe('complete trained ship prices', () => {
  it.each([['cutter',120,160],['transport',160,240],['warship',390,540],['bombardShip',570,800],['fireShip',370,520],['carrier',280,420],['shipOfTheLine',1400,1960]] as const)('%s raises its actual purchase from %i to %i gold', (kind, previous, next) => {
    expect(UNIT_DEFS[kind].cost).toBe(next); expect(next % 20).toBe(0);
    expect(next/previous).toBeGreaterThanOrEqual(1.3); expect(next/previous).toBeLessThanOrEqual(1.5);
  });
  it('counts the included mounted weapons once and retains their equipment retail prices', () => {
    expect(SHIP_WEAPONS.shipCannon.cost).toBe(220); expect(SHIP_WEAPONS.shipMortar.cost).toBe(330); expect(SHIP_WEAPONS.flameProjector.cost).toBe(180);
    expect(UNIT_DEFS.warship.cost).toBe(SHIP_HULL_COST.warship+SHIP_WEAPONS.shipCannon.cost);
    expect(UNIT_DEFS.shipOfTheLine.cost).toBe(SHIP_HULL_COST.shipOfTheLine+4*SHIP_WEAPONS.shipCannon.cost);
  });
});
