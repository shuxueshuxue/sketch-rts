import { pathToFileURL } from 'node:url';
import type { Scene } from '../drivers/browser';

/** Browser contract proof only. All screenshots explicitly identify the synthetic allocation data. */
export default async function (s: Scene) {
  const load = (path: string) => import(pathToFileURL(`${process.cwd()}/${path}`).href);
  const { strategyFixture } = await load('src/client/ai-plan-strategy.test-fixture.ts');
  const { createRoomLifecycleHost } = await load('src/shared/room-lifecycle.ts');
  const { createSaveGameRecord } = await load('src/shared/savegame.ts');
  const { createDebugReplayTrace } = await load('src/shared/replay.ts');
  const { diffAiPlan } = await load('src/ai/plan-stream.ts');
  const fixture = strategyFixture(), lifecycle = createRoomLifecycleHost();
  lifecycle.createRoom({ id: 'allocation-contract', host: { id: 'host', name: 'Contract proof' }, mapId: 'bareDuel' });
  const { room } = lifecycle.startRoom('allocation-contract');
  const replay = createDebugReplayTrace({ id: 'allocation-contract', label: '契约样例（人工数据，非真实 AI 决策）',
    initialSave: createSaveGameRecord(fixture.game, room, { id: 'allocation-contract' }) });
  replay.throughTick = 120;
  const packets: any[] = [{ type: 'coverage', session: 1, from: 0, to: 60 }];
  let previous: any;
  for (const tick of [0, 15, 30, 45, 50, 60]) {
    const trace = { ...fixture.trace, tick, strategy: { ...fixture.strategy, tick,
      situation: { ...fixture.strategy.situation, tick }, allocation: { ...fixture.allocation,
        events: fixture.events.filter((event: any) => event.tick <= tick),
        assignments: fixture.allocation.assignments.map((row: any) => ({ ...row,
          stage: tick >= 30 ? 'on-station' : 'en-route', interruption: tick >= 40 ? row.interruption : null })),
        executions: fixture.allocation.executions.map((row: any) => ({ ...row,
          phase: tick >= 30 ? 'fight' : 'assemble', status: tick >= 40 ? 'blocked' : 'active' })),
      } } };
    packets.push({ ...diffAiPlan(previous, trace, 1), positions: [{ id: fixture.first.id, x: fixture.first.x, y: fixture.first.y }] });
    previous = trace;
  }
  replay.aiPlans = { packets, throughTick: 120 };
  const gpu = await s.page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  s.must(!/SwiftShader|llvmpipe/i.test(gpu), `Software GPU: ${gpu}`);
  await s.page.goto(new URL('?debug=1', s.page.url()).href, { waitUntil: 'load' });
  await s.page.waitForSelector('[data-open-plan-replay]', { timeout: 180000 });
  const choosing = s.page.waitForEvent('filechooser');
  await s.page.click('[data-open-plan-replay]');
  await (await choosing).setFiles({ name: 'allocation-contract.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replay)) });
  await s.page.waitForSelector('.ai-plan-toggle:not([hidden])', { timeout: 180000 });
  await s.page.click('.ai-plan-toggle');
  await s.page.waitForSelector('[data-plan-seek]');
  const seek = async (tick: number) => {
    await s.page.locator('[data-plan-seek]').evaluate((input: HTMLInputElement, value: number) => {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }, tick);
    await s.page.waitForFunction((value: number) => (window as any).__sketchRtsView?.tick === value, tick);
    await s.wait(1200);
  };
  await seek(50);
  await s.page.waitForSelector('.plan-strategy');
  // Label the evidence, rather than presenting a synthetic transaction as a real match decision.
  await s.page.evaluate(() => {
    const watermark = document.createElement('div');
    watermark.dataset.planContractWatermark = '';
    watermark.textContent = '人工样例\n非真实 AI 决策';
    Object.assign(watermark.style, { position: 'fixed', left: '20%', top: '33%', zIndex: '1400',
      pointerEvents: 'none', whiteSpace: 'pre-line', textAlign: 'center', color: '#664c32', opacity: '.28',
      font: '700 52px/1.55 serif', letterSpacing: '.15em', transform: 'rotate(-16deg)' });
    document.body.append(watermark);
  });
  const labelFixture = () => s.page.locator('.ai-plan-overlay header em').evaluate((element: HTMLElement) => {
    element.textContent = '契约样例 · 人工分配数据 · 非真实 AI 决策';
  });
  const html = await s.page.locator('.plan-strategy').innerText();
  for (const text of ['正式分配', '抢占 island → defense', '资源不足', '救命中断后的空缺', 'fixture-camp-blocked']) {
    s.must(html.includes(text), `Missing allocation detail: ${text}`);
  }
  await s.camera(fixture.first.x + 150, fixture.first.y + 100, .9);
  const target = fixture.allocation.objectives[0].target.point;
  const marker = await s.page.evaluate((point: {x:number;y:number}) =>
    (window as any).__sketchRtsDebug.screenOf(point.x, point.y), target);
  await s.page.mouse.click(marker.x, marker.y);
  s.must(await s.page.locator('.plan-strategy').getAttribute('data-objective') === 'defense',
    'A same-position candidate stole the committed marker click');
  await s.wait(500); await labelFixture(); await s.shot('allocation-contract-intent');
  await s.page.locator('.plan-assignment').first().scrollIntoViewIfNeeded();
  await s.wait(300); await labelFixture(); await s.shot('allocation-contract-assignment');
  await seek(15);
  const early = await s.page.locator('.plan-strategy').innerText();
  s.must(!early.includes('抢占 island'), 'Replay seek exposed a not-yet-observed handoff');
  await seek(80);
  s.must(await s.page.locator('.plan-unrecorded').filter({ hasText: '未记录' }).count() > 0, 'Missing explicit unrecorded gap');
  s.must(await s.page.locator('.plan-strategy').count() === 0, 'A formal plan leaked across the recording gap');
  s.record('allocation-contract', { evidence: 'synthetic-contract-fixture', gpu, throughTick: 120,
    packets: packets.length, incremental: packets.filter(packet => packet.strategyDelta).length,
    checked: ['utility', 'assignments', 'preemption', 'unmet', 'vacancies', 'blocked', 'backward-seek', 'unrecorded-gap'] });
}
