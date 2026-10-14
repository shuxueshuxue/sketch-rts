import { afterEach, describe, expect, it, vi } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { snapshotGame } from "../../shared/sim";
import { sameGround, type Terrain } from "../../shared/terrain";
import { createAiPolicyMemory } from "../memory";
import { planNavalTactics } from "./naval";
import * as naval from "../../shared/naval";

afterEach(() => vi.restoreAllMocks());

describe("naval combat query work", () => {
  it("only asks combat reachability about targets strictly within the local search radius", () => {
    const game = sketchScene("fleet-local-distance").map("bareDuel").replaceDefaults()
      .player("player", { race: "grove" }).player("enemy", { race: "ember" })
      .townHall("player", 300, 300).townHall("enemy", 3400, 3400)
      .unit("player", "warship", 1600, 1000, { id: "gun" })
      .unit("enemy", "warship", 1600, 1300, { id: "local" })
      .unit("enemy", "warship", 2500, 1000, { id: "edge" })
      .unit("enemy", "warship", 3400, 1500, { id: "remote" }).build().createGame();
    game.map.terrain = undefined;
    const snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const reach = vi.spyOn(naval, "canReach");
    expect(planNavalTactics(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() })).toContainEqual({
      type: "attackMove", unitIds: ["gun"], x: 1600, y: 1300,
    });
    expect(reach.mock.calls.map(call => call[2].id)).toContain("local");
    expect(reach.mock.calls.some(call => ["edge", "remote"].includes(call[2].id))).toBe(false);
    expect(snapshot).toEqual(before);
  });

  it("still clears old combat, outfit and muster memory without a fleet or expedition", () => {
    const game = sketchScene("mainland-naval-cleanup").map("bareDuel").replaceDefaults()
      .player("player", { race: "grove" }).player("enemy", { race: "ember" })
      .townHall("player", 500, 500).townHall("enemy", 3400, 3400)
      .unit("player", "footman", 620, 520)
      .unit("enemy", "footman", 3300, 3300).build().createGame();
    const snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const memory = createAiPolicyMemory();
    memory.naval = {
      combat: { "removed-ship": { targetId: "removed-target" } },
      outfit: { shipId: "removed-ship", mountId: "mount", kind: "shipCannon" },
      muster: { at: { x: 1000, y: 1000 }, goal: { x: 2000, y: 2000 }, leader: "removed-ship", sinceTick: 0, launched: false },
    };

    expect(planNavalTactics(snapshot, "player", { version: "v2", memory })).toEqual([]);
    expect(memory.naval).toEqual({ combat: {} });
    expect(snapshot).toEqual(before);
  });

  it("still directs a landed expedition when no combat hull exists", () => {
    const game = sketchScene("landed-without-combat-fleet").map("bareDuel").replaceDefaults()
      .player("player", { race: "grove" }).player("enemy", { race: "ember" })
      .townHall("player", 352, 352).townHall("enemy", 224, 992)
      .unit("player", "footman", 1344, 608, { id: "landed" })
      .building("enemy", "farm", 1472, 608, { id: "island-farm" }).build().createGame();
    let cells = "";
    for (let row = 0; row < 20; row += 1) for (let col = 0; col < 30; col += 1) {
      const island = col >= 20 && col <= 24 && row >= 7 && row <= 12;
      const rim = col >= 19 && col <= 25 && row >= 6 && row <= 13;
      cells += col <= 8 || island ? "." : col === 9 || rim ? "," : "~";
    }
    const terrain: Terrain = { cell: 64, cols: 30, rows: 20, cells };
    game.map = { ...game.map, width: 1920, height: 1280, terrain };
    const snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const home = snapshot.buildings.find(building => building.owner === "player")!;
    const landed = snapshot.units.find(unit => unit.id === "landed")!;
    expect(sameGround(snapshot.map, home, landed)).toBe(false);

    expect(planNavalTactics(snapshot, "player", { version: "v2", memory: createAiPolicyMemory() })).toContainEqual({
      type: "attackMove", unitIds: ["landed"], x: 1472, y: 608,
    });
    expect(snapshot).toEqual(before);
  });
});
