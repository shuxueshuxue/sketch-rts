import type { Scene } from '../drivers/browser';

export default async function(s: Scene) {
  const host = { id: 'afk-human', name: 'AFK human' };
  await s.page.evaluate((person: { id: string; name: string }) => localStorage.setItem('sketch-rts-user', JSON.stringify(person)), host);
  const samples: unknown[] = [];
  for (const mapId of ['elderwood', 'templeSpring']) {
    const room: any = await s.api('/api/rooms', { id: `corner-intent-${mapId}`, host, mapId,
      visibility: 'private', humanCount: 1, aiCount: 3 });
    await s.api(`/api/rooms/${room.id}/start`, { userId: host.id });
    await s.api(`/api/rooms/${room.id}/pause`, {});
    let world: any = await s.api(`/api/rooms/${room.id}/snapshot`);
    while (world.tick < 18000) {
      await s.api(`/api/rooms/${room.id}/tick`, { ticks: Math.min(600, 18000 - world.tick) });
      world = await s.api(`/api/rooms/${room.id}/snapshot`);
    }
    await s.page.goto(new URL(`?room=${room.id}`, s.page.url()).href, { waitUntil: 'load' });
    await s.page.waitForFunction((tick: number) => ((window as any).__sketchRtsView?.tick ?? -1) >= tick,
      world.tick, { timeout: 180000 });
    await s.page.waitForFunction(() => !!(window as any).__sketchRtsDebug?.ready(), null, { timeout: 120000 });
    await s.page.addStyleTag({ content: '[data-pointer-lock-gate]{display:none!important}' });
    const boats = world.units.filter((unit: any) => unit.owner !== 'player' && unit.kind === 'transport');
    s.must(boats.length > 0, `${mapId} has no AI transport at 15 minutes`);
    const focus = mapId === 'elderwood' ? boats[0] : world.resources.find((mine: any) => mine.id === 'gold-gen-9');
    await s.camera(focus.x, focus.y, .65);
    await s.wait(3000);
    await s.shot(`native-multiple-basins-${mapId.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}-900s`);
    const output = JSON.parse(process.argv[2]!).out;
    await s.page.screenshot({ path: `${output}/native-multiple-basins-${mapId}-900s.jpg`, type: 'jpeg', quality: 85 });
    samples.push({ mapId, snapshot: world });
  }
  s.record('native-multiple-basins', { method: 'One AFK human and the default room AI seats; no commands or state edits.', samples });
}
