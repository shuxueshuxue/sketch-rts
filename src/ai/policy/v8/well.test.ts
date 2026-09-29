import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import { createAiPolicyMemory } from "../../memory";
import { readV6Intel } from "../v6/intel";
import { v8WantsWell, v8WellPoint } from "./well";

function field(name: string, options: { wounded?: number; well?: boolean; healer?: boolean } = {}) {
  let scene = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v8", { team: "north", race: "ember" })
    .player("v5", { team: "south", race: "grove" })
    .townHall("v8", 500, 2_000)
    .townHall("v5", 3_500, 2_000);
  for (let index = 0; index < 4; index += 1) scene = scene.unit("v8", "emberRavager", 880 + index * 20, 2_000, { id: `ravager-${index}` });
  if (options.well) scene = scene.building("v8", "emberShrine", 880, 2_000, { id: "shrine" });
  if (options.healer) scene = scene.unit("v8", "emberAcolyte", 860, 2_040, { id: "acolyte" });
  const game = scene.build().createGame();
  const hurt = options.wounded ?? 0;
  game.units.filter((unit) => unit.id.startsWith("ravager-")).forEach((unit, index) => (unit.hp = index < 2 ? unit.maxHp - hurt : unit.hp));
  const snapshot = snapshotGame(game);
  const intel = readV6Intel(snapshot, "v8", { version: "v2", requestedVersion: "v8", teams: game.teams, memory: createAiPolicyMemory() });
  return { snapshot, intel };
}

describe("v8 well", () => {
  it("wants its race's well at the rally once its fighters miss enough health and nothing heals them", () => {
    expect(v8WantsWell(field("v8-well-fresh").snapshot, "v8")).toBeUndefined();
    const hurt = field("v8-well-hurt", { wounded: 90 });
    expect(v8WantsWell(hurt.snapshot, "v8")).toBe("emberShrine");
    expect(v8WellPoint(hurt.intel)).toEqual({ x: 880, y: 2_000 });
  });

  it("wants none with a healer or a well of its own", () => {
    expect(v8WantsWell(field("v8-well-healer", { wounded: 90, healer: true }).snapshot, "v8")).toBeUndefined();
    expect(v8WantsWell(field("v8-well-standing", { wounded: 90, well: true }).snapshot, "v8")).toBeUndefined();
  });
});
