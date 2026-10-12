import { describe, expect, it } from "vitest";
import { UnitAnimationTracker, releasePoseForEffect } from "./unit-animation";
import { createGame, issuePlayerCommand, stepGame, strikeUnit } from "../shared/sim";
import { UnitFacingTracker } from "./unit-facing";
import { projectActionFrame } from './art/action-direction';
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
  it('adds guard poses only to armed anatomy, keeping unarmed creature idle/gait caches unchanged',()=>{
    for(const kind of ['wildling','golem','ogreWarrior'] as const){
      const unit=soldier({kind}),tracker=new UnitAnimationTracker();
      const effect:WorldEffect={id:'hit',type:'melee',x:140,y:170,duration:16,remaining:16,sourceId:unit.id,actionMode:'attack',actionTick:0,fromX:100,fromY:100,toX:140,toY:170};
      tracker.update({...snap(0,unit),effects:[effect]},0);
      for(let tick=1;tick<=8;tick++)tracker.update({...snap(tick,unit),effects:[]},tick*50);
      expect(Boolean(tracker.frame(unit,400).carry)).toBe(kind==='ogreWarrior');
    }
  });
  it('uses the actual release tick and direction when a snapshot skips over the contact tick',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
    game.units=[];game.buildings=[];game.resources=[];game.obstacles=[];
    const actor=game.spawnUnit('player','lancer',600,600),target=game.spawnUnit('enemy','footman',566,659);
    actor.order={type:'hold',x:actor.x,y:actor.y};target.order={type:'hold',x:target.x,y:target.y};target.hp=1;
    const animation=new UnitAnimationTracker();animation.update(game,0);
    stepGame(game);stepGame(game);animation.update(game,100);
    expect(animation.frame(actor,100)).toMatchObject({mode:'attack',frame:1,carry:6,direction:{x:-34,y:59}});
    for(let tick=3;tick<=8;tick++){stepGame(game);animation.update(game,tick*50);}
    expect(animation.frame(actor,400)).toMatchObject({mode:'idle',carry:6,carryDirection:{x:-34,y:59}});
  });
  it('keeps the last attack direction while idle and walking for three seconds, then returns and expires',()=>{
    const actor=soldier(),tracker=new UnitAnimationTracker();
    const effect:WorldEffect={id:'guard-hit',type:'melee',x:140,y:170,duration:16,remaining:16,sourceId:actor.id,actionMode:'attack',actionTick:1,fromX:100,fromY:100,toX:140,toY:170};
    tracker.update({...snap(0,actor),effects:[]},0);
    tracker.update({...snap(1,actor),effects:[effect]},50);
    const update=(tick:number,dx=0)=>{actor.x+=dx;tracker.update({...snap(tick,actor),effects:[]},tick*50);return tracker.frame(actor,tick*50);};
    for(let tick=2;tick<=7;tick++)update(tick);
    expect(tracker.frame(actor,350)).toMatchObject({mode:'idle',carry:6,carryDirection:{x:40,y:70}});
    expect(update(8,-5)).toMatchObject({mode:'walk',carry:6});
    expect(tracker.frame(actor,100000).carry).toBe(6); // a stalled simulation freezes it
    for(let tick=9;tick<=67;tick++)update(tick);
    expect(tracker.frame(actor,3350).carry).toBe(6);
    for(let tick=68;tick<=72;tick++)update(tick);
    expect(tracker.frame(actor,3600).carry).toBeLessThan(6);
    for(let tick=73;tick<=77;tick++)update(tick);
    expect(tracker.frame(actor,3850).carry).toBeUndefined();
  });
  it('keeps real hold-position counterattacks facing their victim through recovery and idle',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
    game.units=[];game.buildings=[];game.resources=[];game.obstacles=[];
    const actor=game.spawnUnit('player','footman',600,600),target=game.spawnUnit('enemy','footman',560,600);
    actor.order={type:'hold',x:actor.x,y:actor.y};target.order={type:'hold',x:target.x,y:target.y};
    const animation=new UnitAnimationTracker(),facing=new UnitFacingTracker();let releases=0;
    for(let tick=0;tick<100;tick++){
      animation.update(game,tick*50);facing.update(game.units,id=>game.units.find(u=>u.id===id));
      const raw=animation.frame(actor,tick*50),side=facing.actionFacing(actor.id,raw.direction);
      if(raw.mode==='attack'&&raw.frame===0){releases++;expect(projectActionFrame(raw,side).aim??0).toBe(0);}
      if(releases)expect(side).toBe(-1);
      stepGame(game);
    }
    expect(releases).toBeGreaterThanOrEqual(3);
  });
  it("keeps carried crew idle while their ship translates and turns, but animates real deck walking",()=>{
    const tracker=new UnitAnimationTracker(),unit=soldier({deck:{shipId:'boat',x:18,y:-5}});
    tracker.update(snap(1,unit),0);
    unit.x+=3;unit.y+=2;tracker.update(snap(2,unit),50);
    expect(tracker.frame(unit,75)).toMatchObject({ mode: "idle" });
    unit.x+=2;unit.y-=1;tracker.update(snap(3,unit),100);
    expect(tracker.frame(unit,125)).toMatchObject({ mode: "idle" });
    unit.deck!.x+=2;tracker.update(snap(4,unit),150);
    expect(tracker.frame(unit,175).mode).toBe('walk');
  });

  it("animates observed movement, not blocked move/attack orders", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ order: { type: "attack", targetId: "foe" } });
    tracker.update(snap(1, unit), 0);
    tracker.update(snap(2, unit), 50);
    expect(tracker.frame(unit, 75)).toMatchObject({ mode: "idle" });
    const moved = soldier({ x: 104, order: unit.order });
    tracker.update(snap(3, moved), 100);
    expect(tracker.frame(moved, 125).mode).toBe("walk");
    tracker.update(snap(4, moved), 150);
    expect(tracker.frame(moved, 175)).toMatchObject({ mode: "idle" });
  });

  it("starts a strike on a weapon cooldown rise, including hold-position fire, and does not restart it", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ order: { type: "hold", x: 100, y: 100 } });
    tracker.update(snap(0, unit), 0);
    const struck = soldier({ ...unit, cooldown: 20 });
    tracker.update(snap(1, struck), 50);
    expect(tracker.frame(struck, 50)).toMatchObject({ mode: "attack", frame: 0 });
    tracker.update(snap(1, struck), 75);
    expect(tracker.frame(struck, 90).mode).toBe("attack");
    tracker.update(snap(4, soldier({ ...unit, cooldown: 17 })), 200);
    expect(tracker.frame(unit, 200)).toMatchObject({ mode: "attack", frame: 3 });
    tracker.update(snap(8, soldier({ ...unit, cooldown: 13 })), 400);
    expect(tracker.frame(unit, 400)).toMatchObject({ mode: "idle" });
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
    expect(tracker.frame(worker, 60)).toMatchObject({ mode: "idle" });
    expect(tracker.frame(knight, 60)).toMatchObject({ mode: "idle" });
  });

  it.each(["repairUnit", "repairShip"] as const)("shows %s as work only when a repair pulse occurs", type => {
    const tracker = new UnitAnimationTracker();
    const worker = soldier({ kind: "worker", order: { type, targetId: "machine" } });
    tracker.update(snap(0, worker), 0);
    const repairing = { ...worker, cooldown: 12 };
    tracker.update(snap(1, repairing), 50);
    expect(tracker.frame(repairing, 60)).toMatchObject({ mode: "idle" });
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
    expect(tracker.frame(worker, 700)).toMatchObject({ mode: "idle" });
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
    expect(tracker.frame(worker, 50)).toMatchObject({ mode: "idle" });
    worker.order = { type: "mine", resourceId: "gold", phase: "gather", timer: 64 };
    tracker.update(snap(2, worker), 100);
    expect(tracker.frame(worker, 100)).toMatchObject({ mode: "idle" });
    for (let tick = 3; tick <= 14; tick++) {
      worker.order.timer--;
      tracker.update(snap(tick, worker), tick * 50);
    }
    expect(tracker.frame(worker, 750)).toEqual({ mode: "work", frame: 5 });
    expect(tracker.frame(worker, 750)).toEqual(tracker.frame(worker, 100_000));
    tracker.update(snap(14, worker), 100_000);
    expect(tracker.frame(worker, 100_000)).toEqual({ mode: "work", frame: 5 });
    tracker.update(snap(15, worker), 100_050);
    expect(tracker.frame(worker, 100_050)).toMatchObject({ mode: "idle" });
    worker.order.timer--;
    worker.effects = [{ type: "stun", remaining: 4 }];
    tracker.update(snap(16, worker), 100_100);
    expect(tracker.frame(worker, 100_100)).toMatchObject({ mode: "idle" });
    worker.effects = [];
    worker.pushX = 10;
    worker.order.timer--;
    tracker.update(snap(17, worker), 100_150);
    expect(tracker.frame(worker, 100_150)).toMatchObject({ mode: "idle" });
    worker.pushX = undefined;
    worker.order = { type: "mine", resourceId: "another-mine", phase: "gather", timer: 20 };
    tracker.update(snap(18, worker), 100_200);
    expect(tracker.frame(worker, 100_200)).toMatchObject({ mode: "idle" });
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
    expect(tracker.frame(stunned, 150)).toMatchObject({ mode: "idle" });
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
    expect(tracker.frame(unit, 100)).toMatchObject({ mode: "idle" });
    tracker.update(snap(1, soldier({ x: 1000 })), 150);
    expect(tracker.frame(unit, 150)).toMatchObject({ mode: "idle" });
    tracker.update(snap(20, soldier({ x: 1010, cooldown: 20 })), 200);
    expect(tracker.frame(unit, 200)).toMatchObject({ mode: "idle" });
    tracker.update(snap(21), 250);
    expect(tracker.frame(unit, 250)).toMatchObject({ mode: "idle" });
  });

  it("does not march during knockback or animate a stunned unit", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier();
    tracker.update(snap(0, unit), 0);
    tracker.update(snap(1, soldier({ x: 110, pushX: 10 })), 50);
    expect(tracker.frame(unit, 50)).toMatchObject({ mode: "idle" });
    tracker.update(snap(2, soldier({ x: 112, cooldown: 20, effects: [{ type: "stun", remaining: 5 }] })), 100);
    expect(tracker.frame(unit, 100)).toMatchObject({ mode: "idle" });
  });

  it("selects reproducible attack variants independently of wall clock and idle sampling", () => {
    const a = new UnitAnimationTracker(), b = new UnitAnimationTracker();
    const unit = soldier(), variants = new Set<number>();
    for (let tick = 0; tick < 60; tick++) {
      const next = { ...unit, cooldown: tick % 2 ? 20 : 0 };
      a.update(snap(tick, next), tick * 50);
      b.update(snap(tick, next), 10_000 + tick * 50);
      // Extra renders cannot consume a simulation or presentation RNG stream.
      a.frame(next, tick * 50 + 20);
      if (tick % 2) {
        const pose = a.frame(next, tick * 50);
        expect(pose).toEqual(b.frame(next, 10_000 + tick * 50));
        expect(pose.frame).toBe(0);
        variants.add(pose.variant!);
      }
    }
    expect([...variants].sort()).toEqual([0, 1, 2]);
  });

  it("breathes through eight snapshot-driven idle poses and freezes during pause", () => {
    const tracker = new UnitAnimationTracker(), unit = soldier(), frames = new Set<number>();
    for (let tick = 0; tick < 60; tick++) {
      tracker.update(snap(tick, unit), tick * 50);
      const pose = tracker.frame(unit, tick * 50);
      expect(pose.mode).toBe("idle");
      frames.add(pose.frame);
      expect(pose).toBe(tracker.frame(unit, tick * 50));
    }
    expect([...frames].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(tracker.frame(unit, 3050)).toEqual(tracker.frame(unit, 100_000));
  });

  it("keeps feet still under vertical-only knockback", () => {
    const tracker = new UnitAnimationTracker(), unit = soldier();
    tracker.update(snap(0, unit), 0);
    tracker.update(snap(1, { ...unit, y: 110, pushY: 10 }), 50);
    expect(tracker.frame(unit, 50)).toEqual({ mode: "idle", frame: 0 });
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

describe('explicit story action cues', () => {
  it('accepts a same-tick release and ages duplicate or late-observed cues without replaying them', () => {
    const tracker = new UnitAnimationTracker(), unit = soldier();
    const cues = [{ unitId: unit.id, mode: 'cast' as const, tick: 10 }];
    tracker.update(snap(10, unit), 100);
    tracker.update(snap(10, unit), 110, cues);
    expect(tracker.frame(unit, 110)).toEqual({ mode: 'cast', frame: 0 });
    tracker.update(snap(13, unit), 250, cues);
    expect(tracker.frame(unit, 250)).toEqual({ mode: 'cast', frame: 1 });
    tracker.update(snap(13, unit), 10000, cues);
    expect(tracker.frame(unit, 10000)).toEqual({ mode: 'cast', frame: 2 });
    expect(tracker.frame(unit, 20000)).toEqual(tracker.frame(unit, 10000));
    const fresh = new UnitAnimationTracker();
    fresh.update(snap(13, unit), 0, cues);
    expect(fresh.frame(unit, 0)).toEqual({ mode: 'cast', frame: 1 });
    tracker.update(snap(21, unit), 10010, cues);
    expect(tracker.frame(unit, 10010).mode).toBe('idle');
  });

  it('ignores invalid releases and consumes stunned releases so they do not play after recovery', () => {
    const tracker = new UnitAnimationTracker(), unit = soldier();
    tracker.update(snap(30, unit), 0, [
      { unitId: unit.id, mode: 'cast', tick: 0 },
      { unitId: unit.id, mode: 'cast', tick: 31 },
      { unitId: 'absent', mode: 'cast', tick: 30 },
    ]);
    expect(tracker.frame(unit, 0).mode).toBe('idle');
    const cues = [{ unitId: unit.id, mode: 'cast' as const, tick: 31 }];
    tracker.update(snap(31, soldier({ effects: [{ type: 'stun', remaining: 1 }] })), 50, cues);
    expect(tracker.frame(unit, 50).mode).toBe('idle');
    tracker.update(snap(32, unit), 100, cues);
    expect(tracker.frame(unit, 100).mode).toBe('idle');
  });
});

describe('release-locked action direction',()=>{
  const release=(overrides:Partial<WorldEffect>={}):WorldEffect=>({id:'release',type:'melee',x:200,y:50,fromX:100,fromY:100,toX:200,toY:50,sourceId:'soldier',actionMode:'attack',duration:16,remaining:16,...overrides});
  it('uses the true release author and holds its target vector when the target dies or orders change',()=>{
    const tracker=new UnitAnimationTracker(),actor=soldier(),victim=soldier({id:'victim',x:200,y:50});
    tracker.update({...snap(0,actor,victim),effects:[]},0);
    const effect=release({unitId:victim.id});
    tracker.update({...snap(1,actor,victim),effects:[effect]},50);
    const direction=tracker.frame(actor,50).direction;
    expect(direction).toEqual({x:100,y:-50});expect(tracker.frame(victim,50).mode).toBe('idle');
    actor.order={type:'attack',targetId:'behind'};
    tracker.update({...snap(3,actor),effects:[{...effect,remaining:14}]},150);
    expect(tracker.frame(actor,150).direction).toBe(direction);
    expect(tracker.frame(actor,150)).toMatchObject({mode:'attack',frame:2});
    tracker.update({...snap(8,actor),effects:[]},400);expect(tracker.frame(actor,400).direction).toBeUndefined();
  });

  it('starts a first-observed ranged shot at its real release age, and never restarts it at projectile impact',()=>{
    const tracker=new UnitAnimationTracker(),actor=soldier();
    tracker.update({...snap(20,actor),effects:[release({type:'projectile',duration:22,remaining:19})]},0);
    expect(tracker.frame(actor,0)).toMatchObject({mode:'attack',frame:3,direction:{x:100,y:-50}});
    const impact=release({type:'hit',unitId:'victim'});delete impact.actionMode;
    tracker.update({...snap(24,actor),effects:[impact]},200);
    expect(tracker.frame(actor,200).mode).toBe('idle');
  });

  it('prioritizes a simultaneous real cast direction over weapon fire and preserves Stage cue vectors',()=>{
    const tracker=new UnitAnimationTracker(),actor=soldier();
    tracker.update({...snap(0,actor),effects:[release(),release({id:'heal',type:'heal',actionMode:'cast',toX:100,toY:0})]},0);
    expect(tracker.frame(actor,0)).toMatchObject({mode:'cast',direction:{x:0,y:-100}});
    tracker.update(snap(1,actor),50,[{unitId:actor.id,mode:'attack',tick:1,fromX:100,fromY:100,toX:0,toY:200}]);
    expect(tracker.frame(actor,50)).toMatchObject({mode:'attack',direction:{x:-100,y:100}});
  });

  it('does not invent direction when old cooldown-only snapshots have no release coordinates',()=>{
    const tracker=new UnitAnimationTracker(),actor=soldier();tracker.update(snap(0,actor),0);
    actor.cooldown=20;tracker.update(snap(1,actor),50);
    expect(tracker.frame(actor,50)).toMatchObject({mode:'attack'});expect(tracker.frame(actor,50).direction).toBeUndefined();
  });
});

describe('release chronology and elevation',()=>{
  it('does not replace a newer cooldown trigger with an older lingering release',()=>{
    const tracker=new UnitAnimationTracker(),actor=soldier();tracker.update(snap(5,actor),0);
    actor.cooldown=20;
    tracker.update({...snap(8,actor),effects:[{id:'old',type:'projectile',sourceId:actor.id,actionMode:'attack',x:200,y:100,fromX:100,fromY:100,toX:200,toY:100,duration:16,remaining:12}]},150);
    expect(tracker.frame(actor,150)).toMatchObject({mode:'attack',frame:0});
    expect(tracker.frame(actor,150).direction).toBeUndefined();
  });
  it('keeps true height differences and leaves missing elevations unknown',()=>{
    const tracker=new UnitAnimationTracker(),actor=soldier();
    tracker.update({...snap(1,actor),effects:[{id:'up',type:'projectile',sourceId:actor.id,actionMode:'attack',x:200,y:100,fromX:100,fromY:100,toX:200,toY:100,fromHeight:0,toHeight:70,duration:16,remaining:16}]},0);
    expect(tracker.frame(actor,0).direction).toEqual({x:100,y:0,height:70});
    tracker.update(snap(2,actor),50,[{unitId:actor.id,mode:'cast',tick:2,fromX:100,fromY:100,toX:100,toY:100,fromHeight:5,toHeight:55}]);
    expect(tracker.frame(actor,50).direction).toEqual({x:0,y:0,height:50});
  });
});


it('shares the exact deterministic release variant and direction with projectile socket resolvers',()=>{
  const actor=soldier(),effect:WorldEffect={id:'shot',type:'projectile',sourceId:actor.id,actionMode:'attack',actionTick:12,x:200,y:50,fromX:100,fromY:100,toX:200,toY:50,duration:20,remaining:20};
  const tracker=new UnitAnimationTracker();tracker.update({...snap(12,actor),effects:[effect]},0);
  expect(releasePoseForEffect(effect)).toEqual(tracker.frame(actor,0));
  expect(releasePoseForEffect(effect)).toBe(releasePoseForEffect(effect));
  const {actionTick:_tick,...older}=effect;expect(releasePoseForEffect(older)).toBeUndefined();
});


describe('releases appended between draws of one tick',()=>{
  it('consumes real strikes immediately, keeps the newest vector, and does not replay on the next tick',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.effects=[];
    const actor=game.spawnUnit('player','footman',1000,1000),right=game.spawnUnit('enemy','footman',1030,1000),left=game.spawnUnit('enemy','footman',970,980);
    const tracker=new UnitAnimationTracker(),facing=new UnitFacingTracker();tracker.update(game,0);facing.update(game.units,()=>undefined);
    strikeUnit(game,actor,right,1,'melee');actor.cooldown=20;
    tracker.update(game,0);expect(tracker.frame(actor,0)).toMatchObject({mode:'attack',frame:0,direction:{x:30,y:0}});
    expect(facing.actionFacing(actor.id,tracker.frame(actor,0).direction)).toBe(1);
    strikeUnit(game,actor,left,1,'melee');tracker.update(game,0);
    const pose=tracker.frame(actor,0);expect(pose.direction).toEqual({x:-30,y:-20});
    expect(facing.actionFacing(actor.id,pose.direction)).toBe(-1);expect(facing.releaseFacing(actor.id)).toBe(-1);
    tracker.update(game,0);expect(tracker.frame(actor,0)).toBe(pose);
    game.tick++;actor.cooldown--;for(const effect of game.effects)effect.remaining--;
    tracker.update(game,50);expect(tracker.frame(actor,50)).toMatchObject({mode:'attack',frame:1});
    expect(tracker.frame(actor,50).direction).toBe(pose.direction);
  });
  it('lets a same-tick cast supersede a strike and keeps Stage cues authoritative',()=>{
    const actor=soldier(),tracker=new UnitAnimationTracker(),effects:WorldEffect[]=[];
    const state={...snap(3,actor),effects};tracker.update(state,0);
    effects.push({id:'swing',type:'melee',sourceId:actor.id,actionMode:'attack',actionTick:3,x:150,y:100,fromX:100,fromY:100,toX:150,toY:100,duration:16,remaining:16});
    tracker.update(state,0);
    effects.push({...effects[0]!,id:'cast',type:'heal',actionMode:'cast',toX:100,toY:50});actor.abilityCooldowns={heal:240};
    tracker.update(state,0);expect(tracker.frame(actor,0)).toMatchObject({mode:'cast',direction:{x:0,y:-50}});
    const cues=[{unitId:actor.id,mode:'cast' as const,tick:3,fromX:100,fromY:100,toX:100,toY:200}];
    tracker.update(state,0,cues);const pose=tracker.frame(actor,0);expect(pose.direction).toEqual({x:0,y:100});
    tracker.update(state,0,cues);expect(tracker.frame(actor,0)).toBe(pose);
    tracker.update({...state,tick:4},50,cues);expect(tracker.frame(actor,50)).toBe(pose);
  });
});

describe('offscreen release direction history',()=>{
  const release=(actor:Unit,tick:number,overrides:Partial<WorldEffect>={}):WorldEffect=>({
    id:`release-${tick}`,type:'melee',sourceId:actor.id,actionMode:'attack',actionTick:tick,
    x:actor.x-30,y:actor.y,fromX:actor.x,fromY:actor.y,toX:actor.x-30,toY:actor.y,
    duration:16,remaining:16,...overrides,
  });

  it('visits only active directions and clears removed histories once among ten thousand idle units',()=>{
    const units=Array.from({length:10_000},(_,index)=>soldier({id:`unit-${index}`})),actor=units[321]!;
    const tracker=new UnitAnimationTracker(),observed=new Map<string,unknown>();
    const observe=(id:string,direction:unknown)=>observed.set(id,direction);
    tracker.update({tick:0,units,effects:[]},0);
    expect(tracker.observeDirections(0,observe)).toBe(0);
    tracker.update({tick:1,units,effects:[release(actor,1)]},50);
    expect(tracker.observeDirections(50,observe)).toBe(1);
    expect([...observed.keys()]).toEqual([actor.id]);
    expect(observed.get(actor.id)).toBe(tracker.frame(actor,50).direction);
    tracker.update({tick:2,units:units.filter(unit=>unit!==actor),effects:[]},100);
    expect(tracker.observeDirections(100,observe)).toBe(1);
    expect(observed.get(actor.id)).toBeUndefined();
    expect(tracker.observeDirections(125,observe)).toBe(0);
  });

  it('keeps an unseen attack turn after recovery and carry expire, then lets later movement turn it',()=>{
    const actor=soldier({order:{type:'hold',x:100,y:100}}),tracker=new UnitAnimationTracker(),facing=new UnitFacingTracker();
    let last:unknown;
    const update=(tick:number,effects:WorldEffect[]=[])=>{
      tracker.update({...snap(tick,actor),effects},tick*50);
      facing.update([actor],()=>undefined);
      return tracker.observeDirections(tick*50,(id,direction)=>{last=direction;facing.actionFacing(id,direction);});
    };
    expect(update(0)).toBe(0);
    expect(update(1,[release(actor,1)])).toBe(1);
    expect(facing.releaseFacing(actor.id)).toBe(-1);
    for(let tick=2;tick<=75;tick++){
      expect(update(tick)).toBe(1);
      expect(last).toEqual({x:-30,y:0});
      expect(facing.releaseFacing(actor.id)).toBe(-1);
    }
    expect(update(76)).toBe(1);expect(last).toBeUndefined();
    expect(update(77)).toBe(0);expect(facing.facing(actor.id)).toBe(-1);
    // No frame was needed anywhere in the unseen action/carry lifetime.
    expect(tracker.frame(actor,3850).carryDirection).toBeUndefined();
    actor.x+=4;expect(update(78)).toBe(0);expect(facing.facing(actor.id)).toBe(1);
  });

  it('uses an unseen previous turn for a subsequent vertical release despite a new opposing command',()=>{
    const actor=soldier(),tracker=new UnitAnimationTracker(),facing=new UnitFacingTracker();
    const observe=(id:string,direction:Parameters<UnitFacingTracker['actionFacing']>[1])=>facing.actionFacing(id,direction);
    tracker.update({...snap(0,actor),effects:[release(actor,0)]},0);facing.update([actor],()=>undefined);
    tracker.observeDirections(0,observe);expect(facing.releaseFacing(actor.id)).toBe(-1);
    for(let tick=1;tick<=75;tick++){
      tracker.update({...snap(tick,actor),effects:[]},tick*50);facing.update([actor],()=>undefined);tracker.observeDirections(tick*50,observe);
    }
    actor.order={type:'attack',targetId:'right'};
    tracker.update({...snap(76,actor),effects:[release(actor,76,{toX:actor.x,toY:actor.y-100})]},3800);
    facing.update([actor],()=>({x:200,y:100}));
    tracker.observeDirections(3800,observe);
    expect(facing.releaseFacing(actor.id)).toBe(-1);
    const pose=tracker.frame(actor,3800);
    expect(pose.direction).toEqual({x:0,y:-100});
    expect(facing.actionFacing(actor.id,pose.direction)).toBe(-1);
  });

  it('expires at the interpolated boundary without generating carry poses or waiting for another snapshot',()=>{
    const actor=soldier(),tracker=new UnitAnimationTracker(),directions:unknown[]=[];
    const observe=(_id:string,direction:unknown)=>directions.push(direction);
    tracker.update({...snap(0,actor),effects:[release(actor,0)]},0);
    const direction=releasePoseForEffect(release(actor,0))!.direction;
    for(let tick=1;tick<=74;tick++){
      tracker.update({...snap(tick,actor),effects:[]},tick*50);
      expect(tracker.observeDirections(tick*50,observe)).toBe(1);
    }
    expect(directions.at(-1)).toEqual(direction);
    expect(tracker.observeDirections(3749,observe)).toBe(1);expect(directions.at(-1)).toEqual(direction);
    expect(tracker.observeDirections(3750,observe)).toBe(1);expect(directions.at(-1)).toBeUndefined();
    expect(tracker.observeDirections(100000,observe)).toBe(0);
    expect(tracker.frame(actor,3750).carry).toBeUndefined();
  });

  it('shares action/carry vector identity and follows same-tick releases, cast precedence and Stage cues',()=>{
    const actor=soldier(),tracker=new UnitAnimationTracker(),effects:WorldEffect[]=[],state={...snap(3,actor),effects};
    let direction:unknown;
    const observe=(_id:string,next:unknown)=>{direction=next;};
    tracker.update(state,0);expect(tracker.observeDirections(0,observe)).toBe(0);
    effects.push(release(actor,3));tracker.update(state,0);
    expect(tracker.observeDirections(0,observe)).toBe(1);expect(direction).toBe(tracker.frame(actor,0).direction);
    // A target/order change must not discard the factual direction already held.
    actor.order={type:'attack',targetId:'right'};tracker.update(state,0);
    expect(tracker.observeDirections(0,observe)).toBe(1);expect(direction).toBe(tracker.frame(actor,0).direction);
    effects.push(release(actor,3,{id:'cast',type:'heal',actionMode:'cast',toX:actor.x,toY:actor.y-60}));
    tracker.update(state,0);tracker.observeDirections(0,observe);
    expect(direction).toEqual({x:0,y:-60});expect(direction).toBe(tracker.frame(actor,0).direction);
    tracker.update(state,0,[{unitId:actor.id,mode:'attack',tick:3,fromX:100,fromY:100,toX:140,toY:170}]);
    tracker.observeDirections(0,observe);const cueDirection=direction;
    for(let tick=4;tick<=10;tick++)tracker.update({...snap(tick,actor),effects:[]},tick*50);
    tracker.observeDirections(500,observe);
    expect(direction).toBe(cueDirection);expect(direction).toBe(tracker.frame(actor,500).carryDirection);
  });

  it('clears locks for stun, work and cooldown-only cast, and preserves live history through reduced motion',()=>{
    for(const interruption of ['stun','work','cast','reducedMotion'] as const){
      const actor=soldier({kind:'worker'}),tracker=new UnitAnimationTracker();let direction:unknown;
      const observe=(_id:string,next:unknown)=>{direction=next;};
      tracker.update({...snap(0,actor),effects:[release(actor,0)]},0);tracker.observeDirections(0,observe);
      expect(direction).toEqual({x:-30,y:0});
      if(interruption==='stun')actor.effects=[{type:'stun',remaining:5}];
      if(interruption==='work')actor.order={type:'repair',buildingId:'hall'};
      if(interruption==='cast')actor.abilityCooldowns={heal:240};
      tracker.update({...snap(1,actor),effects:interruption==='work'?[work(actor)]:[]},50);
      expect(tracker.observeDirections(50,observe,interruption==='reducedMotion')).toBe(1);
      expect(direction).toBeUndefined();
      if(interruption==='reducedMotion'){
        expect(tracker.observeDirections(50,observe)).toBe(1);
        expect(direction).toBe(tracker.frame(actor,50).direction);
      }else expect(tracker.observeDirections(50,observe)).toBe(0);
    }
  });
});
