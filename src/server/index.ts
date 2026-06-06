import express, { type Response } from "express";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { BUILDABLE_BUILDING_KINDS, BUILDING_DEFS, MERCENARY_UNIT_KINDS, RACE_DEFS, RACE_IDS, TRAINABLE_UNIT_KINDS, UNIT_DEFS, UPGRADE_KINDS } from "../shared/catalog";
import { MAP_SCENARIOS } from "../shared/map";
import { benchmarkDashboardRunsDir, listBenchmarkDashboardRuns, readBenchmarkDashboardRun, recordAiVersionBenchmarkDashboardRun } from "../ai/benchmark/dashboard-store";
import { commandValidationError } from "../shared/sim/command-validation";
import type { GameCommand, GameSetupOptions, ItemKind, LocalUserProfile, MapId, PlayerId, RaceId, RoomVisibility, ScenarioOverride, SlotController, UnitKind } from "../shared/types";
import { bindHostFromEnv, publicListenUrl, viteHmrPort } from "./network";
import { createRoomHost } from "./room-host";
import { RoomNetHub } from "./room-net";
import { classifyWebSocketUpgrade } from "./ws-routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT ?? 5173);
const host = bindHostFromEnv(process.env);
const roomAutoTick = process.env.ROOM_AUTOTICK !== "0";
const app = express();
const server = createServer(app);
const roomWss = new WebSocketServer({ noServer: true });
const benchmarkDashboardClients = new Set<Response>();
const ITEM_KINDS = ["flameCloak", "lightningRod", "stormStaff", "guardianScroll", "experienceBook", "breachCharge"] satisfies ItemKind[];
const roomHost = createRoomHost({ autoTick: roomAutoTick });
const roomNetHub = new RoomNetHub({ roomHost });

app.use(express.json({ limit: "64kb" }));

app.get("/favicon.ico", (_request, response) => {
  response
    .type("image/svg+xml")
    .send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#f5f6f7"/><path d="M6 22h20M8 17h16M10 12h12" stroke="#202429" stroke-width="3" stroke-linecap="round"/><path d="M8 25 24 7" stroke="#0969da" stroke-width="3" stroke-linecap="round"/></svg>');
});

