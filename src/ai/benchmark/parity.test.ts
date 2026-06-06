import { describe, expect, it } from "vitest";
import { createAiVersionBenchmarkInput } from "./presets";
import { runAiBenchmarkRunnerParityProbe } from "./parity";

describe("AI benchmark runner parity", () => {
  it("proves serial and parallel workers share setup and core results for the same formal match", async () => {
    const preset = createAiVersionBenchmarkInput({ seed: "runner-parity", mapCount: 1, maxTicks: 1 });
    const controlMatch = preset.input.evaluations.find((evaluation) => evaluation.name === "1v1 score control")?.matches[0];
    if (!controlMatch) throw new Error("missing 1v1 score control match");

    const proof = await runAiBenchmarkRunnerParityProbe({
      name: "runner parity probe",
      evaluations: [{ name: "1v1 score control", tag: "melee", matches: [controlMatch] }],
    });

    expect(proof.serialManifest.evaluations[0]?.matches[0]?.commandPlanner).toBe("present");
    expect(proof.parallelManifest.evaluations[0]?.matches[0]?.commandPlanner).toBe("absent");
    expect(proof.setupEqual).toBe(true);
    expect(proof.coreResultEqual).toBe(true);
    expect(proof.directResultEqual).toBe(true);
    expect(proof.serialReport).toEqual(proof.parallelReport);
    expect(proof.probes[0]).toMatchObject({
      evaluationName: "1v1 score control",
      matchName: controlMatch.name,
      setupEqual: true,
      coreResultEqual: true,
      directResultEqual: true,
    });
  });
});
