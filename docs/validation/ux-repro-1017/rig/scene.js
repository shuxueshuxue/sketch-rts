// Reset the current room on its own map with a test scene beside the player's town hall.
export default async (page, { api, sleep }) => {
  const id = await page.evaluate(() => window.__sketchRtsView.roomId);
  const room = await api("/api/rooms/" + id);
  const scenario = {
    addUnits: [
      { id: "fx-a", owner: "player", kind: "footman", x: 5700, y: 3280 },
      { id: "fx-b", owner: "player", kind: "footman", x: 5740, y: 3240 },
    ],
    addItems: [
      { id: "it-rod", kind: "lightningRod", x: 5700, y: 3280, carrierId: "fx-a", cooldownRemaining: 0 },
      { id: "it-heal", kind: "healingScroll", x: 5700, y: 3280, carrierId: "fx-a", cooldownRemaining: 0 },
      { id: "it-boots", kind: "speedBoots", x: 5700, y: 3280, carrierId: "fx-a", cooldownRemaining: 0 },
      { id: "it-ground", kind: "leatherArmor", x: 5640, y: 3400, cooldownRemaining: 0 },
    ],
    addBuildings: [
      { id: "fx-barracks", owner: "player", kind: "barracks", x: 5600, y: 3120, complete: true },
      { id: "fx-stables", owner: "player", kind: "stables", x: 6060, y: 3120, complete: true },
      { id: "fx-sanctum", owner: "player", kind: "sanctum", x: 6060, y: 3560, complete: true },
    ],
    addMercenaryCamps: [{ id: "merc-near", x: 5560, y: 3600, radius: 50, hireKind: "mercenary", cost: 160, stock: 3, cooldown: 320, cooldownRemaining: 0 }],
  };
  const r = await api("/api/rooms/" + id + "/reset", { mapId: room.mapId, options: { scenario } });
  await sleep(1500);
  return { mapId: room.mapId, tick: r.snapshot?.tick, units: r.snapshot?.units.filter(u => u.owner === "player").map(u => u.id) };
};
