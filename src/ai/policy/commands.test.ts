import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { resolveAiCommandIntent } from "./commands";

describe("AI policy command intents", () => {
  it("resolves tactical AI intents through the SDK command intent surface", () => {
    const game = sketchScene("ai-command-intent-focus")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .unit("v2", "footman", 500, 500, { id: "front" })
      .unit("v2", "archer", 530, 500, { id: "back" })
      .unit("v1", "lancer", 620, 500, { id: "target" })
      .build()
      .createGame();

    expect(resolveAiCommandIntent(snapshotGame(game), "v2", { type: "focusFire", unitIds: "combat", targetId: "target" }, { version: "v2", teams: game.teams })).toEqual({
      type: "attack",
      unitIds: ["front", "back"],
      targetId: "target",
    });
  });
});
