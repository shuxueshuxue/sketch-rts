// Run ACTIONS (json list) then screenshot NAME. Actions: ["click",x,y] ["rclick",x,y] ["key",k] ["hover",x,y] ["wait",ms] ["sel",css] (click selector) ["hsel",css] (hover selector)
export default async (page, { sleep, shot }) => {
  for (const [a, x, y] of JSON.parse(process.env.ACTIONS ?? "[]")) {
    if (a === "click") await page.mouse.click(x, y);
    else if (a === "rclick") await page.mouse.click(x, y, { button: "right" });
    else if (a === "hover") await page.mouse.move(x, y);
    else if (a === "key") await page.keyboard.press(x);
    else if (a === "wait") await sleep(x);
    else if (a === "sel") await page.locator(x).first().click();
    else if (a === "hsel") await page.locator(x).first().hover();
    await sleep(250);
  }
  await sleep(400);
  if (process.env.NAME) await shot(process.env.NAME);
  return await page.evaluate(() => ({ status: document.querySelector("[data-status]")?.textContent, selected: window.__sketchRtsView.selectedIds,
    tooltip: document.querySelector("[data-command-tooltip], .command-tooltip:not([hidden])")?.innerText?.slice(0, 400) }));
};
