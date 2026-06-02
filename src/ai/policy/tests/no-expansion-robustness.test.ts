import { describe, expect, it } from "vitest";
import { runAiGame } from "../../game-runner";
import { seconds } from "../../../shared/time";

describe("SDK barren-map robustness checks", () => {
  it("runs no-expansion 1v2 pressure through the SDK without treating it as a v2 strength gate", () => {
    const report = runAiGame({
      name: "bareDuel robustness smoke",
      mapId: "bareDuel",
      agents: {
        v2: { adapter: "external", team: "north", race: "grove", version: "v2" },
        v1a: { adapter: "internal", team: "south", race: "grove", version: "v1" },
        v1b: { adapter: "internal", team: "south", race: "ember", version: "v1" },
      },
      maxTicks: seconds(120),
      thinkInterval: seconds(2.25),
      sampleInterval: seconds(30),
    });

    expect(report.tick).toBeGreaterThan(0);
    expect(report.commandsByOwner.v2).toBeGreaterThan(0);
    expect(report.goldSpent.v2).toBeGreaterThan(0);
  });
});
