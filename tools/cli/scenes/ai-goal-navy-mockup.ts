import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Scene } from '../drivers/browser';

export default async function(s: Scene) {
  const {proveGoalTimeAlignment}=await import(pathToFileURL(`${process.cwd()}/tools/cli/drivers/goal-plan-proof.ts`).href);
  const sha = JSON.parse(process.argv[2]!).sha as string;
  const local = `${process.cwd()}/docs/ai/plan-viz/goal-navy.html`;
  // Incremental CLI copies may exclude docs. This separate source directory
  // contains the exact git-archived page; never patch the runtime cache.
  const file = existsSync(local) ? local : `/Users/mac1/work/sketch-cli/runs/camps-navy-preview-${sha.slice(0,8)}/goal-navy.html`;
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  const gpu = await s.page.evaluate(()=>{
    const gl=document.createElement('canvas').getContext('webgl2')!;
    const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  });
  s.must(!/SwiftShader|llvmpipe/i.test(gpu), `Software GPU: ${gpu}`);
  await s.page.goto(pathToFileURL(file).href,{waitUntil:'load'});
  await s.page.waitForSelector('.goal-gantt-action');
  s.must(await s.page.locator('.goal-gantt-action').count()===7,'Missing branched graph');
  s.must((await s.page.locator('.goal-resource-band').innerText()).includes('已预留 400 金'),'Missing reserve');
  s.must(await s.page.locator('[data-executor-lane]').count()===4,'Missing executor lanes');
  s.must(await s.page.locator('.goal-graph-node.fact').count()===0,'Condition boxes leaked into the time view');
  const alignment=await proveGoalTimeAlignment(s);
  await s.shot('goal-navy-layout');
  await s.page.locator('.goal-gantt-condition').filter({hasText:'兵力到岗'}).click();
  s.must((await s.page.locator('.plan-panel').innerText()).includes('近滩头有敌人'),'Missing rejected explanation');
  await s.page.locator('.plan-panel h4').filter({hasText:'满足它的候选方案'}).evaluate((node:HTMLElement)=>node.scrollIntoView({block:'start'}));
  await s.shot('goal-navy-options');
  await s.page.locator('[data-tick="3600"]').click();
  s.must((await s.page.locator('.goal-resource-band').innerText()).includes('当前 140 金'),'Final cash missing');
  await s.page.goto(pathToFileURL(file).href,{waitUntil:'load'});
  await s.page.waitForSelector('.goal-gantt-action');
  s.record('goal-navy-mockup',{evidence:'artificial-public-puzzle-3',gpu,file,sha256,alignment,
    checked:['file-open','executor-gantt-default','no-condition-boxes','bar-start-and-finish-clock','human-options','reserved-gold','recorded-result','reopen']});
}
