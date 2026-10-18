// Every buildable building three ways (#446): the placement ghost under the cursor, one going up, one built.
// Rewritten from Art Lane's ghosts.mjs.
import type { Scene } from "../drivers/browser";

type Snap = { map: { width: number; height: number }; players: Record<string, unknown> };

export default async function (s: Scene) {
  await s.room("templeSpring");
  const start = await s.snapshot() as Snap;
  const cx = Math.round(start.map.width / 2), cy = Math.round(start.map.height / 2), enemy = Object.keys(start.players).find((player) => player !== "player")!;
  const catalog = await s.api("/api/catalog") as { races: { id: string; buildableBuildings: string[] }[] };
  // Each building's hotkey, from that commit's own cards.
  const hotkeys = await s.page.evaluate(async () => {
    const cards = await import(location.pathname.replace(/[^/]*$/, "") + "src/client/content/buildings.ts");
    return Object.fromEntries(Object.entries(cards.BUILDING_CARDS as Record<string, { command?: { hotkey?: string } }>).map(([kind, card]) => [kind, card.command?.hotkey]));
  }) as Record<string, string | undefined>;
  const D = 300;
  for (const race of ["grove", "ember"]) for (const kind of catalog.races.find((entry) => entry.id === race)!.buildableBuildings.filter((kind) => kind !== "shipyard")) {
    await s.scenario({ aiPlayers: [], races: { player: race, [enemy]: race === "grove" ? "ember" : "grove" }, scenario: {
      players: { player: { gold: 5000 } }, replaceDefaultUnits: true,
      addUnits: [{ id: "ghost-worker", owner: "player", kind: "worker", x: cx, y: cy + 230 }],
      addBuildings: [{ id: "ghost-up", owner: "player", kind, x: cx, y: cy, complete: false }, { id: "ghost-done", owner: "player", kind, x: cx + D, y: cy, complete: true }] } });
    await s.camera(cx, cy);
    await s.select(["ghost-worker"]);
    await s.key("b"); await s.key(hotkeys[kind] ?? "x");
    const ghost = await s.screenOf(cx - D, cy), centre = await s.screenOf(cx, cy);
    await s.page.mouse.move(ghost.x, ghost.y); await s.wait(1500);
    await s.shot(`${race}-${kind.toLowerCase()}`.replace(/[^a-z0-9-]/g, "-"), { x: Math.max(0, centre.x - D - 170), y: centre.y - 220, width: 2 * D + 340, height: 330 });
    await s.key("Escape"); await s.key("Escape");
  }
}
