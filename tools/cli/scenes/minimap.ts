// The minimap and its frame (#453), as a game opens. Rewritten from Art Lane's minimap.mjs.
import type { Scene } from "../drivers/browser";

export default async function (s: Scene) {
  await s.room("templeSpring");
  await s.wait(2500);
  const box = await s.page.evaluate(() => { const frame = document.querySelector("[data-minimap-frame]")!.getBoundingClientRect(); return { x: frame.x, y: frame.y, width: frame.width, height: frame.height }; }) as { x: number; y: number; width: number; height: number };
  await s.shot("minimap", { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 });
}
