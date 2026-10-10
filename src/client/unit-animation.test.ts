import { describe, expect, it } from "vitest";
import { IDLE_FRAME, UnitAnimationTracker } from "./unit-animation";
import { createGame, issuePlayerCommand, stepGame } from "../shared/sim";
import { seconds } from "../shared/time";
import type { Unit, WorldEffect } from "../shared/types";

const soldier = (overrides: Partial<Unit> = {}): Unit => ({
  id: "soldier", owner: "player", kind: "footman", x: 100, y: 100,
  hp: 100, maxHp: 100, speed: 80, attackDamage: 10, attackRange: 30,
  attackCooldown: 20, cooldown: 0, radius: 12, carryingGold: 0,
  kills: 0, xp: 0, level: 0, effects: [], order: { type: "idle" }, ...overrides,
});
const snap = (tick: number, ...units: Unit[]) => ({ tick, units });
const work = (worker: Unit, remaining = 13): WorldEffect => ({
  id: 'stroke', type: 'repair', unitId: worker.id, x: worker.x, y: worker.y,
  duration: 13, remaining,
});

describe("unit pose history", () => {
  it("keeps carried crew idle while their ship translates and turns, but animates real deck walking",()=>{
    const tracker=new UnitAnimationTracker(),unit=soldier({deck:{shipId:'boat',x:18,y:-5}});
    tracker.update(snap(1,unit),0);
    unit.x+=3;unit.y+=2;tracker.update(snap(2,unit),50);
    expect(tracker.frame(unit,75)).toEqual(IDLE_FRAME);
    unit.x+=2;unit.y-=1;tracker.update(snap(3,unit),100);
    expect(tracker.frame(unit,125)).toEqual(IDLE_FRAME);
    unit.deck!.x+=2;tracker.update(snap(4,unit),150);
    expect(tracker.frame(unit,175).mode).toBe('walk');
  });

  it("animates observed movement, not blocked move/attack orders", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ order: { type: "attack", targetId: "foe" } });
    tracker.update(snap(1, unit), 0);
    tracker.update(snap(2, unit), 50);
    expect(tracker.frame(unit, 75)).toEqual(IDLE_FRAME);
    const moved = soldier({ x: 104, order: unit.order });
    tracker.update(snap(3, moved), 100);
    expect(tracker.frame(moved, 125).mode).toBe("walk");
    tracker.update(snap(4, moved), 150);
    expect(tracker.frame(moved, 175)).toEqual(IDLE_FRAME);
  });

  it("starts a strike on a weapon cooldown rise, including hold-position fire, and does not restart it", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ order: { type: "hold", x: 100, y: 100 } });
    tracker.update(snap(0, unit), 0);
    const struck = soldier({ ...unit, cooldown: 20 });
    tracker.update(snap(1, struck), 50);
    expect(tracker.frame(struck, 50)).toEqual({ mode: "attack", frame: 0 });
    tracker.update(snap(1, struck), 75);
    expect(tracker.frame(struck, 90).mode).toBe("attack");
    tracker.update(snap(4, soldier({ ...unit, cooldown: 17 })), 200);
    expect(tracker.frame(unit, 200)).toEqual({ mode: "attack", frame: 3 });
    tracker.update(snap(8, soldier({ ...unit, cooldown: 13 })), 400);
    expect(tracker.frame(unit, 400)).toEqual(IDLE_FRAME);
  });

  it("separates spell cooldowns from weapon fire and prioritizes a simultaneous cast", () => {
    const tracker = new UnitAnimationTracker();
    const priest = soldier({ kind: "priest" });
    tracker.update(snap(1, priest), 0);
    const cast = soldier({ ...priest, cooldown: 20, abilityCooldowns: { heal: 240 } });
    tracker.update(snap(2, cast), 50);
    expect(tracker.frame(cast, 50).mode).toBe("cast");
    tracker.update(snap(5, soldier({ ...cast, cooldown: 17, abilityCooldowns: { heal: 237 } })), 200);
    expect(tracker.frame(cast, 200)).toEqual({ mode: "cast", frame: 1 });
  });

  it("does not treat repair or charge cooldowns as spell/weapon animations", () => {
    const tracker = new UnitAnimationTracker();
    const worker = soldier({ kind: "worker", order: { type: "repair", buildingId: "hall" } });
    const knight = soldier({ id: "knight", kind: "knight" });
    tracker.update(snap(0, worker, knight), 0);
    tracker.update(snap(1, { ...worker, cooldown: 12 }, { ...knight, abilityCooldowns: { charge: 100 } }), 50);
    expect(tracker.frame(worker, 60)).toEqual(IDLE_FRAME);
    expect(tracker.frame(knight, 60)).toEqual(IDLE_FRAME);
  });

  it.each(["repairUnit", "repairShip"] as const)("shows %s as work only when a repair pulse occurs", type => {
    const tracker = new UnitAnimationTracker();
    const worker = soldier({ kind: "worker", order: { type, targetId: "machine" } });
    tracker.update(snap(0, worker), 0);
    const repairing = { ...worker, cooldown: 12 };
    tracker.update(snap(1, repairing), 50);
    expect(tracker.frame(repairing, 60)).toEqual(IDLE_FRAME);
    tracker.update({ ...snap(2, repairing), effects: [work(repairing)] }, 100);
    expect(tracker.frame(repairing, 110).mode).toBe("work");
  });

  it("plays a real work stroke, preserves its age and freezes with the simulation", () => {
    const tracker = new UnitAnimationTracker();
    const worker = soldier({ kind: 'worker', order: {type:'repair', buildingId:'hall'} });
    tracker.update({...snap(10, worker), effects:[work(worker)]}, 0);
    expect(tracker.frame(worker, 0)).toEqual({mode:'work', frame:0});
    tracker.update({...snap(16, worker), effects:[work(worker, 7)]}, 300);
    expect(tracker.frame(worker, 300)).toEqual({mode:'work', frame:2});
    expect(tracker.frame(worker, 350)).toEqual(tracker.frame(worker, 10_000));
    tracker.update({...snap(24, worker), effects:[]}, 700);
    expect(tracker.frame(worker, 700)).toEqual(IDLE_FRAME);
  });

  it("shows real mining work throughout a gather cycle and walks home with the gold", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find(unit => unit.owner === "player" && unit.kind === "worker")!;
    const mine = game.resources.find(resource => resource.id === "gold-player-main")!;
    game.units = [worker];
    game.scriptedVictory = true;
    issuePlayerCommand(game, "player", { type: "mine", resourceId: mine.id, unitIds: [worker.id] });
    const tracker = new UnitAnimationTracker(), frames = new Set<number>();
    let hauling = false, gathering = 0;
    tracker.update(game, 0);
    for (let tick = 0; tick < seconds(15); tick++) {
      const before = { ...worker.order }, x = worker.x, y = worker.y;
      stepGame(game);
      tracker.update(game, game.tick * 50);
      const frame = tracker.frame(worker, game.tick * 50);
      if (worker.order.type === "mine" && worker.order.phase === "gather"
        && before.type === "mine" && before.phase === "gather" && worker.order.timer < before.timer) {
        expect(frame.mode).toBe("work");
        frames.add(frame.frame); gathering++;
      }
      if (worker.order.type === "mine" && worker.order.phase === "toMine") expect(frame.mode).not.toBe("work");
      if (worker.order.type === "mine" && worker.order.phase === "return") {
        expect(frame.mode).not.toBe("work");
        if (Math.hypot(worker.x - x, worker.y - y) > .25) {
          expect(frame.mode).toBe("walk"); hauling = true;
        }
      }
    }
    expect(gathering).toBeGreaterThan(50);
    expect([...frames].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(hauling).toBe(true);
    expect(game.players.player!.gold).toBeGreaterThan(0);
  });

  it("never mistakes mine-entry queues or held timers for work, and freezes the last mining pose", () => {
    const tracker = new UnitAnimationTracker();
    const worker = soldier({ kind: "worker", order: { type: "mine", resourceId: "gold", phase: "toMine", timer: 1 } });
    tracker.update(snap(0, worker), 0);
    worker.order = { type: "mine", resourceId: "gold", phase: "toMine", timer: 2 };
    tracker.update({ ...snap(1, worker), effects: [work(worker)] }, 50);
    expect(tracker.frame(worker, 50)).toEqual(IDLE_FRAME);
    worker.order = { type: "mine", resourceId: "gold", phase: "gather", timer: 64 };
    tracker.update(snap(2, worker), 100);
    expect(tracker.frame(worker, 100)).toEqual(IDLE_FRAME);
    for (let tick = 3; tick <= 14; tick++) {
      worker.order.timer--;
      tracker.update(snap(tick, worker), tick * 50);
    }
    expect(tracker.frame(worker, 750)).toEqual({ mode: "work", frame: 5 });
    expect(tracker.frame(worker, 750)).toEqual(tracker.frame(worker, 100_000));
    tracker.update(snap(14, worker), 100_000);
    expect(tracker.frame(worker, 100_000)).toEqual({ mode: "work", frame: 5 });
    tracker.update(snap(15, worker), 100_050);
    expect(tracker.frame(worker, 100_050)).toEqual(IDLE_FRAME);
    worker.order.timer--;
    worker.effects = [{ type: "stun", remaining: 4 }];
    tracker.update(snap(16, worker), 100_100);
    expect(tracker.frame(worker, 100_100)).toEqual(IDLE_FRAME);
    worker.effects = [];
    worker.pushX = 10;
    worker.order.timer--;
    tracker.update(snap(17, worker), 100_150);
    expect(tracker.frame(worker, 100_150)).toEqual(IDLE_FRAME);
    worker.pushX = undefined;
    worker.order = { type: "mine", resourceId: "another-mine", phase: "gather", timer: 20 };
    tracker.update(snap(18, worker), 100_200);
    expect(tracker.frame(worker, 100_200)).toEqual(IDLE_FRAME);
  });

  it("animates an idle deck engineer repairing, but cancels work on walking or stun", () => {
    const tracker = new UnitAnimationTracker();
    const worker = soldier({ kind:'worker', deck:{shipId:'boat',x:0,y:0} });
    tracker.update({...snap(1, worker), effects:[work(worker)]}, 0);
    expect(tracker.frame(worker, 0).mode).toBe('work');
    const carried = {...worker, x:110, y:110};
    tracker.update({...snap(2, carried), effects:[work(carried, 12)]}, 50);
    expect(tracker.frame(carried, 50).mode).toBe('work');
    const walking = {...carried, deck:{shipId:'boat',x:3,y:0}};
    tracker.update({...snap(3, walking), effects:[work(walking, 11)]}, 100);
    expect(tracker.frame(walking, 100).mode).toBe('walk');
    const stunned = {...walking, effects:[{type:'stun' as const,remaining:4}]};
    tracker.update({...snap(4, stunned), effects:[work(stunned, 10)]}, 150);
    expect(tracker.frame(stunned, 150)).toEqual(IDLE_FRAME);
  });

  it("freezes on stalled snapshots and derives poses independently of wall-clock origin", () => {
    const a = new UnitAnimationTracker(), b = new UnitAnimationTracker();
    const unit = soldier();
    const moved = soldier({ x: 104 });
    a.update(snap(1, unit), 0); b.update(snap(1, unit), 10_000);
    a.update(snap(2, moved), 50); b.update(snap(2, moved), 10_050);
    expect(a.frame(moved, 80)).toEqual(b.frame(moved, 10_080));
    expect(a.frame(moved, 150)).toEqual(a.frame(moved, 10_000));
  });

  it("drops dead units and discards history on rewind, a long gap or teleport", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier();
    tracker.update(snap(10, unit), 0);
    tracker.update(snap(11, soldier({ cooldown: 20 })), 50);
    tracker.update(snap(0, unit), 100);
    expect(tracker.frame(unit, 100)).toEqual(IDLE_FRAME);
    tracker.update(snap(1, soldier({ x: 1000 })), 150);
    expect(tracker.frame(unit, 150)).toEqual(IDLE_FRAME);
    tracker.update(snap(20, soldier({ x: 1010, cooldown: 20 })), 200);
    expect(tracker.frame(unit, 200)).toEqual(IDLE_FRAME);
    tracker.update(snap(21), 250);
    expect(tracker.frame(unit, 250)).toEqual(IDLE_FRAME);
  });

  it("does not march during knockback or animate a stunned unit", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier();
    tracker.update(snap(0, unit), 0);
    tracker.update(snap(1, soldier({ x: 110, pushX: 10 })), 50);
    expect(tracker.frame(unit, 50)).toEqual(IDLE_FRAME);
    tracker.update(snap(2, soldier({ x: 112, cooldown: 20, effects: [{ type: "stun", remaining: 5 }] })), 100);
    expect(tracker.frame(unit, 100)).toEqual(IDLE_FRAME);
  });

  it("never mutates a simulation snapshot", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ abilityCooldowns: { heal: 15 } });
    const before = JSON.stringify(unit);
    tracker.update(snap(0, unit), 0);
    tracker.frame(unit, 30);
    expect(JSON.stringify(unit)).toBe(before);
    unit.abilityCooldowns!.heal = 240;
    tracker.update(snap(1, unit), 50);
    expect(tracker.frame(unit, 50).mode).toBe("cast");
  });
});
