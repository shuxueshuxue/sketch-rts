import { pathToFileURL } from 'node:url';
import type { Scene } from '../drivers/browser';

/** Actual game/replay UI, artificial GoalPlan input. Never evidence of real planner behavior. */
export default async function(s: Scene) {
  const {proveGoalTimeAlignment}=await import(pathToFileURL(`${process.cwd()}/tools/cli/drivers/goal-plan-proof.ts`).href);
  const load=(path:string)=>import(pathToFileURL(`${process.cwd()}/${path}`).href);
  const {goalNavyFixture}=await load('src/client/ai-goal-navy.test-fixture.ts');
  const {createRoomLifecycleHost}=await load('src/shared/room-lifecycle.ts');
  const {createSaveGameRecord}=await load('src/shared/savegame.ts');
  const {createDebugReplayTrace}=await load('src/shared/replay.ts');
  const {diffAiPlan}=await load('src/ai/plan-stream.ts');
  const fixture=goalNavyFixture(),lifecycle=createRoomLifecycleHost();
  lifecycle.createRoom({id:'goal-contract',host:{id:'host',name:'Contract sample'},mapId:'twoShores',humanCount:1,aiCount:3});
  const {room}=lifecycle.startRoom('goal-contract');
  const replay=createDebugReplayTrace({id:'goal-contract',label:'人工 GoalPlan 契约样例 · 非真实 AI 决策',
    initialSave:createSaveGameRecord(fixture.game,room,{id:'goal-contract'})});
  replay.throughTick=4200;
  const next=goalNavyFixture(2100).trace,last=goalNavyFixture(3600).trace;
  replay.aiPlans={throughTick:4200,packets:[{type:'coverage',session:1,from:50,to:3700},
    diffAiPlan(undefined,fixture.trace,1),diffAiPlan(fixture.trace,next,1),diffAiPlan(next,last,1)]};
  const gpu=await s.page.evaluate(()=>{
    const gl=document.createElement('canvas').getContext('webgl2')!;
    const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  });
  s.must(!/SwiftShader|llvmpipe/i.test(gpu),`Software GPU: ${gpu}`);
  await s.page.goto(new URL('?debug=1',s.page.url()).href,{waitUntil:'load'});
  await s.page.waitForSelector('[data-open-plan-replay]',{timeout:180000});
  const choosing=s.page.waitForEvent('filechooser');await s.page.click('[data-open-plan-replay]');
  await(await choosing).setFiles({name:'goal-contract.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replay))});
  await s.page.waitForSelector('.ai-plan-toggle:not([hidden])',{timeout:180000});
  await s.page.click('.ai-plan-toggle');await s.page.waitForSelector('[data-plan-seek]');
  const seek=async(tick:number)=>{
    await s.page.locator('[data-plan-seek]').evaluate((input:HTMLInputElement,value:number)=>{
      input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
    },tick);
    await s.page.waitForFunction((value:number)=>(window as any).__sketchRtsView?.tick===value,tick);
    await s.wait(500);
  };
  const drags: { requested: number; actual: number }[] = [];
  const dragTo = async(requested: number) => {
    const slider = s.page.locator('[data-plan-seek]'), box = await slider.boundingBox();
    s.must(box, 'Replay slider has no box');
    const from = Number(await slider.getAttribute('min')), through = Number(await slider.getAttribute('max'));
    const current = Number(await slider.inputValue()), y = box.y + box.height / 2;
    const x = (tick: number) => box.x + 8 + (box.width - 16) * (tick - from) / (through - from);
    await s.page.mouse.move(x(current), y); await s.page.mouse.down();
    await s.page.mouse.move(x(requested), y, { steps: 12 }); await s.page.mouse.up();
    const actual = Number(await slider.inputValue());
    await s.page.waitForFunction((tick:number)=>(window as any).__sketchRtsView?.tick===tick, actual);
    await s.wait(500); drags.push({ requested, actual });
    return actual;
  };
  await seek(50);await s.page.waitForSelector('.plan-dependency-sheet');
  await s.page.evaluate(()=>{
    const watermark=document.createElement('div');watermark.textContent='人工契约样例 · 非真实 AI 决策';
    Object.assign(watermark.style,{position:'fixed',top:'72px',left:'28px',zIndex:'1400',color:'#934b36',
      background:'#f3eddf',padding:'4px 12px',font:'600 14px serif',pointerEvents:'none'});
    document.body.append(watermark);
  });
  s.must(await s.page.locator('.goal-gantt-action').count()===7,'Missing branched navy dependencies');
  s.must(await s.page.locator('[data-executor-lane]').count()===4,'Missing executor lanes');
  s.must(await s.page.locator('.goal-graph-node.fact').count()===0,'Condition boxes leaked into the time view');
  const alignment=await proveGoalTimeAlignment(s);
  await s.shot('goal-contract-overview');
  await s.page.locator('.goal-gantt-condition').filter({hasText:'兵力到岗'}).click();await s.wait(300);
  const details=()=>s.page.locator('.plan-panel').innerText();
  s.must((await details()).includes('落选'),'No rejected option');
  s.must((await details()).includes('近滩头有敌人'),'Missing human-readable rejected reason');
  await s.page.locator('.plan-panel h4').filter({hasText:'满足它的候选方案'}).evaluate((node:HTMLElement)=>node.scrollIntoView({block:'start'}));
  await s.shot('goal-contract-alternatives');
  await s.page.locator('.goal-gantt-action').filter({hasText:'建大厅'}).click();await s.wait(300);
  s.must((await details()).includes('额度 400 金'),'Missing protected hall budget');
  s.must(!(await details()).includes('sample-'),'Internal ID leaked into visible sidebar');
  await s.page.locator('.plan-panel h4').filter({hasText:'谁在执行'}).evaluate((node:HTMLElement)=>node.scrollIntoView({block:'start'}));
  await s.shot('goal-contract-execution');
  await s.page.locator('.goal-gantt-condition').filter({hasText:'等路线算完'}).click();await s.wait(300);
  s.must((await details()).includes('等路线算完'),'Missing pending explanation');
  s.must(!(await details()).includes('sample-sea-route'),'Request ID leaked into visible sidebar');
  const recordedTick = await dragTo(2160);
  s.must(recordedTick>=2100&&recordedTick<3000,'Pointer missed the incremental recorded interval');
  s.must(await s.page.locator('.plan-dependency-sheet').count()===1,'Incremental goal graph disappeared');
  s.must((await s.page.locator('.goal-resource-band').innerText()).includes('当前 480 金'),'Incremental cash did not update');
  await s.shot('goal-contract-progress');
  const completeTick=await dragTo(3650);
  s.must(completeTick>=3600&&completeTick<=3700,'Pointer missed the completed interval');
  s.must((await s.page.locator('.goal-resource-band').innerText()).includes('当前 140 金'),'Final cash did not update');
  await s.page.locator('.goal-gantt-goal').click();await s.wait(200);
  await s.shot('goal-contract-result');
  const gapTick = await dragTo(4000);
  s.must(gapTick>3700,'Pointer missed the unrecorded interval');
  s.must(await s.page.locator('.plan-dependency-sheet').count()===0,'Graph leaked across an unrecorded gap');
  await s.shot('goal-contract-unrecorded');
  s.record('goal-plan-contract',{evidence:'artificial-public-puzzle-3',gpu,alignment,packets:replay.aiPlans.packets.length,drags,
    checked:['branched-dependencies','executor-gantt-default','no-condition-boxes','no-same-lane-arrows','bar-start-and-finish-clock','shared-gold-clock','regression-toggle','zoom-and-scroll-alignment','gold-prefixes','hall-reservation','human-readable-labels','rejected-alternatives','pending-request','pointer-seek','incremental-replay','unrecorded-gap']});
}
