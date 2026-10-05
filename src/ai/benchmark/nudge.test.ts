import { describe, expect, it } from "vitest";
import type { SdkGameCommandPlanner, SdkGameCommandPlannerContext } from "../../sdk/game-runner";
import type { GameSnapshot } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";
import { nudgedPlanner, nudgedVersion } from "./nudge";
import type { SubjectGauntletMatch } from "./subject-gauntlet";
import { createAiV8GauntletBenchmarkInput } from "./v8-gauntlet";

const agents: Record<string, AiGameAgent> = {
  p1: { controller: "external-agent", team: "rivals", race: "grove", version: "v5", versionLabel: "v5 grove" },
  v8: { controller: "external-agent", team: "v8-side", race: "ember", version: "v8", versionLabel: "v8 ember" },
  p2: { controller: "external-agent", team: "rivals", race: "ember", version: "v7", versionLabel: "v7 ember" },
};

const worker = (owner: string, id: string) => ({ id, owner, kind: "worker" });

function context(owner: string, tick: number): SdkGameCommandPlannerContext<AiGameAgent> {
  const units = [worker("v8", "unit-v8-worker-9"), worker("v8", "unit-v8-worker-10"), worker("v8", "unit-v8-worker-11"), worker("p1", "unit-p1-worker-3"), { id: "unit-v8-footman-4", owner: "v8", kind: "footman" }];
  return { game: {} as never, snapshot: { tick, units } as unknown as GameSnapshot, owner, agent: agents[owner]!, source: "external-agent", plannerOrigin: "local-command-planner", teams: {} };
}

const own: SdkGameCommandPlanner<AiGameAgent> = ({ owner, source }) => [{ playerId: owner, source, scriptId: "own", command: { type: "stop", unitIds: ["own"] } }];

describe("gauntlet nudges", () => {
  it("stops one of the nudged player's workers once, after its own commands, at its first think from the nudge tick", () => {
    const planner = nudgedPlanner(own, agents, { k: 3, atTick: 1200, who: "v8" });
    expect(planner(context("v8", 1185))).toHaveLength(1);
    expect(planner(context("p1", 1200))).toHaveLength(1);
    // Replay 3 takes the second worker by id: ids sort as text, so worker-10 comes before worker-11 and worker-9.
    expect(planner(context("v8", 1200))).toEqual([
      { playerId: "v8", source: "external-agent", scriptId: "own", command: { type: "stop", unitIds: ["own"] } },
      { playerId: "v8", source: "external-agent", scriptId: "nudge", command: { type: "stop", unitIds: ["unit-v8-worker-11"] } },
    ]);
    expect(planner(context("v8", 1215))).toHaveLength(1);
  });

  it("cycles the nudged version and wraps the worker index", () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => nudgedVersion(["v8", "v5", "v7"], k))).toEqual(["v8", "v5", "v7", "v8", "v5", "v7"]);
    const planner = nudgedPlanner(own, agents, { k: 9, atTick: 0, who: "v8" });
    expect(planner(context("v8", 0))[1]!.command).toEqual({ type: "stop", unitIds: ["unit-v8-worker-10"] });
  });

  it("plays every gauntlet game K times, the same game with the nudge cycling v8, v5, v7", () => {
    const plain = createAiV8GauntletBenchmarkInput({ seed: "v8-nudges", mapCount: 2 }).input.evaluations[0]!.matches;
    const nudged = createAiV8GauntletBenchmarkInput({ seed: "v8-nudges", mapCount: 2, nudges: 3, nudgeAt: 90 }).input.evaluations[0]!.matches;
    expect(nudged.map((match) => match.name)).toEqual(plain.flatMap((match) => [0, 1, 2].map((k) => `${match.name} nudge ${k}`)));
    for (const [index, match] of nudged.entries()) {
      const game = plain[Math.floor(index / 3)]!;
      expect(match.agents).toEqual(game.agents);
      expect(match.mapId).toBe(game.mapId);
      expect((match as SubjectGauntletMatch).nudge).toEqual({ k: index % 3, atTick: 90 * 20, who: ["v8", "v5", "v7"][index % 3] });
    }
    expect(createAiV8GauntletBenchmarkInput({ seed: "v8-nudges", mapCount: 2, nudges: 0 }).input.evaluations[0]!.matches.map((match) => match.name)).toEqual(plain.map((match) => match.name));
  });
});
