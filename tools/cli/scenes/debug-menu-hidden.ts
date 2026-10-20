// The home menu a player sees has no developer entries; `?debug=1` shows "open debug recording", and `?debug=0` hides it
// again in the same tab (see debugToolsEnabled). Collects every check and fails with all of them.
import type { Scene } from "../drivers/browser";

async function homeWith(s: Scene, query: string) {
  const url = new URL(s.page.url());
  url.search = query;
  await s.page.goto(url.toString(), { waitUntil: "load" });
  await s.page.waitForSelector("[data-main-menu]:not(.hidden) [data-open-profile]", { timeout: 180_000 });
  return await s.page.evaluate("!!document.querySelector('[data-open-plan-replay]')") as boolean;
}

export default async function (s: Scene) {
  const failures: string[] = [];
  if (await homeWith(s, "")) failures.push("player home shows the debug recording entry");
  await s.shot("home-player");
  if (!await homeWith(s, "?debug=1")) failures.push("?debug=1 home lacks the debug recording entry");
  await s.shot("home-debug");
  if (await homeWith(s, "?debug=0")) failures.push("?debug=0 home still shows the debug recording entry");
  if (failures.length) throw new Error(failures.join("; "));
}
