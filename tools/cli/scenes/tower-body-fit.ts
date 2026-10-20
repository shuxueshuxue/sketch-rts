// Foot-only admission and whole-body footprints, viewed zoomed out on mac1.
import type { Scene } from "../drivers/browser";
type Unit = { id: string; x: number; y: number; radius: number; garrison?: { buildingId: string } };
type Snap = { units: Unit[]; buildings: { id: string; x: number; y: number; radius: number }[]; effects: unknown[] };
export default async function(s: Scene) {
  await s.room("templeSpring");
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [], scenario: {
    replaceDefaultUnits: true, replaceDefaultMercenaryCamps: true,
    addBuildings: [0, 1, 2, 3, 4].map(i => ({ id: `tower-${i}`, kind: "fortifiedTower", owner: "player", x: 1440 + i * 320, y: 2000, complete: true })),
    addUnits: ["knight", "footman", "archer", "priest", "ogreLord"].map((kind, i) => ({ id: kind, kind, owner: "player", x: 1440 + i * 320, y: 2100 })),
  } } });
  await s.reload(); await s.tick(1);
  const footKinds = ["footman", "archer", "priest", "ogreLord"];
  for (const [i, kind] of footKinds.entries()) await s.order("player", { type: "garrison", unitIds: [kind], buildingId: `tower-${i + 1}` });
  await s.tick(120);
  const snapshot = await s.snapshot() as Snap;
  const bodies = footKinds.map((id, i) => {
    const unit = snapshot.units.find(unit => unit.id === id)!, tower = snapshot.buildings.find(tower => tower.id === `tower-${i + 1}`)!;
    return { id, unit, tower, extent: Math.hypot(unit.x - tower.x, unit.y - tower.y) + unit.radius };
  });
  for (const body of bodies) {
    await s.camera(body.tower.x, body.tower.y, .7); await s.select([body.id]); await s.wait(900); await s.shot(`${body.id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}-on-tower-zoomed-out`);
  }
  await s.camera(1440, 2000, .7); await s.select(["knight"]);
  const accepted = await s.command({ type: "garrison", unitIds: ["knight"], buildingId: "tower-0" });
  await s.wait(250); await s.shot("knight-garrison-refusal");
  const status = await s.readDom("[data-status]");
  await s.tick(120);
  const final = await s.snapshot() as Snap;
  s.record("tower-bodies", { bodies, commandQueued: accepted, status, knight: final.units.find(unit => unit.id === "knight") });
  s.must(bodies.every(body => body.unit.garrison && body.extent <= body.tower.radius + 1e-6), "an occupant's body overhangs the tower top");
  s.must(status.some(line => line.text.includes("Only foot troops can garrison towers")) && !final.units.find(unit => unit.id === "knight")?.garrison, "a mounted knight was not explicitly refused");
}
