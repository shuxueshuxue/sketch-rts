// Two armies of forty with spirits in both, lined up and then clashing (#423, spirit team colour). Rewritten from Art
// Lane's battle.mjs and spiritbattle.mjs.
import type { Scene } from "../drivers/browser";

type Snap = { map: { width: number; height: number }; players: Record<string, unknown> };

export default async function (s: Scene) {
  await s.room("pineshade");
  const start = await s.snapshot() as Snap;
  const cx = start.map.width / 2, cy = start.map.height / 2, enemy = Object.keys(start.players).find((player) => player !== "player")!;
  const grove = ["footman", "footman", "lancer", "archer", "archer", "knight", "priest", "golem", "spirit", "spirit"];
  const ember = ["ashWarden", "ashWarden", "emberRavager", "sparkArcher", "sparkArcher", "ashChieftain", "ashHexer", "cinderRevenant", "spirit", "spirit"];
  const units = Array.from({ length: 40 }, (_, i) => {
    const row = Math.floor(i / 10), col = i % 10;
    return [{ id: `p-${i}`, owner: "player", kind: grove[col], x: cx - 200 - row * 40, y: cy - 200 + col * 40 },
      { id: `e-${i}`, owner: enemy, kind: ember[col], x: cx + 200 + row * 40, y: cy - 200 + col * 40 }];
  }).flat();
  await s.scenario({ aiPlayers: [], races: { player: "grove", [enemy]: "ember" }, scenario: { addUnits: units } });
  await s.camera(cx, cy); await s.wait(3000);
  await s.shot("lineup");
  for (const [owner, x] of [["player", cx + 400], [enemy, cx - 400]] as const)
    await s.order(owner, { type: "attackMove", unitIds: units.filter((unit) => unit.owner === owner).map((unit) => unit.id), x, y: cy });
  await s.tick(60);
  await s.camera(cx, cy); await s.wait(1500);
  await s.shot("clash");
}
