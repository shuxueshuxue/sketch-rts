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
  // The upgrade begun as a player begins it (its button on the card), then halfway (12 s, 240 ticks): the progress #471
  // shows on the card. On commits from before the upgrade job there is nothing to begin.
  const begin = s.page.locator("[data-command-label]:visible").first();
  if (!(await begin.getAttribute("data-command-label"))?.toLowerCase().includes("upgrade")) return;
  await begin.click();
  await s.wait(1500);
  await s.tick(120);
  await s.wait(1000);
  const card = await s.page.evaluate("document.querySelector('[data-command-label]') && [...document.querySelectorAll('[data-command-label]')].map(e => e.textContent + ' ' + (e.getAttribute('aria-label') || '')).join(' | ')") as string;
  s.must(/%/.test(card), `the upgrade shows no progress on the card: ${card}`);
  // The pointer off the card, so its tooltip does not cover the progress.
  await s.page.mouse.move(1500, 120); await s.wait(500);
  await s.shot("tower-upgrading", { x: 0, y: 560, width: 1000, height: 340 });
}
