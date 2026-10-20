import type { Scene } from '../drivers/browser';

// Each action is actual mouse/keyboard input. Fixtures only arrange the same battlefield on both refs.
export default async function (s: Scene) {
  const gpu = await s.page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  s.must(!/SwiftShader|llvmpipe/i.test(gpu), `Software GPU: ${gpu}`);
  s.record('gpu', { renderer: gpu });
  await s.page.addInitScript(() => {
    const prototype = AudioContext.prototype, create = prototype.createOscillator;
    (window as any).__refusalToneCount = 0;
    prototype.createOscillator = function () { (window as any).__refusalToneCount++; return create.call(this); };
  });
  await s.room('templeSpring');
  await s.page.locator('[data-match-menu-button]').click();
  await s.page.locator('[data-match-menu] .match-action').filter({ hasText: '设置' }).click();
  await s.page.locator('[data-sound-pack]').selectOption('cc0');
  await s.page.locator('[data-settings-close]').click();
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: 'bareDuel', options: { players: ['player', 'enemy', 'enemy2', 'player-4'], teams: { player: 'a', enemy: 'b', enemy2: 'a', 'player-4': 'b' }, aiPlayers: [], races: { player: 'grove' },
    layout: { seed: 'refusal-proof', kind: 'sides', idea: 'openSides', size: 4096 }, scenario: {
      replaceDefaultUnits: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true,
      players: { player: { gold: 1 } },
      addBuildings: [{ id: 'tower', owner: 'player', kind: 'fortifiedTower', x: 1800, y: 1900, complete: true },
        { id: 'barracks', owner: 'player', kind: 'barracks', x: 2100, y: 1900, complete: true },
        ...[0, 1, 2, 3].map(i => ({ id: `farm-${i}`, owner: 'player', kind: 'farm', x: 2400 + i * 140, y: 2500, complete: true }))],
      addUnits: [{ id: 'ballista', owner: 'player', kind: 'ballista', x: 1660, y: 1990 },
        { id: 'priest', owner: 'player', kind: 'priest', x: 1860, y: 2170 },
        { id: 'hurt', owner: 'player', kind: 'footman', x: 1960, y: 2170, hpRatio: .25 },
        { id: 'carrier', owner: 'player', kind: 'footman', x: 2110, y: 2120 }],
      addItems: [0, 1, 2, 3].map(i => ({ id: `full-${i}`, kind: 'experienceBook', carrierId: 'carrier', slot: `carry${i}`, x: 2110, y: 2120, cooldownRemaining: 0 }))
        .concat([{ id: 'loot', kind: 'experienceBook', x: 2200, y: 2120, cooldownRemaining: 0 } as never]),
    } } });
  await s.order('player', { type: 'setAutocast', unitIds: ['priest'], ability: 'heal', enabled: false });
  // Spend the same 500 starting gold through valid production on both refs; the HTTP fixture schema omits player seeds.
  for (let i = 0; i < 5; i++) await s.order('player', { type: 'train', buildingId: 'barracks', unitKind: 'footman' });
  await s.reload(); await s.tick(1); await s.key('Shift'); await s.camera(1930, 2020, 1);
  const records: { name: string; expected: string; text: string; passed: boolean }[] = [];
  const read = async (name: string, expected: string) => {
    await s.wait(150);
    const text = (await s.readDom('.command-refusal-bar')).map(row => row.text).join(' ');
    records.push({ name, expected, text, passed: text.includes(expected) });
    await s.shot(name);
  };
  await s.select(['ballista']);
  const tower = await s.screenOf(1800, 1900);
  await s.page.mouse.move(tower.x, tower.y); await s.wait(200);
  await s.shot('tower-target-hover');
  await s.click(1800, 1900, 'right');
  await read('tower-refused', '机械单位不能登上防御塔');

  await s.select(['barracks']);
  await s.key('f');
  await read('gold-refused', '金币不足，还差 100');
  const train = s.page.locator('.command-button[data-hotkey="F"]:visible');
  if (await train.count()) { await train.hover(); await s.wait(200); await s.shot('gold-button-tooltip'); }

  await s.select(['priest']);
  await s.key('h'); await s.click(1960, 2170); await s.tick(8);
  await s.key('h');
  await read('cooldown-refused', '冷却中，还剩');

  await s.select(['carrier']);
  await s.click(2200, 2120, 'right');
  await read('inventory-refused', '背包已满');
  const errorTones = await s.page.evaluate(() => (window as any).__refusalToneCount as number);
  s.record('refusal-proof', { gpu, errorTones, records, snapshot: await s.snapshot(), status: await s.readDom('[data-status]') });
  // The comparison deliberately fails here, after capturing all four original silent/missing-feedback cases.
  if (records.every(record => record.passed)) s.must(errorTones === 4, `Expected four actual error tones, heard ${errorTones}`);
  s.must(records.every(record => record.passed), `Missing command feedback: ${JSON.stringify(records.filter(record => !record.passed))}`);
}
