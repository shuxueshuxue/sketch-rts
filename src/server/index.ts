import express, { type Response } from "express";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS } from "../shared/catalog";
import { expressMountPath, publicBasePathFromEnv } from "../shared/deployment-base";
import { MAP_SCENARIOS } from "../shared/map";
import { benchmarkDashboardRunsDir, listBenchmarkDashboardRuns, readBenchmarkDashboardRun, recordAiVersionBenchmarkDashboardRun } from "../ai/benchmark/dashboard-store";
import { isCommandEnvelope } from "../shared/command-schema";
import type { CommandEnvelope } from "../shared/net/types";
import { isLocalUserProfile, parseContinueSaveRequest, parseGrandStressRoomRequest, parseMapUpdateRequest, parseResetRoomRequest, parseSlotCountsRequest, parseSlotPatch, roomCreateInputFromRequest } from "../shared/room-schema";
import { parseSaveGameInput } from "../shared/savegame";
import { bindHostFromEnv, publicListenUrl, viteHmrPort } from "./network";
import { createRoomHost } from "./room-host";
import { RoomNetHub } from "./room-net";
import { classifyWebSocketUpgrade } from "./ws-routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT ?? 5173);
const host = bindHostFromEnv(process.env);
const publicBasePath = publicBasePathFromEnv(process.env);
const publicMountPath = expressMountPath(publicBasePath);
const roomAutoTick = process.env.ROOM_AUTOTICK !== "0";
const app = express();
const router = express.Router();
const server = createServer(app);
const roomWss = new WebSocketServer({ noServer: true });
const benchmarkDashboardClients = new Set<Response>();
const roomHost = createRoomHost({ autoTick: roomAutoTick });
const roomNetHub = new RoomNetHub({ roomHost });

router.use(express.json({ limit: "64kb" }));

router.get("/favicon.ico", (_request, response) => {
  response
    .type("image/svg+xml")
    .send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#f5f6f7"/><path d="M6 22h20M8 17h16M10 12h12" stroke="#202429" stroke-width="3" stroke-linecap="round"/><path d="M8 25 24 7" stroke="#0969da" stroke-width="3" stroke-linecap="round"/></svg>');
});

server.on("upgrade", (request, socket, head) => {
  const route = classifyWebSocketUpgrade(request.url, publicBasePath);
  if (route.type === "room") {
    roomWss.handleUpgrade(request, socket, head, (ws) => {
      roomWss.emit("connection", ws, request, route.roomId);
    });
    return;
  }
  if (route.type === "reject") {
    socket.destroy();
    return;
  }
});

roomWss.on("connection", (ws: WebSocket, _request: IncomingMessage, roomId: string) => {
  roomNetHub.connect(roomId, {
    send(data) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    on(event, handler) {
      if (event === "message") ws.on("message", (raw: RawData) => (handler as (raw: string) => void)(raw.toString()));
      if (event === "close") ws.on("close", handler as () => void);
    },
  });
});

router.get("/api/catalog", (_request, response) => {
  response.json({
    units: Object.keys(UNIT_DEFS),
    buildings: Object.keys(BUILDING_DEFS),
    races: Object.values(RACE_DEFS),
    maps: MAP_SCENARIOS,
  });
});

