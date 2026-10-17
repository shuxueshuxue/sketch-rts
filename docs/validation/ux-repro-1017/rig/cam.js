// Click the canvas once (pointer-lock arm), then jump the camera to world (WX,WY) through the minimap.
export default async (page, { sleep, shot }) => {
  const wx = Number(process.env.WX), wy = Number(process.env.WY);
  const info = await page.evaluate(() => {
    const frame = document.querySelector("[data-minimap-frame]"); const canvas = document.querySelector(".game-canvas");
    const m = new DOMMatrixReadOnly(getComputedStyle(frame).transform); const b = canvas.getBoundingClientRect();
    return { x: b.x + m.m41, y: b.y + m.m42, w: parseFloat(frame.style.width), h: parseFloat(frame.style.height), locked: !!document.pointerLockElement };
  });
  const size = Number(process.env.SIZE ?? 6656);
  await page.mouse.click(info.x + info.w * wx / size, info.y + info.h * wy / size);
  await sleep(600);
  await shot(process.env.NAME ?? "cam");
  return { ...info, lockedAfter: await page.evaluate(() => !!document.pointerLockElement), status: await page.evaluate(() => document.querySelector("[data-status]")?.textContent) };
};
