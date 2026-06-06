import { spawn } from "node:child_process";
import { DEFAULT_AI_SCRIPT_VERSION, planAiCommandFrameFromSnapshot, type AiMemoryProvider } from "../src/ai/runtime";
import { SketchRtsSdk } from "../src/sdk/client";
import { runExternalAgentRoom } from "../src/sdk/external-agent-room-runner";
import type { GameSnapshot, PlayerId, RoomState } from "../src/shared/types";

const port = Number(process.env.SDK_AGENT_PLAYER_PORT ?? 5179);
const baseUrl = `http://127.0.0.1:${port}`;
const sdk = new SketchRtsSdk(baseUrl);
const MAX_TICKS = 36_000;
const STEP_TICKS = 45;
const HUMAN_AGENTS = ["player", "enemy"] as const;
const AGENT_VERSIONS = { player: "v2", enemy: "v1" } as const;
const PLANNER_REPORT = { origin: "shared-ai-command-frame", defaultVersion: DEFAULT_AI_SCRIPT_VERSION, versions: AGENT_VERSIONS } as const;

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
    setupRoom: createExternalAgentRoom,
    maxTicks: MAX_TICKS,
    stepTicks: STEP_TICKS,
    planCommands({ snapshot, externalPlayers, teams }) {
      return planAiCommandFrameFromSnapshot(
        snapshot,
        externalPlayers.map((owner) => ({ playerId: owner, source: "external-agent", version: AGENT_VERSIONS[owner] })),
        { teams, memoryProvider },
      ).commands;
    },
  });
  const latest = run.snapshot;
  const endedRoom = run.room;
  const started = run.startedRoom;
  must(started.slots.filter((slot) => slot.controller === "human").length === 2, "external-agent room did not keep two human slots");
  must(started.slots.filter((slot) => slot.controller === "ai").length === 0, "external-agent room secretly registered an internal AI slot");
  const report = {
    ok: latest.match.winner !== null || latest.tick >= MAX_TICKS,
    baseUrl,
    room: endedRoom,
    winner: latest.match.winner,
    endedAtTick: latest.match.endedAtTick,
    tick: latest.tick,
    planner: PLANNER_REPORT,
    cadence: run.cadence,
    commandCount: run.commandCount,
    commandKinds: run.commandKinds,
    scriptCounts: run.scriptCounts,
    elapsedMs: run.elapsedMs,
    totalTickCpuMs: run.totalTickCpuMs,
    goldSpent: latest.match.stats.goldSpent,
    unitsKilled: latest.match.stats.unitsKilled,
    unitsLost: latest.match.stats.unitsLost,
    nonBaseBuildingsDestroyed: latest.match.stats.nonBaseBuildingsDestroyed,
    losingArmies: losingArmies(latest, run.teams),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  assertExternalAgentMatch(latest, endedRoom, run.commandCount, run.commandKinds, run.teams);
} finally {
  await stopServer(server);
}

async function createExternalAgentRoom(): Promise<RoomState> {
  const room = await sdk.createRoom({
    id: "sdk-agent-humans",
    host: { id: "agent-host", name: "SDK Agent Host" },
    mapId: "bareDuel",
    slotCount: 2,
  });
  await sdk.updateRoomSlot(room.id, "slot-1", { controller: "human", userId: "agent-player", name: "External Agent 1", team: "north", race: "grove", ready: true });
  return sdk.updateRoomSlot(room.id, "slot-2", { controller: "human", userId: "agent-enemy", name: "External Agent 2", team: "south", race: "ember", ready: true });
}

function assertExternalAgentMatch(
  snapshot: GameSnapshot,
  room: RoomState | undefined,
  commandCount: number,
  commandKinds: Record<string, number>,
  teams: Record<string, string>,
) {
  if (snapshot.match.winner) {
    must(room?.status === "ended", `external-agent room did not end cleanly after winner: ${room?.status}`);
    must(room.result?.winner === snapshot.match.winner, "room result did not mirror simulation winner");
    must(snapshot.match.endedAtTick !== null && snapshot.match.endedAtTick <= MAX_TICKS, "external SDK agents exceeded 30-minute tick budget");
  } else {
    must(room?.status === "inMatch", `unfinished external-agent smoke room had unexpected status: ${room?.status}`);
    must(snapshot.tick >= MAX_TICKS, "external SDK agents stopped before winner or smoke tick budget");
  }
  must(commandCount > 40, `external SDK agents barely issued commands: ${commandCount}`);
  for (const kind of ["mine", "build", "train", "attackMove"]) {
    must((commandKinds[kind] ?? 0) > 0, `external SDK agents never issued ${kind}`);
  }
  for (const owner of HUMAN_AGENTS) {
    must(snapshot.match.stats.goldSpent[owner] > 1_500, `${owner} did not spend enough gold through SDK policy`);
  }
  must(snapshot.match.stats.unitsKilled.player + snapshot.match.stats.unitsKilled.enemy > 15, "external SDK agents did not fight enough");
  must(snapshot.match.stats.unitsLost.player + snapshot.match.stats.unitsLost.enemy > 15, "external SDK agents did not take enough losses");
  must(snapshot.match.stats.nonBaseBuildingsDestroyed.player + snapshot.match.stats.nonBaseBuildingsDestroyed.enemy > 0, "external SDK agents destroyed no non-base buildings");
  if (snapshot.match.winner) must(Math.max(...Object.values(losingArmies(snapshot, teams))) <= 3, "defeated external agent kept a large unused army");
}

function losingArmies(snapshot: GameSnapshot, teams: Record<string, string>) {
  const winnerTeam = snapshot.match.winner ? teams[snapshot.match.winner] : "";
  return Object.fromEntries(
    HUMAN_AGENTS.filter((owner) => teams[owner] !== winnerTeam).map((owner) => [
      owner,
      snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length,
    ]),
  ) as Record<PlayerId, number>;
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
  throw new Error(`SDK agent-player server did not become ready at ${baseUrl}`);
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
