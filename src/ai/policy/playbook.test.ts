import { describe, expect, it } from "vitest";
import { aiPlaybook } from "./playbook";

describe("AI playbook", () => {
  it("keeps the core production chain and specialist unit preferences explicit", () => {
    expect(aiPlaybook()).toEqual({
      productionPlan: ["barracks", "archeryRange", "stables", "sanctum"],
      barracksUnits: ["footman", "lancer"],
      stablesUnits: ["knight", "raider"],
      sanctumUnits: ["priest", "summoner", "witch"],
    });
  });
});
