import { pathToFileURL } from 'node:url';
import type { Scene } from '../drivers/browser';

/** Layout inspection of artificial data. Not planner correctness or execution evidence. */
export default async function (s: Scene) {
  const gpu = await s.page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  s.must(!/SwiftShader|llvmpipe/i.test(gpu), `Software GPU: ${gpu}`);
  // The deliverable is opened directly from its folder, independent of SPA routing.
  const file = pathToFileURL(`${process.cwd()}/docs/ai/plan-viz/goal-dependency.html`).href;
  await s.page.goto(file, { waitUntil: 'load' });
  await s.page.waitForSelector('[data-node="camp-action"]');
  const graphBox = await s.page.locator('.graph-sheet').boundingBox();
  const timelineBox = await s.page.locator('.chronology').boundingBox();
  s.must(graphBox && timelineBox && graphBox.y + graphBox.height <= timelineBox.y,
    'The dependency diagram overlaps the time axis');
  await s.page.click('[data-node="camp-action"]');
  const detail = await s.page.locator('#node-detail').innerText();
  for (const text of ['force-at', '运兵', '集结', '等事实', '落选', '200 金']) s.must(detail.includes(text), `Missing dependency detail: ${text}`);
  s.must((await s.page.locator('.sample-label').innerText()).includes('人工样稿'), 'Missing synthetic-data label');
  await s.wait(300); await s.shot('goal-dependency-plan');
  await s.page.locator('.option.rejected').first().scrollIntoViewIfNeeded();
  await s.shot('goal-dependency-options');
  await s.page.locator('#node-detail').evaluate((element: HTMLElement) => { element.scrollTop = 0; });
  await s.page.click('[data-moment="310"]');
  s.must((await s.page.locator('#node-detail').innerText()).includes('2 名兵被矿区回防抢占'), 'Missing interruption and retained parent');
  await s.shot('goal-dependency-interruption');
  await s.page.click('[data-moment="400"]');
  await s.page.click('[data-node="worker-action"]');
  s.must((await s.page.locator('[data-node="worker-result"]').innerText()).includes('结果尚未成立'), 'Unloading was mistaken for arrival');
  await s.shot('goal-dependency-progress');
  // Use a real pointer on the time axis to seek into the unrecorded region.
  const track = await s.page.locator('.timeline-track').first().boundingBox();
  s.must(track, 'No timeline track');
  await s.page.mouse.click(track.x + track.width * .8, track.y + 15);
  s.must(await s.page.locator('#unrecorded').isVisible(), 'A missing frame was interpolated');
  await s.page.click('[data-moment="490"]'); await s.page.click('[data-node="goal"]');
  s.must((await s.page.locator('#node-detail').innerText()).includes('世界中观测到矿厅完工'), 'Missing final effect proof');
  await s.shot('goal-dependency-result');
  // A double-clicked static HTML file must work without a dev server or modules.
  await s.page.goto(file, { waitUntil: 'load' });
  await s.page.waitForSelector('[data-node="camp-action"]');
  await s.page.click('[data-moment="490"]');
  s.must(await s.page.locator('body').getAttribute('data-sample-moment') === '490', 'file:// prototype did not work');
  s.record('goal-dependency-mockup', { evidence: 'artificial-layout-only', gpu,
    checked: ['goal', 'unmet-and-pending-facts', 'recursive-prerequisites', 'rejected-options',
      'execution-and-effect', 'interruption', 'pointer-seek', 'unrecorded-gap', 'file-open'] });
}
