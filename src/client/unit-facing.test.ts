import { describe, expect, it } from "vitest";
import type { GameSnapshot, Unit, UnitOrder } from "../shared/types";
import { FACING_TURN_DISTANCE, UnitFacingTracker, nextFacing, type FacingState } from "./unit-facing";

const idle: UnitOrder = { type: "idle" };
const at = (x: number, order: UnitOrder = idle) => ({ x, order });

function walk(xs: number[], start?: FacingState) {
  let state = start;
  const facings: number[] = [];
  for (const x of xs) {
    state = nextFacing(state, at(x), undefined);
    facings.push(state.facing);
  }
  return facings;
}

describe("unit facing", () => {
  it("starts facing the way the model is painted", () => {
    expect(nextFacing(undefined, at(100), undefined).facing).toBe(1);
  });

  it("turns left once it has walked left past the turn distance, and back right the same way", () => {
    const step = FACING_TURN_DISTANCE;
    expect(walk([100, 100 - step / 2, 100 - step])).toEqual([1, 1, -1]);
    expect(walk([100, 100 - step, 100 - step / 2, 100])).toEqual([1, -1, -1, 1]);
  });

  it("does not flicker when shoved back and forth by less than the turn distance", () => {
    const jitter = FACING_TURN_DISTANCE * 0.4;
    const xs = [100, 100 - jitter, 100 + jitter, 100 - jitter, 100 + jitter, 100 - jitter];
    expect(new Set(walk(xs))).toEqual(new Set([1]));
  });

  it("keeps its facing when it stops", () => {
    const step = FACING_TURN_DISTANCE;
    expect(walk([100, 100 - step * 2, 100 - step * 2, 100 - step * 2])).toEqual([1, -1, -1, -1]);
  });

  it('reuses unchanged immutable history while preserving old values across turns and new anchors', () => {
    const right: FacingState = Object.freeze({ facing: 1, anchorX: 100 });
    const left: FacingState = Object.freeze({ facing: -1, anchorX: 100 });
    expect(nextFacing(right, at(100), undefined)).toBe(right);
    expect(nextFacing(right, at(99), undefined)).toBe(right);
    expect(nextFacing(right, at(100), { x: 200, y: 0 })).toBe(right);
    expect(nextFacing(left, at(100), undefined)).toBe(left);
    expect(nextFacing(left, at(101), undefined)).toBe(left);
    expect(nextFacing(left, at(100), { x: 0, y: 0 })).toBe(left);
    const advanced = nextFacing(right, at(110), undefined);
    expect(advanced).toEqual({ facing: 1, anchorX: 110 });
    expect(advanced).not.toBe(right);
    const turned = nextFacing(right, at(100), { x: 0, y: 0 });
    expect(turned).toEqual({ facing: -1, anchorX: 100 });
    expect(turned).not.toBe(right);
    expect(right).toEqual({ facing: 1, anchorX: 100 });
  });

  it("measures the turn from the furthest point reached, so a small drift back after a long walk does not turn it", () => {
    const step = FACING_TURN_DISTANCE;
    expect(walk([100, 100 + step * 10, 100 + step * 10 - step * 0.5])).toEqual([1, 1, 1]);
  });

  it("faces the enemy it is attacking even while standing still", () => {
    const attack: UnitOrder = { type: "attack", targetId: "enemy" };
    const walkingRight = nextFacing(undefined, at(100), undefined);
    expect(nextFacing(walkingRight, at(100, attack), { x: 100 - FACING_TURN_DISTANCE * 10, y: 0 }).facing).toBe(-1);
    const attackMove: UnitOrder = { type: "attackMove", x: 0, y: 0, targetId: "enemy" };
    expect(nextFacing({ facing: -1, anchorX: 100 }, at(100, attackMove), { x: 100 + FACING_TURN_DISTANCE * 10, y: 0 }).facing).toBe(1);
  });

  it("faces the unit it charges, whichever way it was facing before the dash", () => {
    const charge: UnitOrder = { type: "charge", targetId: "enemy", resume: { type: "attack", targetId: "enemy" } };
    const tracker = new UnitFacingTracker();
    const rider = { id: "rider", x: 400, y: 0, order: charge } as Unit;
    tracker.update([rider], (id) => (id === "enemy" ? { x: 100, y: 0 } : undefined));
    expect(tracker.facing("rider")).toBe(-1);
  });

  it("faces a construction site, mechanical unit or older ship repair target", () => {
    const tracker = new UnitFacingTracker();
    for (const order of [{type:'repair', buildingId:'target'}, {type:'repairUnit', targetId:'target'}, {type:'repairShip', targetId:'target'}] as UnitOrder[]) {
      const worker = {id:'worker', x:400, y:100, order} as Unit;
      tracker.update([worker], id => id === 'target' ? {x:100,y:100} : undefined);
      expect(tracker.facing(worker.id)).toBe(-1);
    }
  });

  it("remembers facing per unit between frames and forgets units that are gone", () => {
    const tracker = new UnitFacingTracker();
    const unit = (id: string, x: number) => ({ id, x, y: 0, order: idle }) as Unit;
    tracker.update([unit("a", 100), unit("b", 100)], () => undefined);
    tracker.update([unit("a", 100 - FACING_TURN_DISTANCE * 2), unit("b", 100 + FACING_TURN_DISTANCE * 2)], () => undefined);
    expect(tracker.facing("a")).toBe(-1);
    expect(tracker.facing("b")).toBe(1);
    tracker.update([unit("b", 100)], () => undefined);
    expect(tracker.facing("a")).toBe(1);
  });
});

