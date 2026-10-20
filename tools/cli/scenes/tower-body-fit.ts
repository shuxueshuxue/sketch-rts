// Foot-only admission and whole-body footprints, viewed zoomed out on mac1.
import type { Scene } from "../drivers/browser";
type Unit = { id: string; x: number; y: number; radius: number; garrison?: { buildingId: string } };
type Snap = { units: Unit[]; buildings: { id: string; x: number; y: number; radius: number }[]; effects: unknown[] };
export default async function(s: Scene) {
  await s.room("templeSpring");
  const enemy = Object.keys((await s.snapshot() as Snap & { players: Record<string, unknown> }).players).find(owner => owner !== "player")!;
  // The same open clearing as tower-trained-melee: tree canopies must not hide the platform in the proof shots.
  const sites = [{ kind: "knight", x: 1200, y: 3800 }, { kind: "footman", x: 1200, y: 3560 },
    { kind: "archer", x: 1600, y: 3560 }, { kind: "priest", x: 2000, y: 3560 }, { kind: "ogreLord", x: 1600, y: 3800 }];
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { players: ["player", enemy, "ally", "rival"], teams: { player: "a", [enemy]: "b", ally: "a", rival: "b" }, aiPlayers: [], layout: { seed: "ranged-aim-buffer", kind: "sides", idea: "openSides", size: 4096 }, races: { player: "grove", [enemy]: "grove" }, scenario: {
    replaceDefaultUnits: true, replaceDefaultMercenaryCamps: true,
    addBuildings: sites.map((site, i) => ({ id: `tower-${i}`, kind: "fortifiedTower", owner: "player", x: site.x, y: site.y, complete: true })),
    addUnits: sites.map(site => ({ id: site.kind, kind: site.kind, owner: "player", x: site.x, y: site.y + 100 })),
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
  await s.camera(sites[0]!.x, sites[0]!.y, .7); await s.select(["knight"]);
  const accepted = await s.command({ type: "garrison", unitIds: ["knight"], buildingId: "tower-0" });
  await s.wait(250); await s.shot("knight-garrison-refusal");
  const status = await s.readDom("[data-status]");
  await s.tick(120);
  const final = await s.snapshot() as Snap;
  s.record("tower-bodies", { bodies, commandQueued: accepted, status, knight: final.units.find(unit => unit.id === "knight") });
  s.must(bodies.every(body => body.unit.garrison && body.extent <= body.tower.radius + 1e-6), "an occupant's body overhangs the tower top");
  s.must(status.some(line => line.text.includes("Only foot troops can garrison towers")) && !final.units.find(unit => unit.id === "knight")?.garrison, "a mounted knight was not explicitly refused");
}
