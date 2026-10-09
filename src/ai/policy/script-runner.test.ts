import { describe, expect, it } from "vitest";
import { issuePlayerCommand, snapshotGame } from "../../shared/sim";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import { sketchScene } from "../../sdk/scene";
import { runAiCommandEntriesFromScripts } from "./script-runner";
import type { AiScript } from "./types";

describe("AI script runner", () => {
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
