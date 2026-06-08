import { describe, expect, it } from "vitest";
import { aiBenchmarkDryRunManifest, commonAiBenchmarkOptionsFromArgs } from "./benchmark-cli";

describe("benchmark CLI helpers", () => {
  it("parses the common AI benchmark option surface once", () => {
    expect(commonAiBenchmarkOptionsFromArgs(["--seed", "cli-seed", "--map-count", "12", "--full", "--max-ticks", "100", "--think-interval", "5", "--workers", "7"])).toEqual({
      seed: "cli-seed",
      mapCount: 12,
      full: true,
      maxTicks: 100,
      thinkInterval: 5,
      workers: 7,
    });
  });

  it("builds the common dry-run benchmark manifest shape", () => {
    const manifest = aiBenchmarkDryRunManifest({
      input: {
        name: "Example AI Benchmark",
        evaluations: [
          {
            name: "example lane",
            matches: [
              {
                name: "alpha north",
                mapId: "alpha",
                maxTicks: 10,
                thinkInterval: 2,
                commandPlanner: () => [],
                agents: {
                  v2: { controller: "external-agent", team: "north", race: "grove", version: "v2" },
                },
              },
            ],
          },
        ],
      },
      selection: { seed: "manifest-seed", mapIds: ["alpha"] },
    });

    expect(manifest).toMatchObject({
      name: "Example AI Benchmark",
      seed: "manifest-seed",
      selectedMapIds: ["alpha"],
      matchCount: 1,
      matches: ["alpha north"],
      manifest: {
        evaluationCount: 1,
        matchCount: 1,
        evaluations: [{ name: "example lane", matchCount: 1 }],
      },
    });
  });
});
