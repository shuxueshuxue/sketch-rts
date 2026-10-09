import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { beginShipPlanningFrame, hasShipPlanningWork, tryAdmitShipPlan, tryConsumeShipPlan } from './ship-planning-budget';
import type { Unit } from './types';

function vessel(id: string, kind: 'warship' | 'fireShip' | 'cutter' = 'warship'): Unit {
  const ship = createUnit(id, 'player', kind, 1000, 1000);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  ship.order = { type: 'move', x: 5000, y: 1000 };
  return ship;
}
function ticket(ship: Unit, requested: number, last = requested) {
  ship.sailing!.planningRequestedAtTick = requested;
  ship.sailing!.planningLastRequestedAtTick = last;
}
function crew(ship: Unit): Unit {
  const unit = createUnit('crew', 'player', 'footman', 1000, 900);
  unit.order = { type: 'board', transportId: ship.id };
  return unit;
}

describe('saved ship planning admission', () => {
  it('separates expensive stages of one admitted hull without starving its peers', () => {
    const first=vessel('first'),second=vessel('second');
    expect(tryConsumeShipPlan(first)).toBe(true);
    expect(tryConsumeShipPlan(first)).toBe(true);
    beginShipPlanningFrame([first,second],10);
    expect(tryConsumeShipPlan(first)).toBe(true);
    expect(tryAdmitShipPlan(first)).toBe(true);
    expect(tryConsumeShipPlan(first)).toBe(false);
    expect(tryConsumeShipPlan(second)).toBe(false);
    expect(first.sailing!.planningRequestedAtTick).toBe(10);
    expect(second.sailing!.planningRequestedAtTick).toBe(10);
    beginShipPlanningFrame([first,second],11);
    expect(tryConsumeShipPlan(first)).toBe(true);
    expect(tryConsumeShipPlan(first)).toBe(false);
    expect(tryConsumeShipPlan(second)).toBe(false);
    beginShipPlanningFrame([first,second],12);
    expect(tryConsumeShipPlan(first)).toBe(false);
    expect(tryConsumeShipPlan(second)).toBe(true);
  });

  it('shares small slices while an older full stage retains FIFO across JSON restores', () => {
    const original=[vessel('a'),vessel('b'),vessel('c')];
    ticket(original[0]!,7,9);ticket(original[1]!,6,9);ticket(original[2]!,5,9);
    const restored=JSON.parse(JSON.stringify(original)) as Unit[];
    const grants:string[][]=[[],[]];
    for(let tick=10;tick<16;tick++){
      const worlds=[original,restored];
      for(let index=0;index<worlds.length;index++){
        const units=worlds[index]!;
        beginShipPlanningFrame(index===0?units:[...units].reverse(),tick);
        for(const ship of units){
          if(tryConsumeShipPlan(ship,ship.id==='b'?8:1))grants[index]!.push(ship.id);
        }
      }
      expect(restored).toEqual(JSON.parse(JSON.stringify(original)));
    }
    expect(grants[0]).toEqual(['c','b','a','c','b','a','c','b']);
    expect(grants[1]).toEqual(grants[0]);
  });

  it('keeps standalone navigation synchronous and grants only one hull per simulation tick', () => {
    const first = vessel('first'), second = vessel('second');
    expect(tryAdmitShipPlan(first)).toBe(true);
    beginShipPlanningFrame([first, second], 10);
    expect(tryAdmitShipPlan(first)).toBe(true);
    expect(tryAdmitShipPlan(second)).toBe(false);
    expect(tryAdmitShipPlan(first)).toBe(true);
    expect(second.sailing).toMatchObject({ planningRequestedAtTick: 10, planningLastRequestedAtTick: 10 });
    expect(first.sailing!.planningRequestedAtTick).toBeUndefined();
    beginShipPlanningFrame([first, second], 11);
    expect(tryAdmitShipPlan(first)).toBe(false);
    expect(tryAdmitShipPlan(second)).toBe(true);
  });

  it('serves oldest requests regardless of iteration order, with code-unit ID ties', () => {
    const oldest = vessel('oldest'), z = vessel('Z'), umlaut = vessel('Å'), fresh = vessel('fresh');
    ticket(oldest, 6, 9); ticket(z, 8, 9); ticket(umlaut, 8, 9);
    beginShipPlanningFrame([fresh, umlaut, z, oldest], 10);
    expect(tryAdmitShipPlan(fresh)).toBe(false);
    expect(tryAdmitShipPlan(umlaut)).toBe(false);
    expect(tryAdmitShipPlan(z)).toBe(false);
    expect(tryAdmitShipPlan(oldest)).toBe(true);
    beginShipPlanningFrame([umlaut, fresh, oldest, z], 11);
    expect(tryAdmitShipPlan(umlaut)).toBe(false);
    expect(tryAdmitShipPlan(z)).toBe(true);
    expect(umlaut.sailing!.planningRequestedAtTick).toBe(8);
  });

  it('prevents a continuously requesting hull from starving deferred hulls', () => {
    const units = [vessel('a'), vessel('b'), vessel('c')], grants: string[] = [];
    for (let tick = 0; tick < 9; tick++) {
      beginShipPlanningFrame(units, tick);
      for (const ship of units) if (tryAdmitShipPlan(ship)) grants.push(ship.id);
    }
    expect(grants).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('queues distant manual aim and flame casts as movement work', () => {
    const first = vessel('first'), casting = vessel('casting', 'fireShip'), aiming = vessel('aiming', 'cutter');
    casting.order = { type: 'cast', ability: 'incendiaryFlume', x: 6000, y: 5000 };
    aiming.order = { type: 'aim', x: 6000, y: 5000 };
    const units = [first, casting, aiming];
    beginShipPlanningFrame(units, 10);
    expect(tryAdmitShipPlan(first)).toBe(true);
    expect(tryAdmitShipPlan(casting)).toBe(false);
    expect(tryAdmitShipPlan(aiming)).toBe(false);
    expect(casting.sailing!.planningRequestedAtTick).toBe(10);
    beginShipPlanningFrame(units, 11);
    // Both have the same age, so the code-unit ID tie is independent of
    // whether casting or aiming is processed first on this tick.
    expect(tryAdmitShipPlan(casting)).toBe(false);
    expect(tryAdmitShipPlan(aiming)).toBe(true);
    beginShipPlanningFrame(units, 12);
    expect(tryAdmitShipPlan(casting)).toBe(true);
  });

  it('removes dead and canceled requests, and gives a fresh command a fresh age', () => {
    const canceled = vessel('canceled'), dead = vessel('dead'), waiting = vessel('waiting');
    ticket(canceled, 2, 9); ticket(dead, 1, 9); ticket(waiting, 8, 9);
    canceled.order = { type: 'hold', x: canceled.x, y: canceled.y }; dead.hp = 0;
    beginShipPlanningFrame([canceled, dead, waiting], 10);
    expect(canceled.sailing!.planningRequestedAtTick).toBeUndefined();
    expect(dead.sailing!.planningRequestedAtTick).toBeUndefined();
    canceled.order = { type: 'move', x: 8000, y: 9000 };
    expect(tryAdmitShipPlan(canceled)).toBe(false);
    expect(canceled.sailing!.planningRequestedAtTick).toBe(10);
    expect(tryAdmitShipPlan(dead)).toBe(false);
    expect(tryAdmitShipPlan(waiting)).toBe(true);
  });

  it('expires an active attack which no longer requests planning within one intervening tick', () => {
    const attack = vessel('attack'), moving = vessel('moving');
    attack.order = { type: 'attack', targetId: 'building-target' };
    ticket(attack, 5, 9);
    beginShipPlanningFrame([attack, moving], 10);
    expect(tryAdmitShipPlan(moving)).toBe(false);
    beginShipPlanningFrame([attack, moving], 11);
    expect(attack.sailing!.planningRequestedAtTick).toBeUndefined();
    expect(attack.sailing!.planningLastRequestedAtTick).toBeUndefined();
    expect(tryAdmitShipPlan(moving)).toBe(true);
  });

  it('rechecks cancellations during the tick without recycling a consumed allowance', () => {
    const a = vessel('a'), b = vessel('b'), c = vessel('c');
    ticket(a, 1, 9); ticket(b, 2, 9);
    beginShipPlanningFrame([a, b, c], 10);
    a.order = { type: 'idle' };
    expect(tryAdmitShipPlan(b)).toBe(true);
    expect(a.sailing!.planningRequestedAtTick).toBeUndefined();
    b.hp = 0;
    expect(tryAdmitShipPlan(c)).toBe(false);
  });

  it('preserves idle guard movement while discarding a dead guard target and hold orders', () => {
    const ship = vessel('guard'), target = vessel('target'); ship.order = { type: 'idle' };
    ship.sailing!.defense = { originX: 1000, originY: 1000, targetId: target.id };
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(true);
    target.hp = 0;
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(false);
    ship.sailing!.defense.returning = true;
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(true);
    ticket(ship, 4, 9); beginShipPlanningFrame([ship, target], 10);
    expect(ship.sailing!.planningRequestedAtTick).toBe(4);
    ship.order = { type: 'hold', x: 1000, y: 1000 };
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(false);
    beginShipPlanningFrame([ship, target], 11);
    expect(ship.sailing!.planningRequestedAtTick).toBeUndefined();
  });

  it('preserves an idle shore pickup only for a living friendly crew member still ashore', () => {
    const ship = vessel('ferry'), passenger = crew(ship); ship.order = { type: 'idle' };
    expect(hasShipPlanningWork(ship, [ship, passenger])).toBe(true);
    ticket(ship, 4, 9); beginShipPlanningFrame([ship, passenger], 10);
    expect(ship.sailing!.planningRequestedAtTick).toBe(4);
    passenger.deck = { shipId: 'other', x: 0, y: 0 };
    expect(hasShipPlanningWork(ship, [ship, passenger])).toBe(false);
    passenger.deck = undefined; passenger.cabin = { shipId: 'other' };
    expect(hasShipPlanningWork(ship, [ship, passenger])).toBe(false);
    passenger.cabin = undefined; passenger.owner = 'enemy';
    expect(hasShipPlanningWork(ship, [ship, passenger])).toBe(false);
    passenger.owner = 'player'; passenger.hp = 0;
    expect(hasShipPlanningWork(ship, [ship, passenger])).toBe(false);
    beginShipPlanningFrame([ship, passenger], 11);
    expect(ship.sailing!.planningRequestedAtTick).toBeUndefined();
  });

  it('keeps an active gangway approach, but drops deployed, canceled or dead-target work', () => {
    const ship = vessel('boarding'), target = vessel('target');
    ship.order = { type: 'boardShip', targetId: target.id };
    ship.sailing!.gangway = { targetId: target.id, phase: 'approach', sourceAnchor: {x:0,y:0},
      targetAnchor: {x:0,y:0}, width: 48, initialSpan: 0, initialHeadingDelta: 0, hp: 60,
      readyAtTick: 0, cooldownUntilTick: 0 };
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(true);
    ticket(ship, 4, 9); beginShipPlanningFrame([ship, target], 10);
    expect(ship.sailing!.planningRequestedAtTick).toBe(4);
    ship.sailing!.gangway.phase = 'ready';
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(false);
    ship.sailing!.gangway.phase = 'approach'; target.hp = 0;
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(false);
    target.hp = target.maxHp; ship.order = { type: 'idle' };
    expect(hasShipPlanningWork(ship, [ship, target])).toBe(false);
  });

  it('rebuilds the same FIFO solely from JSON state and isolates independent games with the same IDs', () => {
    const original = [vessel('a'), vessel('b'), vessel('c')];
    ticket(original[0]!, 3, 9); ticket(original[1]!, 2, 9); ticket(original[2]!, 1, 9);
    const restored = JSON.parse(JSON.stringify(original)) as Unit[];
    const sequences: string[][] = [[], []];
    for (let tick = 10; tick < 16; tick++) {
      beginShipPlanningFrame(original, tick); beginShipPlanningFrame(restored, tick);
      for (let index = 0; index < original.length; index++) {
        if (tryAdmitShipPlan(original[index]!)) sequences[0]!.push(original[index]!.id);
        if (tryAdmitShipPlan(restored[index]!)) sequences[1]!.push(restored[index]!.id);
      }
      expect(restored).toEqual(JSON.parse(JSON.stringify(original)));
    }
    expect(sequences[0]).toEqual(['c', 'b', 'a', 'c', 'b', 'a']);
    expect(sequences[1]).toEqual(sequences[0]);
  });
});
