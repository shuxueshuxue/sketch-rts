/** Browser-side helpers shared by the interactive proof scripts. */
export const roomUiFlowCode = String.raw`
  const displayedMinimapRect = () => page.evaluate(() => {
    const frame = document.querySelector("[data-minimap-frame]");
    const canvas = document.querySelector(".game-canvas");
    if (!frame || !canvas) throw new Error("Displayed minimap or game canvas missing");
    const transform = new DOMMatrixReadOnly(getComputedStyle(frame).transform);
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.x + transform.m41, y: bounds.y + transform.m42,
      width: parseFloat(frame.style.width), height: parseFloat(frame.style.height) };
  });
  const setupRoomId = () => page.locator("[data-room-setup]").getAttribute("data-room-setup");
  // Another map on the setup screen rebuilds the room on it at once (see @@@solo-setup).
  const chooseSetupMap = async (mapId) => {
    if ((await page.locator("[data-map-entries] [aria-pressed='true']").getAttribute("data-map-id")) === mapId) return;
    const before = await setupRoomId();
    // The list stays where it was scrolled to: the same element, at the same place (see @@@setup-in-place).
    const scrolled = await page.evaluate(() => {
      const list = document.querySelector("[data-map-entries]"); list.__kept = true;
      list.scrollTop = list.scrollHeight; list.scrollLeft = list.scrollWidth;
      return { top: list.scrollTop, left: list.scrollLeft };
    });
    await page.locator("[data-map-entries] [data-map-id='" + mapId + "']").click();
    await page.waitForFunction(({ before, mapId }) => {
      const id = document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup");
      const entry = document.querySelector("[data-map-entries] [aria-pressed='true']");
      return id && id !== before && entry?.getAttribute("data-map-id") === mapId && !entry.disabled;
    }, { before, mapId }, { timeout: 5000 });
    const kept = await page.evaluate(() => { const list = document.querySelector("[data-map-entries]"); return { same: !!list.__kept, top: list.scrollTop, left: list.scrollLeft }; });
    must(kept.same && kept.top === scrolled.top && kept.left === scrolled.left, "choosing a map moved the map list: " + JSON.stringify({ scrolled, kept }));
  };
  const setupControls = () => page.evaluate(() => ({
    modeSwitch: document.querySelectorAll("input[name='gameMode']").length, close: document.querySelectorAll("[data-close-room]").length,
    ready: document.querySelectorAll("[data-slot-ready]").length, mapStep: document.querySelectorAll("[data-map-next], [data-choose-map]").length,
    maps: document.querySelectorAll("[data-map-entries] [data-map-id]").length,
    backHome: document.querySelectorAll("[data-back-home]").length, backRooms: document.querySelectorAll("[data-back-room-browser]").length,
  }));
  // A solo game: the home's play entry opens the map and seats on one screen, with only what a solo game uses.
  const soloSetup = async (poolMapId) => {
    await page.waitForSelector("[data-open-create]", { timeout: 5000 });
    await page.click("[data-open-create]");
    await page.waitForSelector("[data-room-setup] [data-map-entries] [data-map-id]", { timeout: 5000 });
    if (poolMapId) await chooseSetupMap(poolMapId);
    await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
    const setup = await page.evaluate(() => {
      const query = new URLSearchParams(location.search);
      return { id: document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup"),
        mapId: query.get("map"), seed: query.get("seed"), seats: query.get("seats"), visibility: query.get("visibility"),
        selected: document.querySelector("[data-map-entries] [aria-pressed='true']")?.getAttribute("data-map-id") };
    });
    const controls = await setupControls();
    must(setup.id && setup.mapId && setup.mapId === setup.selected && (!poolMapId || setup.mapId === poolMapId) && setup.seed && setup.seats && setup.visibility === "private" &&
      controls.modeSwitch === 0 && controls.close === 0 && controls.ready === 0 && controls.mapStep === 0 && controls.maps > 1 && controls.backHome === 1 && controls.backRooms === 0,
      "the play entry must open a solo setup of map and seats on one screen, with no lobby controls: " + JSON.stringify({ setup, controls }));
    return setup.id;
  };
  // A room for others: the room list's create button opens the same screen, open to a player, with readiness and closing.
  // Gameplay proofs use such an authoritative room, its open seat given back to a computer.
  const onlineSetup = async (poolMapId, restoreAi = true) => {
    await page.waitForSelector("[data-create-room]", { timeout: 5000 });
    await page.click("[data-create-room]");
    await page.waitForFunction(() => {
      const id = document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup");
      return id && new URLSearchParams(location.search).get("room") === id && document.querySelector("[data-map-entries] [data-map-id]");
    }, null, { timeout: 5000 });
    if (poolMapId) await chooseSetupMap(poolMapId);
    const id = await setupRoomId();
    const controls = await setupControls();
    must(controls.modeSwitch === 0 && controls.close === 1 && controls.ready > 0 && controls.mapStep === 0 && controls.maps > 1 && controls.backRooms === 1 && controls.backHome === 0,
      "the room list's create button must open a room for others on the same screen: " + JSON.stringify(controls));
    const openSlots = await page.locator("[data-slot-id]").evaluateAll(rows => rows.filter(row => row.querySelector("[data-slot-controller]")?.value === "open").map(row => row.getAttribute("data-slot-id")));
    must(openSlots.length > 0, "a room for others must offer an invitation seat");
    for (const slotId of restoreAi ? openSlots : []) {
      await page.locator("[data-slot-id='" + slotId + "'] [data-slot-controller]").selectOption("ai");
      await page.waitForFunction((slotId) => {
        const select = document.querySelector("[data-slot-id='" + slotId + "'] [data-slot-controller]");
        return select?.value === "ai" && !select.disabled;
      }, slotId, { timeout: 5000 });
    }
    if (restoreAi) await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
    const room = await page.evaluate(async (roomId) => {
      const response = await fetch("/api/rooms/" + encodeURIComponent(roomId));
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }, id);
    must(room.id === id && room.visibility === "public" && room.status === "open" && (!poolMapId || room.mapId === poolMapId) && (!restoreAi || room.slots.slice(1).every(slot => slot.controller === "ai")),
      "a room for others must be the server's, with computers in the other seats: " + JSON.stringify(room));
    return id;
  };
  const serverFixtureMap = async (roomId, mapId) => {
    await page.evaluate(async ({ roomId, mapId }) => {
      const response = await fetch("/api/rooms/" + encodeURIComponent(roomId) + "/map", {
        // Asked as this browser's player, the room's host (see @@@seat-ownership).
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, userId: JSON.parse(localStorage.getItem("sketch-rts-user")).id }),
      });
      if (!response.ok) throw new Error(await response.text());
      const room = await response.json();
      if (room.mapId !== mapId) throw new Error("Fixture map was not applied: " + room.mapId);
    }, { roomId, mapId });
    await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
  };
  const returnToHomeDocument = () => page.goto(page.url().split(/[?#]/)[0]);
`;
