import type { Scene } from '../drivers/browser';

type Soldier = { id: string; owner: string; kind: string; x: number; y: number; hp: number;
  guardPosition?: { x: number; y: number }; order: { type: string; returnToGuard?: boolean } };
type Snapshot = { tick: number; units: Soldier[] };

export default async function (s: Scene) {
  await s.room('templeSpring');
  const soldiers = ['guard-0', 'guard-1', 'guard-2'];
  const baits = Array.from({ length: 8 }, (_, i) => ({ id: `bait-${i}`, owner: 'enemy', kind: 'worker', x: 1650 + i * 175, y: 2000 }));
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: 'bareDuel', options: { aiPlayers: [], scenario: {
    replaceDefaultUnits: true,
    addUnits: [...soldiers.map((id, i) => ({ id, owner: 'player', kind: 'footman', x: 1200, y: 1960 + i * 40 })), ...baits],
    addBuildings: [{ id: 'guard-post', owner: 'player', kind: 'farm', x: 1450, y: 2220, complete: true }],
  } } });
  await s.reload();
  await s.camera(2125, 2050, .7);
  await s.select(soldiers);
  // Actual browser mouse event: the page sends the right-click move through its socket.
  await s.click(1450, 2000, 'right');
  await s.tick(1);
  let snapshot = await s.snapshot() as Snapshot;
  s.must(snapshot.units.filter(u => soldiers.includes(u.id)).every(u => u.order.type === 'move'), 'right-click did not move the selected squad');
  const stations = new Map<string, { x: number; y: number }>();
  for (let ticks = 0; ticks < 160 && stations.size < soldiers.length; ticks++) {
    await s.tick(1);
    snapshot = await s.snapshot() as Snapshot;
    for (const unit of snapshot.units.filter(u => soldiers.includes(u.id))) {
      if (unit.order.type !== 'move' && !stations.has(unit.id)) stations.set(unit.id, unit.guardPosition ?? { x: unit.x, y: unit.y });
    }
  }
  s.must(stations.size === soldiers.length, 'squad did not reach its right-click destination');
  await s.shot('commanded-station');
  // Each enemy really retreats a short distance; killing/reacquiring the next is what used to move the leash origin.
  for (const bait of baits) await s.order('enemy', { type: 'move', unitIds: [bait.id], x: bait.x + 40, y: bait.y } as never);
  const samples: unknown[] = [];
  const farthest = Object.fromEntries(soldiers.map(id => [id, 0]));
  for (let i = 0; i < 50; i++) {
    await s.tick(24);
    snapshot = await s.snapshot() as Snapshot;
    const units = snapshot.units.filter(u => soldiers.includes(u.id));
    for (const unit of units) {
      const station = stations.get(unit.id)!;
      farthest[unit.id] = Math.max(farthest[unit.id]!, Math.hypot(unit.x - station.x, unit.y - station.y));
    }
    samples.push({ tick: snapshot.tick, units: units.map(u => ({ id: u.id, x: u.x, y: u.y, hp: u.hp, order: u.order, station: u.guardPosition })) });
    if (i === 24) await s.shot('after-repeated-lures');
  }
  await s.select(soldiers);
  await s.shot('final-same-camera');
  const final = snapshot.units.filter(u => soldiers.includes(u.id));
  s.record('human-guard-position', { stations: Object.fromEntries(stations), farthest, samples,
    final: final.map(u => ({ id: u.id, x: u.x, y: u.y, order: u.order })) });
  // Main is a valid comparison side; only the new rule is required to retain the persistent station.
  if (final.some(u => u.guardPosition)) {
    s.must(final.length === soldiers.length, 'a guard died during the lure proof');
    s.must(final.every(u => Math.hypot(u.x - stations.get(u.id)!.x, u.y - stations.get(u.id)!.y) < 50), 'guards did not return to their commanded station');
    s.must(Object.values(farthest).every(distance => distance <= 600), `guard exceeded its leash: ${JSON.stringify(farthest)}`);
  }
}
