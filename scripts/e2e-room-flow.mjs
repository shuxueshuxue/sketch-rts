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
  must((await page.locator("[data-open-room-browser]").count()) === 1, "home missing rooms entry");
  must((await page.locator("[data-open-profile]").count()) === 1, "home missing profile entry");
  must((await page.locator("[data-create-game]").count()) === 0, "home should not expose create game outside the room browser");
  must((await page.locator("[data-resume-room]").count()) === 0, "home should not expose resume-room shortcut");
  must((await page.locator("[data-create-local-room]").count()) === 0, "home still exposes old single/local creation entry");
  must((await page.locator("[data-map-id]").count()) === 0, "home exposes direct map picker instead of hierarchy");
  const homeButtonProof = await page.locator("[data-open-room-browser], [data-open-profile]").evaluateAll((buttons) =>
    buttons.map((button) => ({ label: button.textContent ?? "", width: button.getBoundingClientRect().width })),
  );
  must(
    homeButtonProof.length === 2 && homeButtonProof.every((button) => button.width <= 430),
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

  const backdropA = await canvasPatch(640, 400, 180, 120);
  await sleep(260);
  const backdropB = await canvasPatch(640, 400, 180, 120);
  must(backdropA.hash !== backdropB.hash, "main menu background did not animate");

  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  const roomBrowserLayoutProof = await page.evaluate(() => {
    const actions = document.querySelector(".room-browser-actions")?.getBoundingClientRect();
    const list = document.querySelector(".room-browser-list")?.getBoundingClientRect();
    return {
      hasCreate: Boolean(document.querySelector("[data-create-room]")),
      hasList: Boolean(document.querySelector("[data-room-browser-list]")),
      sideBySide: Boolean(actions && list && list.left > actions.right + 8),
    };
  });
  must(roomBrowserLayoutProof.hasCreate && roomBrowserLayoutProof.hasList && roomBrowserLayoutProof.sideBySide, "rooms browser should show create action on the left and room list on the right: " + JSON.stringify(roomBrowserLayoutProof));
  await page.locator("[data-create-room]").click();
  await page.waitForSelector("[data-create-game-form]", { timeout: 5000 });
  must((await page.locator("[data-create-game-form] input[name='privateRoom']").isChecked()) === true, "new rooms should default to private/local shape");
  await page.locator("[data-create-game-form] select[name='mapId']").selectOption("wildMarches");
  await page.locator("[data-submit-create-game]").click();
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  const roomSetupId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
  must(roomSetupId, "room setup did not expose room id");
  must((await page.locator("[data-map-id='wildMarches']").count()) === 1, "room setup missing map selection");
  const roomSetupLayoutProof = await page.evaluate(() => {
    const setup = document.querySelector("[data-room-setup]");
    const layout = document.querySelector(".room-setup-layout");
    const mapPane = document.querySelector(".room-map-pane");
    const slotPane = document.querySelector(".room-slot-pane");
    const selectedMap = document.querySelector("[data-map-id='wildMarches']");
    const layoutRect = layout?.getBoundingClientRect();
    const mapRect = mapPane?.getBoundingClientRect();
    const slotRect = slotPane?.getBoundingClientRect();
    const rowRects = [...document.querySelectorAll(".slot-row")].map((row) => row.getBoundingClientRect());
    return {
      setupWidth: setup?.getBoundingClientRect().width ?? 0,
      mapLeft: mapRect?.left ?? 0,
      slotLeft: slotRect?.left ?? 0,
      sideBySide: Boolean(layoutRect && mapRect && slotRect && slotRect.left > mapRect.right + 8),
      selectedMapText: selectedMap?.textContent ?? "",
      slotSummary: document.querySelector("[data-slot-summary]")?.textContent ?? "",
      maxSlotRowHeight: Math.max(...rowRects.map((rect) => rect.height)),
      slotPaneBorder: getComputedStyle(slotPane).borderTopWidth,
      hasCountInputs: Boolean(document.querySelector("[data-room-human-count], [data-room-ai-count]")),
      slotActions: [...document.querySelectorAll(".slot-actions button")].map((button) => button.textContent?.trim()),
      humanControllerOptions: [...document.querySelectorAll("[data-slot-controller] option[value='human']")].length,
      hostControllerStatus: document.querySelector("[data-slot-id='slot-1'] [data-slot-controller-status]")?.textContent ?? "",
    };
  });
  must(roomSetupLayoutProof.sideBySide, "room setup should place maps in a left pane and slots in a right pane: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.maxSlotRowHeight <= 52, "two-slot setup should not stretch slot rows into oversized panels: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.slotPaneBorder === "0px", "slot pane should not keep an outer box shell around sparse rows: " + JSON.stringify(roomSetupLayoutProof));
  must(!roomSetupLayoutProof.hasCountInputs, "room setup should use slot actions instead of humans/AI number inputs: " + JSON.stringify(roomSetupLayoutProof));
  must(
    roomSetupLayoutProof.slotActions.includes("+ Player") &&
      roomSetupLayoutProof.slotActions.includes("+ Computer") &&
      roomSetupLayoutProof.slotActions.includes("Remove Slot") &&
      roomSetupLayoutProof.slotActions.includes("Close Room"),
    "room setup did not expose direct slot management actions: " + JSON.stringify(roomSetupLayoutProof),
  );
  must(
    roomSetupLayoutProof.humanControllerOptions === 0 && roomSetupLayoutProof.hostControllerStatus === "human",
    "room setup should show claimed human seats as identity, not as a selectable controller: " + JSON.stringify(roomSetupLayoutProof),
  );
  must(roomSetupLayoutProof.selectedMapText.includes("2-30 configurable"), "selected map did not explain configurable slot capacity: " + JSON.stringify(roomSetupLayoutProof));
  must(roomSetupLayoutProof.slotSummary.includes("2/30") && roomSetupLayoutProof.slotSummary.includes("1 AI"), "slot summary did not expose current room composition: " + JSON.stringify(roomSetupLayoutProof));
  const privateRoomProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return { visibility: room.visibility, mapId: room.mapId, slots: room.slots.length };
  }, roomSetupId);
  must(privateRoomProof.visibility === "private", "private checkbox did not create a private room: " + JSON.stringify(privateRoomProof));
  must(privateRoomProof.mapId === "wildMarches", "create form did not use selected map: " + JSON.stringify(privateRoomProof));
  const mapScrollBeforeClick = await page.evaluate(() => {
    const grid = document.querySelector(".room-map-grid");
    if (!grid) throw new Error("map grid missing");
    grid.scrollTop = Math.floor(grid.scrollHeight * 0.55);
    const rect = grid.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height - 20, 120))?.closest("[data-map-id]");
    if (!target) throw new Error("no visible map button after scrolling");
    return { before: grid.scrollTop, mapId: target.getAttribute("data-map-id") };
  });
  must(mapScrollBeforeClick.before > 0 && mapScrollBeforeClick.mapId, "map list did not scroll before click: " + JSON.stringify(mapScrollBeforeClick));
  await page.locator("[data-map-id='" + mapScrollBeforeClick.mapId + "']").click();
  await page.waitForFunction(async ({ roomId, mapId }) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return room.mapId === mapId;
  }, { roomId: roomSetupId, mapId: mapScrollBeforeClick.mapId }, { timeout: 5000 });
  const mapScrollAfterClick = await page.evaluate(() => document.querySelector(".room-map-grid")?.scrollTop ?? -1);
  must(
    Math.abs(mapScrollAfterClick - mapScrollBeforeClick.before) <= 2,
    "clicking a map should not move the map list scrollbar: " + JSON.stringify({ mapScrollBeforeClick, mapScrollAfterClick }),
  );
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
  await page.locator("[data-slot-id='slot-2'] [data-slot-controller]").selectOption("closed");
  await page.waitForFunction(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return room.slots.find((slot) => slot.id === "slot-2")?.controller === "closed";
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
  }, { roomId: roomSetupId, mapId: mapScrollBeforeClick.mapId }, { timeout: 5000 });
  await page.reload();
  await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });
  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  must((await page.locator("[data-room-id='" + roomSetupId + "']").count()) === 1, "in-match owned room was not visible from Rooms after reload");
  await page.locator("[data-room-id='" + roomSetupId + "']").click();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
  const snapshot = await page.evaluate(async (roomId) => {
    const res = await fetch("/api/rooms/" + roomId + "/snapshot");
    return res.json();
  }, roomSetupId);
  must(snapshot.map.id === mapScrollBeforeClick.mapId, "room start did not use selected map");
  must(snapshot.players.player.supplyCap >= 10, "room snapshot did not expose player state");
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
  await page.reload();
  await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });
  await page.locator("[data-open-room-browser]").click();
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  await page.locator("[data-room-id='" + roomSetupId + "']").click();
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
  await page.locator("[data-create-game-form] select[name='mapId']").selectOption("bareDuel");
  await page.locator("[data-create-game-form] input[name='humanCount']").fill("2");
  await page.locator("[data-create-game-form] input[name='aiCount']").fill("3");
  await page.locator("[data-submit-create-game]").click();
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  const sameMapSmallRoomId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
  const sameMapSmallProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return {
      mapId: room.mapId,
      slotCount: room.slots.length,
      humanSeats: room.slots.filter((slot) => slot.controller === "human" || slot.controller === "open").length,
      aiSeats: room.slots.filter((slot) => slot.controller === "ai").length,
    };
  }, sameMapSmallRoomId);
  must(
    sameMapSmallProof.mapId === "bareDuel" &&
      sameMapSmallProof.slotCount === 5 &&
      sameMapSmallProof.humanSeats === 2 &&
      sameMapSmallProof.aiSeats === 3,
    "small same-map room did not keep requested human/computer counts: " + JSON.stringify(sameMapSmallProof),
  );
  await page.locator("[data-add-player-slot]").click();
  await page.waitForFunction(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return room.slots.length === 6 && room.slots.filter((slot) => slot.controller === "ai").length === 3;
  }, sameMapSmallRoomId, { timeout: 5000 });
  const setupResizeProof = await page.evaluate(async (roomId) => {
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    return {
      mapId: room.mapId,
      slotCount: room.slots.length,
      summary: document.querySelector("[data-slot-summary]")?.textContent ?? "",
    };
  }, sameMapSmallRoomId);
  must(
    setupResizeProof.mapId === "bareDuel" && setupResizeProof.slotCount === 6 && setupResizeProof.summary.includes("6/30"),
    "room setup slot actions did not resize the current room independently from map choice: " + JSON.stringify(setupResizeProof),
  );
  await page.locator("[data-back-room-browser]").click();
  await page.evaluate(() => localStorage.removeItem("sketch-rts-current-room"));
  await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
  await page.locator("[data-create-room]").click();
  await page.waitForSelector("[data-create-game-form]", { timeout: 5000 });
  await page.locator("[data-create-game-form] input[name='privateRoom']").uncheck();
  await page.locator("[data-create-game-form] input[name='humanCount']").fill("15");
  await page.locator("[data-create-game-form] input[name='aiCount']").fill("15");
  await page.locator("[data-create-game-form] select[name='mapId']").selectOption("bareDuel");
  await page.locator("[data-submit-create-game]").click();
  await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
  const grandSetupId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
  const layoutProof = await page.evaluate(async (roomId) => {
    const setup = document.querySelector("[data-room-setup]");
    const layout = document.querySelector(".room-setup-layout");
    const mapPane = document.querySelector(".room-map-pane");
    const slotPane = document.querySelector(".room-slot-pane");
    const slotList = document.querySelector(".slot-list");
    const rows = [...document.querySelectorAll(".slot-row")];
    const room = await (await fetch("/api/rooms/" + roomId)).json();
    const setupRect = setup.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const mapRect = mapPane.getBoundingClientRect();
    const slotPaneRect = slotPane.getBoundingClientRect();
    const slotRect = slotList.getBoundingClientRect();
    const rowRects = rows.map((row) => row.getBoundingClientRect());
    return {
      roomVisibility: room.visibility,
      slotCount: room.slots.length,
      rowCount: rows.length,
      sideBySide: slotPaneRect.left > mapRect.right + 8,
      layoutWidth: layoutRect.width,
      setupHeight: setupRect.height,
      slotListHeight: slotRect.height,
      slotListScrollable: slotList.scrollHeight > slotList.clientHeight,
      viewportHeight: window.innerHeight,
      overflowsViewport: setupRect.bottom > window.innerHeight,
      grandMapText: document.querySelector("[data-map-id='grandThirty']")?.textContent ?? "",
    };
  }, grandSetupId);
  must(layoutProof.roomVisibility === "public", "public checkbox did not create public room: " + JSON.stringify(layoutProof));
  must(layoutProof.slotCount === 30 && layoutProof.rowCount === 30, "30-slot setup did not render every slot: " + JSON.stringify(layoutProof));
  must(layoutProof.sideBySide, "30-slot setup should keep map and slot panes side by side: " + JSON.stringify(layoutProof));
  must(layoutProof.slotListScrollable, "30-slot setup should scroll inside the slot pane: " + JSON.stringify(layoutProof));
  must(layoutProof.grandMapText.includes("up to 30"), "grand map capacity is not visible in the map list: " + JSON.stringify(layoutProof));
  must(!layoutProof.overflowsViewport, "30-slot setup overflows the viewport instead of scrolling internally: " + JSON.stringify(layoutProof));
  await page.screenshot({ path: ".playwright-cli/room-flow-30-slot-setup.png", fullPage: false });
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
  }, grandSetupId);
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
    mapScrollProof: { before: mapScrollBeforeClick.before, after: mapScrollAfterClick, mapId: mapScrollBeforeClick.mapId },
    tick: snapshot.tick,
    endedStatus: ended.status,
    winner: ended.result?.winner,
    researchDockProof,
    privateLobbyProof,
    roomBrowserLayoutProof,
    slotEditProof,
    sameMapSmallProof,
    setupResizeProof,
    layoutProof,
    closeRoomProof,
  });
}
`;
}