router.get("/api/benchmark-dashboard/runs", async (_request, response) => {
  try {
    response.json({ runs: await listBenchmarkDashboardRuns() });
  } catch (error) {
    response.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/api/benchmark-dashboard/events", (request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.write(`event: benchmark-dashboard-ready\ndata: ${JSON.stringify({ type: "ready" })}\n\n`);
  benchmarkDashboardClients.add(response);
  request.on("close", () => {
    benchmarkDashboardClients.delete(response);
  });
});

router.get("/api/benchmark-dashboard/runs/:runId", async (request, response) => {
  try {
    response.json(await readBenchmarkDashboardRun(request.params.runId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

router.post("/api/benchmark-dashboard/runs", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const seed = typeof body.seed === "string" && body.seed.length > 0 ? body.seed : new Date().toISOString();
  const mapCount = Number.isInteger(body.mapCount) && Number(body.mapCount) > 0 ? Number(body.mapCount) : 10;
  try {
    response.json(await recordAiVersionBenchmarkDashboardRun({ seed, mapCount }));
  } catch (error) {
    response.status(500).json({ error: errorMessage(error) });
  }
});

router.get("/api/rooms", (request, response) => {
  const viewerUserId = typeof request.query.userId === "string" ? request.query.userId : undefined;
  response.json({ rooms: roomHost.listRooms(viewerUserId) });
});

router.post("/api/rooms", (request, response) => {
  let input;
  try {
    input = roomCreateInputFromRequest(request.body, `room-${randomUUID()}`);
  } catch {
    response.status(400).json({ error: "Malformed room create input" });
    return;
  }
  try {
    response.json(roomHost.createRoom(input));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/grand-thirty", (request, response) => {
  const body = parseGrandStressRoomRequest(request.body);
  if (!body) {
    response.status(400).json({ error: "Malformed grand stress room input" });
    return;
  }
  try {
    response.json(
      roomHost.createGrandThirtyRoom(body.id ?? `room-${randomUUID()}`, body.host, {
        ...(body.humanCount !== undefined ? { humanCount: body.humanCount } : {}),
        ...(body.aiCount !== undefined ? { aiCount: body.aiCount } : {}),
      }),
    );
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/api/rooms/:roomId", (request, response) => {
  try {
    response.json(roomHost.getRoom(request.params.roomId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/join", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!isLocalUserProfile(body.user)) {
    response.status(400).json({ error: "Malformed user profile" });
    return;
  }
  try {
    response.json(roomHost.joinRoom(request.params.roomId, body.user));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/leave", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (typeof body.userId !== "string") {
    response.status(400).json({ error: "Malformed user id" });
    return;
  }
  try {
    response.json(roomHost.leaveRoom(request.params.roomId, body.userId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/close", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (typeof body.userId !== "string") {
    response.status(400).json({ error: "Malformed user id" });
    return;
  }
  try {
    response.json(roomHost.closeRoom(request.params.roomId, body.userId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/slots/:slotId", (request, response) => {
  const patch = parseSlotPatch(request.body);
  if (!patch) {
    response.status(400).json({ error: "Malformed slot patch" });
    return;
  }
  try {
    response.json(roomHost.updateSlot(request.params.roomId, request.params.slotId, patch));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/map", (request, response) => {
  const body = parseMapUpdateRequest(request.body);
  if (!body) {
    response.status(400).json({ error: "Malformed room map input" });
    return;
  }
  try {
    response.json(roomHost.updateMap(request.params.roomId, body.mapId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/slot-counts", (request, response) => {
  const body = parseSlotCountsRequest(request.body);
  if (!body) {
    response.status(400).json({ error: "Malformed room slot count input" });
    return;
  }
  try {
    response.json(roomHost.resizeSlots(request.params.roomId, body.humanCount, body.aiCount));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/start", (request, response) => {
  try {
    response.json(roomHost.startRoom(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/pause", (request, response) => {
  try {
    response.json(roomHost.pauseRoom(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/resume", (request, response) => {
  try {
    response.json(roomHost.resumeRoom(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/reset", (request, response) => {
  const body = parseResetRoomRequest(request.body);
  if (!body) {
    response.status(400).json({ error: "Malformed room reset input" });
    return;
  }
  try {
    response.json(roomHost.resetRoom(request.params.roomId, body.mapId, body.options));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/api/rooms/:roomId/snapshot", (request, response) => {
  try {
    response.json(roomHost.snapshot(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/api/rooms/:roomId/sync-events", (request, response) => {
  try {
    response.json({ events: roomNetHub.syncEventsForRoom(request.params.roomId), summary: roomNetHub.syncSummaryForRoom(request.params.roomId) });
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/command", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!isCommandEnvelope(body)) {
    response.status(400).json({ error: "Malformed room command" });
    return;
  }
  try {
    response.json(roomHost.commandRoom(request.params.roomId, body.playerId, body.command));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/commands", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!Array.isArray(body.commands) || !body.commands.every(isCommandEnvelope)) {
    response.status(400).json({ error: "Malformed room command batch" });
    return;
  }
  try {
    response.json(roomHost.commandRooms(request.params.roomId, body.commands as CommandEnvelope[]));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/tick", (request, response) => {
  const requestedTicks = (request.body as { ticks?: unknown }).ticks;
  if (!isTickCount(requestedTicks)) {
    response.status(400).json({ error: "ticks must be an integer between 1 and 20000" });
    return;
  }
  try {
    const result = roomHost.tickRoom(request.params.roomId, requestedTicks);
    response.json(result);
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/command-tick", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!Array.isArray(body.commands) || !body.commands.every(isCommandEnvelope) || !isTickCount(body.ticks)) {
    response.status(400).json({ error: "Malformed room command-tick batch" });
    return;
  }
  try {
    const result = roomHost.commandTickRoom(request.params.roomId, body.commands as CommandEnvelope[], body.ticks);
    response.json(result);
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/api/rooms/:roomId/result", (request, response) => {
  try {
    const room = roomHost.getRoom(request.params.roomId);
    if (room.status !== "ended" || !room.result) {
      response.status(404).json({ error: "Room has no result yet" });
      return;
    }
    response.json(room.result);
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/save", (request, response) => {
  const input = parseSaveGameInput(request.body);
  if (!input) {
    response.status(400).json({ error: "Malformed savegame input" });
    return;
  }
  try {
    response.json(roomHost.saveRoom(request.params.roomId, input));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/debug-replay", (request, response) => {
  const input = parseSaveGameInput(request.body);
  if (!input) {
    response.status(400).json({ error: "Malformed debug replay input" });
    return;
  }
  try {
    response.json(roomHost.enableDebugReplay(request.params.roomId, input));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/api/rooms/:roomId/debug-replay", (request, response) => {
  try {
    response.json(roomHost.readDebugReplay(request.params.roomId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

router.get("/api/rooms/:roomId/debug-replay/ticks/:tick", (request, response) => {
  const tick = Number(request.params.tick);
  if (!Number.isInteger(tick) || tick < 0) {
    response.status(400).json({ error: "tick must be a non-negative integer" });
    return;
  }
  try {
    response.json(roomHost.replayDebugToTick(request.params.roomId, tick));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/api/rooms/:roomId/debug-replay/ticks/:tick/save", (request, response) => {
  const tick = Number(request.params.tick);
  const input = parseSaveGameInput(request.body);
  if (!Number.isInteger(tick) || tick < 0) {
    response.status(400).json({ error: "tick must be a non-negative integer" });
    return;
  }
  if (!input) {
    response.status(400).json({ error: "Malformed replay frame save input" });
    return;
  }
  try {
    response.json(roomHost.extractDebugReplayFrameSave(request.params.roomId, tick, input));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/api/savegames", (_request, response) => {
  response.json({ saves: roomHost.listSaves() });
});

router.get("/api/savegames/:saveId", (request, response) => {
  try {
    response.json(roomHost.readSave(request.params.saveId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

router.post("/api/savegames/:saveId/continue", (request, response) => {
  const body = parseContinueSaveRequest(request.body);
  if (!body) {
    response.status(400).json({ error: "Malformed room id" });
    return;
  }
  try {
    response.json(roomHost.continueSave(request.params.saveId, undefined, body));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

// @@@api-fail-loud-boundary - Register real /api routes above this line; unknown API paths must fail as JSON before the SPA middleware can serve index.html.
router.use("/api", (_request, response) => {
  response.status(404).json({ error: "Unknown API route" });
});

setInterval(() => {
  const lockstepRoomIds = roomNetHub.tickConnectedRooms();
  roomHost.tickActiveRooms(1, { excludeRoomIds: lockstepRoomIds });
}, 50);

if (process.env.NODE_ENV === "production") {
  router.use(express.static(path.join(root, "dist")));
  router.get("*", (_request, response) => {
    response.sendFile(path.join(root, "dist/index.html"));
  });
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { port: viteHmrPort(port) } },
    appType: "spa",
  });
  router.use(vite.middlewares);
}

app.use(publicMountPath, router);

await watchBenchmarkDashboardRuns();

server.listen(port, host, () => {
  console.log(`Sketch RTS listening on ${publicListenUrl(host, port)}${publicBasePath === "/" ? "" : publicBasePath}`);
});

async function watchBenchmarkDashboardRuns() {
  const dir = benchmarkDashboardRunsDir();
  await mkdir(dir, { recursive: true });
  watch(dir, { persistent: false }, (eventType, filename) => {
    if (!filename || !filename.endsWith(".json")) return;
    broadcastBenchmarkDashboardChange({ eventType, filename });
  });
}

function broadcastBenchmarkDashboardChange(payload: { eventType: string; filename: string }) {
  const frame = `event: benchmark-dashboard-change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of benchmarkDashboardClients) client.write(frame);
}

function isTickCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20000;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
