import { describe, expect, it } from "vitest";
import { aiPlaybook } from "./playbook";

describe("AI playbook", () => {
  it("keeps the core production chain and specialist unit preferences explicit", () => {
    expect(aiPlaybook()).toEqual({
      productionPlan: ["barracks", "archeryRange", "stables", "sanctum"],
      unitsByBuilding: {
        barracks: ["footman", "lancer"],
        archeryRange: ["archer"],
        stables: ["knight", "raider", "horseArcher"],
        sanctum: ["priest", "summoner", "witch"],
        workshop: ["golem"],
      },
    });
    expect(aiPlaybook("ember")).toEqual({
      productionPlan: ["emberForge", "cinderSpire", "emberForge", "cinderSpire"],
      unitsByBuilding: {
        emberForge: ["emberRavager", "cinderRunner", "ashWarden"],
        cinderSpire: ["sparkArcher", "emberAcolyte", "ashHexer", "pyreCaller"],
      },
    });
  });
});
