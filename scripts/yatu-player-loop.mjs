import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const port = Number(process.env.PORT ?? 5173);
const baseUrl = `http://127.0.0.1:${port}`;
const session = `rts-yt-${Date.now().toString(36)}`;
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
  if (proofRun.includes("### Error")) throw new Error("Playwright proof code failed");
  const proofEval = runCli("eval", "() => window.__sketchRtsYatuProof", { encoding: "utf8" });
  process.stdout.write(proofEval);
  if (proofEval.includes("undefined")) throw new Error("Playwright proof object was not produced");
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
  const snapshot = async () => {
    must(activeRoomId, "active room id is not set");
    const response = await page.evaluate(async (roomId) => {
      const res = await fetch("/api/rooms/" + roomId + "/snapshot");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, activeRoomId);
    return response;
  };
  const tick = async (ticks) => {
    must(activeRoomId, "active room id is not set");
    await page.evaluate(async ({ roomId, ticks }) => {
      const res = await fetch("/api/rooms/" + roomId + "/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticks }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, { roomId: activeRoomId, ticks });
  };
  const resetScenario = async (body) => {
    must(activeRoomId, "active room id is not set");
    const result = await page.evaluate(async ({ roomId, body }) => {
      const res = await fetch("/api/rooms/" + roomId + "/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, { roomId: activeRoomId, body });
    return result.snapshot;
  };
  const roomCommand = async (playerId, command) => {
    must(activeRoomId, "active room id is not set");
    return page.evaluate(async ({ roomId, playerId, command }) => {
      const res = await fetch("/api/rooms/" + roomId + "/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, command }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, { roomId: activeRoomId, playerId, command });
  };
  const startLocalRoom = async (mapId) => {
    await page.waitForSelector("[data-open-room-browser]", { timeout: 5000 });
    await page.click("[data-open-room-browser]");
    await page.waitForSelector("[data-room-browser]", { timeout: 5000 });
    await page.click("[data-create-room]");
    await page.waitForSelector("[data-create-game-form]", { timeout: 5000 });
    await page.click("[data-submit-create-game]");
    await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
    activeRoomId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
    must(activeRoomId, "room setup did not expose room id");
    await page.click("[data-map-id='" + mapId + "']");
    await page.click("[data-start-room]");
    await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 5000 });
    await page.evaluate(() => {
      const gate = document.querySelector("[data-pointer-lock-gate]");
      if (gate) {
        gate.classList.add("hidden");
        gate.style.pointerEvents = "none";
      }
    });
    await sleep(120);
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
  const statusIncludes = async (needle) => {
    await waitFor("status " + needle, async () => ((await text("[data-status]")) ?? "").includes(needle));
  };
  const viewport = { width: 1280, height: 800 };
  const cameraForCenteredWorld = (center, current) => ({
    x: Math.max(0, Math.min(current.map.width - viewport.width, center.x - viewport.width / 2)),
    y: Math.max(0, Math.min(current.map.height - viewport.height, center.y - viewport.height / 2)),
  });
  const screenFromCamera = (camera, target) => ({ x: target.x - camera.x, y: target.y - camera.y });
  const centerCameraOnWorld = async (world) => {
    const current = await snapshot();
    const mini = { x: 1280 - 192 - 12, y: 800 - 192 - 12, width: 192, height: 192 };
    await page.mouse.click(mini.x + (world.x / current.map.width) * mini.width, mini.y + (world.y / current.map.height) * mini.height);
    await sleep(120);
    return cameraForCenteredWorld(world, current);
  };
  const canvasPatch = async (x, y, width = 56, height = 62) =>
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
        let gold = 0;
        let blue = 0;
        let red = 0;
        let hash = 2166136261;
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          if (Math.abs(r - 246) + Math.abs(g - 241) + Math.abs(b - 216) > 42) ink += 1;
          if (r > 210 && g > 160 && g < 225 && b < 120) gold += 1;
          if (r > 28 && r < 72 && g > 70 && g < 125 && b > 105 && b < 165) blue += 1;
          if (r > 115 && g > 25 && g < 95 && b > 25 && b < 95) red += 1;
          hash ^= (r << 16) | (g << 8) | b;
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        return { ink, gold, blue, red, hash };
      },
      { x, y, width, height },
    );
  const bestGlyphPatchAround = async (x, y) => {
    const offsets = [-72, -36, 0, 36, 72];
    let best;
    for (const dx of offsets) {
      for (const dy of offsets) {
        const patch = await canvasPatch(x + dx, y + dy, 62, 68);
        if (!best || patch.ink > best.ink) best = patch;
      }
    }
    return best;
  };
  const commandDockState = async () =>
    page.evaluate(() => {
      const dock = document.querySelector("[data-command-dock]");
      if (!dock) throw new Error("command dock missing");
      const style = window.getComputedStyle(dock);
      const buttons = [...dock.querySelectorAll("button")].filter((button) => !button.hidden && window.getComputedStyle(button).display !== "none");
      return {
        hidden: dock.classList.contains("hidden") || style.display === "none",
        labels: buttons.map((button) => button.getAttribute("data-command-label")),
        hotkeys: buttons.map((button) => button.getAttribute("data-hotkey")),
        visibleCount: buttons.length,
      };
    });
  const mustCommandDock = async (label, expectedLabels, expectedHotkeys = []) => {
    const state = await commandDockState();
    for (const expected of expectedLabels) {
      must(state.labels.includes(expected), label + " missing command " + expected + "; state=" + JSON.stringify(state));
    }
    for (const expected of expectedHotkeys) {
      must(state.hotkeys.includes(expected), label + " missing hotkey " + expected + "; state=" + JSON.stringify(state));
    }
    must(!state.hidden && state.visibleCount >= expectedLabels.length, label + " command dock was hidden or too sparse: " + JSON.stringify(state));
    return state;
  };

  await page.waitForSelector("[data-open-room-browser]");
  const menuBackdropA = await canvasPatch(640, 400, 180, 120);
  await sleep(260);
  const menuBackdropB = await canvasPatch(640, 400, 180, 120);
  must(menuBackdropA.hash !== menuBackdropB.hash, "main menu canvas backdrop did not animate between sampled frames");

  await startLocalRoom("verdantCrossroads");
  const emptyDockState = await commandDockState();
  must(emptyDockState.hidden && emptyDockState.visibleCount === 0, "command dock should be hidden before selecting a controllable object");
  const terrainPatch = await canvasPatch(1080, 300, 260, 180);
  must(terrainPatch.ink > 35, "terrain sparse linework did not leave visible background reference ink");
  must(terrainPatch.ink < 2200, "terrain sparse linework was too dense and risks hiding units");

  await page.mouse.click(760, 420, { button: "right" });
  await statusIncludes("Select a unit before issuing orders.");
  await page.keyboard.press("b");
  await statusIncludes("Build needs a selected worker.");
  await page.keyboard.press("a");
  await statusIncludes("Attack-move needs selected units.");

  await page.mouse.move(360, 420);
  await page.mouse.down();
  await page.mouse.move(520, 540);
  await page.mouse.up();
  await waitFor("worker drag selection", async () => ((await text("[data-selection]")) ?? "").includes("3 selected"));
  const workerCommandDock = await mustCommandDock("worker selection", ["Attack Move", "Build"], ["A", "B"]);

  const beforeMineMarkerPatch = await canvasPatch(590, 460, 104, 88);
  await page.mouse.click(590, 460, { button: "right" });
  await statusIncludes("Workers ordered to mine gold.");
  const afterMineCommand = await snapshot();
  must(afterMineCommand.effects.some((effect) => effect.type === "mine"), "right-click mine did not create a mine effect record");
  const mineMarkerPatch = await waitFor("right-click mine marker pixels", async () => {
    const patch = await canvasPatch(590, 460, 104, 88);
    return patch.hash !== beforeMineMarkerPatch.hash && patch.gold > beforeMineMarkerPatch.gold ? patch : false;
  });
  let afterCarry = await snapshot();
  let goldCarrier;
  for (let i = 0; i < 24 && !goldCarrier; i += 1) {
    await tick(10);
    await sleep(30);
    afterCarry = await snapshot();
    goldCarrier = afterCarry.units.find((unit) => unit.owner === "player" && unit.kind === "worker" && unit.carryingGold > 0);
  }
  must(goldCarrier, "worker never visibly carried gold after a real right-click mine order");
  const carrierPatch = await canvasPatch(goldCarrier.x, goldCarrier.y - 18, 48, 56);
  must(carrierPatch.gold > 2, "worker carrying gold did not render a gold marker on canvas");

  await page.keyboard.press("b");
  await statusIncludes("Build menu opened.");
  const buildPaletteDock = await mustCommandDock("worker build palette", ["Build Barracks", "Build Farm", "Build Defense Tower"], ["B", "E", "T"]);
  await page.keyboard.press("b");
  await statusIncludes("Choose a Barracks location.");
  await page.mouse.click(700, 560);
  await statusIncludes("Barracks foundation placed.");

  await tick(100);
  await sleep(180);
  const duringBuild = await snapshot();
  const barracksFoundation = duringBuild.buildings.find((building) => building.owner === "player" && building.kind === "barracks" && !building.complete);
  must(barracksFoundation && barracksFoundation.buildProgress > 0 && barracksFoundation.buildProgress < barracksFoundation.buildTime, "barracks did not expose an in-progress construction state");
  const constructionProgressPatch = await canvasPatch(barracksFoundation.x, barracksFoundation.y + 42, 86, 28);
  must(constructionProgressPatch.blue > 3, "construction progress bar did not render visible progress fill");

  await tick(620);
  await sleep(220);
  const afterBuild = await snapshot();
  const barracks = afterBuild.buildings.find((building) => building.owner === "player" && building.kind === "barracks" && building.complete);
  must(barracks, "player barracks was not completed through UI build placement");

  await page.mouse.click(barracks.x, barracks.y + 42);
  let barracksSelection = "";
  for (let i = 0; i < 60; i += 1) {
    barracksSelection = (await text("[data-selection]")) ?? "";
    if (barracksSelection.includes("Barracks")) break;
    await sleep(80);
  }
  must(barracksSelection.includes("Barracks"), "barracks selection failed at " + JSON.stringify({ selection: barracksSelection, barracks: { x: barracks.x, y: barracks.y } }));
  const barracksCommandDock = await mustCommandDock("barracks selection", ["Train Footman"], ["F"]);
  must(!barracksCommandDock.labels.includes("Build"), "barracks selection should not expose worker build command");
  const selectedBuildingHaloPatch = await canvasPatch(barracks.x, barracks.y + 30, 108, 42);
  must(selectedBuildingHaloPatch.blue > 12, "selected building did not render a visible pseudo-3D ground halo");
  await page.keyboard.press("f");
  await statusIncludes("Footman queued.");

  await tick(60);
  await sleep(180);
  const duringTraining = await snapshot();
  const barracksTraining = duringTraining.buildings.find((building) => building.id === barracks.id);
  must(barracksTraining?.queue[0]?.unitKind === "footman" && barracksTraining.queue[0].remaining > 0, "barracks did not expose an in-progress training queue");
  const trainingProgressPatch = await canvasPatch(barracks.x, barracks.y + 42, 96, 34);
  must(trainingProgressPatch.blue > 3, "training progress bar did not render visible progress fill");

  await tick(220);
  await sleep(220);
  const afterTrain = await snapshot();
  const footman = afterTrain.units.find((unit) => unit.owner === "player" && unit.kind === "footman");
  must(footman, "player footman was not trained through UI hotkey");

  await page.mouse.click(footman.x, footman.y);
  let footmanSelection = "";
  for (let i = 0; i < 60; i += 1) {
    footmanSelection = (await text("[data-selection]")) ?? "";
    if (footmanSelection.includes("1 selected")) break;
    await sleep(80);
  }
  must(footmanSelection.includes("1 selected"), "footman selection failed at " + JSON.stringify({ selection: footmanSelection, footman: { x: footman.x, y: footman.y } }));
  const footmanCommandDock = await mustCommandDock("footman selection", ["Attack Move"], ["A"]);
  must(!footmanCommandDock.labels.some((label) => label?.startsWith("Build")), "footman selection should not expose build commands");
  const moveScreen = { x: Math.min(footman.x + 120, 1060), y: footman.y + 82 };
  const beforeMoveMarkerPatch = await canvasPatch(moveScreen.x, moveScreen.y, 88, 88);
  await page.mouse.click(moveScreen.x, moveScreen.y, { button: "right" });
  await statusIncludes("Move order issued.");
  const moveMarkerPatch = await waitFor("right-click move marker pixels", async () => {
    const patch = await canvasPatch(moveScreen.x, moveScreen.y, 88, 88);
    return patch.hash !== beforeMoveMarkerPatch.hash && patch.ink > beforeMoveMarkerPatch.ink + 4 ? patch : false;
  });
  const afterMoveCommand = await snapshot();
  const movedFootman = afterMoveCommand.units.find((unit) => unit.id === footman.id);
  must(movedFootman?.order.type === "move", "right-click ground did not create a move order");
  must(afterMoveCommand.effects.some((effect) => effect.type === "move"), "right-click ground did not create a move effect record");
  const footmanBeforeLeftGround = await snapshot();
  const footmanBeforeLeftGroundState = footmanBeforeLeftGround.units.find((unit) => unit.id === footman.id);
  must(footmanBeforeLeftGroundState, "expected footman before left-click ground proof");
  await page.mouse.click(Math.min(footmanBeforeLeftGroundState.x + 170, 1060), footmanBeforeLeftGroundState.y + 110);
  await sleep(100);
  const afterLeftGroundClick = await snapshot();
  const footmanAfterLeftGround = afterLeftGroundClick.units.find((unit) => unit.id === footman.id);
  must(footmanAfterLeftGround, "footman disappeared after left-click ground proof");
  must(JSON.stringify(footmanAfterLeftGround.order) === JSON.stringify(footmanBeforeLeftGroundState.order), "left-click ground changed a selected unit order");
  must(((await text("[data-selection]")) ?? "").includes("Nothing selected"), "left-click ground did not behave as a selection-only clear");

  await page.mouse.click(footmanAfterLeftGround.x, footmanAfterLeftGround.y);
  await waitFor("footman reselection after left-click ground proof", async () => ((await text("[data-selection]")) ?? "").includes("1 selected"));
  await page.keyboard.press("a");
  await statusIncludes("Attack-move mode.");
  const footmanForAttackMove = (await snapshot()).units.find((unit) => unit.id === footman.id);
  must(footmanForAttackMove, "expected footman after move proof before attack-move");
  const attackMoveScreen = { x: Math.min(footmanForAttackMove.x + 220, 1060), y: footmanForAttackMove.y };
  await page.mouse.click(attackMoveScreen.x, attackMoveScreen.y);
  await statusIncludes("Attack-move order issued.");
  const attackMoveMarkerPatch = await waitFor("attack-move red marker pixels", async () => {
    const patch = await canvasPatch(attackMoveScreen.x, attackMoveScreen.y, 96, 96);
    return patch.red > 6 ? patch : false;
  });

  const afterAttackMove = await snapshot();
  const orderedFootman = afterAttackMove.units.find((unit) => unit.id === footman.id);
  must(orderedFootman && orderedFootman.order.type === "attackMove", "attack-move hotkey did not create an attackMove order");
  must(afterAttackMove.effects.some((effect) => effect.type === "attack"), "attack-move did not create an attack ground effect record");

  const workerForSanctum = (await snapshot()).units.find((unit) => unit.owner === "player" && unit.kind === "worker");
  must(workerForSanctum, "expected a live worker for sanctum construction");
  await page.mouse.click(workerForSanctum.x, workerForSanctum.y);
  await waitFor("worker reselection for sanctum", async () => ((await text("[data-selection]")) ?? "").includes("worker"));
  await page.keyboard.press("b");
  await statusIncludes("Build menu opened.");
  await page.keyboard.press("c");
  await statusIncludes("Choose a Sanctum location.");
  await page.mouse.click(820, 560);
  await statusIncludes("Sanctum foundation placed.");

  await tick(620);
  await sleep(220);
  const afterSanctum = await snapshot();
  const sanctum = afterSanctum.buildings.find((building) => building.owner === "player" && building.kind === "sanctum" && building.complete);
  must(sanctum, "player sanctum was not completed through UI build hotkey");
  const buildingPatches = {
    barracks: await canvasPatch(barracks.x, barracks.y, 76, 76),
    sanctum: await canvasPatch(sanctum.x, sanctum.y, 76, 76),
  };
  must(buildingPatches.barracks.ink > 120, "barracks glyph did not draw enough ink");
  must(buildingPatches.sanctum.ink > 120, "sanctum glyph did not draw enough ink");
  must(buildingPatches.barracks.hash !== buildingPatches.sanctum.hash, "barracks and sanctum building glyph patches were not visually distinct");

  await page.mouse.click(sanctum.x, sanctum.y + 40);
  let sanctumSelection = "";
  for (let i = 0; i < 60; i += 1) {
    sanctumSelection = (await text("[data-selection]")) ?? "";
    if (sanctumSelection.includes("Sanctum")) break;
    await sleep(80);
  }
  must(sanctumSelection.includes("Sanctum"), "sanctum selection failed at " + JSON.stringify({ selection: sanctumSelection, sanctum: { x: sanctum.x, y: sanctum.y } }));
  const sanctumCommandDock = await mustCommandDock("sanctum selection", ["Train Priest", "Train Summoner", "Train Witch"], ["P", "U", "C"]);
  await page.keyboard.press("u");
  await statusIncludes("Summoner queued.");

  await tick(320);
  await sleep(220);
  const afterSummonerTrain = await snapshot();
  const summoner = afterSummonerTrain.units.find((unit) => unit.owner === "player" && unit.kind === "summoner");
  must(summoner, "player summoner was not trained through UI hotkey");

  await page.mouse.click(summoner.x, summoner.y);
  let summonerSelection = "";
  for (let i = 0; i < 60; i += 1) {
    summonerSelection = (await text("[data-selection]")) ?? "";
    if (summonerSelection.includes("1 selected")) break;
    await sleep(80);
  }
  must(summonerSelection.includes("1 selected"), "summoner selection failed at " + JSON.stringify({ selection: summonerSelection, summoner: { x: summoner.x, y: summoner.y } }));
  const summonerCommandDock = await mustCommandDock("summoner selection", ["Attack Move", "Cast Summon"], ["A", "U"]);
  await page.keyboard.press("u");
  await statusIncludes("Summon mode.");
  await page.mouse.click(summoner.x + 70, summoner.y + 40);
  await statusIncludes("Summon order issued.");

  await sleep(180);
  const afterSummon = await snapshot();
  const spirit = afterSummon.units.find((unit) => unit.owner === "player" && unit.kind === "spirit");
  const summonEffect = afterSummon.effects.find((effect) => effect.type === "summon");
  must(spirit, "summon hotkey did not create a spirit");
  must(summonEffect, "summon hotkey did not create a visible summon effect");

  const summonerClearCamera = await centerCameraOnWorld(summoner);
  const summonerClearTarget = screenFromCamera(summonerClearCamera, { x: Math.min(summoner.x + 220, afterSummon.map.width - 80), y: summoner.y + 30 });
  await page.mouse.click(summonerClearTarget.x, summonerClearTarget.y, { button: "right" });
  await statusIncludes("Move order issued.");
  await tick(120);
  await sleep(120);
  const afterSummonerClear = await snapshot();

  const workerForFarm = afterSummonerClear.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
  must(workerForFarm, "expected a live worker for farm construction");
  const farmWorkerCamera = await centerCameraOnWorld(workerForFarm);
  const farmWorkerScreen = screenFromCamera(farmWorkerCamera, workerForFarm);
  await page.mouse.click(farmWorkerScreen.x, farmWorkerScreen.y);
  await waitFor("worker reselection for farm", async () => ((await text("[data-selection]")) ?? "").includes("worker"));
  await page.keyboard.press("b");
  await statusIncludes("Build menu opened.");
  await page.keyboard.press("e");
  await statusIncludes("Choose a Farm location.");
  await page.mouse.click(900, 620);
  await statusIncludes("Farm foundation placed.");
  let afterFarm = await snapshot();
  for (let i = 0; i < 24 && !afterFarm.buildings.some((building) => building.owner === "player" && building.kind === "farm" && building.complete); i += 1) {
    await tick(20);
    await sleep(30);
    afterFarm = await snapshot();
  }
  const playerFarms = afterFarm.buildings.filter((building) => building.owner === "player" && building.kind === "farm");
  must(
    playerFarms.some((building) => building.complete),
    "player farm was not completed through UI build hotkey; state=" +
      JSON.stringify({
        status: await text("[data-status]"),
        gold: afterFarm.players.player.gold,
        supply: afterFarm.players.player,
        farms: playerFarms,
        buildings: afterFarm.buildings.filter((building) => building.owner === "player").map((building) => ({
          id: building.id,
          kind: building.kind,
          complete: building.complete,
          buildProgress: building.buildProgress,
          buildTime: building.buildTime,
          x: building.x,
          y: building.y,
        })),
      }),
  );
  must(afterFarm.players.player.supplyCap >= 16, "farm did not raise player supply cap for caster training");

  const freshSanctum = afterFarm.buildings.find((building) => building.id === sanctum.id);
  must(freshSanctum, "expected completed sanctum to remain after farm construction");
  const sanctumCamera = await centerCameraOnWorld(freshSanctum);
  const sanctumScreen = screenFromCamera(sanctumCamera, { x: freshSanctum.x, y: freshSanctum.y + 40 });
  await page.mouse.click(sanctumScreen.x, sanctumScreen.y);
  await waitFor("sanctum reselection for priest", async () => ((await text("[data-selection]")) ?? "").includes("Sanctum"));
  await page.keyboard.press("p");
  await statusIncludes("Priest queued.");
  await tick(260);
  await sleep(180);
  await page.keyboard.press("c");
  await statusIncludes("Witch queued.");
  await tick(280);
  await sleep(180);
  const afterCasterTraining = await snapshot();
  const priest = afterCasterTraining.units.find((unit) => unit.owner === "player" && unit.kind === "priest");
  const witch = afterCasterTraining.units.find((unit) => unit.owner === "player" && unit.kind === "witch");
  const healTarget = afterCasterTraining.units.find((unit) => unit.id === footman.id);
  must(priest, "player priest was not trained through UI hotkey");
  must(witch, "player witch was not trained through UI hotkey");
  must(healTarget, "expected footman to remain alive for heal target proof");

  const priestCamera = await centerCameraOnWorld(priest);
  const priestScreen = screenFromCamera(priestCamera, priest);
  await page.mouse.click(priestScreen.x, priestScreen.y);
  await waitFor("priest selection", async () => ((await text("[data-selection]")) ?? "").includes("1 selected"));
  const priestCommandDock = await mustCommandDock("priest selection", ["Attack Move", "Cast Heal"], ["A", "H"]);
  await page.keyboard.press("h");
  await statusIncludes("Heal mode.");
  const healTargetPoint = screenFromCamera(priestCamera, healTarget);
  await page.mouse.click(healTargetPoint.x, healTargetPoint.y);
  await statusIncludes("Heal order issued.");
  await sleep(120);
  const afterHealCast = await snapshot();
  const healEffect = afterHealCast.effects.find((effect) => effect.type === "heal");
  must(healEffect, "heal hotkey did not create a visible heal effect");

  const currentVisibleGlyphUnits = ["worker", "footman", "summoner", "priest", "witch", "spirit"]
    .map((kind) => afterHealCast.units.find((unit) => unit.owner === "player" && unit.kind === kind))
    .filter(Boolean);
  must(currentVisibleGlyphUnits.length === 6, "expected worker, footman, summoner, priest, witch, and spirit for visible glyph proof");
  const glyphPatches = {};
  for (const unit of currentVisibleGlyphUnits) {
    const glyphCamera = await centerCameraOnWorld(unit);
    const glyphScreen = screenFromCamera(glyphCamera, unit);
    glyphPatches[unit.kind] = await canvasPatch(glyphScreen.x, glyphScreen.y, 58, 64);
    must(glyphPatches[unit.kind].ink > 80, unit.kind + " glyph did not draw enough ink");
  }
  must(new Set(Object.values(glyphPatches).map((patch) => patch.hash)).size === currentVisibleGlyphUnits.length, "visible unit glyph patches were not visually distinct");

  const playerMercCamp = afterHealCast.mercenaryCamps[0];
  must(playerMercCamp, "expected a visible mercenary camp for player hire proof");
  const playerMercenariesBefore = afterHealCast.units.filter((unit) => unit.owner === "player" && unit.kind === "mercenary").length;
  const stockBefore = playerMercCamp.stock;
  const mercCampCamera = await centerCameraOnWorld(playerMercCamp);
  const mercCampScreen = screenFromCamera(mercCampCamera, playerMercCamp);
  await page.mouse.click(mercCampScreen.x, mercCampScreen.y);
  await waitFor("mercenary camp selection", async () => ((await text("[data-selection]")) ?? "").includes("Mercenary Camp"));
  const mercenaryCampCommandDock = await mustCommandDock("mercenary camp selection", ["Hire Mercenary"], ["M"]);
  await page.keyboard.press("m");
  await statusIncludes("Mercenary hired.");
  await sleep(120);
  const afterPlayerHire = await snapshot();
  await waitFor("mercenary camp restocking label", async () => ((await text("[data-selection]")) ?? "").includes("restocking"));
  const hiredMercenaries = afterPlayerHire.units.filter((unit) => unit.owner === "player" && unit.kind === "mercenary");
  const hiredCamp = afterPlayerHire.mercenaryCamps.find((camp) => camp.id === playerMercCamp.id);
  const hireEffect = afterPlayerHire.effects.find((effect) => effect.type === "summon" && Math.hypot(effect.x - playerMercCamp.x, effect.y - playerMercCamp.y) < playerMercCamp.radius + 10);
  must(hiredMercenaries.length === playerMercenariesBefore + 1, "player did not hire a mercenary through real UI command card");
  must(hiredCamp && hiredCamp.stock === stockBefore - 1, "mercenary camp stock did not decrement after player hire");
  must(hireEffect, "player mercenary hire did not create visible camp feedback");
  await tick(60);
  await sleep(120);
  const afterRestockProgress = await snapshot();
  const restockingCamp = afterRestockProgress.mercenaryCamps.find((camp) => camp.id === playerMercCamp.id);
  must(restockingCamp && restockingCamp.cooldownRemaining > 0, "mercenary camp left restock cooldown before progress proof");
  const mercenaryRestockPatch = await canvasPatch(640, 460, 86, 26);
  must(mercenaryRestockPatch.blue > 3, "mercenary camp restock cooldown did not render a visible progress bar");

  const combatGroup = afterPlayerHire.units.filter((unit) => unit.owner === "player" && unit.kind !== "worker" && unit.kind !== "mercenary");
  must(combatGroup.length >= 3, "expected at least three player combat units before neutral-camp attack");
  const combatGroupCenter = {
    x: combatGroup.reduce((total, unit) => total + unit.x, 0) / combatGroup.length,
    y: combatGroup.reduce((total, unit) => total + unit.y, 0) / combatGroup.length,
  };
  const combatGroupCamera = await centerCameraOnWorld(combatGroupCenter);
  const combatGroupScreens = combatGroup.map((unit) => screenFromCamera(combatGroupCamera, unit));
  const groupBox = {
    left: Math.max(20, Math.min(...combatGroupScreens.map((point) => point.x)) - 70),
    top: Math.max(20, Math.min(...combatGroupScreens.map((point) => point.y)) - 70),
    right: Math.min(1060, Math.max(...combatGroupScreens.map((point) => point.x)) + 70),
    bottom: Math.min(760, Math.max(...combatGroupScreens.map((point) => point.y)) + 70),
  };
  await page.mouse.move(groupBox.left, groupBox.top);
  await page.mouse.down();
  await page.mouse.move(groupBox.right, groupBox.bottom);
  await page.mouse.up();
  const combatSelectionOk = await waitFor("combat group drag selection", async () => ((await text("[data-selection]")) ?? "").includes("fighter")).catch(() => false);
  if (!combatSelectionOk) {
    throw new Error(
      "combat group drag selection failed; state=" +
        JSON.stringify({
          selection: await text("[data-selection]"),
          groupBox,
          combatGroupCenter,
          combatGroupScreens,
          combatGroup: combatGroup.map((unit) => ({ id: unit.id, kind: unit.kind, x: unit.x, y: unit.y })),
        }),
    );
  }

  const targetWildling = afterSummon.units
    .filter((unit) => unit.owner === "neutral" && unit.kind === "wildling")
    .sort((left, right) => left.x - right.x)[0];
  must(targetWildling, "expected a neutral wildling for real right-click attack proof");
  const neutralKillsBefore = afterSummon.match.stats.neutralUnitsKilled.player;
  const mini = { x: 1280 - 192 - 12, y: 800 - 192 - 12, width: 192, height: 192 };
  const targetWildlingCamera = await centerCameraOnWorld(targetWildling);
  const targetWildlingScreen = screenFromCamera(targetWildlingCamera, targetWildling);
  const beforeLeftWildlingClick = await snapshot();
  const selectedCombatIds = new Set(combatGroup.map((unit) => unit.id));
  const combatOrdersBeforeLeftWildling = Object.fromEntries(
    beforeLeftWildlingClick.units.filter((unit) => selectedCombatIds.has(unit.id)).map((unit) => [unit.id, JSON.stringify(unit.order)]),
  );
  await page.mouse.click(targetWildlingScreen.x, targetWildlingScreen.y);
  await sleep(100);
  const afterLeftWildlingClick = await snapshot();
  const combatOrdersAfterLeftWildling = Object.fromEntries(
    afterLeftWildlingClick.units.filter((unit) => selectedCombatIds.has(unit.id)).map((unit) => [unit.id, JSON.stringify(unit.order)]),
  );
  must(
    JSON.stringify(combatOrdersAfterLeftWildling) === JSON.stringify(combatOrdersBeforeLeftWildling),
    "left-clicking a wildling changed selected combat unit orders",
  );
  must(
    !afterLeftWildlingClick.units.some((unit) => selectedCombatIds.has(unit.id) && unit.order.type === "attack" && unit.order.targetId === targetWildling.id),
    "left-clicking a wildling issued an attack order",
  );
  must(!afterLeftWildlingClick.effects.some((effect) => effect.type === "attackTarget"), "left-clicking a wildling created an attack-target effect");

  const combatReselectCamera = await centerCameraOnWorld(combatGroupCenter);
  const combatReselectScreens = combatGroup.map((unit) => screenFromCamera(combatReselectCamera, unit));
  const combatReselectBox = {
    left: Math.max(20, Math.min(...combatReselectScreens.map((point) => point.x)) - 70),
    top: Math.max(20, Math.min(...combatReselectScreens.map((point) => point.y)) - 70),
    right: Math.min(1060, Math.max(...combatReselectScreens.map((point) => point.x)) + 70),
    bottom: Math.min(760, Math.max(...combatReselectScreens.map((point) => point.y)) + 70),
  };
  await page.mouse.move(combatReselectBox.left, combatReselectBox.top);
  await page.mouse.down();
  await page.mouse.move(combatReselectBox.right, combatReselectBox.bottom);
  await page.mouse.up();
  await waitFor("combat group reselection after left-click wildling proof", async () => ((await text("[data-selection]")) ?? "").includes("fighter"));
  const directTargetCamera = await centerCameraOnWorld(targetWildling);
  const directTargetScreen = screenFromCamera(directTargetCamera, targetWildling);
  await page.mouse.click(directTargetScreen.x, directTargetScreen.y, { button: "right" });
  await statusIncludes("Attack order issued on wildlings.");
  const directAttackMarkerPatch = await waitFor("direct attack target ring pixels", async () => {
    const patch = await canvasPatch(directTargetScreen.x, directTargetScreen.y + 10, 118, 72);
    return patch.red > 6 ? patch : false;
  });
  const afterDirectAttack = await snapshot();
  const attackTargetEffect = afterDirectAttack.effects.find((effect) => effect.type === "attackTarget");
  must(attackTargetEffect, "right-click attack did not create a distinct attack-target effect");
  must(directAttackMarkerPatch.hash !== attackMoveMarkerPatch.hash, "direct attack target ring did not look distinct from attack-move ground marker");

  let beforeCurseCast = afterDirectAttack;
  let curseCaster = beforeCurseCast.units.find((unit) => unit.id === witch.id);
  let curseTarget = beforeCurseCast.units.find((unit) => unit.id === targetWildling.id);
  for (let i = 0; i < 90 && curseCaster && curseTarget && Math.hypot(curseCaster.x - curseTarget.x, curseCaster.y - curseTarget.y) > 260; i += 1) {
    await tick(8);
    await sleep(20);
    beforeCurseCast = await snapshot();
    curseCaster = beforeCurseCast.units.find((unit) => unit.id === witch.id);
    curseTarget = beforeCurseCast.units.find((unit) => unit.id === targetWildling.id);
  }
  must(curseCaster && curseTarget, "witch or wildling died before curse hotkey proof");
  must(Math.hypot(curseCaster.x - curseTarget.x, curseCaster.y - curseTarget.y) <= 280, "witch never reached curse range before target died");
  const curseCamera = await centerCameraOnWorld(curseTarget);
  await mustCommandDock("combat group curse caster selection", ["Cast Curse"], ["C"]);
  await page.keyboard.press("c");
  await statusIncludes("Curse mode.");
  const curseTargetPoint = screenFromCamera(curseCamera, curseTarget);
  await page.mouse.click(curseTargetPoint.x, curseTargetPoint.y);
  await statusIncludes("Curse order issued.");
  await sleep(120);
  const afterCurseCast = await snapshot();
  const cursedTarget = afterCurseCast.units.find((unit) => unit.id === targetWildling.id);
  const curseEffect = afterCurseCast.effects.find((effect) => effect.type === "curse");
  must(curseEffect, "curse hotkey did not create a visible curse effect");
  must(cursedTarget?.effects.some((effect) => effect.type === "curse"), "curse hotkey did not apply curse status to target");

  await tick(1400);
  await sleep(220);
  const afterNeutralFight = await snapshot();
  const neutralKillsAfter = afterNeutralFight.match.stats.neutralUnitsKilled.player;
  must(neutralKillsAfter > neutralKillsBefore, "right-clicked combat group did not kill a neutral wildling");
  must(!afterNeutralFight.units.some((unit) => unit.id === targetWildling.id), "right-clicked wildling target survived the neutral-camp fight");

  const beforeMinimapDragPatch = await canvasPatch(640, 400, 240, 160);
  await page.mouse.move(mini.x + 24, mini.y + 24);
  await page.mouse.down();
  await page.mouse.move(mini.x + mini.width * 0.72, mini.y + mini.height * 0.72);
  await page.mouse.up();
  await sleep(80);
  const afterMinimapDragPatch = await canvasPatch(640, 400, 240, 160);
  must(beforeMinimapDragPatch.hash !== afterMinimapDragPatch.hash, "dragging the minimap viewport did not change the rendered world view");

  const starReset = await resetScenario({
    mapId: "bareDuel",
    options: {
      aiPlayers: [],
      scenario: {
        addUnits: [
          { id: "unit-yatu-star-footman", owner: "player", kind: "footman", x: 1600, y: 1600 },
          { id: "unit-yatu-star-victim", owner: "enemy", kind: "worker", x: 1638, y: 1600 },
        ],
      },
    },
  });
  const starFootman = starReset.units.find((unit) => unit.id === "unit-yatu-star-footman");
  const starVictim = starReset.units.find((unit) => unit.id === "unit-yatu-star-victim");
  must(starFootman && starVictim, "star proof scenario did not create footman and victim");
  await roomCommand("player", { type: "attack", unitIds: [starFootman.id], targetId: starVictim.id });

  let starSnapshot = await snapshot();
  for (let i = 0; i < 24 && !starSnapshot.units.some((unit) => unit.id === starFootman.id && unit.level > 1); i += 1) {
    await tick(20);
    await sleep(20);
    starSnapshot = await snapshot();
  }
  const leveledFootman = starSnapshot.units.find((unit) => unit.id === starFootman.id);
  must(leveledFootman && leveledFootman.level === 2 && leveledFootman.kills === 1, "last-hit XP did not level the star proof footman");
  must(!starSnapshot.units.some((unit) => unit.id === starVictim.id), "star proof victim survived the last-hit duel");
  const starCamera = await centerCameraOnWorld(leveledFootman);
  await sleep(180);
  const levelStarScreen = screenFromCamera(starCamera, leveledFootman);
  const levelStarPatch = await canvasPatch(levelStarScreen.x + 20, levelStarScreen.y - 20, 34, 34);
  must(levelStarPatch.gold > 8, "leveled unit did not render a visible gold star badge");

  const aiCastReset = await resetScenario({
    mapId: "bareDuel",
    options: {
      aiPlayers: ["enemy"],
      scenario: {
        addUnits: [
          { id: "unit-yatu-ai-priest", owner: "enemy", kind: "priest", x: 2600, y: 2600 },
          { id: "unit-yatu-ai-summoner", owner: "enemy", kind: "summoner", x: 2640, y: 2600 },
          { id: "unit-yatu-ai-witch", owner: "enemy", kind: "witch", x: 2680, y: 2600 },
          { id: "unit-yatu-ai-hurt-ally", owner: "enemy", kind: "footman", x: 2620, y: 2660, hp: 35 },
          { id: "unit-yatu-ai-raider", owner: "player", kind: "raider", x: 2720, y: 2600 },
        ],
      },
    },
  });
  const aiHurtAllyStart = aiCastReset.units.find((unit) => unit.id === "unit-yatu-ai-hurt-ally");
  must(aiHurtAllyStart, "AI autocast proof missing hurt ally seed");
  await roomCommand("player", { type: "attackMove", unitIds: ["unit-yatu-ai-raider"], x: 2600, y: 2600 });
  await tick(1);
  await tick(2);
  await sleep(120);
  const aiCastSnapshot = await snapshot();
  const aiHurtAlly = aiCastSnapshot.units.find((unit) => unit.id === "unit-yatu-ai-hurt-ally");
  const aiRaider = aiCastSnapshot.units.find((unit) => unit.id === "unit-yatu-ai-raider");
  const aiSpirit = aiCastSnapshot.units.find((unit) => unit.owner === "enemy" && unit.kind === "spirit");
  const aiHealEffect = aiCastSnapshot.effects.find((effect) => effect.type === "heal");
  const aiSummonEffect = aiCastSnapshot.effects.find((effect) => effect.type === "summon");
  const aiCurseEffect = aiCastSnapshot.effects.find((effect) => effect.type === "curse");
  const aiAttackEffect = aiCastSnapshot.effects.find((effect) => effect.type === "projectile" || effect.type === "melee" || effect.type === "hit");
  must(aiHurtAlly && aiHurtAlly.hp > aiHurtAllyStart.hp, "enemy AI priest did not heal a wounded ally in browser proof");
  must(aiSpirit, "enemy AI summoner did not create a spirit in browser proof");
  must(aiRaider?.effects.some((effect) => effect.type === "curse"), "enemy AI witch did not curse the player raider in browser proof");
  must(aiHealEffect && aiSummonEffect && aiCurseEffect, "enemy AI autocast did not expose heal/summon/curse world effects in browser proof");
  must(aiAttackEffect, "enemy AI attack did not expose combat feedback in browser proof");
  const aiEffectPatches = {};
  for (const effect of [aiHealEffect, aiSummonEffect, aiCurseEffect, aiAttackEffect]) {
    const effectCamera = await centerCameraOnWorld(effect);
    const effectScreen = screenFromCamera(effectCamera, effect);
    aiEffectPatches[effect.type] = await canvasPatch(effectScreen.x, effectScreen.y, 78, 78);
    must(aiEffectPatches[effect.type].ink > 40, "AI " + effect.type + " effect did not render visible canvas ink");
  }

  const allUnitKinds = ["worker", "footman", "archer", "raider", "lancer", "knight", "priest", "summoner", "witch", "golem", "spirit", "mercenary", "wildling"];
  const galleryReset = await resetScenario({
    mapId: "bareDuel",
    options: {
      aiPlayers: [],
      scenario: {
        addUnits: allUnitKinds.map((kind, index) => ({
          id: "unit-yatu-gallery-" + kind,
          owner: kind === "wildling" ? "neutral" : "player",
          kind,
          x: 1200 + (index % 5) * 180,
          y: 1200 + Math.floor(index / 5) * 180,
        })),
      },
    },
  });
  await sleep(240);
  const allUnitGlyphPatches = {};
  for (const kind of allUnitKinds) {
    const unit = galleryReset.units.find((candidate) => candidate.id === "unit-yatu-gallery-" + kind);
    must(unit, "glyph gallery missing unit kind " + kind);
    const galleryCamera = await centerCameraOnWorld(unit);
    await sleep(80);
    const galleryScreen = screenFromCamera(galleryCamera, unit);
    allUnitGlyphPatches[kind] = await bestGlyphPatchAround(galleryScreen.x, galleryScreen.y);
  }
  for (const kind of allUnitKinds) {
    must(allUnitGlyphPatches[kind].ink > 80, kind + " gallery glyph did not draw enough ink; patches=" + JSON.stringify(allUnitGlyphPatches));
  }
  must(new Set(Object.values(allUnitGlyphPatches).map((patch) => patch.hash)).size === allUnitKinds.length, "full roster glyph gallery was not visually distinct");

  const stackReset = await resetScenario({
    mapId: "bareDuel",
    options: {
      aiPlayers: [],
      scenario: {
        addBuildings: [
          { id: "building-yatu-stack-barracks", owner: "player", kind: "barracks", x: 820, y: 760, complete: true },
          { id: "building-yatu-stack-farm-a", owner: "player", kind: "farm", x: 730, y: 840, complete: true },
          { id: "building-yatu-stack-farm-b", owner: "player", kind: "farm", x: 910, y: 840, complete: true },
        ],
      },
    },
  });
  const stackWorkers = stackReset.units.filter((unit) => unit.owner === "player" && unit.kind === "worker");
  const stackMine = stackReset.resources.find((resource) => resource.kind === "goldMine");
  must(stackWorkers.length > 0 && stackMine, "stacked training proof did not start with workers and a mine");
  await roomCommand("player", { type: "mine", unitIds: stackWorkers.map((unit) => unit.id), resourceId: stackMine.id });
  let fundedStack = await snapshot();
  for (let i = 0; i < 80 && fundedStack.players.player.gold < 600; i += 1) {
    await tick(20);
    fundedStack = await snapshot();
  }
  must(fundedStack.players.player.gold >= 600, "stacked training proof did not gather enough gold for five footmen: " + fundedStack.players.player.gold);
  const stackBarracks = fundedStack.buildings.find((building) => building.id === "building-yatu-stack-barracks");
  must(stackBarracks, "stacked training proof missing completed barracks");
  const stackCamera = await centerCameraOnWorld(stackBarracks);
  const stackBarracksScreen = screenFromCamera(stackCamera, stackBarracks);
  await page.mouse.click(stackBarracksScreen.x, stackBarracksScreen.y + 42);
  await waitFor("stack barracks selection", async () => ((await text("[data-selection]")) ?? "").includes("Barracks"));
  await mustCommandDock("stack barracks selection", ["Train Footman"], ["F"]);
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("f");
    await statusIncludes("Footman queued.");
  }
  const stackedQueued = await snapshot();
  const stackedQueuedBarracks = stackedQueued.buildings.find((building) => building.id === stackBarracks.id);
  must(
    stackedQueuedBarracks?.queue.length === 5 && stackedQueuedBarracks.queue.every((job) => job.unitKind === "footman"),
    "five real hotkey presses did not stack five footmen on one barracks: " + JSON.stringify(stackedQueuedBarracks?.queue),
  );
  await tick(181);
  const stackedAfterOne = await snapshot();
  const stackedAfterOneBarracks = stackedAfterOne.buildings.find((building) => building.id === stackBarracks.id);
  const stackedFootmen = stackedAfterOne.units.filter((unit) => unit.owner === "player" && unit.kind === "footman");
  must(
    stackedFootmen.length === 1 && stackedAfterOneBarracks?.queue.length === 4,
    "stacked queue did not produce serially after the first footman: " +
      JSON.stringify({ footmen: stackedFootmen.length, queueLength: stackedAfterOneBarracks?.queue.length }),
  );
  const stackedTrainingProof = {
    queued: stackedQueuedBarracks.queue.map((job) => job.unitKind),
    remainingAfterFirst: stackedAfterOneBarracks.queue.length,
    completedAfterFirst: stackedFootmen.length,
  };

  const proof = {
    ok: true,
    map: afterAttackMove.map.id,
    selected: await text("[data-selection]"),
    status: await text("[data-status]"),
    barracks: { x: barracks.x, y: barracks.y },
    footmanOrder: orderedFootman.order,
    sanctum: { x: sanctum.x, y: sanctum.y },
    buildingGlyphHashes: buildingPatches,
    commandDocks: {
      empty: emptyDockState,
      worker: workerCommandDock,
      buildPalette: buildPaletteDock,
      barracks: barracksCommandDock,
      footman: footmanCommandDock,
      sanctum: sanctumCommandDock,
      summoner: summonerCommandDock,
      priest: priestCommandDock,
      mercenaryCamp: mercenaryCampCommandDock,
    },
    leftClickGroundOrder: footmanAfterLeftGround.order,
    leftClickWildlingOrders: combatOrdersAfterLeftWildling,
    terrainPatch,
    menuBackdropHashes: [menuBackdropA.hash, menuBackdropB.hash],
    minimapDragHashes: [beforeMinimapDragPatch.hash, afterMinimapDragPatch.hash],
    constructionProgressPatch,
    trainingProgressPatch,
    mineMarkerPatch,
    moveMarkerPatch,
    attackMoveMarkerPatch,
    directAttackMarkerPatch,
    selectedBuildingHaloPatch,
    mercenaryRestockPatch,
    levelStarPatch,
    aiEffectPatches,
    aiAutocast: {
      healedHp: { before: aiHurtAllyStart.hp, after: aiHurtAlly.hp },
      spirit: { x: aiSpirit.x, y: aiSpirit.y },
      cursed: aiRaider.effects.some((effect) => effect.type === "curse"),
      attackEffect: aiAttackEffect.type,
    },
    leveledFootman: { level: leveledFootman.level, kills: leveledFootman.kills, xp: leveledFootman.xp },
    summoned: { x: spirit.x, y: spirit.y },
    healEffect: { x: healEffect.x, y: healEffect.y },
    curseEffect: { x: curseEffect.x, y: curseEffect.y },
    carriedGoldPixels: carrierPatch.gold,
    visibleGlyphHashes: glyphPatches,
    allUnitGlyphHashes: allUnitGlyphPatches,
    directAttackEffect: { x: attackTargetEffect.x, y: attackTargetEffect.y },
    neutralKillDelta: neutralKillsAfter - neutralKillsBefore,
    hiredMercenaryCount: hiredMercenaries.length,
    mercenaryStockDelta: stockBefore - (hiredCamp?.stock ?? stockBefore),
    stackedTrainingProof,
  };
  must(consoleIssues.length === 0, "browser console produced warnings/errors: " + JSON.stringify(consoleIssues));
  await page.evaluate((proof) => {
    window.__sketchRtsYatuProof = proof;
  }, proof);
}
`;
}
