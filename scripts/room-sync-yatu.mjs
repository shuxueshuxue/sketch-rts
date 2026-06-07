import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const port = Number(process.env.ROOM_SYNC_PORT ?? 5186);
const baseUrl = `http://127.0.0.1:${port}`;
const session = `rts-sync-${Date.now().toString(36)}`;
const playwrightCli = process.env.PLAYWRIGHT_CLI ?? "playwright-cli";

let server;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();

  runCli("open", baseUrl);
  runCli("resize", "1280", "800");
  const proofRun = runCli("run-code", browserProofCode(), { encoding: "utf8" });
  process.stdout.write(proofRun);
  if (proofRun.includes("### Error")) throw new Error("Room sync YATU proof code failed");
  const proofEval = runCli("eval", "() => window.__sketchRtsRoomSyncProof", { encoding: "utf8" });
  process.stdout.write(proofEval);
  if (proofEval.includes("undefined")) throw new Error("Room sync YATU proof object was not produced");
} finally {
  try {
    runCli("close");
  } catch {
    // Browser cleanup is best effort; server cleanup below must still run.
  }
  if (server && !server.killed) {
    server.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!server.killed) server.kill("SIGTERM");
  }
  movePlaywrightArtifacts();
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(`${baseUrl}/api/catalog`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw new Error(`Server did not become ready at ${baseUrl}`);
}

function runCli(...args) {
  let options = {};
  if (typeof args.at(-1) === "object") options = args.pop();
  return execFileSync(playwrightCli, [`-s=${session}`, ...args], {
    cwd: process.cwd(),
    stdio: options.encoding ? ["ignore", "pipe", "inherit"] : "inherit",
    ...options,
  });
}

function movePlaywrightArtifacts() {
  const artifactDir = path.join(process.cwd(), ".playwright-cli");
  if (!existsSync(artifactDir)) return;
  const opsRoot = path.join(homedir(), "share", "ops", "sketch-rts-yatu");
  mkdirSync(opsRoot, { recursive: true });
  const target = path.join(opsRoot, session);
  rmSync(target, { recursive: true, force: true });
  renameSync(artifactDir, target);
  process.stdout.write(`Moved Playwright CLI artifacts to ${target}\n`);
}

