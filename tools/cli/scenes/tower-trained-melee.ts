// Same scenario on main and the fix: research must not turn cavalry into tower-reaching shooters.
import type { Scene } from "../drivers/browser";
type Unit = { id: string; kind: string; x: number; y: number; hp: number; maxHp: number; attackRange: number; aim?: unknown; garrison?: { buildingId: string } };
type Snap = { players: Record<string, unknown>; units: Unit[]; buildings: { id: string; x: number; y: number; radius: number }[] };
export default async function(s: Scene) {
  await s.room("templeSpring");
  const enemy = Object.keys((await s.snapshot() as Snap).players).find(owner => owner !== "player")!;
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [], scenario: {
    replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultMercenaryCamps: true,
    players: { [enemy]: { upgrades: { rangeTraining: 3 } } },
    addBuildings: [0, 1, 2].map(i => ({ id: `tower-${i}`, kind: "fortifiedTower", owner: "player", x: 1600 + i * 400, y: 2000, complete: true })),
    addUnits: ["knight", "raider", "lancer"].flatMap((kind, i) => [
      { id: `top-${i}`, kind: "worker", owner: "player", x: 1600 + i * 400, y: 2080 },
      { id: `cavalry-${i}`, kind, owner: enemy, x: 1600 + i * 400, y: 2260, order: { type: "hold", x: 1600 + i * 400, y: 2260 } },
    ]),
  } } });
  for (let i = 0; i < 3; i++) await s.order("player", { type: "garrison", unitIds: [`top-${i}`], buildingId: `tower-${i}` });
  await s.tick(70);
  const before = await s.snapshot() as Snap;
  s.must([0, 1, 2].every(i => before.units.find(unit => unit.id === `top-${i}`)?.garrison), "workers did not climb");
  for (let i = 0; i < 3; i++) await s.order(enemy, { type: "attack", unitIds: [`cavalry-${i}`], targetId: `top-${i}` });
  await s.tick(240);
  await s.camera(2000, 2000, .7); await s.select([]); await s.wait(1200);
  await s.shot("trained-cavalry-versus-tower");
  const after = await s.snapshot() as Snap;
  const results = [0, 1, 2].map(i => ({ cavalry: after.units.find(unit => unit.id === `cavalry-${i}`), before: before.units.find(unit => unit.id === `top-${i}`), after: after.units.find(unit => unit.id === `top-${i}`) }));
  s.record("trained-cavalry", results);
  s.must(results.every(result => result.after?.hp === result.before?.hp), "range-trained melee cavalry damaged a tower occupant");
  s.must(results.every(result => result.cavalry?.attackRange === (result.cavalry?.kind === "lancer" ? 74 : 72) && !result.cavalry.aim), "research changed melee reach/category");
}
