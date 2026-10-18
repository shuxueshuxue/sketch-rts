// A fortified tower, empty and then with two archers on its top, its roof open (#452). On a commit before #471 the tower
// is fortified with fortifyTower, after it with upgradeBuilding. Rewritten from Art Lane's towertop.mjs.
import type { Scene } from "../drivers/browser";

type Snap = { map: { width: number; height: number }; players: Record<string, unknown>; units: { id: string; garrison?: unknown }[]; buildings: { id: string; kind: string; fortified?: boolean }[] };

export default async function (s: Scene) {
  await s.room("templeSpring");
  const start = await s.snapshot() as Snap;
  const cx = Math.round(start.map.width / 2), cy = Math.round(start.map.height / 2), enemy = Object.keys(start.players).find((player) => player !== "player")!;
  await s.scenario({ aiPlayers: [], races: { player: "grove", [enemy]: "ember" }, scenario: { players: { player: { gold: 5000 } }, replaceDefaultUnits: true,
    addUnits: [{ id: "archer-a", owner: "player", kind: "archer", x: cx - 40, y: cy + 140 }, { id: "archer-b", owner: "player", kind: "archer", x: cx + 40, y: cy + 140 }],
    addBuildings: [{ id: "tower", owner: "player", kind: "defenseTower", x: cx, y: cy, complete: true }] } });
  await s.order("player", { type: "upgradeBuilding", buildingId: "tower", to: "fortifiedTower" }).catch(() => s.order("player", { type: "fortifyTower", buildingId: "tower" }));
  const fortified = (snap: Snap) => { const tower = snap.buildings.find((building) => building.id === "tower")!; return tower.kind === "fortifiedTower" || tower.fortified === true; };
  for (let i = 0; i < 100 && !fortified(await s.snapshot() as Snap); i++) await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 40 });
  s.must(fortified(await s.snapshot() as Snap), "the tower was not fortified");
  const view = async (name: string) => {
    await s.tick(1);
    await s.camera(cx, cy);
    const centre = await s.screenOf(cx, cy);
    await s.page.mouse.move(centre.x + 500, centre.y + 300);
    for (let i = 0; i < 4; i++) { await s.page.mouse.wheel(0, -240); await s.wait(250); }
    await s.wait(1500);
    await s.shot(name, { x: centre.x - 260, y: centre.y - 260, width: 520, height: 400 });
  };
  await view("fortified");
  await s.order("player", { type: "garrison", unitIds: ["archer-a", "archer-b"], buildingId: "tower" });
  const up = (snap: Snap) => ["archer-a", "archer-b"].every((id) => snap.units.find((unit) => unit.id === id)?.garrison);
  for (let i = 0; i < 60 && !up(await s.snapshot() as Snap); i++) await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 20 });
  s.must(up(await s.snapshot() as Snap), "the archers did not climb the tower");
  await view("garrisoned");
}
