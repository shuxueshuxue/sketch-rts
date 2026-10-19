import { afterEach, describe, expect, it, vi } from "vitest";
import { issuePlayerCommand, snapshotGame } from "../../shared/sim";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import { sketchScene } from "../../sdk/scene";
import { runAiCommandEntriesFromScripts } from "./script-runner";
import type { AiPolicyContext, AiScript } from "./types";
import { aiSnapshotQuery } from "./snapshot";
import { createAiPolicyMemory } from "../memory";
import * as naval from "../../shared/naval";
import { planCombatReadiness, readinessUnitIds } from "./combat-readiness";

afterEach(() => vi.restoreAllMocks());

describe("AI script runner", () => {
  function tacticalScene() {
    return sketchScene("empty-tactical-bookkeeping").map("bareDuel").replaceDefaults()
      .player("v2", { race: "grove" }).player("v1", { race: "ember" })
      .townHall("v2", 500, 500).townHall("v1", 3400, 3400, { id: "enemy-hall" })
      .unit("v2", "footman", 620, 520, { id: "guard" })
      .unit("v2", "footman", 650, 550, { id: "free" }).build().createGame();
  }
  const retreatClaim = { kind: "retreat" as const, targetId: "retreat", x: 500, y: 500, sinceTick: 0, expiresTick: 900 };

  it('finalizes task membership only from commands that survived both ownership and order conflicts', () => {
    const game = tacticalScene(), memory = createAiPolicyMemory();
    let assigned = ['guard', 'free'];
    let finalFieldOrders = -1;
    const scripts: AiScript[] = [
      { id: 'rescue', phase: 'tactics', claimsUnits: () => new Set(['guard']),
        run: () => ({ type: 'move', unitIds: ['guard'], x: 500, y: 500 }) },
      { id: 'first', phase: 'tactics', run: () => ({ type: 'move', unitIds: ['free'], x: 700, y: 700 }) },
      { id: 'field', phase: 'tactics', run: () => ({ type: 'attackMove', unitIds: ['guard', 'free'], x: 2000, y: 2000 }),
        onCommands(_snapshot, _owner, _options, commands) {
          assigned = commands.flatMap(command => 'unitIds' in command ? command.unitIds : []);
        },
        afterPlan(_snapshot, _owner, _options, entries) {
          finalFieldOrders = entries.filter(entry => entry.scriptId === 'field').length;
        } },
      { id: 'commander', phase: 'tactics', run() { expect(assigned).toEqual([]); return []; } },
    ];
    const issued = runAiCommandEntriesFromScripts(snapshotGame(game), 'v2', scripts, { memory });
    expect(assigned).toEqual([]);
    expect(finalFieldOrders).toBe(0);
    for (const entry of issued) issuePlayerCommand(game, 'v2', entry.command);
    expect(game.units.find(unit => unit.id === 'guard')!.order).toMatchObject({ type: 'move', x: 500 });
    expect(game.units.find(unit => unit.id === 'free')!.order).toMatchObject({ type: 'move', x: 700 });
  });

  it.each(["undefined", "array"] as const)("keeps an empty %s script's memory updates before later real commands", result => {
    const game = tacticalScene(), snapshot = snapshotGame(game), memory = createAiPolicyMemory();
    const before = structuredClone(snapshot), calls: string[] = [];
    const scripts: AiScript[] = [
      { id: "inspect", phase: "tactics", run: (_frame, _owner, context) => {
        calls.push("inspect");
        context.memory.unitClaims.guard = { ...retreatClaim };
        return result === "array" ? [] : undefined;
      } },
      { id: "rescue", phase: "tactics", run: (_frame, _owner, context) => {
        calls.push("rescue");
        expect(context.memory.unitClaims.guard?.kind).toBe("retreat");
        return { type: "move", unitIds: ["guard"], x: 500, y: 500 };
      } },
      { id: "later", phase: "tactics", run: (_frame, _owner, context) => {
        calls.push("later");
        expect(context.memory.unitClaims.guard).toBeUndefined();
        return { type: "move", unitIds: ["free"], x: 700, y: 700 };
      } },
    ];
    const entries = runAiCommandEntriesFromScripts(snapshot, "v2", scripts, { memory });
    expect(calls).toEqual(["inspect", "rescue", "later"]);
    expect(entries).toEqual([
      { scriptId: "rescue", command: { type: "move", unitIds: ["guard"], x: 500, y: 500 } },
      { scriptId: "later", command: { type: "move", unitIds: ["free"], x: 700, y: 700 } },
    ]);
    for (const entry of entries) issuePlayerCommand(game, "v2", entry.command);
    expect(game.units.find(unit => unit.id === "guard")!.order).toEqual({ type: "move", x: 500, y: 500 });
    expect(game.units.find(unit => unit.id === "free")!.order).toEqual({ type: "move", x: 700, y: 700 });
    expect(snapshot).toEqual(before);
  });

  it("keeps a fully claim-filtered script's updates for its unit's owning script", () => {
    const game = tacticalScene(), memory = createAiPolicyMemory(), calls: string[] = [];
    const scripts: AiScript[] = [
      { id: "blocked", phase: "tactics", run: (_frame, _owner, context) => {
        calls.push("blocked");
        context.memory.unitClaims.guard = { ...retreatClaim };
        return { type: "move", unitIds: ["guard"], x: 2000, y: 2000 };
      } },
      { id: "rescue", phase: "tactics", claimsUnits: () => new Set(["guard"]), run: (_frame, _owner, context) => {
        calls.push("rescue");
        expect(context.memory.unitClaims.guard?.kind).toBe("retreat");
        return { type: "move", unitIds: ["guard"], x: 500, y: 500 };
      } },
    ];
    expect(runAiCommandEntriesFromScripts(snapshotGame(game), "v2", scripts, { memory })).toEqual([
      { scriptId: "rescue", command: { type: "move", unitIds: ["guard"], x: 500, y: 500 } },
    ]);
    expect(calls).toEqual(["blocked", "rescue"]);
    expect(memory.unitClaims.guard).toBeUndefined();
  });

  it("keeps a fully conflict-filtered script's updates without recording its rejected command", () => {
    const game = tacticalScene(), memory = createAiPolicyMemory(), calls: string[] = [];
    const scripts: AiScript[] = [
      { id: "first", phase: "tactics", run: () => {
        calls.push("first");
        return { type: "move", unitIds: ["guard"], x: 500, y: 500 };
      } },
      { id: "blocked", phase: "tactics", run: (_frame, _owner, context) => {
        calls.push("blocked");
        context.memory.unitClaims.guard = { ...retreatClaim };
        return { type: "attack", unitIds: ["guard"], targetId: "enemy-hall" };
      } },
      { id: "later", phase: "tactics", run: (_frame, _owner, context) => {
        calls.push("later");
        expect(context.memory.unitClaims.guard?.kind).toBe("retreat");
        return { type: "move", unitIds: ["free"], x: 700, y: 700 };
      } },
    ];
    expect(runAiCommandEntriesFromScripts(snapshotGame(game), "v2", scripts, { memory })).toEqual([
      { scriptId: "first", command: { type: "move", unitIds: ["guard"], x: 500, y: 500 } },
      { scriptId: "later", command: { type: "move", unitIds: ["free"], x: 700, y: 700 } },
    ]);
    expect(calls).toEqual(["first", "blocked", "later"]);
    expect(memory.unitClaims.guard).toEqual(retreatClaim);
  });

  it("reuses unchanged budgets before isolating a spent budget", () => {
    const game = sketchScene("shared-economy-frame").map("bareDuel").replaceDefaults()
      .player("v2", { race: "grove" }).player("v1", { race: "ember" })
      .playerState("v2", { gold: 500 })
      .townHall("v2", 500, 500, { id: "hall" }).townHall("v1", 3400, 3400)
      .worker("v2", 620, 520, { id: "worker" }).build().createGame();
    const snapshot = snapshotGame(game), query = aiSnapshotQuery(snapshot);
    const frames: typeof snapshot[] = [];
    const scripts: AiScript[] = [
      { id: "inspect", phase: "economy", run: frame => { frames.push(frame); expect(aiSnapshotQuery(frame)).toBe(query); return undefined; } },
      { id: "economy", phase: "economy", run: frame => { frames.push(frame); expect(aiSnapshotQuery(frame)).toBe(query); return { type: "train", buildingId: "hall", unitKind: "worker" }; } },
      { id: "afterPurchase", phase: "economy", run: frame => {
        frames.push(frame);
        expect(frame).not.toBe(snapshot);
        expect(frame.players.v2!.gold).toBe(500 - UNIT_DEFS.worker.cost);
        expect(frame.units).toBe(snapshot.units);
        expect(frame.players.v1).toBe(snapshot.players.v1);
        const budgetQuery = aiSnapshotQuery(frame);
        expect(budgetQuery).not.toBe(query);
        expect(budgetQuery.snapshot).toBe(frame);
        expect(budgetQuery.snapshot.players.v2!.gold).toBe(500 - UNIT_DEFS.worker.cost);
        const own = budgetQuery.unitsFor("v2"); own.length = 0;
        expect(query.unitsFor("v2")).toHaveLength(1);
        return undefined;
      } },
    ];
    expect(runAiCommandEntriesFromScripts(snapshot, "v2", scripts).map(entry => entry.command)).toEqual([
      { type: "train", buildingId: "hall", unitKind: "worker" },
    ]);
    expect(frames.slice(0, 2)).toEqual([snapshot, snapshot]);
    expect(snapshot.players.v2!.gold).toBe(500);
  });
  it("deducts an earlier economy purchase before a later script decides what it can afford", () => {
    const game = sketchScene("one-purchase-budget").map("bareDuel").replaceDefaults()
      .player("v2", { race: "grove" }).player("v1", { race: "ember" })
      .playerState("v2", { gold: UNIT_DEFS.worker.cost + UNIT_DEFS.archer.cost - 1 })
      .townHall("v2", 500, 500, { id: "hall" }).townHall("v1", 3_400, 3_400)
      .building("v2", "archeryRange", 700, 500, { id: "range" }).build().createGame();
    const scripts: AiScript[] = [
      { id: "economy", phase: "economy", run: () => ({ type: "train", buildingId: "hall", unitKind: "worker" }) },
      { id: "training", phase: "economy", run: snapshot => snapshot.players.v2!.gold >= UNIT_DEFS.archer.cost ? { type: "train", buildingId: "range", unitKind: "archer" } : undefined },
    ];
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), "v2", scripts);
    expect(entries).toHaveLength(1);
    for (const entry of entries) expect(() => issuePlayerCommand(game, "v2", entry.command)).not.toThrow();
  });

  it.each(['attackMove', 'holdPosition'] as const)("preserves an earlier transport assignment against a later %s order", type => {
    const game = sketchScene("claim-priority").map("bareDuel").replaceDefaults()
      .player("v2", { race: "grove" }).player("v1", { race: "ember" })
      .townHall("v2", 500, 500).townHall("v1", 3400, 3400)
      .unit("v2", "footman", 620, 520, { id: "passenger" }).build().createGame();
    const scripts: AiScript[] = [
      { id: "ferry", phase: "tactics", claimsUnits: () => new Set(["passenger"]), run: () => ({ type: "move", unitIds: ["passenger"], x: 1000, y: 500 }) },
      { id: "army", phase: "tactics", claimsUnits: () => new Set(["passenger"]), run: () => type === 'holdPosition'
        ? { type, unitIds: ['passenger'] } : { type, unitIds: ['passenger'], x: 3400, y: 3400 } },
    ];
    expect(runAiCommandEntriesFromScripts(snapshotGame(game), "v2", scripts).map(entry => entry.scriptId)).toEqual(["ferry"]);
  });
  it('keeps a dodge ahead of a later hold, and the hold ahead of a still later march', () => {
    const game = sketchScene('hold-order-priority').replaceDefaults()
      .player('us', { race: 'grove' }).player('foe', { race: 'ember' })
      .townHall('us', 400, 400).townHall('foe', 3400, 3400)
      .unit('us', 'summoner', 600, 600, { id: 'dodging' }).unit('us', 'summoner', 800, 600, { id: 'holding' }).build().createGame();
    const scripts: AiScript[] = [
      { id: 'dodge', phase: 'tactics', run: () => ({ type: 'move', unitIds: ['dodging'], x: 500, y: 700 }) },
      { id: 'formation', phase: 'tactics', run: () => ({ type: 'holdPosition', unitIds: ['dodging', 'holding'] }) },
      { id: 'march', phase: 'tactics', run: () => ({ type: 'attackMove', unitIds: ['dodging', 'holding'], x: 2000, y: 2000 }) },
    ];
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', scripts);
    for (const entry of entries) issuePlayerCommand(game, 'us', entry.command);
    expect(game.units.find(unit => unit.id === 'dodging')!.order).toEqual({ type: 'move', x: 500, y: 700 });
    expect(game.units.find(unit => unit.id === 'holding')!.order.type).toBe('hold');
    expect(entries.map(entry => entry.scriptId)).toEqual(['dodge', 'formation']);
  });
  it("lets a boarding healer reach its ferry instead of restarting land spells every think", () => {
    const game = sketchScene("boarding-caster-reservation").map("bareDuel").replaceDefaults()
      .player("v2", { race: "grove" }).player("v1", { race: "ember" })
      .townHall("v2", 500,500).townHall("v1",3400,3400)
      .unit("v2", "priest",620,520,{id:"healer"})
      .unit("v2", "footman",700,520,{id:"patient"})
      .unit("v2", "transport",1000,520,{id:"ferry"}).build().createGame();
    issuePlayerCommand(game,"v2",{type:"board",unitIds:["healer"],transportId:"ferry"});
    const scripts:AiScript[]=[{id:"abilities",phase:"tactics",run:()=>({type:"cast",unitId:"healer",ability:"heal",targetId:"patient"})}];
    expect(runAiCommandEntriesFromScripts(snapshotGame(game),"v2",scripts)).toEqual([]);
  });
  it("keeps later tactical scripts from reusing units reserved by earlier scripts", () => {
    const scene = sketchScene("script-runner-unit-reservations")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 620, 520, { id: "reserved-footman" })
      .unit("v2", "archer", 650, 540, { id: "free-archer" })
      .townHall("v1", 3400, 3400)
      .build();
    const game = scene.createGame();
    const scripts: AiScript[] = [
      {
        id: "reserve",
        phase: "economy",
        run: () => ({ type: "move", unitIds: ["reserved-footman"], x: 700, y: 700 }),
      },
      {
        id: "attack",
        phase: "tactics",
        run: () => ({ type: "attackMove", unitIds: ["reserved-footman", "free-archer"], x: 3400, y: 3400 }),
      },
    ];

    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), "v2", scripts, {}, { minimumAttackMoveUnits: () => 1 });

    expect(entries.map((entry) => entry.command)).toEqual([
      { type: "move", unitIds: ["reserved-footman"], x: 700, y: 700 },
      { type: "attackMove", unitIds: ["free-archer"], x: 3400, y: 3400 },
    ]);
  });

  it("applies attack-move minimums even when no earlier script reserved units", () => {
    const scene = sketchScene("script-runner-attack-move-minimum")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 620, 520, { id: "footman-1" })
      .unit("v2", "footman", 650, 540, { id: "footman-2" })
      .unit("v2", "archer", 680, 560, { id: "archer-1" })
      .unit("v2", "archer", 710, 580, { id: "archer-2" })
      .townHall("v1", 3400, 3400)
      .build();
    const game = scene.createGame();
    const scripts: AiScript[] = [
      {
        id: "thinAttack",
        phase: "tactics",
        run: () => ({ type: "attackMove", unitIds: ["footman-1", "footman-2", "archer-1", "archer-2"], x: 3400, y: 3400 }),
      },
    ];

    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), "v2", scripts, {}, { minimumAttackMoveUnits: () => 5 });

    expect(entries).toEqual([]);
  });
  it("keeps the money for a walking builder without changing the shared snapshot", () => {
    const game = sketchScene("pending-build-budget").map("bareDuel").replaceDefaults()
      .player("v2", { team: "north", race: "grove" }).player("v1", { team: "south", race: "ember" })
      .playerState("v2", { gold: BUILDING_DEFS.townHall.cost + UNIT_DEFS.footman.cost - 1 })
      .townHall("v2", 500, 500).townHall("v1", 3400, 3400)
      .worker("v2", 600, 600, { id: "builder" }).unit("v2", "footman", 620, 520, { id: "guard" })
      .building("v2", "barracks", 750, 500, { id: "producer" }).build().createGame();
    issuePlayerCommand(game, "v2", { type: "build", unitId: "builder", buildingKind: "townHall", x: 1500, y: 1500 });
    const snapshot = snapshotGame(game);
    const scripts: AiScript[] = [
      { id: "training", phase: "economy", run: state => state.players.v2!.gold >= UNIT_DEFS.footman.cost
        ? { type: "train", buildingId: "producer", unitKind: "footman" } : undefined },
      { id: "guard", phase: "tactics", run: () => ({ type: "move", unitIds: ["guard"], x: 1400, y: 1400 }) },
    ];
    expect(runAiCommandEntriesFromScripts(snapshot, "v2", scripts).map(entry => entry.command)).toEqual([
      { type: "move", unitIds: ["guard"], x: 1400, y: 1400 },
    ]);
    expect(snapshot.players.v2!.gold).toBe(BUILDING_DEFS.townHall.cost + UNIT_DEFS.footman.cost - 1);
    expect(game.buildings.some(building => building.x === 1500)).toBe(false);
  });

});

