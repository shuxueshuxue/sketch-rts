// Same scenario on main and the fix: research must not turn cavalry into tower-reaching shooters.
import type { Scene } from "../drivers/browser";
type Unit = { id: string; kind: string; x: number; y: number; hp: number; maxHp: number; attackRange: number; aim?: unknown; garrison?: { buildingId: string } };
type Snap = { players: Record<string, unknown>; units: Unit[]; buildings: { id: string; x: number; y: number; radius: number }[] };
export default async function(s: Scene) {
  await s.room("templeSpring");
  const enemy = Object.keys((await s.snapshot() as Snap).players).find(owner => owner !== "player")!;
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { players: ["player", enemy, "ally", "rival"], teams: { player: "a", [enemy]: "b", ally: "a", rival: "b" }, aiPlayers: [], layout: { seed: "ranged-aim-buffer", kind: "sides", idea: "openSides", size: 4096 }, races: { player: "grove", [enemy]: "grove" }, scenario: {
    replaceDefaultUnits: true, replaceDefaultMercenaryCamps: true,
    addBuildings: [0, 1, 2].map(i => ({ id: `tower-${i}`, kind: "fortifiedTower", owner: "player", x: 1200 + i * 400, y: 3560, complete: true })).concat([{ id: "lab", kind: "workshop", owner: enemy, x: 2800, y: 3500, complete: true }]),
    addUnits: ["knight", "raider", "lancer"].flatMap((kind, i) => [
      { id: `top-${i}`, kind: "worker", owner: "player", x: 1200 + i * 400, y: 3640 },
      { id: `cavalry-${i}`, kind, owner: enemy, x: 1200 + i * 400, y: 3820, order: { type: "hold", x: 1200 + i * 400, y: 3820 } },
    ]),
  } } });
  await s.order(enemy, { type: "research", buildingId: "lab", upgradeKind: "rangeTraining" });
  await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 961 });
  await s.reload();
  const trained = await s.snapshot() as Snap;
  s.record("research", trained.players);
  s.must((trained.players[enemy] as { upgrades: { rangeTraining: number } }).upgrades.rangeTraining === 1, "range research did not complete");
  for (let i = 0; i < 3; i++) await s.order("player", { type: "garrison", unitIds: [`top-${i}`], buildingId: `tower-${i}` });
  await s.tick(70);
  const before = await s.snapshot() as Snap;
  s.must([0, 1, 2].every(i => before.units.find(unit => unit.id === `top-${i}`)?.garrison), "workers did not climb");
  for (let i = 0; i < 3; i++) await s.order(enemy, { type: "attack", unitIds: [`cavalry-${i}`], targetId: `top-${i}` });
  await s.tick(240);
  await s.camera(1600, 3560, .7); await s.select([]); await s.wait(1200);
  await s.shot("trained-cavalry-versus-tower");
  const after = await s.snapshot() as Snap;
  const results = [0, 1, 2].map(i => ({ cavalry: after.units.find(unit => unit.id === `cavalry-${i}`), before: before.units.find(unit => unit.id === `top-${i}`), after: after.units.find(unit => unit.id === `top-${i}`) }));
  s.record("trained-cavalry", results);
  s.must(results.every(result => result.after?.hp === result.before?.hp), "range-trained melee troops damaged a tower occupant");
  s.must(results.every(result => result.cavalry?.attackRange === (result.cavalry?.kind === "lancer" ? 74 : 72) && !result.cavalry.aim), "research changed melee reach/category");
}
