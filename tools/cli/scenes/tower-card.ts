// A complete defense tower selected, its card shown: before #471 the card offers "Fortify tower", after it "Upgrade to
// Fortified Tower". Runs on commits from before the debug hooks too (camera through the minimap, click at its centre).
import type { Scene } from "../drivers/browser";

export default async function (s: Scene) {
  await s.room("pineshade");
  const start = await s.snapshot() as { units: unknown[]; buildings: { owner: string; kind: string; x: number; y: number }[]; map: { id: string } };
  const hall = start.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
  const tower = { x: hall.x, y: hall.y + 300 };
  await s.scenario({ aiPlayers: [], scenario: { players: { player: { gold: 2000 } }, addBuildings: [{ id: "scene-tower", owner: "player", kind: "defenseTower", ...tower, complete: true }] } });
  const placed = (await s.snapshot() as typeof start).buildings.find((building) => (building as { id?: string }).id === "scene-tower")!;
  await s.camera(placed.x, placed.y);
  await s.click(placed.x, placed.y);
  const labels = await s.readDom("[data-command-label]");
  s.must(labels.some((label) => label.visible), "the tower's card shows no command");
  await s.shot("tower-card", { x: 0, y: 560, width: 1000, height: 340 });
}
