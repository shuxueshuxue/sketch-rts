// Whole-body footprint and shared mechanical refusal, viewed zoomed out on mac1.
import type { Scene } from "../drivers/browser";
type Unit = { id: string; x: number; y: number; radius: number; garrison?: { buildingId: string } };
type Snap = { units: Unit[]; buildings: { id: string; x: number; y: number; radius: number }[]; effects: unknown[] };
export default async function(s: Scene) {
  await s.room("templeSpring");
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [], scenario: {
    replaceDefaultUnits: true, replaceDefaultMercenaryCamps: true,
    addBuildings: [0, 1, 2, 3].map(i => ({ id: `tower-${i}`, kind: "fortifiedTower", owner: "player", x: 1600 + i * 350, y: 2000, complete: true })),
    addUnits: ["ballista", "footman", "knight", "ancientStag"].map((kind, i) => ({ id: kind, kind, owner: "player", x: 1600 + i * 350, y: 2100 })),
  } } });
  await s.tick(1);
  for (const [i, kind] of ["footman", "knight", "ancientStag"].entries()) await s.order("player", { type: "garrison", unitIds: [kind], buildingId: `tower-${i + 1}` });
  await s.tick(120);
  const snapshot = await s.snapshot() as Snap;
  const bodies = ["footman", "knight", "ancientStag"].map((id, i) => {
    const unit = snapshot.units.find(unit => unit.id === id)!, tower = snapshot.buildings.find(tower => tower.id === `tower-${i + 1}`)!;
    return { id, unit, tower, extent: Math.hypot(unit.x - tower.x, unit.y - tower.y) + unit.radius };
  });
  for (const body of bodies) {
    await s.camera(body.tower.x, body.tower.y, .7); await s.select([body.id]); await s.wait(900); await s.shot(`${body.id}-on-tower-zoomed-out`);
  }
  await s.camera(1600, 2000, .7); await s.select(["ballista"]);
  const accepted = await s.command({ type: "garrison", unitIds: ["ballista"], buildingId: "tower-0" });
  await s.wait(250); await s.shot("ballista-garrison-refusal");
  s.record("tower-bodies", { bodies, ballistaCommandAccepted: accepted, status: await s.readDom("[data-status]") });
  s.must(bodies.every(body => body.unit.garrison && body.extent <= body.tower.radius + 1e-6), "an occupant's body overhangs the tower top");
  s.must(accepted === false, "a mechanical ballista was allowed to climb");
}
