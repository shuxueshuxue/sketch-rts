// The equipment panel, paper doll and hand-slot icons (#422, #446): one soldier selected, its equipment opened.
// Rewritten from Art Lane's equip.mjs.
import type { Scene } from "../drivers/browser";
// A scene file travels alone (see tools/cli/README.md), so it imports nothing but types.
const HUD = { x: 0, y: 560, width: 1000, height: 340 };

type Snap = { buildings: { owner: string; kind: string; x: number; y: number }[] };

export default async function (s: Scene) {
  await s.room("pineshade");
  const hall = (await s.snapshot() as Snap).buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
  const cx = hall.x, cy = hall.y + 260;
  const veterans = [0, 1, 2, 3].map((i) => ({ id: `vet-${i}`, owner: "player", kind: "footman", x: cx - 300 + i * 34, y: cy, xp: 99999 }));
  await s.scenario({ aiPlayers: [], races: { player: "grove", enemy: "ember" }, scenario: { players: { player: { gold: 2000 } }, addUnits: veterans } });
  await s.camera(cx, cy);
  await s.select(veterans.map((unit) => unit.id));
  await s.shot("veterans", HUD);
  await s.select(["vet-0"]);
  await s.shot("one-soldier", HUD);
  await s.key("i"); await s.wait(1000);
  await s.shot("equipment");
}
