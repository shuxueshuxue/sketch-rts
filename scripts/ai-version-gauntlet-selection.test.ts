import { describe, expect, it } from "vitest";
import { selectGauntletRichScoreMaps } from "./ai-version-gauntlet-selection";

const MAPS = Array.from({ length: 18 }, (_, index) => `map${index + 1}`);

describe("AI version gauntlet map selection", () => {
  it("samples ten rich maps by default for fast iteration", () => {
    const selection = selectGauntletRichScoreMaps(MAPS, { AI_GAUNTLET_SEED: "daily-sample" });

    expect(selection.mode).toBe("sample");
    expect(selection.mapIds).toHaveLength(10);
    expect(new Set(selection.mapIds).size).toBe(10);
    expect(selection.mapIds.every((mapId) => MAPS.includes(mapId))).toBe(true);
  });

  it("keeps the default random sample reproducible when a seed is supplied", () => {
    const first = selectGauntletRichScoreMaps(MAPS, { AI_GAUNTLET_SEED: "same-seed" });
    const second = selectGauntletRichScoreMaps(MAPS, { AI_GAUNTLET_SEED: "same-seed" });

    expect(second.mapIds).toEqual(first.mapIds);
  });

  it("uses the full rich-map family only when explicitly requested", () => {
    const selection = selectGauntletRichScoreMaps(MAPS, { AI_GAUNTLET_FULL: "1", AI_GAUNTLET_SEED: "ignored" });

    expect(selection).toMatchObject({ mode: "full", mapIds: MAPS });
  });
});
