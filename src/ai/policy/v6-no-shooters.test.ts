import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import type { MercenaryUnitKind, RaceId } from "../../shared/types";
import { AI_SCRIPT_LIBRARY, planAiCommandsFromScripts } from "../policy";
import { missingCombatProductionKind } from "./production-model";
import { trainingChoice } from "./training-choice";

const V6 = { version: "v2", requestedVersion: "v6" } as const;
const V5 = { version: "v2", requestedVersion: "v5" } as const;

function base(race: RaceId, kinds: Parameters<ReturnType<typeof sketchScene>["building"]>[1][], army: Parameters<ReturnType<typeof sketchScene>["unit"]>[1][] = []) {
  let scene = sketchScene(`v6-no-shooters-${race}-${kinds.join("-")}-${army.length}`)
    .map("openClaims")
    .replaceDefaults()
    .player("v6", { team: "north", race })
    .player("v3", { team: "south", race: "grove" })
    .player("v5", { team: "south", race: "grove" })
    .townHall("v6", 500, 500)
    .townHall("v3", 3_300, 3_300)
    .townHall("v5", 3_300, 3_800);
  kinds.forEach((kind, index) => (scene = scene.building("v6", kind, 700 + index * 110, 560, { id: kind })));
  army.forEach((kind, index) => (scene = scene.unit("v6", kind, 800 + (index % 6) * 30, 760 + Math.floor(index / 6) * 30)));
  return snapshotGame(scene.build().createGame());
}

describe("v6 fields no shooters", () => {
  it("builds its Grove core without an archery range, and leaves one idle if it stands", () => {
    expect(missingCombatProductionKind(base("grove", ["barracks"]), "v6", V6)).toBe("sanctum");
    expect(missingCombatProductionKind(base("grove", ["barracks"]), "v6", V5)).toBe("archeryRange");
    const withRange = base("grove", ["barracks", "archeryRange"]);
    expect(trainingChoice(withRange, "v6", withRange.buildings.find((building) => building.id === "archeryRange")!, V6)).toBeUndefined();
  });

  it("trains summoners from its caster building whatever the army holds, and stops the forge once a spire stands", () => {
    const armies: Parameters<typeof base>[2][] = [[], ["emberRavager"], ["emberAcolyte", "ashHexer", "pyreCaller"], Array(12).fill("pyreCaller")];
    for (const army of armies) {
      const snapshot = base("ember", ["emberForge", "cinderSpire"], army);
      const building = (id: string) => snapshot.buildings.find((candidate) => candidate.id === id)!;
      expect(trainingChoice(snapshot, "v6", building("cinderSpire"), V6)).toBe("pyreCaller");
      expect(trainingChoice(snapshot, "v6", building("emberForge"), V6)).toBeUndefined();
    }
    const grove = base("grove", ["sanctum"]);
    expect(trainingChoice(grove, "v6", grove.buildings.find((building) => building.id === "sanctum")!, V6)).toBe("summoner");
  });

  it("never hires from a contract archer camp, but still hires a mercenary standing at the same spot", () => {
    const hires = (hireKind: MercenaryUnitKind) => {
      const game = sketchScene(`v6-camp-${hireKind}`)
        .map("openClaims")
        .replaceDefaults()
        .player("v6", { team: "north", race: "grove" })
        .player("v3", { team: "south", race: "grove" })
        .player("v5", { team: "south", race: "grove" })
        .playerState("v6", { gold: 1_500 })
        .townHall("v6", 500, 500)
        .building("v6", "barracks", 700, 560)
        .building("v6", "stables", 810, 560)
        .building("v6", "sanctum", 920, 560)
        .building("v6", "farm", 600, 700)
        .building("v6", "farm", 660, 700)
        .unit("v6", "footman", 1_000, 1_000)
        .unit("v6", "footman", 1_030, 1_000)
        .mercenaryCamp("camp", 1_010, 1_050, { hireKind, cost: 160 })
        .townHall("v3", 3_300, 3_300)
        .townHall("v5", 3_300, 3_800)
        .build()
        .createGame();
      return planAiCommandsFromScripts(snapshotGame(game), "v6", [AI_SCRIPT_LIBRARY.mercenary], { ...V6, teams: game.teams }).filter((command) => command.type === "hire");
    };
    expect(hires("contractArcher")).toEqual([]);
    expect(hires("mercenary")).toEqual([{ type: "hire", campId: "camp" }]);
  });
});