describe('release-facing lock',()=>{
  const unit=(order:UnitOrder={type:'idle'})=>({id:'actor',x:100,y:100,order} as Unit);
  it('keeps the last counterattack side between strikes while holding position',()=>{
    const tracker=new UnitFacingTracker(),actor=unit({type:'hold',x:100,y:100});
    tracker.update([actor],()=>undefined);
    expect(tracker.facing(actor.id)).toBe(1);
    for(let strike=0;strike<3;strike++){
      const direction={x:-40,y:0};
      expect(tracker.actionFacing(actor.id,direction)).toBe(-1);
      for(let frame=0;frame<6;frame++){
        tracker.update([actor],()=>undefined);
        expect(tracker.actionFacing(actor.id,direction)).toBe(-1);
      }
      tracker.update([actor],()=>undefined);
      expect(tracker.actionFacing(actor.id,undefined)).toBe(-1);
      expect(tracker.facing(actor.id)).toBe(-1);
    }
    tracker.update([{...actor,x:110}],()=>undefined);
    expect(tracker.actionFacing(actor.id,undefined)).toBe(1);
  });
  it('keeps vertical recovery facing when a new order or jitter points sideways',()=>{
    const tracker=new UnitFacingTracker();tracker.update([unit()],()=>undefined);
    const direction={x:0,y:-200};expect(tracker.actionFacing('actor',direction)).toBe(1);
    tracker.update([unit({type:'attack',targetId:'behind'})],()=>({x:0,y:100}));
    expect(tracker.facing('actor')).toBe(-1);expect(tracker.actionFacing('actor',direction)).toBe(1);
    expect(tracker.releaseFacing('actor')).toBe(1);
    expect(tracker.actionFacing('actor',undefined)).toBe(-1);expect(tracker.releaseFacing('actor')).toBe(-1);
  });
  it('uses projected direction and a relative vertical deadzone',()=>{
    const tracker=new UnitFacingTracker();tracker.update([unit()],()=>undefined);
    expect(tracker.actionFacing('actor',{x:1,y:200})).toBe(1);
    expect(tracker.actionFacing('actor',{x:100,y:0},p=>({x:-p.x,y:p.y}))).toBe(-1);
    expect(nextFacing({facing:-1,anchorX:100},{x:100,y:100,order:{type:'idle'}},{x:104,y:-200}).facing).toBe(-1);
  });
});