server.on("upgrade", (request, socket, head) => {
  const route = classifyWebSocketUpgrade(request.url);
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

app.get("/api/catalog", (_request, response) => {
  response.json({
    units: Object.keys(UNIT_DEFS),
    buildings: Object.keys(BUILDING_DEFS),
    races: Object.values(RACE_DEFS),
    maps: MAP_SCENARIOS,
  });
});

app.get("/api/benchmark-dashboard/runs", async (_request, response) => {
  try {
    response.json({ runs: await listBenchmarkDashboardRuns() });
  } catch (error) {
    response.status(500).json({ error: errorMessage(error) });
  }
});

app.get("/api/benchmark-dashboard/events", (request, response) => {
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

app.get("/api/benchmark-dashboard/runs/:runId", async (request, response) => {
  try {
    response.json(await readBenchmarkDashboardRun(request.params.runId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

app.post("/api/benchmark-dashboard/runs", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const seed = typeof body.seed === "string" && body.seed.length > 0 ? body.seed : new Date().toISOString();
  const mapCount = Number.isInteger(body.mapCount) && Number(body.mapCount) > 0 ? Number(body.mapCount) : 10;
  try {
    response.json(await recordAiVersionBenchmarkDashboardRun({ seed, mapCount }));
  } catch (error) {
    response.status(500).json({ error: errorMessage(error) });
  }
});

app.get("/api/rooms", (request, response) => {
  const viewerUserId = typeof request.query.userId === "string" ? request.query.userId : undefined;
  response.json({ rooms: roomHost.listRooms(viewerUserId) });
});

app.post("/api/rooms", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!isLocalUserProfile(body.host)) {
    response.status(400).json({ error: "Malformed host profile" });
    return;
  }
  if (body.mapId !== undefined && !isMapId(body.mapId)) {
    response.status(400).json({ error: "Unknown map id" });
    return;
  }
  if (body.slotCount !== undefined && (!Number.isInteger(body.slotCount) || Number(body.slotCount) < 2 || Number(body.slotCount) > 30)) {
    response.status(400).json({ error: "slotCount must be an integer between 2 and 30" });
    return;
  }
  if (body.humanCount !== undefined && (!Number.isInteger(body.humanCount) || Number(body.humanCount) < 1 || Number(body.humanCount) > 30)) {
    response.status(400).json({ error: "humanCount must be an integer between 1 and 30" });
    return;
  }
  if (body.aiCount !== undefined && (!Number.isInteger(body.aiCount) || Number(body.aiCount) < 0 || Number(body.aiCount) > 29)) {
    response.status(400).json({ error: "aiCount must be an integer between 0 and 29" });
    return;
  }
  if (body.visibility !== undefined && !isRoomVisibility(body.visibility)) {
    response.status(400).json({ error: "visibility must be private or public" });
    return;
  }
  try {
    const room = roomHost.createRoom({
      id: typeof body.id === "string" ? body.id : `room-${randomUUID()}`,
      host: body.host,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(isMapId(body.mapId) ? { mapId: body.mapId } : {}),
      ...(typeof body.slotCount === "number" ? { slotCount: body.slotCount } : {}),
      ...(typeof body.humanCount === "number" ? { humanCount: body.humanCount } : {}),
      ...(typeof body.aiCount === "number" ? { aiCount: body.aiCount } : {}),
      ...(isRoomVisibility(body.visibility) ? { visibility: body.visibility } : {}),
    });
    response.json(room);
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/grand-thirty", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!isLocalUserProfile(body.host)) {
    response.status(400).json({ error: "Malformed host profile" });
    return;
  }
  try {
    const humanCount = body.humanCount === undefined ? undefined : Number(body.humanCount);
    const aiCount = body.aiCount === undefined ? undefined : Number(body.aiCount);
    if (humanCount !== undefined && !Number.isInteger(humanCount)) {
      response.status(400).json({ error: "humanCount must be an integer" });
      return;
    }
    if (aiCount !== undefined && !Number.isInteger(aiCount)) {
      response.status(400).json({ error: "aiCount must be an integer" });
      return;
    }
    response.json(
      roomHost.createGrandThirtyRoom(typeof body.id === "string" ? body.id : `room-${randomUUID()}`, body.host, {
        ...(humanCount !== undefined ? { humanCount } : {}),
        ...(aiCount !== undefined ? { aiCount } : {}),
      }),
    );
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.get("/api/rooms/:roomId", (request, response) => {
  try {
    response.json(roomHost.getRoom(request.params.roomId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/join", (request, response) => {
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

app.post("/api/rooms/:roomId/leave", (request, response) => {
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

app.post("/api/rooms/:roomId/close", (request, response) => {
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

app.post("/api/rooms/:roomId/slots/:slotId", (request, response) => {
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

app.post("/api/rooms/:roomId/map", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!isMapId(body.mapId)) {
    response.status(400).json({ error: "Unknown map id" });
    return;
  }
  try {
    response.json(roomHost.updateMap(request.params.roomId, body.mapId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/slot-counts", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!Number.isInteger(body.humanCount) || Number(body.humanCount) < 1 || Number(body.humanCount) > 30) {
    response.status(400).json({ error: "humanCount must be an integer between 1 and 30" });
    return;
  }
  if (!Number.isInteger(body.aiCount) || Number(body.aiCount) < 0 || Number(body.aiCount) > 29) {
    response.status(400).json({ error: "aiCount must be an integer between 0 and 29" });
    return;
  }
  try {
    response.json(roomHost.resizeSlots(request.params.roomId, Number(body.humanCount), Number(body.aiCount)));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/start", (request, response) => {
  try {
    response.json(roomHost.startRoom(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/pause", (request, response) => {
  try {
    response.json(roomHost.pauseRoom(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/resume", (request, response) => {
  try {
    response.json(roomHost.resumeRoom(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/reset", (request, response) => {
  const body = request.body as { mapId?: unknown; options?: unknown };
  if (!isMapId(body.mapId)) {
    response.status(400).json({ error: "Unknown map id" });
    return;
  }
  const options = parseGameSetupOptions(body.options);
  if (!options) {
    response.status(400).json({ error: "Malformed game setup options" });
    return;
  }
  try {
    response.json(roomHost.resetRoom(request.params.roomId, body.mapId, options));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.get("/api/rooms/:roomId/snapshot", (request, response) => {
  try {
    response.json(roomHost.snapshot(request.params.roomId));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.get("/api/rooms/:roomId/sync-events", (request, response) => {
  try {
    response.json({ events: roomNetHub.syncEventsForRoom(request.params.roomId), summary: roomNetHub.syncSummaryForRoom(request.params.roomId) });
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/command", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!isPlayerId(body.playerId) || !isCommand(body.command)) {
    response.status(400).json({ error: "Malformed room command" });
    return;
  }
  try {
    const error = commandValidationError(roomHost.snapshot(request.params.roomId), body.playerId, body.command);
    if (error) {
      response.status(400).json({ error });
      return;
    }
    response.json(roomHost.commandRoom(request.params.roomId, body.playerId, body.command));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/commands", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!Array.isArray(body.commands) || !body.commands.every(isRoomCommandEnvelope)) {
    response.status(400).json({ error: "Malformed room command batch" });
    return;
  }
  try {
    const snapshot = roomHost.snapshot(request.params.roomId);
    const error = body.commands.map((entry) => commandValidationError(snapshot, entry.playerId, entry.command)).find((message) => message);
    if (error) {
      response.status(400).json({ error });
      return;
    }
    response.json(roomHost.commandRooms(request.params.roomId, body.commands));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/tick", (request, response) => {
  const requestedTicks = (request.body as { ticks?: unknown }).ticks;
  if (!isTickCount(requestedTicks)) {
    response.status(400).json({ error: "ticks must be an integer between 1 and 20000" });
    return;
  }
  try {
    const result = roomHost.tickRoom(request.params.roomId, requestedTicks);
    if (result.room.status === "ended") roomNetHub.publishRoom(request.params.roomId);
    response.json(result);
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.post("/api/rooms/:roomId/command-tick", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (!Array.isArray(body.commands) || !body.commands.every(isRoomCommandEnvelope) || !isTickCount(body.ticks)) {
    response.status(400).json({ error: "Malformed room command-tick batch" });
    return;
  }
  try {
    const result = roomHost.commandTickRoom(request.params.roomId, body.commands, body.ticks);
    if (result.room.status === "ended") roomNetHub.publishRoom(request.params.roomId);
    response.json(result);
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

app.get("/api/rooms/:roomId/result", (request, response) => {
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

app.post("/api/rooms/:roomId/save", (request, response) => {
  const input = parseSaveInput(request.body);
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

app.post("/api/rooms/:roomId/debug-replay", (request, response) => {
  const input = parseSaveInput(request.body);
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

app.get("/api/rooms/:roomId/debug-replay", (request, response) => {
  try {
    response.json(roomHost.readDebugReplay(request.params.roomId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

app.get("/api/rooms/:roomId/debug-replay/ticks/:tick", (request, response) => {
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

app.post("/api/rooms/:roomId/debug-replay/ticks/:tick/save", (request, response) => {
  const tick = Number(request.params.tick);
  const input = parseSaveInput(request.body);
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

app.get("/api/savegames", (_request, response) => {
  response.json({ saves: roomHost.listSaves() });
});

app.get("/api/savegames/:saveId", (request, response) => {
  try {
    response.json(roomHost.readSave(request.params.saveId));
  } catch (error) {
    response.status(404).json({ error: errorMessage(error) });
  }
});

app.post("/api/savegames/:saveId/continue", (request, response) => {
  const body = request.body as Record<string, unknown>;
  if (body.roomId !== undefined && typeof body.roomId !== "string") {
    response.status(400).json({ error: "Malformed room id" });
    return;
  }
  try {
    response.json(roomHost.continueSave(request.params.saveId, undefined, typeof body.roomId === "string" ? { roomId: body.roomId } : {}));
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});

// @@@api-fail-loud-boundary - Register real /api routes above this line; unknown API paths must fail as JSON before the SPA middleware can serve index.html.
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Unknown API route" });
});

setInterval(() => {
  const lockstepRoomIds = roomNetHub.tickConnectedRooms();
  roomHost.tickActiveRooms(1, { excludeRoomIds: lockstepRoomIds });
}, 50);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(root, "dist/index.html"));
  });
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { port: viteHmrPort(port) } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

await watchBenchmarkDashboardRuns();

server.listen(port, host, () => {
  console.log(`Sketch RTS listening on ${publicListenUrl(host, port)}`);
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

function isCommand(value: unknown): value is GameCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (command.type === "move") {
    return isStringArray(command.unitIds) && isNumber(command.x) && isNumber(command.y);
  }
  if (command.type === "attackMove") {
    return isStringArray(command.unitIds) && isNumber(command.x) && isNumber(command.y);
  }
  if (command.type === "attack") {
    return isStringArray(command.unitIds) && typeof command.targetId === "string";
  }
  if (command.type === "mine") {
    return isStringArray(command.unitIds) && typeof command.resourceId === "string";
  }
  if (command.type === "repair") {
    return isStringArray(command.unitIds) && typeof command.buildingId === "string";
  }
  if (command.type === "build") {
    return typeof command.unitId === "string" && isBuildableBuilding(command.buildingKind) && isNumber(command.x) && isNumber(command.y);
  }
  if (command.type === "setRally") {
    return isStringArray(command.buildingIds) && isNumber(command.x) && isNumber(command.y) && (command.target === undefined || isRallyTarget(command.target));
  }
  if (command.type === "train") {
    return typeof command.buildingId === "string" && isTrainableUnit(command.unitKind);
  }
  if (command.type === "research") {
    return typeof command.buildingId === "string" && isUpgradeKind(command.upgradeKind);
  }
  if (command.type === "hire") {
    return typeof command.campId === "string";
  }
  if (command.type === "cast") {
    return (
      typeof command.unitId === "string" &&
      (command.ability === "heal" || command.ability === "summon" || command.ability === "curse") &&
      (command.targetId === undefined || typeof command.targetId === "string") &&
      (command.x === undefined || isNumber(command.x)) &&
      (command.y === undefined || isNumber(command.y))
    );
  }
  if (command.type === "pickupItem") {
    return typeof command.unitId === "string" && typeof command.itemId === "string";
  }
  if (command.type === "dropItem") {
    return typeof command.unitId === "string" && typeof command.itemId === "string" && isNumber(command.x) && isNumber(command.y);
  }
  if (command.type === "useItem") {
    return (
      typeof command.unitId === "string" &&
      typeof command.itemId === "string" &&
      (command.targetId === undefined || typeof command.targetId === "string") &&
      (command.x === undefined || isNumber(command.x)) &&
      (command.y === undefined || isNumber(command.y))
    );
  }
  return false;
}

function isRoomCommandEnvelope(value: unknown): value is { playerId: PlayerId; command: GameCommand } {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  return isPlayerId(envelope.playerId) && isCommand(envelope.command);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRallyTarget(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (target.type === "point") return true;
  if (target.type === "resource") return typeof target.resourceId === "string";
  if (target.type === "unit") return typeof target.unitId === "string";
  return false;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBuildableBuilding(value: unknown) {
  return typeof value === "string" && (BUILDABLE_BUILDING_KINDS as readonly string[]).includes(value);
}

function isTrainableUnit(value: unknown) {
  return typeof value === "string" && (TRAINABLE_UNIT_KINDS as readonly string[]).includes(value);
}

function isUpgradeKind(value: unknown) {
  return typeof value === "string" && (UPGRADE_KINDS as readonly string[]).includes(value);
}

function parseGameSetupOptions(value: unknown): GameSetupOptions | undefined {
  if (value === undefined) return {};
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const options: GameSetupOptions = {};
  if (source.players !== undefined) {
    if (!isPlayerArray(source.players)) return undefined;
    options.players = source.players;
  }
  if (source.aiPlayers !== undefined) {
    if (!isPlayerArray(source.aiPlayers)) return undefined;
    options.aiPlayers = source.aiPlayers;
  }
  if (source.aiVersions !== undefined) {
    if (!isAiVersionMap(source.aiVersions)) return undefined;
    options.aiVersions = source.aiVersions;
  }
  if (source.teams !== undefined) {
    if (!isTeamMap(source.teams)) return undefined;
    options.teams = source.teams;
  }
  if (source.races !== undefined) {
    if (!isRaceMap(source.races)) return undefined;
    options.races = source.races;
  }
  if (source.scenario !== undefined) {
    const scenario = parseScenarioOverride(source.scenario);
    if (!scenario) return undefined;
    options.scenario = scenario;
  }
  return options;
}

function parseScenarioOverride(value: unknown): ScenarioOverride | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const scenario: ScenarioOverride = {};
  if (source.replaceDefaultUnits !== undefined) {
    if (typeof source.replaceDefaultUnits !== "boolean") return undefined;
    scenario.replaceDefaultUnits = source.replaceDefaultUnits;
  }
  if (source.replaceDefaultBuildings !== undefined) {
    if (typeof source.replaceDefaultBuildings !== "boolean") return undefined;
    scenario.replaceDefaultBuildings = source.replaceDefaultBuildings;
  }
  if (source.replaceDefaultResources !== undefined) {
    if (typeof source.replaceDefaultResources !== "boolean") return undefined;
    scenario.replaceDefaultResources = source.replaceDefaultResources;
  }
  if (source.replaceDefaultMercenaryCamps !== undefined) {
    if (typeof source.replaceDefaultMercenaryCamps !== "boolean") return undefined;
    scenario.replaceDefaultMercenaryCamps = source.replaceDefaultMercenaryCamps;
  }
  if (source.replaceDefaultLandmarks !== undefined) {
    if (typeof source.replaceDefaultLandmarks !== "boolean") return undefined;
    scenario.replaceDefaultLandmarks = source.replaceDefaultLandmarks;
  }
  if (source.addResources !== undefined) {
    if (!Array.isArray(source.addResources) || !source.addResources.every(isResourceSeed)) return undefined;
    scenario.addResources = source.addResources;
  }
  if (source.addMercenaryCamps !== undefined) {
    if (!Array.isArray(source.addMercenaryCamps) || !source.addMercenaryCamps.every(isMercenaryCampSeed)) return undefined;
    scenario.addMercenaryCamps = source.addMercenaryCamps;
  }
  if (source.addItems !== undefined) {
    if (!Array.isArray(source.addItems) || !source.addItems.every(isItemSeed)) return undefined;
    scenario.addItems = source.addItems;
  }
  if (source.addUnits !== undefined) {
    if (!Array.isArray(source.addUnits) || !source.addUnits.every(isUnitSeed)) return undefined;
    scenario.addUnits = source.addUnits;
  }
  if (source.addBuildings !== undefined) {
    if (!Array.isArray(source.addBuildings) || !source.addBuildings.every(isBuildingSeed)) return undefined;
    scenario.addBuildings = source.addBuildings;
  }
  if (source.addLandmarks !== undefined) {
    if (!Array.isArray(source.addLandmarks) || !source.addLandmarks.every(isLandmarkSeed)) return undefined;
    scenario.addLandmarks = source.addLandmarks;
  }
  return scenario;
}

function isPlayerArray(value: unknown): value is PlayerId[] {
  return Array.isArray(value) && value.every(isPlayerId);
}

function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
}

function isTeamMap(value: unknown): value is Partial<Record<PlayerId, string>> {
  return Boolean(value) && typeof value === "object" && Object.entries(value as Record<string, unknown>).every(([owner, team]) => isPlayerId(owner) && typeof team === "string");
}

function isRaceMap(value: unknown): value is Partial<Record<PlayerId, RaceId>> {
  return Boolean(value) && typeof value === "object" && Object.entries(value as Record<string, unknown>).every(([owner, race]) => isPlayerId(owner) && typeof race === "string" && (RACE_IDS as readonly string[]).includes(race));
}

function isAiVersionMap(value: unknown): value is GameSetupOptions["aiVersions"] {
  return Boolean(value) && typeof value === "object" && Object.entries(value as Record<string, unknown>).every(([owner, version]) => isPlayerId(owner) && (version === "v1" || version === "v2"));
}

function isMapId(value: unknown): value is MapId {
  return typeof value === "string" && MAP_SCENARIOS.some((scenario) => scenario.id === value);
}

function isRoomVisibility(value: unknown): value is RoomVisibility {
  return value === "private" || value === "public";
}

function isLocalUserProfile(value: unknown): value is LocalUserProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.id === "string" && profile.id.length > 0 && typeof profile.name === "string" && profile.name.length > 0;
}

function parseSlotPatch(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const patch: { controller?: SlotController; team?: string; race?: RaceId; ready?: boolean; name?: string; userId?: string | undefined } = {};
  if (source.controller !== undefined) {
    if (source.controller !== "human" && source.controller !== "ai" && source.controller !== "open" && source.controller !== "closed") return undefined;
    patch.controller = source.controller;
  }
  if (source.team !== undefined) {
    if (typeof source.team !== "string" || source.team.length === 0) return undefined;
    patch.team = source.team;
  }
  if (source.race !== undefined) {
    if (typeof source.race !== "string" || !(RACE_IDS as readonly string[]).includes(source.race)) return undefined;
    patch.race = source.race as RaceId;
  }
  if (source.ready !== undefined) {
    if (typeof source.ready !== "boolean") return undefined;
    patch.ready = source.ready;
  }
  if (source.name !== undefined) {
    if (typeof source.name !== "string" || source.name.length === 0) return undefined;
    patch.name = source.name;
  }
  if ("userId" in source) {
    if (source.userId !== undefined && typeof source.userId !== "string") return undefined;
    patch.userId = source.userId;
  }
  return patch;
}

function parseSaveInput(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || source.id.length === 0) return undefined;
  if (source.label !== undefined && typeof source.label !== "string") return undefined;
  return {
    id: source.id,
    ...(typeof source.label === "string" ? { label: source.label } : {}),
  };
}

function isTickCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20000;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isResourceSeed(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const seed = value as Record<string, unknown>;
  return typeof seed.id === "string" && seed.kind === "goldMine" && isNumber(seed.x) && isNumber(seed.y) && isPositiveInteger(seed.amount);
}

function isMercenaryCampSeed(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const seed = value as Record<string, unknown>;
  return (
    typeof seed.id === "string" &&
    isNumber(seed.x) &&
    isNumber(seed.y) &&
    isPositiveNumber(seed.radius) &&
    typeof seed.hireKind === "string" &&
    (MERCENARY_UNIT_KINDS as readonly string[]).includes(seed.hireKind) &&
    isPositiveInteger(seed.cost) &&
    isPositiveInteger(seed.stock) &&
    isPositiveInteger(seed.cooldown) &&
    isNonNegativeInteger(seed.cooldownRemaining)
  );
}

function isItemSeed(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const seed = value as Record<string, unknown>;
  return (
    typeof seed.id === "string" &&
    isItemKind(seed.kind) &&
    isNumber(seed.x) &&
    isNumber(seed.y) &&
    (seed.carrierId === undefined || typeof seed.carrierId === "string") &&
    isNonNegativeInteger(seed.cooldownRemaining)
  );
}

function isUnitSeed(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const seed = value as Record<string, unknown>;
  if (!(typeof seed.id === "string" && isOwner(seed.owner) && isUnitKind(seed.kind) && isNumber(seed.x) && isNumber(seed.y))) return false;
  const kind = seed.kind;
  const hp = seed.hp;
  return hp === undefined || (isPositiveNumber(hp) && hp <= UNIT_DEFS[kind].hp);
}

function isBuildingSeed(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const seed = value as Record<string, unknown>;
  return typeof seed.id === "string" && isPlayerId(seed.owner) && isBuildableBuilding(seed.kind) && isNumber(seed.x) && isNumber(seed.y) && (seed.complete === undefined || typeof seed.complete === "boolean");
}

function isLandmarkSeed(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const seed = value as Record<string, unknown>;
  return typeof seed.id === "string" && isLandmarkKind(seed.kind) && isNumber(seed.x) && isNumber(seed.y) && isPositiveNumber(seed.size) && isNumber(seed.rotation);
}

function isOwner(value: unknown) {
  return isPlayerId(value) || value === "neutral";
}

function isUnitKind(value: unknown): value is UnitKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(UNIT_DEFS, value);
}

function isItemKind(value: unknown): value is ItemKind {
  return typeof value === "string" && (ITEM_KINDS as readonly string[]).includes(value);
}

function isLandmarkKind(value: unknown) {
  return value === "grove" || value === "ridge" || value === "ruin" || value === "ditch" || value === "road" || value === "campMark" || value === "mineScar" || value === "bannerStone";
}

function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value > 0;
}

function isPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
