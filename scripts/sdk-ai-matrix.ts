import { spawn } from "node:child_process";
import { AI_MATRIX_CASES, AI_MATRIX_MAX_TICKS, assertAiMatrixCase, createExpansionProof, losingArmies, sampleExpansionProof, type AiMatrixCase } from "../src/ai/benchmark/matrix";
import { SketchRtsSdk } from "../src/sdk/client";

const port = Number(process.env.SDK_AI_MATRIX_PORT ?? 5175);
const baseUrl = `http://127.0.0.1:${port}`;
const sdk = new SketchRtsSdk(baseUrl);
const host = { id: "sdk-ai-matrix-host", name: "SDK AI Matrix Host" };
const runId = Date.now().toString(36);

let server: ReturnType<typeof spawn> | undefined;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ROOM_AUTOTICK: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  await waitForSdk();
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  const reports = [];
  for (const testCase of AI_MATRIX_CASES) {
    reports.push(await runCase(testCase));
  }
  const cpu = process.cpuUsage(cpuStarted);
  const memory = process.memoryUsage();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        runner: "sdk",
        baseUrl,
        totalElapsedMs: Number((performance.now() - started).toFixed(3)),
        totalCpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        reports,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (server && !server.killed) {
    server.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!server.killed) server.kill("SIGTERM");
  }
}

async function runCase(testCase: AiMatrixCase) {
  const expansionProof = createExpansionProof(testCase.activePlayers);
  const caseStarted = performance.now();
  const roomId = `sdk-ai-matrix-${runId}-${slug(testCase.name)}`;
  await sdk.createRoom({
    id: roomId,
    host,
    mapId: testCase.mapId,
    visibility: "private",
    humanCount: 1,
    aiCount: Math.max(1, testCase.activePlayers.length - 1),
  });
  await sdk.resetRoom(roomId, testCase.mapId, testCase.options);
  const result = await sdk.tickRoomUntil(roomId, {
    until: (snapshot) => snapshot.match.winner !== null,
    maxTicks: AI_MATRIX_MAX_TICKS,
    chunkTicks: 45,
    maxElapsedMs: 6_000,
    maxCpuMs: 7_000,
  });
  for (const sample of result.samples) sampleExpansionProof(sample.snapshot, testCase.activePlayers, expansionProof);
  sampleExpansionProof(result.snapshot, testCase.activePlayers, expansionProof);
  assertAiMatrixCase(testCase, {
    snapshot: result.snapshot,
    totalTicks: result.totalTicks,
    elapsedMs: result.elapsedMs,
    cpuMs: result.cpuMs,
    memorySamples: result.samples.map((sample) => sample.memory),
    expansionProof,
    budget: { maxTicks: AI_MATRIX_MAX_TICKS, maxElapsedMs: 6_000, maxCpuMs: 7_000, requireMemorySamples: true },
  });
  return {
    name: testCase.name,
    runner: "sdk",
    mapId: testCase.mapId,
    winner: result.snapshot.match.winner,
    endedAtTick: result.snapshot.match.endedAtTick,
    totalTicks: result.totalTicks,
    elapsedMs: Number(result.elapsedMs.toFixed(3)),
    cpuMs: Number(result.cpuMs.toFixed(3)),
    wallElapsedMs: Number((performance.now() - caseStarted).toFixed(3)),
    samples: result.samples.length,
    lastMemory: result.samples.at(-1)?.memory,
    races: Object.fromEntries(testCase.activePlayers.map((owner) => [owner, result.snapshot.players[owner].race])),
    unitsKilled: result.snapshot.match.stats.unitsKilled,
    unitsLost: result.snapshot.match.stats.unitsLost,
    goldSpent: result.snapshot.match.stats.goldSpent,
    neutralUnitsKilled: result.snapshot.match.stats.neutralUnitsKilled,
    mercenaryKills: result.snapshot.match.stats.mercenaryKills,
    nonBaseBuildingsDestroyed: result.snapshot.match.stats.nonBaseBuildingsDestroyed,
    losingArmies: losingArmies(result.snapshot, testCase),
    expansionProof,
  };
}

async function waitForSdk() {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      await sdk.catalog();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw new Error(`SDK AI matrix server did not become ready at ${baseUrl}`);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
