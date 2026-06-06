import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { createAiMemoryProvider, planAiOwnerCommandEntries } from "./planner-context";
import type { AiPolicyMemory, AiScript } from "./policy";

describe("AI planner context boundary", () => {
  it("keeps runtime and SDK game-runner on one owner planner context primitive", () => {
    const gameRunnerSource = readFileSync("src/ai/game-runner.ts", "utf8");
    const runtimeSource = readFileSync("src/ai/runtime.ts", "utf8");

    expect(gameRunnerSource).toContain("planAiOwnerCommandEntries");
    expect(runtimeSource).toContain("planAiOwnerCommandEntries");

    const gameRunnerForbidden = ["AI_SCRIPT_VERSIONS", "SKETCH_RTS_PRESET_AI_STACK", "createAiPolicyMemory", "planAiCommandEntriesFromScripts"];
    const gameRunnerOffenders = gameRunnerForbidden.filter((needle) => gameRunnerSource.includes(needle));

    expect(gameRunnerOffenders).toEqual([]);
  });

  it("resolves owner scripts and keeps per-owner memory through one provider", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const memories: Record<string, AiPolicyMemory> = {};
    const seen: Array<{ version: string | undefined; policyMode: string | undefined; disabledBehaviors: readonly string[] | undefined; jobCount: number }> = [];
    const script: AiScript = {
      id: "planner-context-probe",
      phase: "tactics",
      run(_snapshot, _owner, options) {
        seen.push({
          version: options.version,
          policyMode: options.policyMode,
          disabledBehaviors: options.disabledBehaviors,
          jobCount: options.memory.jobs.length,
        });
        options.memory.jobs.push({ id: `probe-${options.memory.jobs.length}`, kind: "probe", createdTick: 0, updatedTick: 0 });
        return undefined;
      },
    };
    const provider = createAiMemoryProvider(memories);

    planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", version: "v1", scripts: [script], policyMode: "combat", disabledBehaviors: ["workerHarassment"] }, { teams: game.teams, memoryProvider: provider });
    planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", version: "v1", scripts: [script], policyMode: "combat", disabledBehaviors: ["workerHarassment"] }, { teams: game.teams, memoryProvider: provider });

    expect(seen).toEqual([
      { version: "v1", policyMode: "combat", disabledBehaviors: ["workerHarassment"], jobCount: 0 },
      { version: "v1", policyMode: "combat", disabledBehaviors: ["workerHarassment"], jobCount: 1 },
    ]);
    const playerMemory = memories.player;
    expect(playerMemory).toBeDefined();
    expect(playerMemory!.jobs.map((job) => job.id)).toEqual(["probe-0", "probe-1"]);
  });
});
