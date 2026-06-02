import { spawn } from "node:child_process";
import { planPresetAiCommands } from "../src/ai/policy";
import { SketchRtsSdk } from "../src/sdk/client";
import type { GameSnapshot, PlayerId, RoomState } from "../src/shared/types";

const port = Number(process.env.SDK_AGENT_15V15_PORT ?? 5180);
const baseUrl = `http://127.0.0.1:${port}`;
const sdk = new SketchRtsSdk(baseUrl);
const HUMAN_COUNT = Number(process.env.GRAND_STRESS_HUMANS ?? 15);
const AI_COUNT = Number(process.env.GRAND_STRESS_AIS ?? 15);
const STRESS_NAME = `${HUMAN_COUNT}v${AI_COUNT}`;
const MAX_TICKS = 48_000;
const STEP_TICKS = 45;
const MAX_WALL_MS = 25_000;

let server: ReturnType<typeof spawn> | undefined;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), SESSION_AUTOTICK: "0", ROOM_AUTOTICK: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  await waitForSdk();
  const room = await sdk.createGrandThirtyRoom({ id: "agent-host", name: "Grand Agent Host" }, `sdk-agent-grand-thirty-${STRESS_NAME}`, {
    humanCount: HUMAN_COUNT,
    aiCount: AI_COUNT,
  });
  const humanAgents = room.slots.filter((slot) => slot.controller === "human").map((slot) => slot.playerId);
  const internalAis = room.slots.filter((slot) => slot.controller === "ai").map((slot) => slot.playerId);
  const teams = Object.fromEntries(room.slots.map((slot) => [slot.playerId, slot.team]));

  must(humanAgents.length === HUMAN_COUNT, `expected ${HUMAN_COUNT} external human agents, got ${humanAgents.length}`);
  must(internalAis.length === AI_COUNT, `expected ${AI_COUNT} internal AI slots, got ${internalAis.length}`);

  const started = await sdk.startRoom(room.id);
  must(started.mapId === "grandThirty", `${STRESS_NAME} room did not start on grandThirty`);
  must(started.slots.filter((slot) => slot.controller === "human").length === HUMAN_COUNT, "human slots changed at start");
  must(started.slots.filter((slot) => slot.controller === "ai").length === AI_COUNT, "internal AI slots changed at start");

  const runStarted = performance.now();
  const cpuStarted = process.cpuUsage();
  let latest = await sdk.roomSnapshot(room.id);
  const commandsByOwner: Record<PlayerId, number> = Object.fromEntries(humanAgents.map((owner) => [owner, 0]));
  const commandKinds: Record<string, number> = {};
  const memorySamples: number[] = [];
  let totalTickCpuMs = 0;

  while (!latest.match.winner && latest.tick < MAX_TICKS) {
    const elapsed = performance.now() - runStarted;
    if (elapsed > MAX_WALL_MS) throw new Error(`${STRESS_NAME} test wall budget exceeded at tick ${latest.tick}: ${elapsed.toFixed(1)}ms`);
    const batch = [];
    const hiredCampIds = new Set<string>();
    for (const owner of humanAgents) {
      const commands = planPresetAiCommands(latest, owner, { teams });
      for (const command of commands) {
        if (command.type === "hire") {
          if (hiredCampIds.has(command.campId)) continue;
          hiredCampIds.add(command.campId);
        }
        batch.push({ playerId: owner, command });
      }
    }
    const ticked = await sdk.commandTickRoom(room.id, batch, STEP_TICKS);
    latest = ticked.snapshot;
    for (const entry of batch) {
      commandsByOwner[entry.playerId] = (commandsByOwner[entry.playerId] ?? 0) + 1;
      commandKinds[entry.command.type] = (commandKinds[entry.command.type] ?? 0) + 1;
    }
    totalTickCpuMs += ticked.cpuMs;
    memorySamples.push(ticked.memory.heapUsedBytes);
    if (latest.tick > 0 && latest.tick % 3_600 === 0) {
      process.stderr.write(`${STRESS_NAME} progress tick=${latest.tick} elapsedMs=${(performance.now() - runStarted).toFixed(1)} cpuMs=${totalTickCpuMs.toFixed(1)}\n`);
    }
  }

  const endedRoom = (await sdk.listRooms()).find((candidate) => candidate.id === room.id);
  const cpu = process.cpuUsage(cpuStarted);
  const report = {
    ok: true,
    stressName: STRESS_NAME,
    humanCount: HUMAN_COUNT,
    aiCount: AI_COUNT,
    baseUrl,
    winner: latest.match.winner,
    endedAtTick: latest.match.endedAtTick,
    tick: latest.tick,
    roomStatus: endedRoom?.status,
    elapsedMs: Number((performance.now() - runStarted).toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    totalTickCpuMs: Number(totalTickCpuMs.toFixed(3)),
    heapMin: Math.min(...memorySamples),
    heapMax: Math.max(...memorySamples),
    commandKinds,
    activeCommandingHumans: Object.values(commandsByOwner).filter((count) => count > 0).length,
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
    losingArmy: losingArmy(latest, teams),
    losingArmyPerPlayer: losingArmyPerPlayer(latest, teams, [...humanAgents, ...internalAis]),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  assertGrandThirty(report, latest, endedRoom, humanAgents, internalAis, teams);
} finally {
  if (server && !server.killed) {
    server.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!server.killed) server.kill("SIGTERM");
  }
}

function assertGrandThirty(
  report: Record<string, unknown>,
  snapshot: GameSnapshot,
  room: RoomState | undefined,
  humanAgents: PlayerId[],
  internalAis: PlayerId[],
  teams: Record<string, string>,
) {
  must(room?.status === "ended", `${STRESS_NAME} room did not end cleanly: ${room?.status}`);
  must(snapshot.match.winner !== null, `${STRESS_NAME} did not produce a winner`);
  must(snapshot.match.endedAtTick !== null && snapshot.match.endedAtTick <= MAX_TICKS, `${STRESS_NAME} exceeded development tick budget`);
  must((report.activeCommandingHumans as number) >= Math.min(12, humanAgents.length), "too few external human agents issued commands");
  must(((report.commandKinds as Record<string, number>).attackMove ?? 0) > 0, "external human agents never issued attack-move commands");
  must((report.humanGoldSpent as number) > 8_000, "external human team did not spend enough gold");
  must((report.internalAiGoldSpent as number) > 8_000, "internal AI team did not spend enough gold");
  must((report.humanKills as number) + (report.internalAiKills as number) > 40, `${STRESS_NAME} did not produce enough kills`);
  must((report.nonBaseBuildingsDestroyed as { humans: number; internalAis: number }).humans + (report.nonBaseBuildingsDestroyed as { humans: number; internalAis: number }).internalAis > 0, `${STRESS_NAME} destroyed no non-base buildings`);
  must((report.losingArmyPerPlayer as number) <= 3, `defeated ${STRESS_NAME} team kept a large unused army per player`);
  if (HUMAN_COUNT !== AI_COUNT) {
    const winnerTeam = snapshot.match.winner ? teams[snapshot.match.winner] : "";
    const expectedTeam = HUMAN_COUNT > AI_COUNT ? "north" : "south";
    must(winnerTeam === expectedTeam, `${STRESS_NAME} did not produce decisive numerical-advantage winner: expected ${expectedTeam}, got ${winnerTeam}`);
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

function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
