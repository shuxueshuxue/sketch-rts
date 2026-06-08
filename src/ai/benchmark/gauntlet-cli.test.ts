import { describe, expect, it } from "vitest";
import { createAiGauntletCatalog } from "./gauntlet";
import { gauntletPlaytestReplay } from "./gauntlet-cli";

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
});
