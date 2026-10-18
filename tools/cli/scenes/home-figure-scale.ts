// Same seed, still pose and camera on both commits. The close camera changes only
// framing; the real home scene, model painters and GPU world renderer draw it.
import type { Scene } from '../drivers/browser';

type Snap = {
  map: { width: number; height: number; terrain: { cell: number; cols: number; cells: string } };
  units: { id: string; kind: string; deck?: { shipId: string } }[];
};

export default async function (s: Scene) {
  await s.page.emulateMedia({ reducedMotion: 'reduce' });
  await s.page.addInitScript('Date.now = () => 1;');
  const home = async (id: string) => {
    await s.page.evaluate(`localStorage.setItem('sketch-rts-menu-scene', ${JSON.stringify(id)})`);
    await s.home();
    await s.page.addStyleTag({ content: '.menu-window{opacity:0!important}' });
    await s.wait(1500);
    const gpu = await s.page.evaluate(`(() => {
      const canvas = document.querySelector('.world-actors'), gl = canvas?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { visible: canvas && !canvas.parentElement.hidden, renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) };
    })()`);
    s.must(gpu.visible && /Apple|Metal/i.test(gpu.renderer ?? ''), 'home must be drawn by mac1 GPU');
    s.record(`gpu-${id}`, gpu);
  };

  await home('fleet');
  await s.shot('home-fleet');
  await s.page.evaluate(`(async () => {
    const { MenuBackdrop } = await import('/src/client/menu-scenes.ts');
    const draw = MenuBackdrop.prototype.draw;
    MenuBackdrop.prototype.draw = function(ctx, width, height, now, reduced, paint) {
      const run = this.run, original = run?.frameAt;
      if (run) {
        const ship = run.game.units.find(unit => unit.kind === 'shipOfTheLine' && unit.owner === 'corsairs');
        run.frameAt = () => ({ focus: { x: ship.x, y: ship.y - 150 }, zoom: 1.5, anchorX: .5, anchorY: .5 });
      }
      try { return draw.call(this, ctx, width, height, now, reduced, paint); }
      finally { if (run) run.frameAt = original; }
    };
  })()`);
  await s.wait(1600);
  await s.shot('home-fleet-close');
  await home('capital');
  await s.shot('home-capital');

  // A real paused room, with ordinary catalog footmen and workers aboard a
  // shipOfTheLine. Boarding orders place the crew; no home costume models apply.
  await s.room('brokenSea');
  const start = await s.snapshot() as Snap, t = start.map.terrain;
  const deep = (x: number, y: number) => {
    const c = Math.floor(x / t.cell), r = Math.floor(y / t.cell);
    for (let dy = -5; dy <= 5; dy++) for (let dx = -9; dx <= 9; dx++)
      if (t.cells[(r + dy) * t.cols + c + dx] !== '~') return false;
    return true;
  };
  let at: { x: number; y: number } | undefined;
  for (let ring = 0; ring < 60 && !at; ring++) for (let a = 0; a < 24 && !at; a++) {
    const x = Math.round(start.map.width / 2 + Math.cos(a / 24 * Math.PI * 2) * ring * 64);
    const y = Math.round(start.map.height / 2 + Math.sin(a / 24 * Math.PI * 2) * ring * 64);
    if (deep(x, y)) at = { x, y };
  }
  s.must(at, 'open water for the shipOfTheLine reference');
  const crew = ['footman', 'footman', 'worker', 'worker', 'priest'].map((kind, i) =>
    ({ id: `reference-crew-${i}`, owner: 'player', kind, x: at!.x + (i - 2) * 18, y: at!.y }));
  await s.scenario({ aiPlayers: [], scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true,
    addUnits: [{ id: 'reference-ship', owner: 'player', kind: 'shipOfTheLine', ...at }, ...crew] } });
  await s.order('player', { type: 'board', unitIds: crew.map(unit => unit.id), transportId: 'reference-ship' });
  await s.tick(150);
  const reference = await s.snapshot() as Snap;
  s.must(crew.every(unit => reference.units.find(actual => actual.id === unit.id)?.deck?.shipId === 'reference-ship'), 'all reference crew must stand on deck');
  await s.camera(at!.x, at!.y - 120, 1.5);
  await s.wait(1600);
  await s.shot('game-ship-reference');
  s.record('reference', { camera: { x: at!.x, y: at!.y - 120, zoom: 1.5 }, crew, snapshot: reference });
}
