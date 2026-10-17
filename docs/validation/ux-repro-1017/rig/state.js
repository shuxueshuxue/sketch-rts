export default async (page, { api }) => {
  const id = await page.evaluate(() => window.__sketchRtsView.roomId);
  const room = await api("/api/rooms/" + id);
  const s = await api("/api/rooms/" + id + "/snapshot");
  const p = s.players.player;
  return { id, mapId: room.mapId, layout: room.layout ?? room.options?.layout, tick: s.tick, size: [s.map.width, s.map.height], gold: p.gold, race: p.race,
    shops: s.shops?.map(x => [x.id, Math.round(x.x), Math.round(x.y), x.radius]),
    camps: s.mercenaryCamps?.map(c => [c.id, c.hireKind, c.cost, c.stock, c.cooldown, Math.round(c.x), Math.round(c.y), c.radius]),
    mines: s.resources?.filter(r => r.owner === undefined || true).slice(0, 20).map(r => [r.id, r.kind, Math.round(r.x), Math.round(r.y)]),
    myUnits: s.units.filter(u => u.owner === "player").map(u => [u.id, u.kind, Math.round(u.x), Math.round(u.y)]),
    myBuildings: s.buildings.filter(b => b.owner === "player").map(b => [b.id, b.kind, Math.round(b.x), Math.round(b.y), b.radius]),
    items: s.items?.slice(0, 10).map(i => [i.id, i.kind, i.carrierId, Math.round(i.x), Math.round(i.y)]) };
};
