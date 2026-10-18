// How a match looks: Temple Spring after nine minutes of computers on every seat (the player's base, another player's
// of the other race, the coast nearest the player), then a 40 v 40 battle (grove against ember) dragged into a
// selection. Rewritten from Art Lane's capture-ba.mjs, one look (direction A); on mac1 its machine flags draw on Metal.
import type { Scene } from "../drivers/browser";

type Building = { owner: string; kind: string; x: number; y: number };
type Snap = { tick: number; map: { id: string; width: number; height: number; terrain: { cell: number; cols: number; rows: number; cells: string } }; players: Record<string, { race?: string }>; buildings: Building[]; units: { owner: string }[] };

export default async function (s: Scene) {
  await s.room("templeSpring");
  const start = await s.snapshot() as Snap, players = Object.keys(start.players);
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: start.map.id, options: { aiPlayers: players } });
  for (let i = 0; i < 9; i++) await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 1200 });
  const mid = await s.snapshot() as Snap;
  await s.reload();
  const hall = mid.buildings.find((b) => b.owner === "player" && b.kind === "townHall") ?? mid.buildings.find((b) => b.owner === "player");
  s.must(hall, `the player has no building at tick ${mid.tick}`);
  await s.camera(hall!.x, hall!.y + 60); await s.wait(4000);
  await s.shot("mid");
  const halls = mid.buildings.filter((b) => b.owner !== "player" && b.kind === "townHall");
  const other = halls.find((b) => mid.players[b.owner]?.race !== mid.players.player?.race) ?? halls[0];
  s.must(other, "no other player has a town hall");
  await s.camera(other!.x, other!.y + 60); await s.wait(4000);
  await s.shot("base2");
  // The coast nearest the player's hall: a water cell beside open ground.
  const t = mid.map.terrain;
  let coast: { x: number; y: number } | undefined, best = Infinity;
  for (let r = 1; r < t.rows - 1; r++) for (let c = 1; c < t.cols - 1; c++) {
    const k = t.cells[r * t.cols + c];
    if ((k !== "~" && k !== ",") || ![1, -1, t.cols, -t.cols].some((o) => t.cells[r * t.cols + c + o] === ".")) continue;
    const d = Math.hypot(c * t.cell - hall!.x, r * t.cell - hall!.y);
    if (d < best) { best = d; coast = { x: c * t.cell, y: r * t.cell }; }
  }
  s.must(coast, "Temple Spring has no coast");
  await s.camera(coast!.x - 200, coast!.y); await s.wait(4000);
  await s.shot("coast");

  // The bare duel map with its own units taken off: the centre of Temple Spring has a dragon, which ends the battle.
  const grove = ["footman", "footman", "lancer", "archer", "archer", "knight", "priest", "golem", "horseArcher", "summoner"];
  const ember = ["ashWarden", "ashWarden", "emberRavager", "sparkArcher", "sparkArcher", "ashChieftain", "ashHexer", "cinderRevenant", "cinderRunner", "catapult"];
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [] } });
  const duel = await s.snapshot() as Snap, enemy = Object.keys(duel.players).find((p) => p !== "player")!;
  const cx = Math.round(duel.map.width / 2), cy = Math.round(duel.map.height / 2), addUnits = [];
  for (let i = 0; i < 40; i++) {
    const row = Math.floor(i / 10), col = i % 10;
    addUnits.push({ id: `look-p-${i}`, owner: "player", kind: grove[col], x: cx - 240 - row * 40, y: cy - 200 + col * 40, order: { type: "attackMove", x: cx + 400, y: cy } });
    addUnits.push({ id: `look-e-${i}`, owner: enemy, kind: ember[col], x: cx + 240 + row * 40, y: cy - 200 + col * 40, order: { type: "attackMove", x: cx - 400, y: cy } });
  }
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [], races: { player: "grove", [enemy]: "ember" }, scenario: { replaceDefaultUnits: true, addUnits } } });
  await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 130 });
  await s.reload();
  const battle = await s.snapshot() as Snap;
  s.must(battle.units.filter((u) => u.owner === "player").length > 20 && battle.units.filter((u) => u.owner === enemy).length > 20, "the armies did not meet at full strength");
  await s.camera(cx, cy); await s.wait(3000);
  await s.drag(cx - 460, cy - 260, cx, cy + 260);
  const selected = await s.readDom("[data-selection]");
  s.must(selected.some((element) => element.visible), "the drag selected nothing");
  await s.wait(1000);
  await s.shot("battle");
}
