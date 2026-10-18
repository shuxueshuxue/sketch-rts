// Grand Estuary: identical overview and home cameras on both commits, paused at
// the opening. Run with sketch shot camp-budget --before … --after … --on mac1.
import type { Scene } from '../drivers/browser';

type Snapshot = { map: { width: number; height: number }; buildings: { kind: string; x: number; y: number }[]; units: { owner: string }[] };
export default async function (s: Scene) {
  await s.page.click('[data-open-create]');
  await s.page.waitForSelector('[data-map-id="grandEstuary"]', { timeout: 60_000 });
  await s.page.click('[data-map-id="grandEstuary"]');
  await s.wait(1800);
  await s.shot('grand-estuary-overview');
  await s.home();
  await s.room('grandEstuary', 8);
  await s.scenario({ aiPlayers: [] });
  const snapshot = await s.snapshot() as Snapshot;
  const homes = snapshot.buildings.filter(building => building.kind === 'townHall');
  for (const [index, home] of homes.slice(0, 2).entries()) {
    const dx = snapshot.map.width / 2 - home.x, dy = snapshot.map.height / 2 - home.y;
    const length = Math.hypot(dx, dy);
    const camera = { x: home.x + dx / length * 400, y: home.y + dy / length * 400, zoom: 0.65 };
    await s.camera(camera.x, camera.y, camera.zoom);
    await s.wait(1600);
    await s.shot(`grand-estuary-home-${index + 1}`);
    s.record(`home-${index + 1}-camera`, camera);
  }
  s.record('opening', { homes, neutralUnits: snapshot.units.filter(unit => unit.owner === 'neutral').length });
}
