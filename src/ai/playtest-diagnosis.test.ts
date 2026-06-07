import { describe, expect, it } from "vitest";
import { runAiPlaytestDiagnosis } from "./playtest-diagnosis";

describe("AI playtest diagnosis", () => {
  it("samples reusable checkpoints with plans without mutating the diagnosed runtime", () => {
    const diagnosis = runAiPlaytestDiagnosis({
      args: ["--id", "diagnosis-combat", "--setup", "combat-10v12", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a", "--assist-you"],
      checkpoints: [{ type: "initial" }, { type: "tick", tick: 45 }],
      planOwners: ["v2"],
    });

    expect(diagnosis.samples.map((sample) => sample.tick)).toEqual([0, 45]);
    expect(diagnosis.samples[0]).toMatchObject({
      label: "initial",
      tick: 0,
      gameSecond: 0,
      plans: {
        v2: {
          owner: "v2",
          entries: expect.arrayContaining([
            expect.objectContaining({
              playerId: "v2",
              scriptId: "attackWave",
              command: expect.objectContaining({ type: "attackMove" }),
            }),
          ]),
        },
      },
    });
    const tickSample = diagnosis.samples[1];
    expect(tickSample).toBeDefined();
    const tickPlan = tickSample!.plans.v2;
    expect(tickPlan).toBeDefined();
    expect(tickPlan!.entries.length).toBeGreaterThan(0);
    expect(diagnosis.finalSummary.tick).toBe(45);
    expect(diagnosis.file.session.id).toBe("diagnosis-combat");
    expect(diagnosis.file.runtime.lastThink.v2).toBe(30);
  });

  it("can include inspected units at every checkpoint through the shared inspection primitive", () => {
    const diagnosis = runAiPlaytestDiagnosis({
      args: ["--id", "diagnosis-units", "--setup", "combat-10v12", "--recipe", "early-mixed", "--you", "v2", "--enemy", "v1a", "--assist-you"],
      checkpoints: [{ type: "initial" }, { type: "tick", tick: 45 }],
      planOwners: ["v2"],
      inspectOwner: "v2",
    });

    expect(diagnosis.samples).toHaveLength(2);
    expect(diagnosis.samples[0]!.inspections.v2).toMatchObject({
      owner: "v2",
      units: expect.arrayContaining([
        expect.objectContaining({
          owner: "v2",
          hp: expect.any(Number),
          order: expect.objectContaining({ type: expect.any(String) }),
        }),
      ]),
    });
    expect(diagnosis.samples[1]!.inspections.v2!.units.some((unit) => unit.memoryClaim !== null)).toBe(true);
  });
});
