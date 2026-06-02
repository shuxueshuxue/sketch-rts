import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { runAiCommandEntriesFromScripts } from "./script-runner";
import type { AiScript } from "./types";

describe("AI script runner", () => {
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
});
