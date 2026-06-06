import { createAiRuntime, createPresetAiRuntimeFramePlanner } from "../src/ai/runtime";
import { AI_MATRIX_CASES, AI_MATRIX_MAX_TICKS, assertAiMatrixCase, createExpansionProof, expansionTeamsWithMining, losingArmies, sampleExpansionProof, type AiMatrixCase } from "../src/ai/benchmark/matrix";
import { createGame } from "../src/shared/sim";
import { CommandFrameRuntime } from "../src/shared/sim/command-frame-runtime";

const matrixStarted = performance.now();
const cpuStarted = process.cpuUsage();
const reports = AI_MATRIX_CASES.map(runCase);
const cpu = process.cpuUsage(cpuStarted);
const memory = process.memoryUsage();

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      runner: "local",
      totalElapsedMs: Number((performance.now() - matrixStarted).toFixed(3)),
      totalCpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      reports,
    },
    null,
    2,
  )}\n`,
);

function runCase(testCase: AiMatrixCase) {
  const game = createGame(testCase.mapId, testCase.options);
  const runtime = createAiRuntime(testCase.options.aiPlayers ?? []);
  const frameRuntime = new CommandFrameRuntime({
    game,
    roomId: "ai-matrix",
    rejectionLabel: "AI matrix command rejected",
    aiPlanner: createPresetAiRuntimeFramePlanner(game, runtime),
  });
  const expansionProof = createExpansionProof(testCase.activePlayers);
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  sampleExpansionProof(game, testCase.activePlayers, expansionProof);
  for (let i = 0; i < AI_MATRIX_MAX_TICKS && !game.match.winner; i += 1) {
    frameRuntime.tick();
    if (game.tick % 45 === 0) sampleExpansionProof(game, testCase.activePlayers, expansionProof);
  }
  sampleExpansionProof(game, testCase.activePlayers, expansionProof);
  const cpu = process.cpuUsage(cpuStarted);
  const elapsedMs = performance.now() - started;

  assertAiMatrixCase(testCase, {
    snapshot: game,
    totalTicks: game.tick,
    elapsedMs,
    expansionProof,
    budget: { maxTicks: AI_MATRIX_MAX_TICKS, maxElapsedMs: 2_500 },
  });
  return {
    name: testCase.name,
    runner: "local",
    mapId: testCase.mapId,
    tick: game.tick,
    winner: game.match.winner,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    unitsKilled: game.match.stats.unitsKilled,
    unitsLost: game.match.stats.unitsLost,
    goldSpent: game.match.stats.goldSpent,
    races: Object.fromEntries(testCase.activePlayers.map((owner) => [owner, game.players[owner].race])),
    nonBaseBuildingsDestroyed: game.match.stats.nonBaseBuildingsDestroyed,
    neutralUnitsKilled: game.match.stats.neutralUnitsKilled,
    mercenaryKills: game.match.stats.mercenaryKills,
    losingArmies: losingArmies(game, testCase),
    expansionProof,
    expansionTeamsWithMining: expansionTeamsWithMining(game, testCase, expansionProof),
  };
}
