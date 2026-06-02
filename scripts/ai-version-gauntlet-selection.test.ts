import { describe, expect, it } from "vitest";
import { RICH_SCORE_MAP_IDS } from "../src/shared/map";
import { allocateGauntletBenchmarkMaps, selectGauntletRichScoreMaps } from "./ai-version-gauntlet-selection";

const MAPS = Array.from({ length: 18 }, (_, index) => `map${index + 1}`);

describe("AI version gauntlet map selection", () => {
  it("samples seventeen rich maps by default for the benchmark bundle", () => {
    const selection = selectGauntletRichScoreMaps(MAPS, { AI_GAUNTLET_SEED: "daily-sample" });

    expect(selection.mode).toBe("sample");
    expect(selection.mapIds).toHaveLength(17);
    expect(new Set(selection.mapIds).size).toBe(17);
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

  it("keeps the stable rich score pool at sixty-four maps", () => {
    expect(RICH_SCORE_MAP_IDS).toHaveLength(64);
    expect(new Set(RICH_SCORE_MAP_IDS).size).toBe(64);
  });

  it("allocates the random sample into score, probe, and sanity maps", () => {
    const selection = selectGauntletRichScoreMaps(MAPS, { AI_GAUNTLET_SEED: "same-score-sample" });
    const allocated = allocateGauntletBenchmarkMaps(selection.mapIds);
    const allMatchMapIds = [...allocated.score, ...allocated.oneVThreeProbe, ...allocated.twoVThreeProbe, ...allocated.sanity];

    expect(allocated.score).toHaveLength(10);
    expect(allocated.oneVThreeProbe).toHaveLength(2);
    expect(allocated.twoVThreeProbe).toHaveLength(2);
    expect(allocated.sanity).toHaveLength(3);
    expect(allMatchMapIds).toEqual(selection.mapIds);
    expect(new Set(allMatchMapIds).size).toBe(17);
  });
});
