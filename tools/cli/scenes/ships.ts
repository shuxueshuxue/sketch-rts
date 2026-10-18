// Two fleets with crews aboard on open water (#416, ship ink lines and masts): still, closing, in a volley, selected.
// Rewritten from Art Lane's ships.mjs.
import type { Scene } from "../drivers/browser";

type Snap = { map: { width: number; height: number; terrain: { cell: number; cols: number; cells: string } }; players: Record<string, unknown>; units: { deck?: unknown }[] };

export default async function (s: Scene) {
  await s.room("brokenSea");
  const start = await s.snapshot() as Snap, t = start.map.terrain;
  const deep = (x: number, y: number) => { const c = Math.floor(x / t.cell), r = Math.floor(y / t.cell); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (t.cells[(r + dy) * t.cols + c + dx] !== "~") return false; return true; };
  // Open water for two lines of ships 520 apart, nearest the map's centre.
  let at: { x: number; y: number } | undefined;
  for (let ring = 0; ring < 60 && !at; ring++) for (let a = 0; a < 24 && !at; a++) {
    const x = start.map.width / 2 + Math.cos(a / 24 * Math.PI * 2) * ring * 64, y = start.map.height / 2 + Math.sin(a / 24 * Math.PI * 2) * ring * 64;
    if ([-260, 0, 260].every((dx) => [-160, 160].every((dy) => deep(x + dx, y + dy)))) at = { x, y };
  }
  s.must(at, "brokenSea has no open water for two fleets");
  const enemy = Object.keys(start.players).find((player) => player !== "player")!;
  const fleet = (owner: string, side: number) => ["warship", "warship", "cutter"].map((kind, i) => ({ id: `${owner}-ship-${i}`, owner, kind, x: Math.round(at!.x + (i - 1) * 200), y: Math.round(at!.y + side * 260) }));
  const ships = [...fleet("player", 1), ...fleet(enemy, -1)];
  const crew = ships.flatMap((ship) => ["footman", "archer", "footman", "archer"].map((kind, i) => ({ id: `${ship.id}-crew-${i}`, owner: ship.owner, kind, x: ship.x + (i - 1.5) * 10, y: ship.y })));
  await s.scenario({ aiPlayers: [], races: { player: "grove", [enemy]: "ember" }, scenario: { addUnits: [...ships, ...crew] } });
  for (const ship of ships) await s.order(ship.owner, { type: "board", unitIds: crew.filter((unit) => unit.id.startsWith(ship.id)).map((unit) => unit.id), transportId: ship.id });
  await s.tick(200);
  s.must((await s.snapshot() as Snap).units.some((unit) => unit.deck), "no crew went aboard");
  await s.camera(at!.x, at!.y); await s.wait(3000);
  await s.shot("still");
  // Close in on our line, crews on deck: the masts and yards #416 drew without an ink outline.
  await s.camera(at!.x, at!.y + 260, 2.2); await s.wait(2000);
  await s.shot("rig-close");
  await s.camera(at!.x, at!.y, 1);
  for (const owner of ["player", enemy]) await s.order(owner, { type: "attackMove", unitIds: ships.filter((ship) => ship.owner === owner).map((ship) => ship.id), x: Math.round(at!.x), y: Math.round(at!.y + (owner === "player" ? -400 : 400)) });
  await s.tick(90);
  await s.camera(at!.x, at!.y); await s.wait(1500);
  await s.shot("fleet");
  await s.tick(60);
  await s.shot("volley");
  await s.select(ships.filter((ship) => ship.owner === "player").map((ship) => ship.id));
  await s.shot("fleet-selected");
}
