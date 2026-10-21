import type { Scene } from './browser';

/** Measure rendered pixels, including scale and scroll; pure x arithmetic is insufficient. */
export async function proveGoalTimeAlignment(s: Scene) {
  const measure = (): Promise<{order:string|undefined;rows:{tick:number;edge:string;nodeX:number;goldX:number;error:number}[]}> => s.page.evaluate(() => {
    const sheet=document.querySelector<HTMLElement>('.plan-dependency-sheet')!;
    return {order:sheet.dataset.graphOrder,rows:[{tick:200,edge:'start'},{tick:500,edge:'start'},{tick:3000,edge:'start'},{tick:2000,edge:'finish'},{tick:2400,edge:'finish'}].map(({tick,edge})=>{
      const card=sheet.querySelector<HTMLElement>(`.goal-gantt-action[data-plan-${edge==='start'?'time':'finish'}="${tick}"]`)!.getBoundingClientRect();
      const dot=sheet.querySelector<SVGCircleElement>(`[data-gold-tick="${tick}"]`)!.getBoundingClientRect();
      const nodeX=edge==='start'?card.x:card.x+card.width;
      return {tick,edge,nodeX,goldX:dot.x+dot.width/2,error:Math.abs(nodeX-dot.x-dot.width/2)};
    })};
  });
  const fitted=await measure();
  s.must(fitted.order==='time','Execution-time view is not the default');
  s.must(fitted.rows.every(row=>row.error<1),`Fitted time alignment: ${JSON.stringify(fitted)}`);
  await s.page.click('[data-action="goal-regression"]');await s.wait(150);
  s.must(await s.page.locator('[data-graph-order="regression"]').count()===1,'Missing backwards-goal view');
  await s.page.click('[data-action="goal-time"]');await s.wait(150);
  const switched=await measure();
  s.must(switched.rows.every(row=>row.error<1),'Clock alignment lost on view switch');
  for(let i=0;i<4;i++){await s.page.click('[data-action="goal-zoom-in"]');await s.wait(100);}
  const scrolled=await s.page.locator('.goal-graph-viewport').evaluate((view:HTMLElement)=>{
    view.scrollLeft=190;return view.scrollLeft;
  });
  await s.wait(150);
  s.must(scrolled>0,'Zoom did not exercise horizontal scrolling');
  const zoomed=await measure();
  s.must(zoomed.rows.every(row=>row.error<1),`Scrolled time alignment: ${JSON.stringify(zoomed)}`);
  await s.page.click('[data-action="goal-fit"]');await s.wait(150);
  return {fitted,switched,zoomed,scrolled};
}
