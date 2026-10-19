import type { Scene } from '../drivers/browser';

type Fighter = { id: string; x: number; y: number; hp: number; order: { type: string; targetId?: string };
  aim?: { x: number; y: number; tracking: boolean; targetId?: string } };
type Snapshot = { tick: number; units: Fighter[]; projectiles: { id: string; attackerId: string }[] };

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
  // Both units use their ordinary game stats. The golem's native 42 speed lets the 60-speed archer catch up again.
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: 'bareDuel', options: {
    players: ['player', 'enemy', 'enemy2', 'player-4'], aiPlayers: [],
    teams: { player: 'a', enemy: 'b', enemy2: 'a', 'player-4': 'b' }, layout: { seed: 'ranged-aim-buffer', kind: 'sides', idea: 'openSides', size: 4096 }, scenario: {
      replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultLandmarks: true,
      replaceDefaultResources: true, replaceDefaultMercenaryCamps: true,
      addUnits: [
        { id: 'shooter', owner: 'player', kind: 'archer', x: 1200, y: 3560, order: { type: 'hold', x: 1200, y: 3560 } },
        { id: 'retreating-melee', owner: 'enemy', kind: 'golem', x: 1510, y: 3560, order: { type: 'hold', x: 1510, y: 3560 } },
      ],
    },
  } });
  await s.reload(); await s.tick(1);
  await s.camera(1640, 3600, 1.6);
  await s.select(['shooter']);
  await s.shot('selected-before-attack');
  await s.order('enemy', { type: 'move', unitIds: ['retreating-melee'], x: 3000, y: 3560 });
  // Real browser right-click on the enemy sends the player's explicit attack through the room socket.
  await s.click(1510, 3560, 'right');
  await s.tick(8);
  let snapshot = await s.snapshot() as Snapshot;
  s.must(snapshot.units.find(unit => unit.id === 'shooter')?.order.targetId === 'retreating-melee', 'right-click did not issue an attack on the retreating melee unit');
  const start = snapshot.tick, samples: unknown[] = [], shots: number[] = [], seen = new Set<string>();
  let hasBuffer = false, interrupted = 0, wasTracking = false;
  for (let tick = 1; tick <= 240; tick++) {
    await s.tick(1);
    snapshot = await s.snapshot() as Snapshot;
    const shooter = snapshot.units.find(unit => unit.id === 'shooter')!;
    const target = snapshot.units.find(unit => unit.id === 'retreating-melee')!;
    hasBuffer ||= shooter.aim?.targetId === 'retreating-melee';
    if (wasTracking && !shooter.aim) interrupted++;
    wasTracking = !!shooter.aim?.tracking;
    for (const projectile of snapshot.projectiles) if (projectile.attackerId === 'shooter' && !seen.has(projectile.id)) {
      seen.add(projectile.id); shots.push(snapshot.tick - start);
    }
    if (tick % 4 === 0) samples.push({ tick: snapshot.tick, shooter, target, projectiles: snapshot.projectiles });
    if ([12, 74, 180, 240].includes(tick)) await s.shot(`pursuit-${tick}`);
  }
  s.record('ranged-aim-buffer', { start, hasBuffer, shots, interrupted, samples });
  if (hasBuffer) {
    s.must(shots.length >= 3, `buffered archer did not keep firing: ${JSON.stringify(shots)}`);
    s.must(interrupted === 0, `buffered windup was interrupted ${interrupted} times`);
  } else {
    s.must(shots.length === 0 && interrupted >= 10, `comparison did not reproduce the pursuit stutter: ${JSON.stringify({ shots, interrupted })}`);
  }
}
