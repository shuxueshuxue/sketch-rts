import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { AI_SCRIPT_VERSIONS } from "./policy";
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

  it("dispatches v2-prod through the frozen policy snapshot instead of the live script registry", () => {
    expect(Object.keys(AI_SCRIPT_VERSIONS)).toEqual(["v1", "v2", "v3", "v3-grove", "v3-ember"]);

    const game = createGame("bareDuel", { aiPlayers: [] });
    const commands = planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", version: "v2-prod" }, { teams: game.teams });

    expect(commands[0]).toMatchObject({ playerId: "player", scriptId: "economy", command: { type: "mine" } });
  });

  it("keeps the frozen production policy subtree physically isolated from the live policy modules", () => {
    expect(existsSync("src/ai/policy-v2prod/core.ts")).toBe(true);
    const files = readdirSync("src/ai/policy-v2prod").filter((file) => file.endsWith(".ts"));
    const offenders = files.filter((file) => {
      const source = readFileSync(`src/ai/policy-v2prod/${file}`, "utf8");
      return source.includes("../policy/") || source.includes('from "../policy"');
    });
    const core = readFileSync("src/ai/policy-v2prod/core.ts", "utf8");

    expect(offenders).toEqual([]);
    expect(core).toContain('version: "v2"');
  });
});
