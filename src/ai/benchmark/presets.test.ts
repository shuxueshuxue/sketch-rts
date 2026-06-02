import { describe, expect, it } from "vitest";
import { runBenchmark } from "../../sdk/benchmark";
import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import { runAiGame } from "../game-runner";
import { createAiVersionBenchmarkInput, runAiVersionBenchmarkParallel, selectGauntletRichScoreMaps, summarizeCombatEvaluation, summarizePairedScoreEvaluation, summarizeSanityEvaluation } from "./presets";

const MAPS = Array.from({ length: 18 }, (_, index) => `map${index + 1}`);

describe("AI benchmark presets", () => {
  it("samples seventeen rich maps by default for the full benchmark bundle", () => {
    const selection = selectGauntletRichScoreMaps(MAPS, { AI_GAUNTLET_SEED: "daily-sample" });

    expect(selection.mode).toBe("sample");
    expect(selection.mapIds).toHaveLength(17);
    expect(new Set(selection.mapIds).size).toBe(17);
    expect(selection.mapIds.every((mapId) => MAPS.includes(mapId))).toBe(true);
  });

  it("uses a fresh random seed when no benchmark seed is supplied", () => {
    const first = selectGauntletRichScoreMaps(MAPS);
    const second = selectGauntletRichScoreMaps(MAPS);

    expect(first.seed).not.toBe(second.seed);
  });

  it("keeps the stable rich score pool at sixty-four maps", () => {
    expect(RICH_SCORE_MAP_IDS).toHaveLength(64);
    expect(new Set(RICH_SCORE_MAP_IDS).size).toBe(64);
  });

  it("builds the visible benchmark as melee score/probes plus tagged combat micro lanes", () => {
    const preset = createAiVersionBenchmarkInput({ seed: "visible-dashboard", mapCount: 17 });

    expect(preset.input.evaluations).toHaveLength(7);
    expect(preset.input.evaluations.map((evaluation) => evaluation.name)).toEqual(["1v2 score", "1v1 score control", "1v3 probe", "2v3 probe", "1v1 sanity", "15v20 mixed combat", "10v12 mixed combat"]);
    expect(preset.input.evaluations.map((evaluation) => evaluation.tag)).toEqual(["melee", "melee", "melee", "melee", "melee", "combat", "combat"]);
    expect(preset.input.evaluations[0]!.matches).toHaveLength(10);
    expect(preset.input.evaluations[0]!.matches[0]!.agents).toMatchObject({
      v2: { version: "v2", team: "north" },
      v1a: { version: "v1", team: "south" },
      v1b: { version: "v1", team: "south" },
    });
    expect(preset.input.evaluations[0]!.matches[0]!.agents.v1c).toBeUndefined();
    expect(preset.input.evaluations[0]!.matches.filter((match) => match.agents.v2?.disabledBehaviors?.includes("workerHarassment")).length).toBe(5);
    expect(preset.input.evaluations[1]!.matches).toHaveLength(10);
    expect(preset.input.evaluations[1]!.matches.map((match) => match.mapId)).toEqual(preset.input.evaluations[0]!.matches.map((match) => match.mapId));
    expect(preset.input.evaluations[1]!.matches[0]!.agents).toMatchObject({
      v2: { version: "v2", team: "north" },
      v1a: { version: "v1", team: "south" },
    });
    expect(preset.input.evaluations[1]!.matches[0]!.agents.v1b).toBeUndefined();
    expect(preset.input.evaluations[2]!.matches).toHaveLength(2);
    expect(preset.input.evaluations[2]!.matches[0]!.agents).toMatchObject({
      v2: { version: "v2", team: "north" },
      v1a: { version: "v1", team: "south" },
      v1b: { version: "v1", team: "south" },
      v1c: { version: "v1", team: "south" },
    });
    expect(preset.input.evaluations[3]!.matches).toHaveLength(2);
    expect(preset.input.evaluations[3]!.matches[0]!.agents).toMatchObject({
      v2: { version: "v2", team: "north" },
      v2b: { version: "v2", team: "north" },
      v1a: { version: "v1", team: "south" },
      v1b: { version: "v1", team: "south" },
      v1c: { version: "v1", team: "south" },
    });
    expect(preset.input.evaluations[4]).toMatchObject({ name: "1v1 sanity" });
    expect(preset.input.evaluations[4]!.matches).toHaveLength(3);
    expect(preset.input.evaluations[5]!.matches).toHaveLength(3);
    expect(preset.input.evaluations[6]!.matches).toHaveLength(3);
    expect(preset.input.evaluations[5]!.matches[0]).toMatchObject({ name: "combatArena 15v20 early mixed", mapId: "combatArena" });
    expect(preset.input.evaluations[6]!.matches[0]).toMatchObject({ name: "combatArena 10v12 early mixed", mapId: "combatArena" });
    expect(Object.keys(preset.input.evaluations[5]!.matches[0]!.agents)).toEqual(["v2", "v1a"]);
    expect(preset.input.evaluations[5]!.matches[0]!.agents.v1a?.version).toBe("v1");
    expect(preset.input.evaluations[5]!.matches[0]!.agents.v1a?.scripts?.map((script) => script.id)).toContain("attackWave");
    const allMatchMapIds = [preset.input.evaluations[0]!, ...preset.input.evaluations.slice(2, 5)].flatMap((evaluation) => evaluation.matches.map((match) => match.mapId));
    expect(allMatchMapIds).toHaveLength(17);
    expect(new Set(allMatchMapIds).size).toBe(17);
    expect(allMatchMapIds).toEqual(preset.selection.mapIds);
    expect(preset.input.evaluations[4]!.matches[0]!.agents.v1b).toBeUndefined();
    expect(preset.input.evaluations[4]!.matches[0]!.agents.v1c).toBeUndefined();
    expect(preset.input.evaluations[4]!.matches[0]!.agents.v2b).toBeUndefined();
  });

  it("uses matching combat recipes for both sides while varying mix, stars, and formation", () => {
    const preset = createAiVersionBenchmarkInput({ seed: "combat-recipes", mapCount: 17 });
    const combatEvaluations = preset.input.evaluations.filter((evaluation) => evaluation.tag === "combat");

    for (const evaluation of combatEvaluations) {
      expect(evaluation.matches.map((match) => match.name)).toEqual(
        expect.arrayContaining([expect.stringContaining("early mixed"), expect.stringContaining("ranged casters"), expect.stringContaining("high-star heavy")]),
      );
      const formations = new Set<string>();
      for (const match of evaluation.matches) {
        const v2Units = match.options?.scenario?.addUnits?.filter((unit) => unit.owner === "v2") ?? [];
        const v1Units = match.options?.scenario?.addUnits?.filter((unit) => unit.owner === "v1a") ?? [];
        const v1Items = match.options?.scenario?.addItems?.filter((item) => item.carrierId?.startsWith("combat-v1a-unit-")) ?? [];
        expect(v2Units.length).toBe(evaluation.name.startsWith("15v20") ? 15 : 10);
        expect(v1Units.length).toBe(evaluation.name.startsWith("15v20") ? 20 : 12);
        expect(v2Units.map((unit) => unit.kind)).toEqual(v1Units.slice(0, v2Units.length).map((unit) => unit.kind));
        expect(v1Items.length).toBeGreaterThan(0);
        formations.add(v2Units.map((unit) => `${Math.round(unit.x)},${Math.round(unit.y)}`).join("|"));
        if (match.name.includes("ranged casters")) expect(v2Units.some((unit) => unit.kind === "summoner" || unit.kind === "witch" || unit.kind === "priest")).toBe(true);
        if (match.name.includes("high-star heavy")) expect(v2Units.some((unit) => unit.xp !== undefined && unit.xp > 0)).toBe(true);
      }
      expect(formations.size).toBe(3);
    }
  });

  it("allocates score, probe, and sanity maps from one seventeen-map random sample", () => {
    const preset = createAiVersionBenchmarkInput({ seed: "api-dashboard-smoke", mapCount: 17 });

    const allMatchMapIds = [preset.input.evaluations[0]!, ...preset.input.evaluations.slice(2, 5)].flatMap((evaluation) => evaluation.matches.map((match) => match.mapId));
    const scoreControlMapIds = preset.input.evaluations[1]!.matches.map((match) => match.mapId);
    const sanityMapIds = preset.input.evaluations[4]!.matches.map((match) => match.mapId);
    expect(preset.selection.mapIds).toHaveLength(17);
    expect(allMatchMapIds).toEqual(preset.selection.mapIds);
    expect(scoreControlMapIds).toEqual(preset.input.evaluations[0]!.matches.map((match) => match.mapId));
    expect(sanityMapIds).toHaveLength(3);
    expect(new Set(sanityMapIds).size).toBe(3);
  });

  it("requires each 1v2 score win to have a same-map 1v1 control win", () => {
    const summary = summarizePairedScoreEvaluation(
      {
        name: "1v2 score",
        tag: "melee",
        startedAt: "now",
        elapsedMs: 0,
        cpuMs: 0,
        matchCount: 2,
        matches: [
          {
            name: "map-a 1v2",
            elapsedMs: 0,
            cpuMs: 0,
            setup: { map: { id: "map-a" } } as never,
            result: { winnerTeam: "north", players: { v2: { enemyUnitKills: 9 } } } as never,
          },
          {
            name: "map-b 1v2",
            elapsedMs: 0,
            cpuMs: 0,
            setup: { map: { id: "map-b" } } as never,
            result: { winnerTeam: "north", players: { v2: { enemyUnitKills: 9 } } } as never,
          },
        ],
      },
      {
        name: "1v1 score control",
        tag: "melee",
        startedAt: "now",
        elapsedMs: 0,
        cpuMs: 0,
        matchCount: 2,
        matches: [
          {
            name: "map-a 1v1 control",
            elapsedMs: 0,
            cpuMs: 0,
            setup: { map: { id: "map-a" } } as never,
            result: { winnerTeam: "south", players: { v2: { enemyUnitKills: 1 }, v1a: { unitsLost: 1, unitsKilledByNeutral: 0 } } } as never,
          },
          {
            name: "map-b 1v1 control",
            elapsedMs: 0,
            cpuMs: 0,
            setup: { map: { id: "map-b" } } as never,
            result: { winnerTeam: "north", players: { v2: { enemyUnitKills: 7 }, v1a: { unitsLost: 7, unitsKilledByNeutral: 0 } } } as never,
          },
        ],
      },
    );

    expect(summary).toMatchObject({ name: "paired 1v2 score", wins: 1, losses: 1, failures: 1, successRate: 0.5, matchCount: 2 });
  });

  it("summarizes combat as combat-unit elimination by the north side", () => {
    const summary = summarizeCombatEvaluation({
      name: "15v20 mixed combat",
      tag: "combat",
      startedAt: "now",
      elapsedMs: 0,
      cpuMs: 0,
      matchCount: 1,
      matches: [
        {
          name: "combat",
          elapsedMs: 0,
          cpuMs: 0,
          setup: {} as never,
          result: {
            winnerTeam: "south",
            players: {
              v2: { team: "north", enemyUnitKills: 20, unitsLost: 3, finalSupply: 24 } as never,
              v1a: { team: "south", enemyUnitKills: 3, unitsLost: 20, finalSupply: 0 } as never,
            },
          } as never,
        },
      ],
    });

    expect(summary).toMatchObject({ wins: 1, losses: 0, failures: 0, successRate: 1 });
  });

  it("runs combat lanes on a small arena where both AI versions actively fight", () => {
    const preset = createAiVersionBenchmarkInput({ seed: "combat-smoke", mapCount: 17, maxTicks: 1_500 });
    const combatEvaluation = preset.input.evaluations.find((evaluation) => evaluation.name === "15v20 mixed combat");
    if (!combatEvaluation) throw new Error("missing 15v20 combat evaluation");

    const report = runBenchmark({ name: "combat smoke", evaluations: [combatEvaluation] });
    const match = report.evaluations[0]!.matches[0]!;

    expect(match.setup.map).toMatchObject({ id: "combatArena", width: 1600, height: 1600 });
    expect(match.setup.map.items.total).toBeGreaterThanOrEqual(7);
    expect(match.result.players.v2?.firstEnemyEngagementSecond).not.toBeNull();
    expect(match.result.players.v1a?.firstEnemyEngagementSecond).not.toBeNull();
  });

  it("runs the combat micro targets and reports each recipe outcome separately", () => {
    const preset = createAiVersionBenchmarkInput({ seed: "combat-smoke", mapCount: 17, maxTicks: 9_000 });
    const combatEvaluations = preset.input.evaluations.filter((evaluation) => evaluation.tag === "combat");

    const report = runBenchmark({ name: "combat target smoke", evaluations: combatEvaluations });
    const summaries = report.evaluations.map((evaluation) => summarizeCombatEvaluation(evaluation));

    expect(summaries).toEqual([
      expect.objectContaining({ name: "15v20 mixed combat", matchCount: 3 }),
      expect.objectContaining({ name: "10v12 mixed combat", matchCount: 3 }),
    ]);
    expect(report.evaluations.flatMap((evaluation) => evaluation.matches).every((match) => match.result.players.v2?.firstEnemyEngagementSecond !== null && match.result.players.v1a?.firstEnemyEngagementSecond !== null)).toBe(true);
  });

  it("starts combat lanes by sending v2 toward the enemy instead of back to its anchor", () => {
    const preset = createAiVersionBenchmarkInput({ seed: "combat-smoke", mapCount: 17, maxTicks: 45 });
    const combatEvaluation = preset.input.evaluations.find((evaluation) => evaluation.name === "15v20 mixed combat");
    if (!combatEvaluation) throw new Error("missing 15v20 combat evaluation");
    const match = combatEvaluation.matches[0]!;

    const report = runAiGame({ ...match, trace: { commands: true } });
    const attackWaveCommands = report.commands.filter((entry) => entry.tick === 0 && entry.owner === "v2" && entry.scriptId === "attackWave");

    expect(attackWaveCommands.map((entry) => entry.command)).toEqual([
      expect.objectContaining({ type: "attackMove", x: expect.any(Number), y: expect.any(Number) }),
    ]);
    expect(attackWaveCommands.some((entry) => (entry.command.type === "move" || entry.command.type === "attackMove") && entry.command.x === 150 && entry.command.y === 800)).toBe(false);
  });

  it("does not pass 1v1 sanity when the opponent only died to neutral creeps", () => {
    const summary = summarizeSanityEvaluation({
      name: "1v1 sanity",
      startedAt: "now",
      elapsedMs: 0,
      cpuMs: 0,
      matchCount: 1,
      matches: [
        {
          name: "fake 1v1",
          elapsedMs: 0,
          cpuMs: 0,
          setup: {} as never,
          result: {
            winnerTeam: "north",
            players: {
              v2: { enemyUnitKills: 0 } as never,
              v1a: { unitsLost: 7, unitsKilledByNeutral: 7 } as never,
            },
          } as never,
        },
      ],
    });

    expect(summary).toMatchObject({ wins: 0, losses: 1, failures: 1, successRate: 0 });
  });

  it("runs the AI benchmark preset through SDK parallel workers", async () => {
    const run = await runAiVersionBenchmarkParallel({ seed: "parallel-smoke", mapCount: 1, maxTicks: 1, workers: 2 });

    expect(run.report.matchCount).toBe(8);
    expect(run.scoreSummary).toMatchObject({ name: "paired 1v2 score", matchCount: 1 });
    expect(run.scoreControlSummary).toMatchObject({ name: "1v1 score control", matchCount: 1 });
    expect(run.report.evaluations.map((evaluation) => evaluation.name)).toEqual(["1v2 score", "1v1 score control", "1v3 probe", "2v3 probe", "1v1 sanity", "15v20 mixed combat", "10v12 mixed combat"]);
  });
});
