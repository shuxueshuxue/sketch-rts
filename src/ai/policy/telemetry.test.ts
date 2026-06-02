import { describe, expect, it } from "vitest";
import { createAiTelemetry } from "./telemetry";

describe("AI policy telemetry", () => {
  it("creates a complete zeroed behavior counter set", () => {
    const telemetry = createAiTelemetry();

    expect(Object.keys(telemetry.behaviors)).toEqual(["workerHarassment", "earlyHarassment", "skirmishPreservation", "expansionFallback", "economicCatchUp"]);
    for (const stats of Object.values(telemetry.behaviors)) {
      expect(stats).toEqual({
        attempts: 0,
        workerRaidCommands: 0,
        retreatCommands: 0,
        disabledSkips: 0,
        disadvantagedRetreats: 0,
        woundedMeleeSaves: 0,
        woundedRangedPullbacks: 0,
        rangedKites: 0,
        expansionFallbackRetreats: 0,
        catchUpExpansions: 0,
        catchUpTowers: 0,
      });
    }
  });
});