describe("script runner readiness scope", () => {
  const readiness: AiScript = { id: "readiness", phase: "tactics", run: planCombatReadiness, claimsUnits: readinessUnitIds };
  function frame() {
    const game = sketchScene("readiness-runner-scope").map("bareDuel").replaceDefaults()
      .player("us", { race: "grove" }).player("enemy", { race: "ember" }).playerState("us", { gold: 1000 })
      .townHall("us", 300, 300).townHall("enemy", 3400, 3400)
      .unit("us", "archer", 1000, 1000, { id: "shooter" })
      .unit("enemy", "footman", 1430, 1000, { id: "foe" })
      .worker("us", 500, 500, { id: "builder" }).build().createGame();
    const memory = createAiPolicyMemory();
    memory.v6 = { general: { mode: "guard", target: { x: 1000, y: 1000 } } };
    return { snapshot: snapshotGame(game), memory };
  }

  it("reuses claims for the real readiness script without changing bookkeeping", () => {
    const { snapshot, memory } = frame(), before = structuredClone(snapshot);
    const reach = vi.spyOn(naval, "canReach");
    expect(runAiCommandEntriesFromScripts(snapshot, "us", [readiness], { version: "v7", memory })).toEqual([
      { scriptId: "readiness", command: { type: "aim", unitIds: ["shooter"], x: 1271.32, y: 1000 } },
    ]);
    expect(reach).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual(before);
  });

  it("uses memory changed by an earlier tactics script while preserving earlier claims", () => {
    const { snapshot, memory } = frame();
    const scripts: AiScript[] = [
      { id: "changeGeneral", phase: "tactics", run: (_frame, _owner, context) => {
        context.memory.v6!.general!.mode = "attack";
        return undefined;
      } },
      readiness,
      { id: "later", phase: "tactics", run: () => ({ type: "move", unitIds: ["shooter"], x: 1500, y: 1500 }) },
    ];
    // Claims are still computed before the general change, exactly as before.
    // Readiness now emits no aim, and its earlier claim still excludes `later`.
    expect(runAiCommandEntriesFromScripts(snapshot, "us", scripts, { version: "v7", memory })).toEqual([]);
    expect(memory.v6!.general!.mode).toBe("attack");
  });

  it("uses memory changed by a later claims callback before readiness executes", () => {
    const { snapshot, memory } = frame();
    const scripts: AiScript[] = [readiness, {
      id: "laterClaims", phase: "tactics", run: () => undefined,
      claimsUnits: (_frame, _owner, context) => {
        context.memory.v6!.general!.target!.x = 1300;
        return new Set();
      },
    }];
    expect(runAiCommandEntriesFromScripts(snapshot, "us", scripts, { version: "v7", memory })).toEqual([]);
    expect(memory.v6!.general!.target!.x).toBe(1300);
  });

  it("keeps an economy budget distinct from the original claims snapshot", () => {
    const { snapshot, memory } = frame();
    snapshot.units.find(unit => unit.id === "builder")!.order = { type: "build", buildingKind: "farm", x: 1300, y: 1500 };
    const reach = vi.spyOn(naval, "canReach");
    const observed: typeof snapshot[] = [];
    const scripts: AiScript[] = [
      { id: "inspectBudget", phase: "economy", run: frame => { observed.push(frame); return undefined; } },
      { ...readiness, phase: "economy" },
    ];
    expect(runAiCommandEntriesFromScripts(snapshot, "us", scripts, { version: "v7", memory })).toEqual([
      { scriptId: "readiness", command: { type: "aim", unitIds: ["shooter"], x: 1271.32, y: 1000 } },
    ]);
    expect(observed[0]).not.toBe(snapshot);
    expect(observed[0]!.units).toBe(snapshot.units);
    expect(observed[0]!.players.us!.gold).toBe(1000 - BUILDING_DEFS.farm.cost);
    expect(snapshot.players.us!.gold).toBe(1000);
    expect(reach).toHaveBeenCalledTimes(2);
  });

  it("starts fresh on every invocation and expires a retained context", () => {
    const { snapshot, memory } = frame();
    let retained: AiPolicyContext | undefined;
    const scripts: AiScript[] = [
      { id: "retain", phase: "tactics", run: (_frame, _owner, context) => { retained = context; return undefined; } },
      readiness,
    ];
    const options = { version: "v7" as const, memory };
    expect(runAiCommandEntriesFromScripts(snapshot, "us", scripts, options)).toHaveLength(1);
    const firstContext = retained!;
    snapshot.units.find(unit => unit.id === "foe")!.x = 2000;
    expect(planCombatReadiness(snapshot, "us", firstContext)).toEqual([]);
    expect(runAiCommandEntriesFromScripts(snapshot, "us", scripts, options)).toEqual([]);
    expect(retained).not.toBe(firstContext);
    expect(retained!.memory).toBe(memory);
  });
});
