import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const port = Number(process.env.PORT ?? 5176);
const baseUrl = `http://127.0.0.1:${port}`;
const session = `sketch-rts-e2e-brutal-${Date.now()}`;
const playwrightCli = process.env.PLAYWRIGHT_CLI ?? "playwright-cli";

let server;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), SESSION_AUTOTICK: "0", ROOM_AUTOTICK: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();

  runCli("open", baseUrl);
  runCli("resize", "1280", "800");
  const proofRun = runCli("run-code", browserProofCode(), { encoding: "utf8" });
  process.stdout.write(proofRun);
  if (proofRun.includes("### Error")) throw new Error("Playwright brutal E2E proof code failed");
  const proofEval = runCli("eval", "() => window.__sketchRtsBrutalE2eProof", { encoding: "utf8" });
  process.stdout.write(proofEval);
  if (proofEval.includes("undefined")) throw new Error("Brutal E2E proof object was not produced");
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
  const consoleIssues = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      consoleIssues.push({ type: message.type(), text: message.text() });
    }
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  const text = async (selector) => page.locator(selector).textContent();
  const must = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  let activeRoomId;
  const snapshot = async () =>
    page.evaluate(async (roomId) => {
      const res = await fetch(roomId ? "/api/rooms/" + roomId + "/snapshot" : "/api/snapshot");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, activeRoomId);
  const catalog = async () =>
    page.evaluate(async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    });
  const statusIncludes = async (needle) => {
    await page.waitForFunction((needle) => document.querySelector("[data-status]")?.textContent?.includes(needle), needle, { timeout: 5000 });
  };
  const waitFor = async (label, fn, timeout = 5000) => {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeout) {
      last = await fn();
      if (last) return last;
      await sleep(80);
    }
    throw new Error("Timed out waiting for " + label + "; last=" + JSON.stringify(last));
  };
  const resetScenario = async (body) =>
    page.evaluate(async ({ roomId, body }) => {
      const res = await fetch(roomId ? "/api/rooms/" + roomId + "/reset" : "/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      return result.snapshot ?? result;
    }, { roomId: activeRoomId, body });
  const waitForMenu = async () => {
    await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 5000 });
    await page.waitForSelector("[data-create-local-room]", { timeout: 5000 });
  };
  const enterRoomSetup = async () => {
    await page.click("[data-create-local-room]");
    await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
    activeRoomId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
    must(activeRoomId, "room setup did not expose room id");
  };
  const startLocalRoom = async (mapId, viaKeyboardIndex = null) => {
    await enterRoomSetup();
    if (viaKeyboardIndex !== null) {
      await page.keyboard.press(String(viaKeyboardIndex + 1));
    } else {
      await page.click("[data-map-id='" + mapId + "']");
    }
    await page.click("[data-start-room]");
    await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
    await sleep(140);
  };
  const canvasPatch = async (x, y, width = 80, height = 80) =>
    page.evaluate(
      ({ x, y, width, height }) => {
        const canvas = document.querySelector("canvas");
        if (!canvas) throw new Error("canvas missing");
        const left = Math.max(0, Math.floor(x - width / 2));
        const top = Math.max(0, Math.floor(y - height / 2));
        const readback = document.createElement("canvas");
        readback.width = width;
        readback.height = height;
        const context = readback.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("canvas readback context missing");
        context.drawImage(canvas, left, top, width, height, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        let ink = 0;
        let blue = 0;
        let red = 0;
        let hash = 2166136261;
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          if (Math.abs(r - 246) + Math.abs(g - 241) + Math.abs(b - 216) > 42) ink += 1;
          if (r > 28 && r < 72 && g > 70 && g < 125 && b > 105 && b < 165) blue += 1;
          if (r > 115 && g > 25 && g < 95 && b > 25 && b < 95) red += 1;
          hash ^= (r << 16) | (g << 8) | b;
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        return { ink, blue, red, hash };
      },
      { x, y, width, height },
    );
  const visibleTerrainProof = async () => {
    const samples = [];
    for (const y of [180, 320, 460, 620]) {
      for (const x of [240, 480, 760, 1040]) {
        samples.push(await canvasPatch(x, y, 180, 120));
      }
    }
    const totalInk = samples.reduce((total, sample) => total + sample.ink, 0);
    const maxInk = Math.max(...samples.map((sample) => sample.ink));
    const readableReferenceSamples = samples.filter((sample) => sample.ink > 20 && sample.ink < 1400).length;
    const saturatedSamples = samples.filter((sample) => sample.ink >= 2400).length;
    return { totalInk, maxInk, readableReferenceSamples, saturatedSamples, samples };
  };
  const visibleCommandButtons = async () =>
    page.evaluate(() => {
      const dock = document.querySelector("[data-command-dock]");
      if (!dock) throw new Error("command dock missing");
      return [...dock.querySelectorAll("button")]
        .filter((button) => !button.hidden && window.getComputedStyle(button).display !== "none")
        .map((button) => {
          const rect = button.getBoundingClientRect();
          const hotkey = button.querySelector(".hotkey")?.getBoundingClientRect();
          const icon = button.querySelector(".command-icon")?.textContent ?? "";
          return {
            label: button.getAttribute("data-command-label"),
            hotkey: button.getAttribute("data-hotkey"),
            icon,
            width: rect.width,
            height: rect.height,
            hotkeyRightGap: hotkey ? rect.right - hotkey.right : null,
            hotkeyBottomGap: hotkey ? rect.bottom - hotkey.bottom : null,
          };
        });
    });
  const assertSmallCommandCard = async (label) => {
    const buttons = await visibleCommandButtons();
    must(buttons.length > 0, label + ": no visible command buttons");
    for (const button of buttons) {
      must(button.width <= 44 && button.height <= 44, label + ": command button too large " + JSON.stringify(button));
      must(button.icon.trim().length > 0, label + ": command button missing icon " + JSON.stringify(button));
      must(button.hotkey && button.hotkey.length === 1, label + ": command button missing hotkey " + JSON.stringify(button));
      must(button.hotkeyRightGap !== null && button.hotkeyRightGap <= 6, label + ": hotkey is not bottom-right enough " + JSON.stringify(button));
      must(button.hotkeyBottomGap !== null && button.hotkeyBottomGap <= 6, label + ": hotkey is not bottom-right enough " + JSON.stringify(button));
    }
    return buttons;
  };

  await waitForMenu();
  const menuCatalog = await catalog();
  must((await page.locator("[data-map-id]").count()) === 0, "home menu should not expose the direct map picker");
  await enterRoomSetup();
  const setupMenuButtons = await page.locator("[data-map-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-map-id")));
  must(setupMenuButtons.length === menuCatalog.maps.length, "room setup does not expose every catalog map");
  for (const map of menuCatalog.maps) must(setupMenuButtons.includes(map.id), "room setup missing map " + map.id);

  const menuBackdropA = await canvasPatch(640, 400, 180, 120);
  await sleep(260);
  const menuBackdropB = await canvasPatch(640, 400, 180, 120);
  must(menuBackdropA.hash !== menuBackdropB.hash, "main menu background is not visibly animated");

  const mapSelectionProof = [];
  for (let index = 0; index < menuCatalog.maps.length; index += 1) {
    const map = menuCatalog.maps[index];
    await page.reload();
    activeRoomId = undefined;
    await waitForMenu();
    await startLocalRoom(map.id, index === 1 ? index : null);
    const current = await snapshot();
    const readout = await text("[data-map-readout]");
    const terrain = await visibleTerrainProof();
    must(current.map.id === map.id, "menu selection did not start map " + map.id + "; saw " + current.map.id);
    must(readout?.includes(current.map.width + " x " + current.map.height), "map readout does not expose selected map size after selecting " + map.id);
    must(terrain.readableReferenceSamples >= 2 && terrain.saturatedSamples <= 3, "selected map " + map.id + " terrain linework is missing or too dense: " + JSON.stringify(terrain));
    mapSelectionProof.push({ id: map.id, via: index === 1 ? "keyboard-number" : "click", terrain });
  }

  await page.reload();
  activeRoomId = undefined;
  await waitForMenu();
  await startLocalRoom("verdantCrossroads");
  await page.mouse.move(640, 400);
  const suppressedCanvasDefaults = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const proof = {};
    for (const type of ["mousedown", "contextmenu", "auxclick", "dragstart"]) {
      let observedDefaultPrevented = false;
      canvas.addEventListener(
        type,
        (event) => {
          observedDefaultPrevented = event.defaultPrevented;
        },
        { once: true },
      );
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 2, clientX: 640, clientY: 400 });
      const dispatchAllowed = canvas.dispatchEvent(event);
      proof[type] = { dispatchAllowed, observedDefaultPrevented, finalDefaultPrevented: event.defaultPrevented };
    }
    const style = getComputedStyle(canvas);
    proof.style = { touchAction: style.touchAction, userSelect: style.userSelect };
    return proof;
  });
  for (const [eventType, proof] of Object.entries(suppressedCanvasDefaults).filter(([eventType]) => eventType !== "style")) {
    must(proof.finalDefaultPrevented && proof.observedDefaultPrevented && proof.dispatchAllowed === false, eventType + " did not suppress the browser default gesture: " + JSON.stringify(proof));
  }
  must(suppressedCanvasDefaults.style.touchAction === "none", "canvas touch-action is not disabled: " + JSON.stringify(suppressedCanvasDefaults.style));
  const virtualPointerOverlayProof = await page.evaluate(() => {
    const pointer = document.querySelector("[data-virtual-pointer]");
    const topStrip = document.querySelector(".top-strip");
    const pointerStyle = pointer ? getComputedStyle(pointer) : null;
    const topStripStyle = topStrip ? getComputedStyle(topStrip) : null;
    return {
      exists: !!pointer,
      position: pointerStyle?.position,
      pointerEvents: pointerStyle?.pointerEvents,
      zIndex: pointerStyle?.zIndex,
      topStripZIndex: topStripStyle?.zIndex,
    };
  });
  must(virtualPointerOverlayProof.exists, "virtual pointer overlay is missing");
  must(virtualPointerOverlayProof.position === "absolute", "virtual pointer is not an overlay: " + JSON.stringify(virtualPointerOverlayProof));
  must(virtualPointerOverlayProof.pointerEvents === "none", "virtual pointer can intercept player input: " + JSON.stringify(virtualPointerOverlayProof));
  must(
    Number(virtualPointerOverlayProof.zIndex) > (virtualPointerOverlayProof.topStripZIndex === "auto" ? 0 : Number(virtualPointerOverlayProof.topStripZIndex || 0)),
    "virtual pointer is not above HUD UI: " + JSON.stringify(virtualPointerOverlayProof),
  );
  const beforePointerLockClickState = await page.evaluate(() => ({
    hasButton: !!document.querySelector("[data-pointer-lock]"),
    button: document.querySelector("[data-pointer-lock]")?.textContent,
    locked: document.pointerLockElement === document.querySelector("canvas"),
  }));
  must(beforePointerLockClickState.hasButton, "Pointer Lock button is missing from the game UI");
  await page.locator("[data-pointer-lock]").click();
  let pointerLockStateAfterButton = null;
  for (let i = 0; i < 50; i += 1) {
    pointerLockStateAfterButton = await page.evaluate(() => ({
      locked: document.pointerLockElement === document.querySelector("canvas"),
      pointerLockElement: document.pointerLockElement ? document.pointerLockElement.tagName : null,
      button: document.querySelector("[data-pointer-lock]")?.textContent,
      status: document.querySelector("[data-status]")?.textContent,
    }));
    if (
      pointerLockStateAfterButton.locked ||
      pointerLockStateAfterButton.button?.includes("Click Field") ||
      pointerLockStateAfterButton.status?.includes("Pointer lock failed")
    ) {
      break;
    }
    await sleep(100);
  }
  must(
    pointerLockStateAfterButton.locked ||
      pointerLockStateAfterButton.button?.includes("Click Field") ||
      pointerLockStateAfterButton.status?.includes("Pointer lock failed"),
    "Pointer Lock button did not attempt immediate capture or expose a fallback: " + JSON.stringify({ beforePointerLockClickState, pointerLockStateAfterButton }),
  );
  let pointerLockStateAfterFieldClick = null;
  if (!pointerLockStateAfterButton.locked && pointerLockStateAfterButton.button?.includes("Click Field")) {
    await page.mouse.click(640, 400);
    for (let i = 0; i < 50; i += 1) {
      pointerLockStateAfterFieldClick = await page.evaluate(() => ({
        locked: document.pointerLockElement === document.querySelector("canvas"),
        pointerLockElement: document.pointerLockElement ? document.pointerLockElement.tagName : null,
        button: document.querySelector("[data-pointer-lock]")?.textContent,
        status: document.querySelector("[data-status]")?.textContent,
      }));
      if (pointerLockStateAfterFieldClick.locked || pointerLockStateAfterFieldClick.status?.includes("Pointer lock failed")) break;
      await sleep(100);
    }
  }
  const pointerLockState = await page.evaluate(() => ({
    locked: document.pointerLockElement === document.querySelector("canvas"),
    pointerLockElement: document.pointerLockElement ? document.pointerLockElement.tagName : null,
    button: document.querySelector("[data-pointer-lock]")?.textContent,
    status: document.querySelector("[data-status]")?.textContent,
  }));
  let beforePointerLockEdgePatch = null;
  let afterPointerLockEdgePatch = null;
  if (pointerLockState.locked) {
    must(pointerLockState.button?.includes("Mouse Locked"), "Pointer Lock button did not reflect locked state");
    beforePointerLockEdgePatch = await canvasPatch(640, 400, 240, 160);
    await page.mouse.move(1276, 400);
    await sleep(360);
    afterPointerLockEdgePatch = await canvasPatch(640, 400, 240, 160);
    must(beforePointerLockEdgePatch.hash !== afterPointerLockEdgePatch.hash, "Pointer Lock virtual mouse did not drive edge camera scrolling");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.pointerLockElement === null, { timeout: 5000 });
  } else {
    must(
      pointerLockState.status?.includes("Pointer lock failed"),
      "Pointer Lock neither activated nor failed visibly: " +
        JSON.stringify({ beforePointerLockClickState, pointerLockStateAfterButton, pointerLockStateAfterFieldClick, pointerLockState }),
    );
  }
  await sleep(80);
  await page.reload();
  activeRoomId = undefined;
  await waitForMenu();
  await startLocalRoom("verdantCrossroads");
  const beforeEdgeScrollPatch = await canvasPatch(640, 400, 240, 160);
  await page.mouse.move(1276, 400);
  await sleep(360);
  const afterEdgeScrollPatch = await canvasPatch(640, 400, 240, 160);
  must(beforeEdgeScrollPatch.hash !== afterEdgeScrollPatch.hash, "touching the right viewport edge did not scroll the camera");
  await page.mouse.move(640, 400);
  await page.reload();
  activeRoomId = undefined;
  await waitForMenu();
  await startLocalRoom("verdantCrossroads");
  const emptyDockHidden = await page.evaluate(() => document.querySelector("[data-command-dock]")?.classList.contains("hidden"));
  must(emptyDockHidden, "command dock is visible before selecting a usable object");
  await page.keyboard.press("b");
  await statusIncludes("Build needs a selected worker.");
  await page.mouse.click(760, 420, { button: "right" });
  await statusIncludes("Select a unit before issuing orders.");

  await page.mouse.move(360, 420);
  await page.mouse.down();
  await page.mouse.move(520, 540);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("[data-selection]")?.textContent?.includes("selected"), { timeout: 5000 });
  const workerButtons = await assertSmallCommandCard("worker command card");
  must(workerButtons.some((button) => button.label === "Build"), "worker command card does not expose Build");
  must(workerButtons.some((button) => button.label === "Attack Move"), "worker command card does not expose Attack Move");

  await page.locator("[data-command-label='Build']").click();
  await statusIncludes("Build menu opened.");
  const buildButtons = await assertSmallCommandCard("build palette command card");
  const buildLabels = buildButtons.map((button) => button.label);
  for (const expected of ["Build Town Hall", "Build Barracks", "Build Archery Range", "Build Stables", "Build Sanctum", "Build Workshop", "Build Defense Tower", "Build Farm"]) {
    must(buildLabels.includes(expected), "build palette missing " + expected);
  }

  const beforePreview = await canvasPatch(740, 560, 128, 128);
  await page.locator("[data-command-label='Build Defense Tower']").click();
  await statusIncludes("Choose a Defense Tower location.");
  await page.mouse.move(740, 560);
  await sleep(120);
  const placementPreview = await canvasPatch(740, 560, 128, 128);
  must(placementPreview.hash !== beforePreview.hash && placementPreview.blue > beforePreview.blue, "build placement mode did not render a blue preview");
  const towerCountBeforeCancel = (await snapshot()).buildings.filter((building) => building.owner === "player" && building.kind === "defenseTower").length;
  await page.mouse.click(760, 580, { button: "right" });
  await statusIncludes("Build placement canceled.");
  await sleep(120);
  const towerCountAfterCancel = (await snapshot()).buildings.filter((building) => building.owner === "player" && building.kind === "defenseTower").length;
  must(towerCountAfterCancel === towerCountBeforeCancel, "canceling build placement still created a defense tower");

  await page.locator("[data-command-label='Build']").click();
  await statusIncludes("Build menu opened.");
  await page.locator("[data-command-label='Build Farm']").click();
  await statusIncludes("Choose a Farm location.");
  await page.mouse.move(900, 620);
  await page.mouse.click(900, 620);
  await statusIncludes("Farm foundation placed.");
  await sleep(160);
  const farmFoundation = (await snapshot()).buildings.find((building) => building.owner === "player" && building.kind === "farm" && !building.complete);
  must(farmFoundation, "clicking command-card Build Farm and map placement did not create an in-world foundation");

  const selectedBeforeGroundClick = await snapshot();
  await page.mouse.click(1040, 720);
  await sleep(120);
  const afterGroundClick = await snapshot();
  must((await text("[data-selection]"))?.includes("Nothing selected"), "left-click empty ground did not clear selection");
  must(JSON.stringify(afterGroundClick.units.map((unit) => [unit.id, unit.order])) === JSON.stringify(selectedBeforeGroundClick.units.map((unit) => [unit.id, unit.order])), "left-click empty ground changed unit orders");
  const dockHiddenAfterClear = await page.evaluate(() => document.querySelector("[data-command-dock]")?.classList.contains("hidden"));
  must(dockHiddenAfterClear, "command dock stayed visible after empty-ground selection clear");

  const enemyAttackSetup = await resetScenario({
    mapId: "bareDuel",
    options: {
      aiPlayers: [],
      scenario: {
        addUnits: [
          { id: "unit-brutal-attacker", owner: "player", kind: "footman", x: 520, y: 420 },
          { id: "unit-brutal-enemy", owner: "enemy", kind: "raider", x: 650, y: 420 },
        ],
      },
    },
  });
  await sleep(180);
  must(enemyAttackSetup.units.some((unit) => unit.id === "unit-brutal-attacker"), "enemy attack setup missing player attacker");
  must(enemyAttackSetup.units.some((unit) => unit.id === "unit-brutal-enemy"), "enemy attack setup missing enemy target");
  await page.mouse.click(520, 420);
  await page.waitForFunction(() => document.querySelector("[data-selection]")?.textContent?.includes("1 selected"), { timeout: 5000 });
  const beforeEnemyAttackPatch = await canvasPatch(650, 430, 118, 72);
  await page.mouse.click(650, 420, { button: "right" });
  await statusIncludes("Attack order issued.");
  const enemyAttackMarkerPatch = await waitFor("enemy attack target ring pixels", async () => {
    const patch = await canvasPatch(650, 430, 118, 72);
    return patch.red > 6 && patch.hash !== beforeEnemyAttackPatch.hash ? patch : false;
  });
  const afterEnemyAttack = await snapshot();
  const attackerAfterEnemyAttack = afterEnemyAttack.units.find((unit) => unit.id === "unit-brutal-attacker");
  must(
    attackerAfterEnemyAttack?.order.type === "attack" && attackerAfterEnemyAttack.order.targetId === "unit-brutal-enemy",
    "right-clicking an enemy unit did not issue an attack order to the selected unit",
  );
  must(afterEnemyAttack.effects.some((effect) => effect.type === "attackTarget"), "right-clicking an enemy unit did not create an attack-target feedback effect");

  const mini = { x: 1280 - 192 - 12, y: 800 - 192 - 12, width: 192, height: 192 };
  const beforeMinimapClickPatch = await canvasPatch(640, 400, 240, 160);
  await page.mouse.click(mini.x + mini.width * 0.82, mini.y + mini.height * 0.18);
  await sleep(120);
  const afterMinimapClickPatch = await canvasPatch(640, 400, 240, 160);
  must(beforeMinimapClickPatch.hash !== afterMinimapClickPatch.hash, "clicking the minimap did not jump the rendered camera view");

  const proof = {
    ok: true,
    kind: "browser-e2e-brutal-spec",
    mapSelectionProof,
    commandCard: {
      workerButtons,
      buildButtons,
      placementPreview,
      farmFoundation: { x: farmFoundation.x, y: farmFoundation.y, buildProgress: farmFoundation.buildProgress },
      enemyAttackMarkerPatch,
      minimapClickHashes: [beforeMinimapClickPatch.hash, afterMinimapClickPatch.hash],
      edgeScrollHashes: [beforeEdgeScrollPatch.hash, afterEdgeScrollPatch.hash],
      pointerLockState,
      pointerLockEdgeHashes: beforePointerLockEdgePatch && afterPointerLockEdgePatch ? [beforePointerLockEdgePatch.hash, afterPointerLockEdgePatch.hash] : null,
    },
    checks: [
      "real browser main-menu click/keyboard map selection",
      "real mouse drag selection",
      "real DOM command-card button clicks",
      "real mouse build placement and cancellation",
      "real right-click attack on an enemy unit",
      "real minimap click-to-jump navigation",
      "real mouse edge scrolling",
      "real Pointer Lock one-click UI flow with browser activation, fallback, or visible denial",
      "top-layer virtual pointer overlay above HUD",
      "browser mouse-default suppression on the battlefield canvas",
      "canvas pixels for animated menu, terrain, and placement preview",
      "left-click selection-only negative proof",
    ],
  };
  must(consoleIssues.length === 0, "browser console produced warnings/errors: " + JSON.stringify(consoleIssues));
  await page.evaluate((proof) => {
    window.__sketchRtsBrutalE2eProof = proof;
  }, proof);
}
`;
}
