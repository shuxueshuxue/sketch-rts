// A gold mine at each of its four stages, mined down by real workers, and the shop and camp footprint rings (#451).
// Rewritten from Art Lane's sites.mjs.
import type { Scene } from "../drivers/browser";

type Snap = { map: { width: number; height: number }; players: Record<string, unknown>; resources: { id: string; amount: number }[]; shops?: { x: number; y: number }[]; mercenaryCamps: { x: number; y: number }[] };

export default async function (s: Scene) {
  await s.room("templeSpring");
  const start = await s.snapshot() as Snap;
  const cx = Math.round(start.map.width / 2), cy = Math.round(start.map.height / 2), enemy = Object.keys(start.players).find((player) => player !== "player")!;
  const mines = [["m-rich", -330, 1000], ["m-worked", -110, 100], ["m-failing", 110, 34], ["m-empty", 330, 20]] as const;
  const workers = mines.slice(1).flatMap(([id, dx]) => Array.from({ length: id === "m-failing" ? 1 : 4 }, (_, k) => ({ id: `w-${id}-${k}`, owner: "player", kind: "worker", x: cx + dx - 30 + k * 20, y: cy + 150 })));
  await s.scenario({ aiPlayers: [], races: { player: "grove", [enemy]: "ember" }, scenario: { replaceDefaultUnits: true, addUnits: workers,
    addBuildings: [{ id: "site-hall", owner: "player", kind: "townHall", x: cx, y: cy + 300, complete: true }],
    addResources: mines.map(([id, dx, amount]) => ({ id, kind: "goldMine", x: cx + dx, y: cy, amount })) } });
  // Mine the middle ones down: past half, then into the last tenth, then out (see @@@mine-stages).
  const goal: Record<string, number> = { "m-worked": 45, "m-failing": 4, "m-empty": 0 };
  for (const id of Object.keys(goal)) await s.order("player", { type: "mine", unitIds: workers.filter((worker) => worker.id.includes(id)).map((worker) => worker.id), resourceId: id });
  const stopped = new Set<string>();
  let snap = start;
  for (let i = 0; i < 200 && stopped.size < 3; i++) {
    await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 40 });
    snap = await s.snapshot() as Snap;
    for (const [id, left] of Object.entries(goal)) if (!stopped.has(id) && snap.resources.find((mine) => mine.id === id)!.amount <= left) {
      stopped.add(id);
      await s.order("player", { type: "move", unitIds: workers.filter((worker) => worker.id.includes(id)).map((worker) => worker.id), x: cx, y: cy + 420 });
    }
  }
  s.must(stopped.size === 3, "the mines were not worked down");
  await s.tick(200);
  const look = async (x: number, y: number, name: string) => {
    await s.camera(x, y);
    const centre = await s.screenOf(x, y);
    await s.shot(name, { x: centre.x - 420, y: centre.y - 200, width: 840, height: 360 });
  };
  await look(cx, cy, "mines-row");
  for (const [id, dx] of mines) await look(cx + dx, cy, id);
  snap = await s.snapshot() as Snap;
  if (snap.shops?.[0]) await look(snap.shops[0].x, snap.shops[0].y, "shop");
  if (snap.mercenaryCamps[0]) await look(snap.mercenaryCamps[0].x, snap.mercenaryCamps[0].y, "camp");
}
