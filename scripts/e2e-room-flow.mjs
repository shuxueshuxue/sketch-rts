import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { roomUiFlowCode } from "./room-ui-flow.mjs";

const port = Number(process.env.ROOM_FLOW_PORT ?? 5178);
const baseUrl = `http://127.0.0.1:${port}`;
const session = `rts-rf-${Date.now().toString(36)}`;
const playwrightCli = process.env.PLAYWRIGHT_CLI ?? "playwright-cli";
let server;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ROOM_AUTOTICK: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();

  runCli("open", baseUrl);
  runCli("resize", "1280", "800");
  const proofRun = runCli("run-code", browserProofCode(), { encoding: "utf8" });
  process.stdout.write(proofRun);
  if (proofRun.includes("### Error")) throw new Error("Room-flow E2E proof code failed");
  const proofEval = runCli("eval", "() => window.__sketchRtsRoomFlowProof", { encoding: "utf8" });
  process.stdout.write(proofEval);
  if (proofEval.includes("undefined")) throw new Error("Room-flow E2E proof object was not produced");
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
  ${roomUiFlowCode}
  const canvasPatch = (x, y, width, height) =>
    page.evaluate(
      ({ x, y, width, height }) => {
        const canvas = document.querySelector(".game-canvas");
        if (!canvas) throw new Error("canvas missing");
        const readback = document.createElement("canvas");
        readback.width = width;
        readback.height = height;
        const context = readback.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("readback missing");
        context.drawImage(canvas, x - width / 2, y - height / 2, width, height, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        let hash = 2166136261;
        for (let index = 0; index < data.length; index += 4) {
          hash ^= (data[index] << 16) | (data[index + 1] << 8) | data[index + 2];
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        return { hash };
      },
      { x, y, width, height },
    );
  await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });
  must((await page.locator("[data-open-create]").count()) === 1, "home missing play entry");
  must((await page.locator("[data-open-room-browser]").count()) === 1, "home missing rooms entry");
  must((await page.locator("[data-open-profile]").count()) === 1, "home missing settings entry");
  must((await page.locator("[data-resume-room]").count()) === 0, "home should not expose resume-room shortcut");
  must((await page.locator("[data-create-local-room]").count()) === 0, "home still exposes old single/local creation entry");
  must((await page.locator("[data-map-id]").count()) === 0, "home exposes direct map picker instead of hierarchy");
  const homeButtonProof = await page.locator("[data-open-create], [data-open-room-browser], [data-open-profile]").evaluateAll((buttons) =>
    buttons.map((button) => ({ label: button.textContent ?? "", width: button.getBoundingClientRect().width, notes: button.querySelectorAll(".map-button-note").length })),
  );
  must(
    homeButtonProof.length === 3 && homeButtonProof.every((button) => button.width <= 430 && button.notes === 0),
    "home menu buttons should stay compact: " + JSON.stringify(homeButtonProof),
  );

  const initialProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("sketch-rts-user")));
  must(initialProfile.id && initialProfile.name, "localStorage profile was not created");

  await page.locator("[data-open-profile]").click();
  await page.locator("[data-profile-form] input[name='name']").fill("Room Flow Tester");
  await page.locator("[data-profile-form] button[type='submit']").click();
  await page.reload();
  await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });
  const persistedProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("sketch-rts-user")));
  must(persistedProfile.id === initialProfile.id, "profile id did not persist across reload");
  must(persistedProfile.name === "Room Flow Tester", "profile name did not persist across reload");

  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  const roomBrowserLayoutProof = await page.evaluate(() => {
    const actions = document.querySelector("[data-room-browser] .menu-actions")?.getBoundingClientRect();
    const list = document.querySelector(".room-browser-list")?.getBoundingClientRect();
    return {
      hasCreate: Boolean(document.querySelector("[data-create-room]")),
      hasList: Boolean(document.querySelector("[data-room-browser-list]")),
      actionsBelow: Boolean(actions && list && actions.top > list.bottom),
    };
  });
  must(roomBrowserLayoutProof.hasCreate && roomBrowserLayoutProof.hasList && roomBrowserLayoutProof.actionsBelow, "rooms browser should show the room list with its actions below: " + JSON.stringify(roomBrowserLayoutProof));
  // A solo game opens from the home's play entry (see @@@solo-setup).
  await page.locator("[data-back-home]").click();
  await page.waitForSelector("[data-main-menu]:not(.hidden) [data-open-create]", { timeout: 5000 });
  const firstSoloId = await soloSetup("pineshade");
  must((await page.locator("[data-map-name]").textContent()) === "Pineshade", "confirmed map did not show the chosen pool map");
  const privateRoomProof = await page.evaluate(() => {
    const query = new URLSearchParams(location.search);
    return { visibility: query.get("visibility"), mapId: query.get("map"), slots: document.querySelectorAll(".slot-row").length };
  });
  must(privateRoomProof.visibility === "private", "confirming the map did not create a local room: " + JSON.stringify(privateRoomProof));
  must(privateRoomProof.mapId === "pineshade" && privateRoomProof.slots === 2, "confirming the map did not create the chosen pool map and its seats: " + JSON.stringify(privateRoomProof));
  const privateLobbyProof = await page.evaluate(async (roomId) => {
    const profile = JSON.parse(localStorage.getItem("sketch-rts-user"));
    const publicLobby = await (await fetch("/api/rooms")).json();
    const ownerLobby = await (await fetch("/api/rooms?userId=" + encodeURIComponent(profile.id))).json();
    return {
      listedPublicly: publicLobby.rooms.some((room) => room.id === roomId),
      listedOnServerForOwner: ownerLobby.rooms.some((room) => room.id === roomId),
      listedForOwner: false,
    };
  }, firstSoloId);
  must(!privateLobbyProof.listedPublicly && !privateLobbyProof.listedOnServerForOwner, "browser-local solo room leaked into server lists: " + JSON.stringify(privateLobbyProof));
  await page.locator("[data-back-home]").click();
  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  privateLobbyProof.listedForOwner = (await page.locator("[data-room-id='" + firstSoloId + "']").count()) === 1;
  must(privateLobbyProof.listedForOwner, "owned solo room was not visible after backing to Rooms UI");
  await page.locator("[data-room-id='" + firstSoloId + "']").click();
  await page.waitForSelector("[data-room-setup='" + firstSoloId + "']", { timeout: 5000 });
  await page.locator("[data-slot-id='slot-1'] [data-slot-race]").selectOption("ember");
  await page.locator("[data-slot-id='slot-1'] [data-slot-team]").selectOption("team-1");
  await page.locator("[data-slot-id='slot-2'] [data-slot-race]").selectOption("grove");
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("team-2");
  await page.waitForFunction(() => new URLSearchParams(location.search).get("seats") === "human:team-1:ember:,ai:team-2:grove:random", null, { timeout: 5000 });
  const configuredSoloUrl = new URL(page.url());
  configuredSoloUrl.searchParams.set("seed", "room-flow-config-seed");
  configuredSoloUrl.searchParams.set("name", "Room Flow Fleet");
  await page.goto(configuredSoloUrl.href);
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  const beforeSoloReloadId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
  const beforeSoloReloadUrl = page.url();
  await page.reload();
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
  const soloReloadProof = await page.evaluate(() => ({
    id: document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup"),
    query: Object.fromEntries(new URLSearchParams(location.search)),
    hostRace: document.querySelector("[data-slot-id='slot-1'] [data-slot-race]")?.value,
    hostTeam: document.querySelector("[data-slot-id='slot-1'] [data-slot-team]")?.value,
    aiRace: document.querySelector("[data-slot-id='slot-2'] [data-slot-race]")?.value,
    aiTeam: document.querySelector("[data-slot-id='slot-2'] [data-slot-team]")?.value,
    aiController: document.querySelector("[data-slot-id='slot-2'] [data-slot-controller-status]")?.textContent?.trim(),
  }));
  must(soloReloadProof.id !== beforeSoloReloadId && page.url() === beforeSoloReloadUrl && soloReloadProof.query.map === "pineshade" &&
    soloReloadProof.query.seed === "room-flow-config-seed" && soloReloadProof.query.name === "Room Flow Fleet" && soloReloadProof.query.visibility === "private" &&
    soloReloadProof.hostRace === "ember" && soloReloadProof.hostTeam === "team-1" && soloReloadProof.aiRace === "grove" && soloReloadProof.aiTeam === "team-2" &&
    soloReloadProof.aiController === "AI", "solo reload did not rebuild exactly the configured map/seed/name/teams/races/controllers: " + JSON.stringify(soloReloadProof));

  // The play entry opens the last solo game's map and seats again.
  const soloSeats = "human:team-1:ember:,ai:team-2:grove:random";
  await page.locator("[data-back-home]").click();
  await page.waitForSelector("[data-main-menu]:not(.hidden) [data-open-create]", { timeout: 5000 });
  await soloSetup();
  const rememberedProof = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
  must(rememberedProof.map === "pineshade" && rememberedProof.seats === soloSeats && rememberedProof.seed === "room-flow-config-seed",
    "the play entry did not open the last solo setup: " + JSON.stringify(rememberedProof));
  // Another map keeps the seats it has; coming back keeps them again.
  await chooseSetupMap("stillwater");
  const movedSeats = await page.evaluate(() => new URLSearchParams(location.search).get("seats").split(",").map(seat => seat.split(":")));
  must(movedSeats.length === 4 && movedSeats[0][2] === "ember" && movedSeats[1][2] === "grove" && movedSeats[1][0] === "ai",
    "a map change did not keep the seats the new map has: " + JSON.stringify(movedSeats));
  await chooseSetupMap("pineshade");
  must((await page.evaluate(() => new URLSearchParams(location.search).get("seats").split(",").map(seat => seat.split(":")[2]).join(","))) === "ember,grove",
    "returning to the first map did not keep the seats' races");
  // A solo rematch comes back to this screen with the settings unchanged.
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("team-2");
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
  const soloBeforeMatch = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
  await page.locator("[data-start-room]").click();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 60000 });
  // Headless Chromium cannot take the pointer lock its gate asks for; set the gate aside as the match proof below does.
  await page.evaluate(() => {
    const gate = document.querySelector("[data-pointer-lock-gate]");
    if (gate) { gate.classList.add("hidden"); gate.style.pointerEvents = "none"; }
  });
  await page.locator("[data-match-menu-button]").click();
  await page.locator("[data-forfeit-match]").click();
  await page.waitForSelector("[data-results-screen] [data-rematch]", { timeout: 10000 });
  await page.locator("[data-rematch]").click();
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false && new URLSearchParams(location.search).get("visibility") === "private", null, { timeout: 10000 });
  const soloRematch = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));
  must(soloRematch.map === soloBeforeMatch.map && soloRematch.seats === soloBeforeMatch.seats && soloRematch.seed === soloBeforeMatch.seed,
    "a solo rematch did not keep the settings: " + JSON.stringify({ soloBeforeMatch, soloRematch }));

  // A room for others opens from the room list's create button on the same screen.
  await page.locator("[data-back-home]").click();
  await page.locator("[data-open-room-browser]").click();
  const roomSetupId = await onlineSetup("pineshade", false);
  const guestContext = await page.context().browser().newContext();
  let guestJoinProof;
  try {
    const guest = await guestContext.newPage();
    await guest.goto(page.url());
    // A fresh context loads the whole client from the dev server before it can show the room: 1.6 to 6.5 s measured
    // on a loaded machine, so 5 s failed main as often as a branch.
    await guest.waitForSelector("[data-room-setup='" + roomSetupId + "']", { timeout: 30000 });
    await guest.locator("[data-slot-id='slot-2'] [data-slot-ready]").check();
    await page.waitForFunction(async (roomId) => {
      const room = await (await fetch("/api/rooms/" + roomId)).json();
      return room.slots[1]?.controller === "human" && room.slots[1]?.ready === true;
    }, roomSetupId, { timeout: 5000 });
    guestJoinProof = await guest.evaluate(async (roomId) => {
      const room = await (await fetch("/api/rooms/" + roomId)).json();
      const user = JSON.parse(localStorage.getItem("sketch-rts-user"));
      // A guest has no start or host controls; the footer says what the start waits on (see @@@seat-ownership).
      return { status: room.status, owner: room.hostUserId, userId: user.id, slots: room.slots.filter(slot => slot.userId === user.id),
        hostControls: document.querySelectorAll("[data-start-room], [data-close-room], [data-map-entries]").length,
        reason: document.querySelector("[data-start-reason]")?.textContent ?? "",
        hostSeatLocked: [...document.querySelectorAll("[data-slot-id='slot-1'] select, [data-slot-id='slot-1'] input")].every(control => control.disabled),
        ownSeatOpen: !document.querySelector("[data-slot-id='slot-2'] [data-slot-race]")?.disabled };
    }, roomSetupId);
    must(guestJoinProof.owner !== guestJoinProof.userId && guestJoinProof.slots.length === 1 && guestJoinProof.slots[0].id === "slot-2" &&
      guestJoinProof.status === "open" && guestJoinProof.hostControls === 0 && guestJoinProof.reason.length > 0 &&
      guestJoinProof.hostSeatLocked && guestJoinProof.ownSeatOpen, "public invitation did not join one guest seat and wait for the host: " + JSON.stringify(guestJoinProof));
    // Asked straight at the server, the guest still cannot change the host's seat.
    const guestRefused = await guest.evaluate(async (roomId) => {
      const userId = JSON.parse(localStorage.getItem("sketch-rts-user")).id;
      const response = await fetch("/api/rooms/" + roomId + "/slots/slot-1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch: { race: "random" }, userId }) });
      return { status: response.status, body: await response.text() };
    }, roomSetupId);
    must(guestRefused.status === 400 && guestRefused.body.includes("Only the seat's player"), "the server let a guest change the host's seat: " + JSON.stringify(guestRefused));
  } finally { await guestContext.close(); }
  // Restore the authoritative AI fixture after testing the real invitation.
  await page.evaluate(async (roomId) => {
    // Asked as this browser's player, the room's host (see @@@seat-ownership).
    const userId = JSON.parse(localStorage.getItem("sketch-rts-user")).id;
    const response = await fetch("/api/rooms/" + roomId + "/slots/slot-2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch: { controller: "ai" }, userId }) });
    if (!response.ok) throw new Error(await response.text());
  }, roomSetupId);
  await page.waitForFunction(() => document.querySelector("[data-slot-id='slot-2'] [data-slot-controller]")?.value === "ai" && document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
  must(roomSetupId, "room setup did not expose room id");
  const roomSetupLayoutProof = await page.evaluate(() => {
    const mapPane = document.querySelector(".match-dossier")?.getBoundingClientRect();
    const slotPane = document.querySelector(".room-slot-pane")?.getBoundingClientRect();
    const rowRects = [...document.querySelectorAll(".slot-row")].map((row) => row.getBoundingClientRect());
    return {
      mapThenSeats: Boolean(mapPane && slotPane && slotPane.left > mapPane.right + 8),
      mapName: document.querySelector("[data-map-name]")?.textContent ?? "",
      rows: rowRects.length,
      maxSlotRowHeight: Math.max(...rowRects.map((rect) => rect.height)),
      slotActions: [...document.querySelectorAll(".slot-actions button")].map((button) => button.textContent?.trim()),
      controllerOptions: [...document.querySelectorAll("[data-slot-id='slot-2'] [data-slot-controller] option")].map((option) => option.value),
      hostControllerStatus: document.querySelector("[data-slot-id='slot-1'] [data-slot-controller-status]")?.textContent ?? "",
    };
  });
  must(roomSetupLayoutProof.mapThenSeats, "room setup should keep the map dossier left of the compact seats without overlap: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.mapName === "Pineshade" && roomSetupLayoutProof.rows === 2, "room setup should show the map's name and one row per seat: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.maxSlotRowHeight <= 52, "seat rows should stay one line high: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.slotActions.length === 1 && roomSetupLayoutProof.slotActions[0] === "Close Room", "seats come with the map: only closing the room should be offered: " + JSON.stringify(roomSetupLayoutProof));
  must(
    roomSetupLayoutProof.controllerOptions.join(",") === "ai,open" && roomSetupLayoutProof.hostControllerStatus.toLowerCase() === "human",
    "a seat should be a computer's or open, and a claimed seat shown as identity: " + JSON.stringify(roomSetupLayoutProof),
  );
  await page.locator("[data-back-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  must((await page.locator("[data-room-id='" + roomSetupId + "']").count()) === 1, "owned multiplayer room was not visible after backing to Rooms UI");
  await page.locator("[data-back-home]").click();
  await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });
  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-create-room]", { timeout: 5000 });
  await page.locator("[data-back-home]").click();
  await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });

  await page.reload();
  await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });
  must((await page.locator("[data-resume-room]").count()) === 0, "reload should not depend on resume-room shortcut");
  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  must((await page.locator("[data-room-id='" + roomSetupId + "']").count()) === 1, "owned room was not visible from Rooms after reload");
  await page.locator("[data-room-id='" + roomSetupId + "']").click();
  await page.waitForSelector("[data-room-setup='" + roomSetupId + "']", { timeout: 5000 });
  const rejoinedRoomProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    const profile = JSON.parse(localStorage.getItem("sketch-rts-user"));
    return { ownedSlots: room.slots.filter((slot) => slot.userId === profile.id).map((slot) => slot.playerId) };
  }, roomSetupId);
  must(rejoinedRoomProof.ownedSlots.length === 1, "refresh/resume did not rejoin the user's claimed slot: " + JSON.stringify(rejoinedRoomProof));

  await page.locator("[data-slot-id='slot-2'] [data-slot-controller]").selectOption("open");
  await page.waitForFunction(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return room.slots.find((slot) => slot.id === "slot-2")?.controller === "open";
  }, roomSetupId, { timeout: 5000 });
  await page.locator("[data-slot-id='slot-2'] [data-slot-controller]").selectOption("ai");
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("team-4");
  await page.locator("[data-slot-id='slot-2'] [data-slot-race]").selectOption("grove");
  await page.locator("[data-slot-id='slot-1'] [data-slot-race]").selectOption("ember");
  await page.locator("[data-slot-id='slot-1'] [data-slot-ready]").uncheck();
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === true, null, { timeout: 5000 });
  await page.locator("[data-slot-id='slot-1'] [data-slot-ready]").check();
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
  const slotEditProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return {
      startEnabled: !document.querySelector("[data-start-room]")?.disabled,
      host: room.slots.find((slot) => slot.id === "slot-1"),
      ai: room.slots.find((slot) => slot.id === "slot-2"),
    };
  }, roomSetupId);
  must(
    slotEditProof.startEnabled &&
      slotEditProof.host?.controller === "human" &&
      slotEditProof.host?.ready === true &&
      slotEditProof.host?.race === "ember" &&
      slotEditProof.ai?.controller === "ai" &&
      slotEditProof.ai?.name === "AI" &&
      slotEditProof.ai?.team === "team-4" &&
      slotEditProof.ai?.race === "grove",
    "slot controls did not update controller/team/race/ready through the UI: " + JSON.stringify(slotEditProof),
  );

  await page.locator("[data-start-room]").click();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
  await page.waitForFunction(async ({ roomId, mapId }) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return room.status === "inMatch" && room.mapId === mapId;
  }, { roomId: roomSetupId, mapId: "pineshade" }, { timeout: 5000 });
  // A reload during the match comes straight back into it (the room's route).
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
  const snapshot = await page.evaluate(async (roomId) => {
    const res = await fetch("/api/rooms/" + roomId + "/snapshot");
    return res.json();
  }, roomSetupId);
  must(snapshot.map.id === "pineshade" && snapshot.map.terrain, "room start did not use the pool map's layout");
  must(snapshot.players.player.supplyCap > 0, "room snapshot did not expose player state");
  const researchProof = await page.evaluate(async (roomId) => {
    const reset = await fetch("/api/rooms/" + roomId + "/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId: "bareDuel",
        options: {
          aiPlayers: ["enemy"],
          // The reset keeps the room's races, and the host plays ember (the slot edits above): its weapon and plating
          // research is at the Ember Forge.
          scenario: {
            addBuildings: [{ id: "ui-research-forge", owner: "player", kind: "emberForge", x: 1200, y: 960, complete: true }],
          },
        },
      }),
    });
    if (!reset.ok) throw new Error(await reset.text());
    return (await reset.json()).snapshot;
  }, roomSetupId);
  must(researchProof.buildings.some((building) => building.id === "ui-research-forge"), "research proof did not seed a selectable ember forge");
  await page.waitForFunction(async (roomId) => {
    const snapshot = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    return snapshot.buildings.some((building) => building.id === "ui-research-forge");
  }, roomSetupId, { timeout: 5000 });
  // A reload during the match comes straight back into it (the room's route).
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
  await page.waitForFunction(async (roomId) => {
    const snapshot = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    return snapshot.buildings.some((building) => building.id === "ui-research-forge");
  }, roomSetupId, { timeout: 5000 });
  await page.waitForFunction(() => window.__sketchRtsView?.buildingIds.includes("ui-research-forge"), null, { timeout: 5000 });
  const authoritativeReloadProof = await page.evaluate(() => ({ tick: window.__sketchRtsView?.tick, buildingIds: window.__sketchRtsView?.buildingIds }));
  await page.evaluate(() => {
    const gate = document.querySelector("[data-pointer-lock-gate]");
    if (gate) {
      gate.classList.add("hidden");
      gate.style.pointerEvents = "none";
    }
  });
  // Opening a match centers the camera on the player's entities. Use the
  // actual minimap to bring the research fixture into the screen center.
  const researchNavigation = await page.evaluate(async (roomId) => {
    const snapshot = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    const forge = snapshot.buildings.find(building => building.id === "ui-research-forge");
    const frame = document.querySelector("[data-minimap-frame]");
    const canvas = document.querySelector(".game-canvas");
    if (!forge || !frame || !canvas) throw new Error("Research navigation fixture missing");
    const transform = new DOMMatrixReadOnly(getComputedStyle(frame).transform);
    const bounds = canvas.getBoundingClientRect();
    return {
      minimap: { x: bounds.x + transform.m41 + parseFloat(frame.style.width) * forge.x / snapshot.map.width,
        y: bounds.y + transform.m42 + parseFloat(frame.style.height) * forge.y / snapshot.map.height },
      center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    };
  }, roomSetupId);
  await page.mouse.click(researchNavigation.minimap.x, researchNavigation.minimap.y);
  await page.waitForTimeout(250);
  await page.mouse.click(researchNavigation.center.x, researchNavigation.center.y);
  await page.waitForTimeout(300);
  const researchSelectionProof = await page.evaluate(() => ({
    focusedId: window.__sketchRtsView?.focusedSelectionId,
    selection: document.querySelector("[data-selection]")?.textContent ?? "",
    selectionLabels: [...document.querySelectorAll("[data-selection] [aria-label]")].map((element) => element.getAttribute("aria-label") ?? ""),
    status: document.querySelector("[data-status]")?.textContent ?? "",
  }));
  must(researchSelectionProof.focusedId === "ui-research-forge" && researchSelectionProof.selectionLabels.some((label) => label.includes("Ember Forge")), "research proof did not select the ember forge: " + JSON.stringify(researchSelectionProof));
  const researchDockProof = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("[data-command-dock] button")].filter((button) => !button.hidden);
    return {
      labels: buttons.map((button) => button.getAttribute("data-command-label")),
      hotkeys: buttons.map((button) => button.getAttribute("data-hotkey")),
    };
  });
  must(
    researchDockProof.labels.includes("Research Weapon Training") &&
      researchDockProof.labels.includes("Research Reinforced Plating") &&
      researchDockProof.hotkeys.includes("W") &&
      researchDockProof.hotkeys.includes("P"),
    "selected ember forge did not expose research buttons: " + JSON.stringify(researchDockProof),
  );
  await page.locator("[data-command-label='Research Weapon Training']").click();
  await page.waitForFunction(async (roomId) => {
    const snapshot = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    return snapshot.buildings.find((building) => building.id === "ui-research-forge")?.researchQueue?.[0]?.upgradeKind === "weaponTraining";
  }, roomSetupId, { timeout: 5000 });
  const researchProgressProof = await page.waitForFunction(() => {
    const button = document.querySelector("[data-research-progress='weaponTraining']");
    if (!button) return false;
    const fill = button.querySelector(".research-progress-fill");
    const state = {
      ariaDisabled: button.getAttribute("aria-disabled"),
      ariaLabel: button.getAttribute("aria-label"),
      commandLabel: button.getAttribute("data-command-label"),
      progressValue: getComputedStyle(button).getPropertyValue("--research-progress"),
      progressWidth: fill ? getComputedStyle(fill).width : "",
    };
    return state.progressValue !== "0%" && state.progressWidth !== "0px" ? state : false;
  }, null, { timeout: 5000 });
  const researchProgressState = await researchProgressProof.jsonValue();
  must(
    researchProgressState.ariaDisabled === "true" &&
      researchProgressState.ariaLabel?.includes("Researching Weapon Training") &&
      researchProgressState.commandLabel?.includes("Researching Weapon Training") &&
      researchProgressState.progressValue !== "0%" &&
      researchProgressState.progressWidth !== "0px",
    "research progress button did not replace the clicked research command: " + JSON.stringify(researchProgressState),
  );
  await page.evaluate(() => {
    const canvas = document.querySelector(".game-canvas");
    let locked = true;
    window.__sketchRtsExitPointerLockCalled = false;
    Object.defineProperty(document, "pointerLockElement", {
      configurable: true,
      get: () => (locked ? canvas : null),
    });
    document.exitPointerLock = () => {
      locked = false;
      window.__sketchRtsExitPointerLockCalled = true;
      document.dispatchEvent(new Event("pointerlockchange"));
    };
  });

  const ended = await page.evaluate(async (roomId) => {
    const current = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    const playerBase = current.buildings.find(building => building.owner === "player" && building.kind === "townHall");
    if (!playerBase) throw new Error("Results fixture requires the player's actual base");
    const moduleBase = location.pathname;
    const [{ landSpawnPoint }, { createUnit }, { footprintHalf }] = await Promise.all([
      import(moduleBase + "src/shared/production-spawn.ts"), import(moduleBase + "src/shared/map.ts"), import(moduleBase + "src/shared/terrain.ts"),
    ]);
    const half = current.map.terrain ? footprintHalf(playerBase.radius, current.map.terrain.cell) : playerBase.radius;
    const placementWorld = { ...current, units: [...current.units] };
    const assault = [[1, 0], [-1, 0], [0, -1]].map(([dx, dy], index) => {
      const unit = createUnit("result-golem-" + (index + 1), "enemy", "golem", playerBase.x, playerBase.y);
      const reach = half + unit.radius + 4;
      const source = { ...playerBase, rallyTarget: undefined, rallyX: playerBase.x + dx * reach, rallyY: playerBase.y + dy * reach };
      const at = landSpawnPoint({ ...placementWorld, buildings: placementWorld.buildings.map(building => building.id === source.id ? source : building) }, source, unit);
      if (!at) throw new Error("No legal assault berth beside the player's actual base");
      placementWorld.units.push({ ...unit, ...at });
      return { id: unit.id, owner: unit.owner, kind: unit.kind, ...at, order: { type: "attack", targetId: playerBase.id } };
    });
    const reset = await fetch("/api/rooms/" + roomId + "/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId: "bareDuel",
        options: {
          aiPlayers: ["enemy"],
          scenario: {
            addUnits: assault,
          },
        },
      }),
    });
    if (!reset.ok) throw new Error(await reset.text());
    let latest;
    for (let i = 0; i < 40; i += 1) {
      const ticked = await fetch("/api/rooms/" + roomId + "/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticks: 120 }),
      });
      if (!ticked.ok) throw new Error(await ticked.text());
      latest = await ticked.json();
      if (latest.room.status === "ended") return latest.room;
    }
    throw new Error("results scenario did not end; latest=" + JSON.stringify(latest?.room));
  }, roomSetupId);

  await page.waitForSelector("[data-results-screen='" + roomSetupId + "']", { timeout: 5000 });
  const resultText = await page.locator("[data-result-winner]").textContent();
  const pointerLockReleasedForResults = await page.evaluate(() => window.__sketchRtsExitPointerLockCalled === true && document.pointerLockElement === null);
  must(pointerLockReleasedForResults, "results screen did not release pointer lock for menu clicks");
  must(resultText && resultText.includes("Winner:"), "results screen did not show winner");
  must((await page.locator("[data-result-slot='player']").count()) === 1, "results screen missing player slot row");
  must((await page.locator("[data-result-slot='enemy']").count()) === 1, "results screen missing enemy slot row");
  // A computer is named by how it plays; its internal version waits in the details.
  const styleProof = await page.evaluate(() => ({ controllers: [...document.querySelectorAll("[data-result-slot] span:nth-child(2)")].map(cell => cell.textContent),
    finished: document.querySelector("[data-menu-status]")?.textContent ?? "", details: !!document.querySelector("[data-result-details]") }));
  must(styleProof.controllers.some(text => /AI · (Archers|Summoners|Knights)/.test(text)) && styleProof.details && !/tick/i.test(styleProof.finished),
    "results should name computers by play style and keep versions in the details: " + JSON.stringify(styleProof));
  must((await page.locator("[data-rematch]").count()) === 1, "results screen missing rematch action");
  must((await page.locator("[data-return-home]").count()) === 1, "results screen missing home action");

  // An online player concedes from the match menu (see @@@forfeit): the other side wins, and the results say how long
  // the match took. Then the room is played again (see @@@rematch): the host's rematch brings both players back into the
  // same room, seats as they were, the guest to get ready again.
  await page.locator("[data-return-home]").click();
  await page.locator("[data-open-room-browser]").click();
  const concedeId = await onlineSetup("pineshade", false);
  const rivalContext = await page.context().browser().newContext();
  try {
    const rival = await rivalContext.newPage();
    await rival.goto(page.url().split(/[?#]/)[0] + "?room=" + encodeURIComponent(concedeId));
    await rival.waitForSelector("[data-room-setup='" + concedeId + "'] [data-slot-id='slot-2'] [data-slot-ready]:not([disabled])", { timeout: 30000 });
    await rival.locator("[data-slot-id='slot-2'] [data-slot-ready]").check();
    await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 30000 });
    const seatsBefore = await page.evaluate(async (roomId) => (await (await fetch("/api/rooms/" + roomId)).json()).slots.map(slot => [slot.userId ?? null, slot.controller, slot.team, slot.race]), concedeId);
    await page.locator("[data-start-room]").click();
    await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 30000 });
    await page.evaluate(() => {
      const gate = document.querySelector("[data-pointer-lock-gate]");
      if (gate) { gate.classList.add("hidden"); gate.style.pointerEvents = "none"; }
    });
    await page.locator("[data-match-menu-button]").click();
    await page.locator("[data-forfeit-match]").click();
    await page.waitForSelector("[data-results-screen='" + concedeId + "']", { timeout: 30000 });
    await rival.waitForSelector("[data-results-screen='" + concedeId + "']", { timeout: 30000 });
    const concedeProof = await page.evaluate(async (roomId) => {
      const room = await (await fetch("/api/rooms/" + roomId)).json();
      return { status: room.status, winner: room.result?.winner, finished: document.querySelector("[data-menu-status]")?.textContent ?? "" };
    }, concedeId);
    must(concedeProof.status === "ended" && concedeProof.winner === "enemy" && /\d+:\d\d/.test(concedeProof.finished) && !/tick/i.test(concedeProof.finished),
      "conceding an online match did not end it for the other side with readable results: " + JSON.stringify(concedeProof));
    await page.locator("[data-rematch]").click();
    await page.waitForSelector("[data-room-setup='" + concedeId + "']", { timeout: 30000 });
    // The guest, still on the results, is brought back without a click.
    await rival.waitForSelector("[data-room-setup='" + concedeId + "'] [data-slot-id='slot-2'] [data-slot-ready]", { timeout: 30000 });
    const rematchProof = await page.evaluate(async (roomId) => {
      const room = await (await fetch("/api/rooms/" + roomId)).json();
      return { status: room.status, result: room.result ?? null, seats: room.slots.map(slot => [slot.userId ?? null, slot.controller, slot.team, slot.race]), ready: room.slots.map(slot => slot.ready) };
    }, concedeId);
    const rivalBox = await rival.locator("[data-slot-id='slot-2'] [data-slot-ready]").isChecked();
    must(rematchProof.status === "open" && rematchProof.result === null && JSON.stringify(rematchProof.seats) === JSON.stringify(seatsBefore)
      && rematchProof.ready[0] === true && rematchProof.ready[1] === false && !rivalBox,
      "a rematch did not bring both players back to the same room, seats kept, the guest to get ready again: " + JSON.stringify({ seatsBefore, rematchProof, rivalBox }));
  } finally { await rivalContext.close(); }
  await page.locator("[data-back-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  await page.locator("[data-back-home]").click();
  await page.waitForSelector("[data-main-menu]:not(.hidden) [data-open-room-browser]", { timeout: 5000 });

  await page.evaluate(() => localStorage.removeItem("sketch-rts-current-room"));
  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  const sidesSetupId = await onlineSetup("twoShores");
  const seatsReady = () => page.evaluate(() => !document.querySelector("[data-start-room]")?.disabled);
  const sidesBefore = await seatsReady();
  const waitForSeatEdit = (field, value, ready) => page.waitForFunction(({ field, value, ready }) => {
    const select = document.querySelector(field);
    const start = document.querySelector("[data-start-room]");
    return select?.value === value && !select.disabled && start?.disabled === !ready;
  }, { field, value, ready }, { timeout: 5000 });
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("team-1");
  await waitForSeatEdit("[data-slot-id='slot-2'] [data-slot-team]", "team-1", true);
  const unevenTeamsReady = await seatsReady();
  await page.locator("[data-slot-id='slot-4'] [data-slot-team]").selectOption("team-1");
  await waitForSeatEdit("[data-slot-id='slot-4'] [data-slot-team]", "team-1", false);
  const oneTeamReady = await seatsReady();
  await page.locator("[data-slot-id='slot-4'] [data-slot-team]").selectOption("team-2");
  await waitForSeatEdit("[data-slot-id='slot-4'] [data-slot-team]", "team-2", true);
  const opposingTeamsReady = await seatsReady();
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("team-2");
  await waitForSeatEdit("[data-slot-id='slot-2'] [data-slot-team]", "team-2", true);
  await page.locator("[data-slot-id='slot-4'] [data-slot-controller]").selectOption("open");
  await waitForSeatEdit("[data-slot-id='slot-4'] [data-slot-controller]", "open", false);
  const emptySeatReady = await seatsReady();
  await page.locator("[data-slot-id='slot-4'] [data-slot-controller]").selectOption("ai");
  await waitForSeatEdit("[data-slot-id='slot-4'] [data-slot-controller]", "ai", true);
  const restoredSeatsReady = await seatsReady();
  const seatsProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return { visibility: room.visibility, mapId: room.mapId, seats: room.slots.length, rows: document.querySelectorAll(".slot-row").length };
  }, sidesSetupId);
  const allianceReadinessProof = { sidesBefore, unevenTeamsReady, oneTeamReady, opposingTeamsReady, emptySeatReady, restoredSeatsReady };
  must(sidesBefore && unevenTeamsReady && !oneTeamReady && opposingTeamsReady && !emptySeatReady && restoredSeatsReady && seatsProof.visibility === "public" && seatsProof.mapId === "twoShores" && seatsProof.seats === 4 && seatsProof.rows === 4, "a named two-shore map should retain four occupied seats and allow custom opposing alliances: " + JSON.stringify({ seatsProof, allianceReadinessProof }));
  await page.locator("[data-close-room]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  const closeRoomProof = await page.evaluate(async (roomId) => {
    const profile = JSON.parse(localStorage.getItem("sketch-rts-user"));
    const rooms = await (await fetch("/api/rooms?userId=" + encodeURIComponent(profile.id))).json();
    // @@@expected-404-console-noise - The per-room GET returns 404 after close, but browser fetch logs expected 404s as console errors; server tests cover deletion, and GET maps missing rooms to 404.
    return {
      listed: rooms.rooms.some((room) => room.id === roomId),
      visibleInUi: Boolean(document.querySelector("[data-room-id='" + roomId + "']")),
    };
  }, sidesSetupId);
  must(
    !closeRoomProof.listed && !closeRoomProof.visibleInUi,
    "closing a room should remove it from the backend room list and room browser: " + JSON.stringify(closeRoomProof),
  );

  await page.evaluate((proof) => {
    window.__sketchRtsRoomFlowProof = proof;
  }, {
    ok: true,
    profileId: persistedProfile.id,
    roomSetupId,
    map: snapshot.map.id,
    tick: snapshot.tick,
    endedStatus: ended.status,
    winner: ended.result?.winner,
    pointerLockReleasedForResults,
    researchDockProof,
    researchSelectionProof,
    authoritativeReloadProof,
    researchProgressState,
    privateLobbyProof,
    soloReloadProof,
    guestJoinProof,
    roomSetupLayoutProof,
    roomBrowserLayoutProof,
    slotEditProof,
    seatsProof,
    allianceReadinessProof,
    closeRoomProof,
  });
}
`;
}
