// HUD states (#418, #420): veterans ready to learn and their skill palette, a mixed army, a production building, a
// worker's build menu. Rewritten from Art Lane's hud.mjs.
import type { Scene } from "../drivers/browser";

type Snap = { units: { id: string; owner: string; kind: string; x: number; y: number }[]; buildings: { owner: string; kind: string; x: number; y: number }[] };
const HUD = { x: 0, y: 560, width: 1000, height: 340 };

export default async function (s: Scene) {
  await s.room("pineshade");
  const hall = (await s.snapshot() as Snap).buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
  const cx = hall.x, cy = hall.y + 260;
  const veterans = [0, 1, 2, 3].map((i) => ({ id: `vet-${i}`, owner: "player", kind: "footman", x: cx - 300 + i * 34, y: cy, xp: 99999 }));
  const mixed = ["archer", "archer", "priest", "lancer", "knight"].map((kind, i) => ({ id: `mix-${i}`, owner: "player", kind, x: cx + 120 + i * 40, y: cy, xp: 0 }));
  const snap = await s.scenario({ aiPlayers: [], races: { player: "grove", enemy: "ember" }, scenario: { players: { player: { gold: 2000 } }, addUnits: [...veterans, ...mixed],
    addBuildings: [{ id: "hud-barracks", owner: "player", kind: "barracks", x: hall.x + 360, y: hall.y - 80, complete: true }] } }) as Snap;
  await s.camera(cx, cy);
  await s.select(veterans.map((unit) => unit.id));
  await s.shot("veterans", HUD);
  await s.key("p");
  await s.shot("veteran-palette", HUD);
  await s.key("Escape"); await s.key("Escape");
  await s.select(mixed.map((unit) => unit.id));
  await s.shot("mixed-army", HUD);
  await s.key("Escape");
  await s.select(["hud-barracks"]);
  await s.shot("barracks", HUD);
  const worker = snap.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
  await s.select([worker.id]);
  await s.key("b");
  await s.shot("build-menu", HUD);
  await s.key("Escape");
  await s.shot("full");
}
