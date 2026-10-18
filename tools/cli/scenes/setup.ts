// The match setup screen (#459, layout C): a solo game's, then a room's host's, through the real menu. Rewritten from Art
// Lane's setupshot.mjs; shoot it in Chinese with `--locale zh-CN` on a machine with CJK fonts (mac1).
import type { Scene } from "../drivers/browser";

export default async function (s: Scene) {
  await s.page.click("[data-open-create]");
  await s.page.waitForSelector("[data-room-setup] [data-map-entries] [data-map-id]", { timeout: 60_000 });
  // The map pictures fill in when the page is idle (see @@@map-thumbnails).
  await s.page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("[data-map-entries] img")].every((img) => img.src), null, { timeout: 60_000 });
  await s.shot("solo");
  await s.page.click("[data-back-home]");
  await s.page.waitForSelector("[data-main-menu]:not(.hidden) [data-open-room-browser]", { timeout: 60_000 });
  await s.page.click("[data-open-room-browser]");
  await s.page.waitForSelector("[data-create-room]", { state: "visible", timeout: 60_000 });
  await s.page.click("[data-create-room]");
  await s.page.waitForFunction(() => {
    const id = document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup");
    return id && new URLSearchParams(location.search).get("room") === id && document.querySelector("[data-start-room]");
  }, null, { timeout: 60_000 });
  await s.page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("[data-map-entries] img")].every((img) => img.src), null, { timeout: 60_000 });
  await s.shot("host");
}
