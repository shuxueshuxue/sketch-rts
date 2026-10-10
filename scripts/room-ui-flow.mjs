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
  const confirmedSoloSetup = async (poolMapId) => {
    await page.waitForSelector("[data-map-entries] [data-map-id]", { timeout: 5000 });
    const entry = poolMapId ? page.locator("[data-map-entries] [data-map-id='" + poolMapId + "']") : page.locator("[data-map-entries] [data-map-id]").first();
    const selectedMapId = await entry.getAttribute("data-map-id");
    must(selectedMapId, "map chooser did not expose a selected map");
    await entry.click();
    const draft = await page.evaluate(() => ({
      mapId: new URLSearchParams(location.search).get("map"),
      view: new URLSearchParams(location.search).get("view"),
      selected: document.querySelector("[data-map-entries] [aria-pressed='true']")?.getAttribute("data-map-id"),
      rooms: document.querySelectorAll("[data-room-setup]").length,
      confirms: document.querySelectorAll("[data-map-next]").length,
    }));
    must(draft.mapId === selectedMapId && draft.selected === selectedMapId && draft.view === "maps" && draft.rooms === 0 && draft.confirms === 1,
      "map click must only select and preview the map: " + JSON.stringify(draft));
    await page.locator("[data-map-next]").click();
    await page.waitForSelector("[data-room-setup]", { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
    const setup = await page.evaluate(() => {
      const query = new URLSearchParams(location.search);
      return {
        id: document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup"),
        mapId: query.get("map"), seed: query.get("seed"), name: query.get("name"), seats: query.get("seats"),
        visibility: query.get("visibility"), solo: document.querySelector("input[name='gameMode'][value='singlePlayer']")?.checked,
        createButtons: document.querySelectorAll("[data-submit-create-game], [data-map-next]").length,
      };
    });
    must(setup.id && setup.mapId === selectedMapId && setup.seed && setup.seats && setup.visibility === "private" && setup.solo && setup.createButtons === 0,
      "confirming the map must enter the configured solo setup: " + JSON.stringify(setup));
    return setup.id;
  };
  // Gameplay proofs use authoritative HTTP/WS fixtures. Move the real solo
  // setup to multiplayer, then restore its AI seats before starting.
  const serverSetupFromSolo = async (restoreAi = true) => {
    const previousId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
    await page.locator(".game-mode-switch label").filter({ has: page.locator("input[name='gameMode'][value='multiplayer']") }).click();
    await page.waitForFunction((oldId) => {
      const id = document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup");
      return id && id !== oldId && new URLSearchParams(location.search).get("room") === id && document.querySelector("input[name='gameMode'][value='multiplayer']")?.checked;
    }, previousId, { timeout: 5000 });
    const id = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
    const openSlots = await page.locator("[data-slot-id]").evaluateAll(rows => rows.filter(row => row.querySelector("[data-slot-controller]")?.value === "open").map(row => row.getAttribute("data-slot-id")));
    must(openSlots.length > 0, "multiplayer mode must expose an invitation seat");
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
    must(room.id === id && room.visibility === "public" && room.status === "open" && (!restoreAi || room.slots.slice(1).every(slot => slot.controller === "ai")),
      "authoritative fixture must preserve the solo AI army: " + JSON.stringify(room));
    return id;
  };
  const serverFixtureMap = async (roomId, mapId) => {
    await page.evaluate(async ({ roomId, mapId }) => {
      const response = await fetch("/api/rooms/" + encodeURIComponent(roomId) + "/map", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId }),
      });
      if (!response.ok) throw new Error(await response.text());
      const room = await response.json();
      if (room.mapId !== mapId) throw new Error("Fixture map was not applied: " + room.mapId);
    }, { roomId, mapId });
    await page.waitForFunction(() => document.querySelector("[data-start-room]")?.disabled === false, null, { timeout: 5000 });
  };
  const returnToHomeDocument = () => page.goto(page.url().split(/[?#]/)[0]);
`;