function browserProofCode() {
  return String.raw`
async page => {
  const must = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const sleep = (ms) => page.waitForTimeout(ms);
  const sampleIntervalMs = 160;
  const sampleCount = 70;
  const durableMismatchThreshold = 4;
  const consoleIssues = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") consoleIssues.push({ type: message.type(), text: message.text() });
  });

  await page.waitForSelector("[data-open-room-browser]", { timeout: 5000 });
  await page.click("[data-open-room-browser]");
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  await page.click("[data-create-room]");
  await page.waitForSelector("[data-create-game-form]", { timeout: 5000 });
  await page.selectOption("[data-create-game-form] select[name='mapId']", "bareDuel");
  await page.click("[data-submit-create-game]");
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  const roomId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
  must(roomId, "room setup did not expose room id");
  await page.click("[data-start-room]");
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
  await page.waitForFunction(() => window.__sketchRtsView?.roomId && window.__sketchRtsView?.unitIds?.length > 0, null, { timeout: 5000 });

  await page.evaluate(async (roomId) => {
    const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(wsProtocol + "://" + location.host + "/ws/rooms/" + encodeURIComponent(roomId));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out opening auxiliary command websocket")), 3000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Auxiliary command websocket failed"));
      }, { once: true });
    });
    let clientSeq = 0;
    let epoch = 0;
    window.__sketchRtsRoomSyncCommandErrors = [];
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (Number.isInteger(message.epoch)) epoch = message.epoch;
        if (message.type === "error") window.__sketchRtsRoomSyncCommandErrors.push(message.message ?? JSON.stringify(message));
      } catch (error) {
        window.__sketchRtsRoomSyncCommandErrors.push(String(error));
      }
    });
    window.__sketchRtsRoomSyncSendCommand = (playerId, command) => {
      socket.send(JSON.stringify({ type: "command", roomId, playerId, clientSeq, epoch, command }));
      clientSeq += 1;
    };
    window.__sketchRtsRoomSyncCloseCommandSocket = () => socket.close();
  }, roomId);
  const sendCommand = (playerId, command) =>
    page.evaluate(({ playerId, command }) => {
      window.__sketchRtsRoomSyncSendCommand(playerId, command);
    }, { playerId, command });
  const readFrontend = () => page.evaluate(() => window.__sketchRtsView ?? null);
  const readServerSnapshot = () =>
    page.evaluate(async (roomId) => {
      const res = await fetch("/api/rooms/" + roomId + "/snapshot");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, roomId);
  const readSyncEvents = () =>
    page.evaluate(async (roomId) => {
      const res = await fetch("/api/rooms/" + roomId + "/sync-events");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, roomId);

  const durableMissing = new Map();
  const samples = [];
  let commandsSent = 0;
  let observedCommandEffect = false;
  for (let index = 0; index < sampleCount; index += 1) {
    const server = await readServerSnapshot();
    if (index % 8 === 0) {
      const playerCombat = server.units.filter((unit) => unit.owner === "player" && unit.kind !== "worker").map((unit) => unit.id);
      const playerFallback = server.units.filter((unit) => unit.owner === "player").map((unit) => unit.id);
      const enemyBase = server.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall") ?? server.buildings.find((building) => building.owner === "enemy");
      const unitIds = playerCombat.length > 0 ? playerCombat : playerFallback;
      if (enemyBase && unitIds.length > 0) {
        sendCommand("player", { type: "attackMove", unitIds, x: enemyBase.x, y: enemyBase.y });
        commandsSent += 1;
      }
    }
    await sleep(sampleIntervalMs);

    const frontend = await readFrontend();
    must(frontend, "frontend debug view missing");
    must(frontend.roomId === roomId, "frontend room id mismatch: " + JSON.stringify({ expected: roomId, frontend }));
    const authoritative = await readServerSnapshot();
    if (authoritative.units.some((unit) => unit.owner === "player" && (unit.order?.type === "attackMove" || unit.order?.type === "attack"))) {
      observedCommandEffect = true;
    }
    const authoritativeUnitIds = new Set(authoritative.units.map((unit) => unit.id));
    const authoritativeBuildingIds = new Set(authoritative.buildings.map((building) => building.id));
    const frontendEntityIds = new Set([...(frontend.unitIds ?? []), ...(frontend.buildingIds ?? [])]);

    for (const selectedId of frontend.selectedIds ?? []) {
      must(frontendEntityIds.has(selectedId), "frontend selected stale id " + selectedId + " at sample " + index);
    }
    if (frontend.focusedSelectionId) {
      must(frontendEntityIds.has(frontend.focusedSelectionId), "frontend focused stale id " + frontend.focusedSelectionId + " at sample " + index);
    }

    const missingVisibleUnits = (frontend.unitIds ?? []).filter((id) => !authoritativeUnitIds.has(id));
    const missingVisibleBuildings = (frontend.buildingIds ?? []).filter((id) => !authoritativeBuildingIds.has(id));
    for (const id of [...missingVisibleUnits, ...missingVisibleBuildings]) durableMissing.set(id, (durableMissing.get(id) ?? 0) + 1);
    for (const id of [...durableMissing.keys()]) {
      if (![...missingVisibleUnits, ...missingVisibleBuildings].includes(id)) durableMissing.delete(id);
    }
    const durable = [...durableMissing.entries()].filter(([, count]) => count >= durableMismatchThreshold);
    must(
      durable.length === 0,
      "frontend showed ids absent from authoritative room state for multiple samples: " +
        JSON.stringify({ sample: index, durable, frontendTick: frontend.tick, authoritativeTick: authoritative.tick, missingVisibleUnits, missingVisibleBuildings }),
    );
    samples.push({
      sample: index,
      frontendTick: frontend.tick,
      authoritativeTick: authoritative.tick,
      frontendUnits: frontend.unitIds?.length ?? 0,
      authoritativeUnits: authoritative.units.length,
      selectedIds: frontend.selectedIds?.length ?? 0,
      missingVisibleUnits,
      missingVisibleBuildings,
    });
  }
  await page.evaluate(() => window.__sketchRtsRoomSyncCloseCommandSocket?.());

  const commandErrors = await page.evaluate(() => window.__sketchRtsRoomSyncCommandErrors ?? []);
  must(commandErrors.length === 0, "auxiliary room command websocket errors: " + JSON.stringify(commandErrors));
  must(commandsSent > 0, "room sync YATU did not send any auxiliary room commands");
  must(observedCommandEffect, "room sync YATU never observed an authoritative player attack command effect");

  const syncEvents = await readSyncEvents();
  must(syncEvents.summary.byKind["checksum-mismatch"] === 0, "checksum mismatch events recorded: " + JSON.stringify(syncEvents.summary));
  must(syncEvents.summary.byKind["frame-apply-error"] === 0, "frame apply errors recorded: " + JSON.stringify(syncEvents.summary));
  must(syncEvents.summary.byKind["message-error"] === 0, "message errors recorded: " + JSON.stringify(syncEvents.summary));
  must(syncEvents.summary.byKind["server-desync"] === 0, "server desync events recorded: " + JSON.stringify(syncEvents.summary));
  must(consoleIssues.length === 0, "browser console warnings/errors: " + JSON.stringify(consoleIssues.slice(0, 10)));

  await page.evaluate((proof) => {
    window.__sketchRtsRoomSyncProof = proof;
  }, {
    roomId,
    samples: samples.length,
    commandsSent,
    observedCommandEffect,
    firstSample: samples[0],
    lastSample: samples[samples.length - 1],
    syncSummary: syncEvents.summary,
  });
}`;
}
