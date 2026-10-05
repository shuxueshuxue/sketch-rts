import { describe, expect, it } from "vitest";
import { LADDER_SLOT_IDS } from "../src/shared/map";
import { allocateGauntletBenchmarkMaps, selectGauntletMaps } from "./ai-version-gauntlet-selection";

const MAPS = Array.from({ length: 24 }, (_, index) => `map${index + 1}`);

describe("AI version gauntlet map selection", () => {
  it("samples eighteen maps by default for the benchmark bundle", () => {
    const selection = selectGauntletMaps(MAPS, { AI_GAUNTLET_SEED: "daily-sample" });

    expect(selection.mode).toBe("sample");
    expect(selection.mapIds).toHaveLength(18);
    expect(new Set(selection.mapIds).size).toBe(18);
    expect(selection.mapIds.every((mapId) => MAPS.includes(mapId))).toBe(true);
  });

  it("keeps the default random sample reproducible when a seed is supplied", () => {
    const first = selectGauntletMaps(MAPS, { AI_GAUNTLET_SEED: "same-seed" });
    const second = selectGauntletMaps(MAPS, { AI_GAUNTLET_SEED: "same-seed" });

    expect(second.mapIds).toEqual(first.mapIds);
  });

  it("uses the whole pool only when explicitly requested", () => {
    const selection = selectGauntletMaps(MAPS, { AI_GAUNTLET_FULL: "1", AI_GAUNTLET_SEED: "ignored" });

    expect(selection).toMatchObject({ mode: "full", mapIds: MAPS });
  });

  it("keeps the ladder slot pool at sixty-four named maps", () => {
    expect(LADDER_SLOT_IDS).toHaveLength(64);
    expect(new Set(LADDER_SLOT_IDS).size).toBe(64);
  });

  it("allocates the random sample into score and probe maps", () => {
    const selection = selectGauntletMaps(MAPS, { AI_GAUNTLET_SEED: "same-score-sample" });
    const allocated = allocateGauntletBenchmarkMaps(selection.mapIds);
    const allMatchMapIds = [...allocated.score, ...allocated.oneVThreeProbe, ...allocated.twoVThreeProbe];

    expect(allocated.score).toHaveLength(12);
    expect(allocated.oneVThreeProbe).toHaveLength(3);
    expect(allocated.twoVThreeProbe).toHaveLength(3);
    expect(allMatchMapIds).toEqual(selection.mapIds);
    expect(new Set(allMatchMapIds).size).toBe(18);
  });
});
