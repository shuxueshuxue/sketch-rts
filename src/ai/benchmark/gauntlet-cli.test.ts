import { describe, expect, it } from "vitest";
import { createAiGauntletCatalog } from "./gauntlet";
import { gauntletFailureReplayManifest, gauntletPlaytestReplay } from "./gauntlet-cli";

describe("AI gauntlet CLI helpers", () => {
  it("builds exact playtest replay args from a gauntlet match and selection", () => {
    const catalog = createAiGauntletCatalog({ seed: "gauntlet-cli-seed", mapCount: 2 });
    const match = catalog.matches.find((candidate) => candidate.name === "mixed-v2-external score wildMarches official triangle");

    expect(match).toBeDefined();
    expect(gauntletPlaytestReplay(match!, catalog)).toEqual({
      args: ["new", "--file", ".playtests/gauntlet-mixed-v2-external-score-wild-marches-official-triangle.json", "--from-gauntlet", match!.name, "--gauntlet-seed", "gauntlet-cli-seed", "--gauntlet-map-count", "2", "--you", "v2", "--assist-you"],
      command: "npm run play:ai -- new --file .playtests/gauntlet-mixed-v2-external-score-wild-marches-official-triangle.json --from-gauntlet \"mixed-v2-external score wildMarches official triangle\" --gauntlet-seed gauntlet-cli-seed --gauntlet-map-count 2 --you v2 --assist-you",
    });
  });

  it("summarizes failed gauntlet reports with exact replay metadata", () => {
    const failedReplay = { args: ["new", "--from-gauntlet", "failed match"], command: "npm run play:ai -- new --from-gauntlet \"failed match\"" };
    const passedReplay = { args: ["new", "--from-gauntlet", "passed match"], command: "npm run play:ai -- new --from-gauntlet \"passed match\"" };

    expect(
      gauntletFailureReplayManifest([
        { failed: true, playtestName: "failed match", lane: "score", controllerCase: "mixed-v2-external", mapId: "wildMarches", winnerTeam: "south", tick: 1200, playtest: failedReplay },
        { failed: false, playtestName: "passed match", lane: "score", controllerCase: "mixed-v2-external", mapId: "verdigrisSpire", winnerTeam: "north", tick: 900, playtest: passedReplay },
      ]),
    ).toEqual({
      failureCount: 1,
      failures: [
        {
          name: "failed match",
          lane: "score",
          controllerCase: "mixed-v2-external",
          mapId: "wildMarches",
          winnerTeam: "south",
          tick: 1200,
          playtest: failedReplay,
        },
      ],
    });
  });
});
