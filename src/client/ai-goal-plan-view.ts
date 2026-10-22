/** Shared by the game overlay and the standalone preview. No observation work. */
export function fitGoalPlanView(sheet: HTMLElement, preferredZoom?: number): void {
  const view = sheet.querySelector<HTMLElement>('.goal-graph-viewport');
  const stage = sheet.querySelector<HTMLElement>('.goal-graph-stage');
  const canvas = sheet.querySelector<HTMLElement>('.goal-graph-canvas');
  if (!view || !stage || !canvas) return;
  const width = Number(stage.dataset.width), height = Number(stage.dataset.height);
  const zoom = preferredZoom ?? Math.max(.3, Math.min(1, (view.clientWidth-4)/width, (view.clientHeight-4)/height));
  stage.style.width = `${width*zoom}px`; stage.style.height = `${height*zoom}px`; stage.dataset.zoom = String(zoom);
  canvas.style.transform = `scale(${zoom})`;
  const money = sheet.querySelector<HTMLElement>('.goal-money-scroll.time-aligned');
  const chart = money?.querySelector<HTMLElement>('.goal-money-chart');
  if (money && chart) {
    chart.style.width = `${width*zoom}px`; money.style.width = `${view.clientWidth}px`;
    money.scrollLeft = view.scrollLeft;
    view.onscroll = () => { money.scrollLeft = view.scrollLeft; };
  }
}
