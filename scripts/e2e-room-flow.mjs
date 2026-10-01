import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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
  const canvasPatch = (x, y, width, height) =>
    page.evaluate(
      ({ x, y, width, height }) => {
        const canvas = document.querySelector("canvas");
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
    const actions = document.querySelector(".room-browser-actions")?.getBoundingClientRect();
    const list = document.querySelector(".room-browser-list")?.getBoundingClientRect();
    return {
      hasCreate: Boolean(document.querySelector("[data-create-room]")),
      hasList: Boolean(document.querySelector("[data-room-browser-list]")),
      actionsBelow: Boolean(actions && list && actions.top > list.bottom),
    };
  });
  must(roomBrowserLayoutProof.hasCreate && roomBrowserLayoutProof.hasList && roomBrowserLayoutProof.actionsBelow, "rooms browser should show the room list with its actions below: " + JSON.stringify(roomBrowserLayoutProof));
  await page.locator("[data-create-room]").click();
  await page.waitForSelector("[data-create-game-form]", { timeout: 5000 });
  must((await page.locator("[data-create-game-form] input[name='privateRoom']").isChecked()) === true, "new rooms should default to private/local shape");
  await page.locator("[data-map-entries] [data-map-id='pineshade']").click();
  must((await page.locator("[data-map-name]").textContent()) === "Pineshade", "map chooser did not show the chosen pool map");
  await page.locator("[data-submit-create-game]").click();
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  const roomSetupId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
  must(roomSetupId, "room setup did not expose room id");
  const roomSetupLayoutProof = await page.evaluate(() => {
    const mapPane = document.querySelector(".room-map-pane")?.getBoundingClientRect();
    const slotPane = document.querySelector(".room-slot-pane")?.getBoundingClientRect();
    const rowRects = [...document.querySelectorAll(".slot-row")].map((row) => row.getBoundingClientRect());
    return {
      seatsThenMap: Boolean(mapPane && slotPane && mapPane.left > slotPane.right + 8),
      mapName: document.querySelector("[data-map-name]")?.textContent ?? "",
      rows: rowRects.length,
      maxSlotRowHeight: Math.max(...rowRects.map((rect) => rect.height)),
      slotActions: [...document.querySelectorAll(".slot-actions button")].map((button) => button.textContent?.trim()),
      controllerOptions: [...document.querySelectorAll("[data-slot-id='slot-2'] [data-slot-controller] option")].map((option) => option.value),
      hostControllerStatus: document.querySelector("[data-slot-id='slot-1'] [data-slot-controller-status]")?.textContent ?? "",
    };
  });
  must(roomSetupLayoutProof.seatsThenMap, "room setup should place seats on the left and the map on the right: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.mapName === "Pineshade" && roomSetupLayoutProof.rows === 2, "room setup should show the map's name and one row per seat: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.maxSlotRowHeight <= 52, "seat rows should stay one line high: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.slotActions.length === 1 && roomSetupLayoutProof.slotActions[0] === "Close Room", "seats come with the map: only closing the room should be offered: " + JSON.stringify(roomSetupLayoutProof));
  must(
    roomSetupLayoutProof.controllerOptions.join(",") === "ai,open" && roomSetupLayoutProof.hostControllerStatus.toLowerCase() === "human",
    "a seat should be a computer's or open, and a claimed seat shown as identity: " + JSON.stringify(roomSetupLayoutProof),
  );
  const privateRoomProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return { visibility: room.visibility, mapId: room.mapId, slots: room.slots.length };
  }, roomSetupId);
  must(privateRoomProof.visibility === "private", "private checkbox did not create a private room: " + JSON.stringify(privateRoomProof));
  must(privateRoomProof.mapId === "pineshade" && privateRoomProof.slots === 2, "create form did not create a room on the chosen pool map with its seats: " + JSON.stringify(privateRoomProof));
  const privateLobbyProof = await page.evaluate(async (roomId) => {
    const profile = JSON.parse(localStorage.getItem("sketch-rts-user"));
    const publicLobby = await (await fetch("/api/rooms")).json();
    const ownerLobby = await (await fetch("/api/rooms?userId=" + encodeURIComponent(profile.id))).json();
    return {
      listedPublicly: publicLobby.rooms.some((room) => room.id === roomId),
      listedForOwner: ownerLobby.rooms.some((room) => room.id === roomId),
    };
  }, roomSetupId);
  must(!privateLobbyProof.listedPublicly, "private room leaked into public room API list: " + JSON.stringify(privateLobbyProof));
  must(privateLobbyProof.listedForOwner, "private room was not visible to its owning user query: " + JSON.stringify(privateLobbyProof));
  await page.locator("[data-back-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  must((await page.locator("[data-room-id='" + roomSetupId + "']").count()) === 1, "owned private room was not visible after backing to Rooms UI");
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
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("west");
  await page.locator("[data-slot-id='slot-2'] [data-slot-race]").selectOption("grove");
  await page.locator("[data-slot-id='slot-1'] [data-slot-race]").selectOption("ember");
  await page.locator("[data-slot-id='slot-1'] [data-slot-ready]").uncheck();
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === true, null, { timeout: 5000 });
  await page.locator("[data-slot-id='slot-1'] [data-slot-ready]").check();
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
      slotEditProof.ai?.team === "west" &&
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
          scenario: {
            addBuildings: [{ id: "ui-research-barracks", owner: "player", kind: "barracks", x: 1200, y: 960, complete: true }],
          },
        },
      }),
    });
    if (!reset.ok) throw new Error(await reset.text());
    return (await reset.json()).snapshot;
  }, roomSetupId);
  must(researchProof.buildings.some((building) => building.id === "ui-research-barracks"), "research proof did not seed a selectable barracks");
  await page.waitForFunction(async (roomId) => {
    const snapshot = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    return snapshot.buildings.some((building) => building.id === "ui-research-barracks");
  }, roomSetupId, { timeout: 5000 });
  // A reload during the match comes straight back into it (the room's route).
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
  await page.waitForFunction(async (roomId) => {
    const snapshot = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    return snapshot.buildings.some((building) => building.id === "ui-research-barracks");
  }, roomSetupId, { timeout: 5000 });
  await page.evaluate(() => {
    const gate = document.querySelector("[data-pointer-lock-gate]");
    if (gate) {
      gate.classList.add("hidden");
      gate.style.pointerEvents = "none";
    }
  });
  await page.waitForTimeout(250);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(300);
  const researchSelectionProof = await page.evaluate(() => ({
    selection: document.querySelector("[data-selection]")?.textContent ?? "",
    selectionLabels: [...document.querySelectorAll("[data-selection] [aria-label]")].map((element) => element.getAttribute("aria-label") ?? ""),
    status: document.querySelector("[data-status]")?.textContent ?? "",
  }));
  must(researchSelectionProof.selectionLabels.some((label) => label.includes("Barracks")), "research proof did not select the barracks: " + JSON.stringify(researchSelectionProof));
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
    "selected barracks did not expose research buttons: " + JSON.stringify(researchDockProof),
  );
  await page.locator("[data-command-label='Research Weapon Training']").click();
  await page.waitForFunction(async (roomId) => {
    const snapshot = await (await fetch("/api/rooms/" + roomId + "/snapshot")).json();
    return snapshot.buildings.find((building) => building.id === "ui-research-barracks")?.researchQueue?.[0]?.upgradeKind === "weaponTraining";
  }, roomSetupId, { timeout: 5000 });
  const researchProgressProof = await page.waitForFunction(() => {
    const button = document.querySelector("[data-research-progress='weaponTraining']");
    if (!button) return false;
    const fill = button.querySelector(".research-progress-fill");
    return {
      ariaDisabled: button.getAttribute("aria-disabled"),
      ariaLabel: button.getAttribute("aria-label"),
      commandLabel: button.getAttribute("data-command-label"),
      progressValue: getComputedStyle(button).getPropertyValue("--research-progress"),
      progressWidth: fill ? getComputedStyle(fill).width : "",
    };
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
    const canvas = document.querySelector("canvas");
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
    const reset = await fetch("/api/rooms/" + roomId + "/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId: "bareDuel",
        options: {
          aiPlayers: ["enemy"],
          scenario: {
            addUnits: [
              { id: "result-golem-1", owner: "enemy", kind: "golem", x: 640, y: 600 },
              { id: "result-golem-2", owner: "enemy", kind: "golem", x: 690, y: 650 },
              { id: "result-golem-3", owner: "enemy", kind: "golem", x: 720, y: 610 },
            ],
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
  must((await page.locator("[data-rematch]").count()) === 1, "results screen missing rematch action");
  must((await page.locator("[data-return-home]").count()) === 1, "results screen missing home action");

  await page.locator("[data-return-home]").click();
  await page.evaluate(() => localStorage.removeItem("sketch-rts-current-room"));
  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  await page.locator("[data-create-room]").click();
  await page.waitForSelector("[data-create-game-form]", { timeout: 5000 });
  await page.locator("[data-create-game-form] input[name='privateRoom']").uncheck();
  await page.locator("[data-map-entries] [data-map-id='twoShores']").click();
  await page.locator("[data-submit-create-game]").click();
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  const sidesSetupId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
  const seatsReady = () => page.evaluate(() => !document.querySelector("[data-start-room]")?.disabled);
  const sidesBefore = await seatsReady();
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("north");
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === true, null, { timeout: 5000 });
  await page.locator("[data-slot-id='slot-2'] [data-slot-team]").selectOption("south");
  await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
  const seatsProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return { visibility: room.visibility, mapId: room.mapId, seats: room.slots.length, rows: document.querySelectorAll(".slot-row").length };
  }, sidesSetupId);
  must(sidesBefore && seatsProof.visibility === "public" && seatsProof.mapId === "twoShores" && seatsProof.seats === 4 && seatsProof.rows === 4, "a two-sides map should open with its four seats ready and start only on even teams: " + JSON.stringify(seatsProof));
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
    researchDockProof,
    privateLobbyProof,
    roomBrowserLayoutProof,
    slotEditProof,
    seatsProof,
    closeRoomProof,
  });
}
`;
}
