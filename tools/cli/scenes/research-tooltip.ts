// A research in progress, its button hovered while the match runs, then left: the button must be the same element the
// whole time (updated in place, not rebuilt each HUD refresh), its open tooltip must follow its progress, and leaving
// it must close the tooltip. Art Lane's report in #494: a rebuilt progress button left its tooltip open.
import type { Scene } from "../drivers/browser";

type Snap = { buildings: { id: string; owner: string; kind: string; x: number; y: number }[] };
const HUD = { x: 0, y: 560, width: 1000, height: 340 };

export default async function (s: Scene) {
  await s.room("pineshade");
  const hall = (await s.snapshot() as Snap).buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
  const x = hall.x + 320, y = hall.y;
  await s.scenario({ aiPlayers: [], races: { player: "ember", enemy: "grove" }, scenario: { players: { player: { gold: 5000 } },
    addBuildings: [{ id: "tip-forge", owner: "player", kind: "emberForge", x, y, complete: true }] } });
  await s.camera(x, y);
  await s.select(["tip-forge"]);
  // Ordered as a player does, from the forge's command dock: the room's ticks take what the page sends (@@@api-tick-queue).
  await s.page.locator("[data-command-label='Research Weapon Training']").click();
  // An order lands a few ticks after its click, on the tick the server has when the page's message reaches it: the
  // match is stepped a tick at a time (at most 40) until the research shows.
  const button = s.page.locator("[data-research-progress]");
  for (let tick = 0; tick < 40 && await button.count() === 0; tick++) await s.tick(1);
  s.must(await button.count() === 1, "no research progress button within 40 ticks of ordering Weapon Training");
  const read = () => s.page.evaluate(() => {
    const element = document.querySelector<HTMLElement & { probe?: number }>("[data-research-progress]"), layer = document.querySelector("[data-tooltip-layer]");
    return { same: element?.probe === 1, label: element?.getAttribute("aria-label") ?? "", tooltipShown: !!layer && !layer.classList.contains("hidden"), tooltip: layer?.textContent ?? "" };
  });
  await s.page.evaluate(() => { (document.querySelector("[data-research-progress]") as HTMLElement & { probe?: number }).probe = 1; });
  // A pointer moved onto the button, as a player's (a hover by element would wait for a rebuilt button to hold still).
  const box = (await button.boundingBox())!;
  await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await s.wait(100);
  const hovered = await read();
  s.must(hovered.tooltipShown, "hovering the research progress button did not open its tooltip");
  await s.shot("hovered", HUD);
  // The match runs on under the pointer: every snapshot refreshes the HUD.
  await s.tick(40);
  const running = await read();
  await s.shot("running", HUD);
  // Every check is taken, and all that failed are reported together.
  const failures: string[] = [];
  if (!running.same) failures.push("the research progress button was rebuilt while the research ran (it must be updated in place)");
  if (running.label === hovered.label) failures.push(`the button's progress did not move: ${running.label}`);
  if (running.tooltip === hovered.tooltip) failures.push("the open tooltip did not follow the research's progress");
  // The pointer leaves.
  await s.page.mouse.move(HUD.x + 4, 8);
  await s.wait(150);
  const left = await read();
  await s.shot("left", HUD);
  if (left.tooltipShown) failures.push("the tooltip stayed open after the pointer left the research progress button");
  s.must(failures.length === 0, failures.join("; "));
}
