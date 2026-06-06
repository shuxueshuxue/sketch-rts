import { spawn } from "node:child_process";
import { DEFAULT_AI_SCRIPT_VERSION, planAiCommandFrameFromSnapshot, type AiMemoryProvider } from "../src/ai/runtime";
import { SketchRtsSdk } from "../src/sdk/client";
import { runExternalAgentRoom } from "../src/sdk/external-agent-room-runner";
import type { GameSnapshot, PlayerId, RoomState } from "../src/shared/types";

const port = Number(process.env.SDK_AGENT_15V15_PORT ?? 5180);
const baseUrl = `http://127.0.0.1:${port}`;
const sdk = new SketchRtsSdk(baseUrl);
const HUMAN_COUNT = Number(process.env.GRAND_STRESS_HUMANS ?? 15);
const AI_COUNT = Number(process.env.GRAND_STRESS_AIS ?? 15);
const STRESS_NAME = `${HUMAN_COUNT}v${AI_COUNT}`;
const MAX_TICKS = Number(process.env.SDK_AGENT_15V15_MAX_TICKS ?? 10_800);
const STEP_TICKS = 45;
const MAX_WALL_MS = process.env.SDK_AGENT_15V15_MAX_WALL_MS === undefined ? undefined : Number(process.env.SDK_AGENT_15V15_MAX_WALL_MS);
const EXTERNAL_AGENT_VERSION = "v1";
const PLANNER_REPORT = { origin: "shared-ai-command-frame", defaultVersion: DEFAULT_AI_SCRIPT_VERSION, externalAgentVersion: EXTERNAL_AGENT_VERSION } as const;

let server: ReturnType<typeof spawn> | undefined;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ROOM_AUTOTICK: "0" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  await waitForSdk();
  const memoryProvider = createScriptMemoryProvider();
  const run = await runExternalAgentRoom({
    sdk,
    setupRoom: createGrandStressRoom,
    maxTicks: MAX_TICKS,
    stepTicks: STEP_TICKS,
    ...(MAX_WALL_MS === undefined ? {} : { maxWallMs: MAX_WALL_MS }),
    planCommands({ snapshot, externalPlayers, teams }) {
      return planAiCommandFrameFromSnapshot(
        snapshot,
        externalPlayers.map((owner) => ({ playerId: owner, source: "external-agent", version: EXTERNAL_AGENT_VERSION })),
        { teams, memoryProvider },
      ).commands;
    },
    onProgress({ snapshot, elapsedMs, totalTickCpuMs }) {
      if (snapshot.tick > 0 && snapshot.tick % 3_600 === 0) {
        process.stderr.write(`${STRESS_NAME} progress tick=${snapshot.tick} elapsedMs=${elapsedMs.toFixed(1)} cpuMs=${totalTickCpuMs.toFixed(1)}\n`);
      }
    },
  });
  const latest = run.snapshot;
  const endedRoom = run.room;
  const humanAgents = run.externalPlayers;
  const internalAis = run.internalPlayers;
  const started = run.startedRoom;
  must(started.mapId === "grandThirty", `${STRESS_NAME} room did not start on grandThirty`);
  must(started.slots.filter((slot) => slot.controller === "human").length === HUMAN_COUNT, "human slots changed at start");
  must(started.slots.filter((slot) => slot.controller === "ai").length === AI_COUNT, "internal AI slots changed at start");
  const report = {
    ok: latest.match.winner !== null || latest.tick >= MAX_TICKS,
    stressName: STRESS_NAME,
    humanCount: HUMAN_COUNT,
    aiCount: AI_COUNT,
    baseUrl,
    winner: latest.match.winner,
    endedAtTick: latest.match.endedAtTick,
    tick: latest.tick,
    roomStatus: endedRoom?.status,
    planner: PLANNER_REPORT,
    cadence: run.cadence,
    wallBudgetMs: MAX_WALL_MS ?? null,
    elapsedMs: run.elapsedMs,
    totalTickCpuMs: run.totalTickCpuMs,
    heapMin: run.heapMin,
    heapMax: run.heapMax,
    commandKinds: run.commandKinds,
    scriptCounts: run.scriptCounts,
    activeCommandingHumans: Object.values(run.commandsByOwner).filter((count) => count > 0).length,
    humanGoldSpent: sumOwners(humanAgents, latest.match.stats.goldSpent),
    internalAiGoldSpent: sumOwners(internalAis, latest.match.stats.goldSpent),
    humanKills: sumOwners(humanAgents, latest.match.stats.unitsKilled),
    internalAiKills: sumOwners(internalAis, latest.match.stats.unitsKilled),
    humanLosses: sumOwners(humanAgents, latest.match.stats.unitsLost),
    internalAiLosses: sumOwners(internalAis, latest.match.stats.unitsLost),
    nonBaseBuildingsDestroyed: {
      humans: sumOwners(humanAgents, latest.match.stats.nonBaseBuildingsDestroyed),
      internalAis: sumOwners(internalAis, latest.match.stats.nonBaseBuildingsDestroyed),
    },
    losingArmy: losingArmy(latest, run.teams),
    losingArmyPerPlayer: losingArmyPerPlayer(latest, run.teams, [...humanAgents, ...internalAis]),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  assertGrandThirty(report, latest, endedRoom, humanAgents, internalAis, run.teams);
} finally {
  await stopServer(server);
}

