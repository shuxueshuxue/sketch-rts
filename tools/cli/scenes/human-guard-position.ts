import type { Scene } from '../drivers/browser';

type Soldier = { id: string; owner: string; kind: string; x: number; y: number; hp: number;
  guardPosition?: { x: number; y: number }; order: { type: string; returnToGuard?: boolean } };
type Snapshot = { tick: number; units: Soldier[] };

export default async function (s: Scene) {
  const gpu = await s.page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('No WebGL2 context');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION) };
  });
  s.must(!/SwiftShader|llvmpipe/i.test(gpu.renderer), `Software GPU: ${gpu.renderer}`);
  s.record('gpu', gpu);
  await s.room('templeSpring');
  const soldiers = ['guard-0', 'guard-1', 'guard-2'];
  const baits = Array.from({ length: 8 }, (_, i) => ({ id: `bait-${i}`, owner: 'enemy', kind: 'worker', x: 1550 + i * 175, y: 2000 }));
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: 'bareDuel', options: { players: ['player', 'enemy', 'enemy2', 'player-4'], aiPlayers: [], teams: { player: 'a', enemy: 'b', enemy2: 'a', 'player-4': 'b' },
    layout: { seed: 'human-guard-proof', kind: 'sides', idea: 'openSides', size: 4096 }, scenario: {
    replaceDefaultUnits: true,
    replaceDefaultLandmarks: true,
    replaceDefaultResources: true, replaceDefaultMercenaryCamps: true,
    addUnits: [...soldiers.map((id, i) => ({ id, owner: 'player', kind: 'footman', x: 1200, y: 1960 + i * 40 })), ...baits],
    addBuildings: [{ id: 'guard-post', owner: 'player', kind: 'farm', x: 1450, y: 2220, complete: true }],
  } } });
  await s.reload();
  // A local tick-0 image can precede websocket join; wait for an authoritative frame before real input.
  await s.tick(1);
  await s.camera(2125, 2050, .7);
  await s.select(soldiers);
  await s.shot('selected-before-move');
  const point = await s.screenOf(1450, 2000);
  const input = await s.page.evaluate(({x,y}: {x:number;y:number}) => ({ at: document.elementFromPoint(x,y)?.outerHTML.slice(0,300), view: (window as any).__sketchRtsView }), point);
  s.record('mouse-input', { point, input });
  // Actual browser mouse event: the page sends the right-click move through its socket.
  await s.click(1450, 2000, 'right');
  // Human network commands land after the room's input delay, not on the immediately following tick.
  await s.tick(8);
  let snapshot = await s.snapshot() as Snapshot;
  await s.shot('after-mouse');
  s.record('post-mouse', { snapshot, view: await s.page.evaluate(() => (window as any).__sketchRtsView), events: await s.api(`/api/rooms/${s.roomId}/sync-events`) });
  s.must(snapshot.units.filter(u => soldiers.includes(u.id)).every(u => u.order.type === 'move'), `right-click did not move the selected squad: ${JSON.stringify({ point, units: snapshot.units.filter(u => soldiers.includes(u.id)) })}`);
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
  } else s.must(Object.values(farthest).some(distance => distance > 600), `comparison did not reproduce the original drift: ${JSON.stringify(farthest)}`);
}
