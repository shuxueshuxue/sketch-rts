import { spawn } from "node:child_process";
import { DEFAULT_AI_SCRIPT_VERSION, planAiCommandFrameFromSnapshot, type AiMemoryProvider } from "../src/ai/runtime";
import { SketchRtsSdk } from "../src/sdk/client";
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
  const room = await createExternalAgentRoom();
  const teams = Object.fromEntries(room.slots.map((slot) => [slot.playerId, slot.team]));
  const started = await sdk.startRoom(room.id);
  must(started.slots.filter((slot) => slot.controller === "human").length === 2, "external-agent room did not keep two human slots");
  must(started.slots.filter((slot) => slot.controller === "ai").length === 0, "external-agent room secretly registered an internal AI slot");

  const runStarted = performance.now();
  const cpuStarted = process.cpuUsage();
  let latest = await sdk.roomSnapshot(room.id);
  let commandCount = 0;
  const commandKinds: Record<string, number> = {};
  const scriptCounts: Record<string, number> = {};
  const memoryProvider = createScriptMemoryProvider();

  while (!latest.match.winner && latest.tick < MAX_TICKS) {
    for (const owner of HUMAN_AGENTS) {
      latest = await sdk.roomSnapshot(room.id);
      for (const entry of planAiCommandFrameFromSnapshot(latest, [{ playerId: owner, source: "external-agent", version: AGENT_VERSIONS[owner] }], { teams, memoryProvider }).commands) {
        latest = await sdk.roomCommand(room.id, owner, entry.command);
        commandCount += 1;
        commandKinds[entry.command.type] = (commandKinds[entry.command.type] ?? 0) + 1;
        scriptCounts[entry.scriptId] = (scriptCounts[entry.scriptId] ?? 0) + 1;
      }
    }
    const ticked = await sdk.tickRoom(room.id, STEP_TICKS);
    latest = ticked.snapshot;
  }

  const endedRoom = (await sdk.listRooms()).find((candidate) => candidate.id === room.id);
  const cpu = process.cpuUsage(cpuStarted);
  const report = {
    ok: endedRoom?.status === "ended" && latest.match.winner !== null,
    baseUrl,
    room: endedRoom,
    winner: latest.match.winner,
    endedAtTick: latest.match.endedAtTick,
    tick: latest.tick,
    planner: PLANNER_REPORT,
    commandCount,
    commandKinds,
    scriptCounts,
    elapsedMs: Number((performance.now() - runStarted).toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    goldSpent: latest.match.stats.goldSpent,
    unitsKilled: latest.match.stats.unitsKilled,
    unitsLost: latest.match.stats.unitsLost,
    nonBaseBuildingsDestroyed: latest.match.stats.nonBaseBuildingsDestroyed,
    losingArmies: losingArmies(latest, teams),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  assertExternalAgentMatch(latest, endedRoom, commandCount, commandKinds, teams);
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
  must(room?.status === "ended", `external-agent room did not end cleanly: ${room?.status}`);
  must(room.result?.winner === snapshot.match.winner, "room result did not mirror simulation winner");
  must(snapshot.match.winner !== null, "external SDK agents did not produce a winner");
  must(snapshot.match.endedAtTick !== null && snapshot.match.endedAtTick <= MAX_TICKS, "external SDK agents exceeded 30-minute tick budget");
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
  must(Math.max(...Object.values(losingArmies(snapshot, teams))) <= 3, "defeated external agent kept a large unused army");
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