async function createGrandStressRoom(): Promise<RoomState> {
  return sdk.createGrandThirtyRoom({ id: "agent-host", name: "Grand Agent Host" }, `sdk-agent-grand-thirty-${STRESS_NAME}`, {
    humanCount: HUMAN_COUNT,
    aiCount: AI_COUNT,
  });
}

function assertGrandThirty(
  report: Record<string, unknown>,
  snapshot: GameSnapshot,
  room: RoomState | undefined,
  humanAgents: PlayerId[],
  internalAis: PlayerId[],
  teams: Record<string, string>,
) {
  if (snapshot.match.winner) {
    must(room?.status === "ended", `${STRESS_NAME} room did not end cleanly after winner: ${room?.status}`);
    must(snapshot.match.endedAtTick !== null && snapshot.match.endedAtTick <= MAX_TICKS, `${STRESS_NAME} exceeded development tick budget`);
  } else {
    must(room?.status === "inMatch", `${STRESS_NAME} unfinished smoke room had unexpected status: ${room?.status}`);
    must(snapshot.tick >= MAX_TICKS, `${STRESS_NAME} stopped before winner or smoke tick budget`);
  }
  must((report.activeCommandingHumans as number) >= Math.min(12, humanAgents.length), "too few external human agents issued commands");
  must(((report.commandKinds as Record<string, number>).attackMove ?? 0) > 0, "external human agents never issued attack-move commands");
  must((report.humanGoldSpent as number) > 8_000, "external human team did not spend enough gold");
  must((report.internalAiGoldSpent as number) > 8_000, "internal AI team did not spend enough gold");
  must((report.humanKills as number) + (report.internalAiKills as number) > 30, `${STRESS_NAME} did not produce enough kills`);
  if (HUMAN_COUNT !== AI_COUNT && snapshot.match.winner) {
    const winnerTeam = snapshot.match.winner ? teams[snapshot.match.winner] : "";
    const expectedTeam = HUMAN_COUNT > AI_COUNT ? "north" : "south";
    must(winnerTeam === expectedTeam, `${STRESS_NAME} did not produce decisive numerical-advantage winner: expected ${expectedTeam}, got ${winnerTeam}`);
  }
  if (snapshot.match.winner) {
    must((report.losingArmyPerPlayer as number) <= 3, `defeated ${STRESS_NAME} team kept a large unused army per player`);
  }
  must(humanAgents.every((owner) => snapshot.players[owner]), "snapshot missing at least one external human player");
  must(internalAis.every((owner) => snapshot.players[owner]), "snapshot missing at least one internal AI player");
}

function losingArmy(snapshot: GameSnapshot, teams: Record<string, string>) {
  const winnerTeam = snapshot.match.winner ? teams[snapshot.match.winner] : "";
  return snapshot.units.filter((unit) => unit.owner !== "neutral" && teams[unit.owner] !== winnerTeam && unit.kind !== "worker").length;
}

function losingArmyPerPlayer(snapshot: GameSnapshot, teams: Record<string, string>, activePlayers: PlayerId[]) {
  const winnerTeam = snapshot.match.winner ? teams[snapshot.match.winner] : "";
  const losingPlayers = activePlayers.filter((owner) => teams[owner] !== winnerTeam).length || 1;
  return losingArmy(snapshot, teams) / losingPlayers;
}

function sumOwners(owners: PlayerId[], record: Record<PlayerId, number>) {
  return owners.reduce((total, owner) => total + (record[owner] ?? 0), 0);
}

function createScriptMemoryProvider(): AiMemoryProvider {
  const memories = new Map<PlayerId, NonNullable<ReturnType<AiMemoryProvider["get"]>>>();
  return {
    get: (owner) => memories.get(owner),
    set: (owner, memory) => memories.set(owner, memory),
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
  throw new Error(`SDK 15v15 server did not become ready at ${baseUrl}`);
}

async function stopServer(process: ReturnType<typeof spawn> | undefined) {
  if (!process?.pid) return;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    try {
      globalThis.process.kill(-process.pid, signal);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