describe('snapshot facing history', () => {
  const actor = (order: UnitOrder = { type: 'attack', targetId: 'target' }, x = 100) => ({ id: 'actor', x, y: 100, order }) as Unit;
  const snapshot = (tick: number, ...units: Unit[]): Pick<GameSnapshot, 'tick' | 'units' | 'buildings'> => ({ tick, units, buildings: [] });

  it('looks up targets once across repeated frames and retains successive release turns', () => {
    const tracker = new UnitFacingTracker(), game = snapshot(10, actor());
    let lookups = 0;
    const locate = () => { lookups++; return { x: 0, y: 100 }; };
    tracker.updateSnapshot(game, locate);
    expect(tracker.facing('actor')).toBe(-1);
    for (let frame = 0; frame < 10; frame++) tracker.updateSnapshot(game, locate);
    expect(lookups).toBe(1);

    expect(tracker.actionFacing('actor', { x: 40, y: 0 })).toBe(1);
    tracker.updateSnapshot(game, locate);
    expect(tracker.facing('actor')).toBe(1);
    expect(tracker.actionFacing('actor', { x: -40, y: 0 })).toBe(-1);
    tracker.updateSnapshot(game, locate);
    expect(tracker.actionFacing('actor', undefined)).toBe(-1);
    expect(lookups).toBe(1);
  });

  it('accepts a command snapshot at the same tick', () => {
    const tracker = new UnitFacingTracker(), first = snapshot(10, actor());
    tracker.updateSnapshot(first, () => ({ x: 200, y: 100 }));
    const command = { ...first, units: [actor({ type: 'attack', targetId: 'behind' })] };
    tracker.updateSnapshot(command, () => ({ x: 0, y: 100 }));
    expect(tracker.facing('actor')).toBe(-1);
  });

  it('accepts mutable recording ticks, rewinds, changed arrays and collection sizes', () => {
    const tracker = new UnitFacingTracker(), game = snapshot(10, actor());
    let targetX = 200, lookups = 0;
    const locate = () => { lookups++; return { x: targetX, y: 100 }; };
    tracker.updateSnapshot(game, locate);
    game.tick++;
    targetX = 0;
    tracker.updateSnapshot(game, locate);
    expect(tracker.facing('actor')).toBe(-1);
    game.tick = 0;
    targetX = 200;
    tracker.updateSnapshot(game, locate);
    expect(tracker.facing('actor')).toBe(1);

    game.units = [actor()];
    tracker.updateSnapshot(game, locate);
    game.buildings = [];
    tracker.updateSnapshot(game, locate);
    game.buildings.push({ id: 'target' } as GameSnapshot['buildings'][number]);
    tracker.updateSnapshot(game, locate);
    expect(lookups).toBe(6);

    tracker.actionFacing('actor', { x: -40, y: 0 });
    game.units.length = 0;
    tracker.updateSnapshot(game, locate);
    expect(tracker.facing('actor')).toBe(1);
    expect(tracker.releaseFacing('actor')).toBe(1);
  });

  it('keeps direct update uncached and invalidates a previously accepted snapshot', () => {
    const tracker = new UnitFacingTracker(), game = snapshot(10, actor());
    tracker.updateSnapshot(game, () => ({ x: 0, y: 100 }));
    tracker.update(game.units, () => ({ x: 200, y: 100 }));
    expect(tracker.facing('actor')).toBe(1);
    tracker.update(game.units, () => ({ x: 0, y: 100 }));
    expect(tracker.facing('actor')).toBe(-1);
    tracker.updateSnapshot(game, () => ({ x: 200, y: 100 }));
    expect(tracker.facing('actor')).toBe(1);
  });

  it('retains the pre-snapshot side for a vertical release after the target turns', () => {
    const tracker = new UnitFacingTracker();
    tracker.updateSnapshot(snapshot(10, actor()), () => ({ x: 0, y: 100 }));
    const game = snapshot(11, actor());
    tracker.updateSnapshot(game, () => ({ x: 200, y: 100 }));
    tracker.updateSnapshot(game, () => ({ x: 200, y: 100 }));
    expect(tracker.facing('actor')).toBe(1);
    expect(tracker.actionFacing('actor', { x: 0, y: -200 })).toBe(-1);
  });

  it('keeps pre-update history intact when a release turns a reused stationary state', () => {
    const tracker = new UnitFacingTracker();
    tracker.update([actor()], () => ({ x: 0, y: 100 }));
    tracker.update([actor()], () => ({ x: 0, y: 100 }));
    expect(tracker.actionFacing('actor', { x: 40, y: 0 })).toBe(1);
    expect(tracker.actionFacing('actor', undefined)).toBe(1);
    expect(tracker.actionFacing('actor', { x: 0, y: -200 })).toBe(-1);
  });

  it('keeps an offscreen counterattack side through recovery and subsequent return', () => {
    const tracker = new UnitFacingTracker(), distant = actor({ type: 'hold', x: 10000, y: 100 }, 10000);
    tracker.updateSnapshot(snapshot(10, distant), () => undefined);
    const release = { x: -40, y: 0 };
    expect(tracker.actionFacing(distant.id, release)).toBe(-1);
    for (let tick = 11; tick <= 15; tick++) {
      tracker.updateSnapshot(snapshot(tick, distant), () => undefined);
      expect(tracker.actionFacing(distant.id, release)).toBe(-1);
    }
    expect(tracker.actionFacing(distant.id, undefined)).toBe(-1);
    tracker.updateSnapshot(snapshot(16, distant), () => undefined);
    expect(tracker.facing(distant.id)).toBe(-1);
    tracker.updateSnapshot(snapshot(17, { ...distant, x: 10004 }), () => undefined);
    expect(tracker.facing(distant.id)).toBe(1);
  });
});
