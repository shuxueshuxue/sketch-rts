import { spawn } from "node:child_process";
import { SketchRtsSdk } from "../src/sdk/client";
import type { GameSnapshot } from "../src/shared/types";

const port = Number(process.env.SDK_SAVEGAME_PORT ?? 5177);
const baseUrl = `http://127.0.0.1:${port}`;
const sdk = new SketchRtsSdk(baseUrl);
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
  const room = await sdk.createRoom({ id: "save-room", host: { id: "host-save", name: "Save Host" }, mapId: "bareDuel" });
  await sdk.updateRoomSlot(room.id, "slot-2", {
    controller: "human",
    userId: "guest-save",
    name: "Save Guest",
    ready: true,
    team: "south",
  });
  await sdk.startRoom(room.id);
  const opening = await sdk.roomSnapshot(room.id);
  const worker = opening.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
  must(worker, "room opening did not include player worker");

  await sdk.enableDebugReplay(room.id, { id: "trace-savegame-opening", label: "savegame opening trace" });
  await sdk.roomCommand(room.id, "player", { type: "move", unitIds: [worker.id], x: worker.x + 220, y: worker.y + 35 });
  await sdk.tickRoom(room.id, 40);
  const save = await sdk.saveRoom(room.id, { id: "savegame-opening", label: "controlled worker move opening" });
  const replayFrameSave = await sdk.saveDebugReplayFrame(room.id, 24, { id: "savegame-replay-frame-24", label: "frame 24 from replay" });
  must(save.snapshot.tick === 40, "savegame did not capture expected tick");
  must(save.room.status === "inMatch", "savegame did not preserve live room state");
  must(replayFrameSave.snapshot.tick === 24, "debug replay frame save did not capture requested tick");

  const direct = await sdk.tickRoom(room.id, 60);
  const resumedRoom = await sdk.continueSavegame(save.id, { roomId: "save-room-resumed" });
  const resumed = await sdk.tickRoom(resumedRoom.id, 60);
  const frameRoom = await sdk.continueSavegame(replayFrameSave.id, { roomId: "save-room-frame-resumed" });
  const frameResumed = await sdk.tickRoom(frameRoom.id, save.snapshot.tick - replayFrameSave.snapshot.tick);
  const saves = await sdk.listSavegames();
  const readBack = await sdk.readSavegame(save.id);
  const readFrame = await sdk.readSavegame(replayFrameSave.id);

  assertSameContinuation(direct.snapshot, resumed.snapshot);
  assertSameContinuation(save.snapshot, frameResumed.snapshot);
  must(saves.some((candidate) => candidate.id === save.id), "savegame list did not include saved opening");
  must(saves.some((candidate) => candidate.id === replayFrameSave.id), "savegame list did not include replay frame save");
  must(readBack.snapshot.tick === save.snapshot.tick, "read savegame did not preserve saved snapshot");
  must(readFrame.snapshot.tick === replayFrameSave.snapshot.tick, "read replay frame save did not preserve extracted snapshot");
  must(JSON.stringify(save).includes("camera") === false, "savegame leaked frontend camera state");
  must(JSON.stringify(save).includes("selectedIds") === false, "savegame leaked frontend selection state");

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        baseUrl,
        saveId: save.id,
        replayFrameSaveId: replayFrameSave.id,
        sourceRoom: room.id,
        resumedRoom: resumedRoom.id,
        frameResumedRoom: frameRoom.id,
        savedTick: save.snapshot.tick,
        replayFrameTick: replayFrameSave.snapshot.tick,
        replayFrameContinuedTick: frameResumed.snapshot.tick,
        continuedTick: resumed.snapshot.tick,
        units: resumed.snapshot.units.length,
        buildings: resumed.snapshot.buildings.length,
        directCpuMs: Number(direct.cpuMs.toFixed(3)),
        resumedCpuMs: Number(resumed.cpuMs.toFixed(3)),
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
  throw new Error(`SDK savegame server did not become ready at ${baseUrl}`);
}

function assertSameContinuation(direct: GameSnapshot, resumed: GameSnapshot) {
  must(resumed.tick === direct.tick, `resumed tick ${resumed.tick} did not match direct tick ${direct.tick}`);
  must(JSON.stringify(resumed.units) === JSON.stringify(direct.units), "resumed units diverged from direct continuation");
  must(JSON.stringify(resumed.buildings) === JSON.stringify(direct.buildings), "resumed buildings diverged from direct continuation");
  must(JSON.stringify(resumed.resources) === JSON.stringify(direct.resources), "resumed resources diverged from direct continuation");
  must(JSON.stringify(resumed.match) === JSON.stringify(direct.match), "resumed match state diverged from direct continuation");
}

function must<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (!value) throw new Error(message);
}
