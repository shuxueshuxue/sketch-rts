import { pathToFileURL } from 'node:url';
import type { Scene } from '../drivers/browser';

/** Actual game/replay UI, artificial GoalPlan input. Never evidence of real planner behavior. */
export default async function(s: Scene) {
  const load=(path:string)=>import(pathToFileURL(`${process.cwd()}/${path}`).href);
  const {goalDependencyFixture}=await load('src/client/ai-goal-plan.test-fixture.ts');
  const {createRoomLifecycleHost}=await load('src/shared/room-lifecycle.ts');
  const {createSaveGameRecord}=await load('src/shared/savegame.ts');
  const {createDebugReplayTrace}=await load('src/shared/replay.ts');
  const {diffAiPlan}=await load('src/ai/plan-stream.ts');
  const fixture=goalDependencyFixture(),lifecycle=createRoomLifecycleHost();
  lifecycle.createRoom({id:'goal-contract',host:{id:'host',name:'Contract sample'},mapId:'bareDuel'});
  const {room}=lifecycle.startRoom('goal-contract');
  const replay=createDebugReplayTrace({id:'goal-contract',label:'人工 GoalPlan 契约样例 · 非真实 AI 决策',
    initialSave:createSaveGameRecord(fixture.game,room,{id:'goal-contract'})});
  replay.throughTick=120;
  const next={...fixture.trace,tick:65,goalPlanner:{...fixture.output,plans:[{...fixture.plan,observedTick:65}]}};
  replay.aiPlans={throughTick:120,packets:[{type:'coverage',session:1,from:50,to:80},
    diffAiPlan(undefined,fixture.trace,1),diffAiPlan(fixture.trace,next,1)]};
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
  await seek(50);await s.page.waitForSelector('.plan-dependency-sheet');
  await s.page.evaluate(()=>{
    const watermark=document.createElement('div');watermark.textContent='人工契约样例 · 非真实 AI 决策';
    Object.assign(watermark.style,{position:'fixed',top:'72px',left:'28px',zIndex:'1400',color:'#934b36',
      background:'#f3eddf',padding:'4px 12px',font:'600 14px serif',pointerEvents:'none'});
    document.body.append(watermark);
  });
  await s.page.locator('.goal-graph-node.fact').first().click();await s.wait(300);
  const details=()=>s.page.locator('.plan-panel').innerText();
  s.must((await details()).includes('落选'),'No recorded rejected option');
  s.must(await s.page.locator('.plan-panel img').count()===0,'Unescaped alternative created an image');
  await s.page.locator('.plan-panel h4').filter({hasText:'满足它的候选方案'}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await s.shot('goal-contract-alternatives');
  await s.page.locator('.goal-graph-node.action').first().click();await s.wait(300);
  s.must((await details()).includes('未记录执行回执'),'A different generation was displayed as execution');
  s.must((await details()).includes('0 名正式分配'),'A planned action invented a grant');
  await s.page.locator('.plan-panel h4').filter({hasText:'正式执行记录'}).evaluate(node=>node.scrollIntoView({block:'start'}));
  await s.shot('goal-contract-execution');
  await s.page.locator('.goal-graph-node.fact').filter({hasText:'可达路线'}).click();await s.wait(300);
  s.must((await details()).includes('route-request'),'Missing pending request');
  await seek(65);s.must(await s.page.locator('.plan-dependency-sheet').count()===1,'Incremental goal graph disappeared');
  await seek(95);s.must(await s.page.locator('.plan-dependency-sheet').count()===0,'Graph leaked across an unrecorded gap');
  s.record('goal-plan-contract',{evidence:'artificial-contract-only',gpu,packets:replay.aiPlans.packets.length,
    checked:['recorded-edges','rejected-alternatives','pending-request','generation-binding','incremental-replay','unrecorded-gap']});
}
