// Four armies meeting in the middle of templeSpring, seen zoomed out and at 1:1: troop cards drawn smaller than they
// were painted are sampled from their mips past the first (see @@@card-window-blit; #504 reverted the troop card atlas
// when those mips were copied from the wrong place and zoomed-out troops drew as blocks).
import type { Scene } from "../drivers/browser";

type Snap = { map: { width: number; height: number }; players: Record<string, { race: string }> };
const KINDS = { grove: ["footman", "archer", "knight", "priest", "lancer"], ember: ["ashWarden", "sparkArcher", "emberRavager", "ashHexer", "cinderRunner"] } as const;

export default async function (s: Scene) {
  await s.room("templeSpring", 4);
  const start = await s.snapshot() as Snap;
  const cx = Math.round(start.map.width / 2), cy = Math.round(start.map.height / 2), owners = Object.keys(start.players);
  const addUnits = owners.flatMap((owner, side) => {
    const kinds = KINDS[start.players[owner]!.race === "ember" ? "ember" : "grove"], angle = side / owners.length * Math.PI * 2;
    return Array.from({ length: 30 }, (_, i) => ({ id: `z-${side}-${i}`, owner, kind: kinds[i % kinds.length]!,
      x: Math.round(cx + Math.cos(angle) * (260 + (i % 3) * 30) - Math.sin(angle) * ((i / 3 | 0) - 5) * 30), y: Math.round(cy + Math.sin(angle) * (260 + (i % 3) * 30) + Math.cos(angle) * ((i / 3 | 0) - 5) * 30) }));
  });
  await s.scenario({ aiPlayers: [], scenario: { addUnits } });
  for (const owner of owners) await s.order(owner, { type: "attackMove", unitIds: addUnits.filter((unit) => unit.owner === owner).map((unit) => unit.id), x: cx, y: cy });
  await s.tick(60);
  await s.camera(cx, cy, 0.5);
  await s.wait(1500);
  await s.shot("zoomed-out");
  await s.camera(cx, cy, 1);
  await s.wait(1500);
  await s.shot("one-to-one");
}
