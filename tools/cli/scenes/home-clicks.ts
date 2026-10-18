// Clicks on the home menu while the page loads, as a player makes them: press, hold a moment, release, on a button that
// is the thing under the pointer (the loading screen takes clicks by design). During each press the page draws its home
// again, as it does when the address's screen opens after loading. Each click must open the settings; the scene then goes
// back home and clicks again, until a few seconds after the page is ready (see @@@home-in-place).
import type { Scene } from "../drivers/browser";

export default async function (s: Scene) {
  const page = s.page;
  await page.reload({ waitUntil: "commit" });
  // Every settings button the page ever puts in the menu: one when the buttons are kept, more when they are rebuilt.
  await page.waitForFunction(() => document.querySelector("[data-open-profile]"), null, { timeout: 180_000, polling: 20 });
  await page.evaluate(`(() => {
    var seen = window.__homeButtons = new Set();
    var note = function () { var b = document.querySelector("[data-open-profile]"); if (b) seen.add(b); };
    note(); new MutationObserver(note).observe(document.body, { childList: true, subtree: true });
  })()`);
  const results: string[] = [];
  let readyAt: number | undefined;
  for (const started = Date.now(); Date.now() - started < 120_000;) {
    // Ready by the page's own word where it has one (the dev hook), else by its loading screen and status line.
    const ready = await page.evaluate(`(() => {
      var d = window.__sketchRtsDebug;
      if (d && typeof d.ready === "function") return d.ready();
      var status = document.querySelector("[data-menu-status]");
      return !document.querySelector(".resource-screen:not([hidden])") && !!status && status.textContent === "";
    })()`);
    if (ready && readyAt === undefined) readyAt = Date.now();
    if (readyAt !== undefined && Date.now() - readyAt > 4000 && results.length >= 6) break;
    // Where a player would press: the button's middle, when the button is what is there.
    const at = await page.evaluate(`(() => {
      var b = document.querySelector("[data-main-menu]:not(.hidden) [data-open-profile]");
      if (!b) return null;
      var r = b.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, top = document.elementFromPoint(x, y);
      return top && b.contains(top) ? { x: x, y: y } : null;
    })()`) as { x: number; y: number } | null;
    if (!at) { await s.wait(50); continue; }
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    // While the button is held, the page opens the address's screen again (as it does once the home's art is in), which
    // draws the home again: the moment a player's click was lost in.
    await page.evaluate("window.dispatchEvent(new PopStateEvent('popstate'))");
    await s.wait(120);
    await page.mouse.up();
    const opened = await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.getAttribute("data-menu-view") === "profile", null, { timeout: 3000 }).then(() => true, () => false);
    results.push(opened ? "opened" : "lost");
    if (!opened) continue;
    await page.click("[data-back-home]");
    await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.getAttribute("data-menu-view") === "home", null, { timeout: 10_000 });
  }
  const buttons = await page.evaluate("window.__homeButtons.size") as number;
  await s.shot("home-after-clicks");
  s.must(results.length >= 6 && results.every((result) => result === "opened") && buttons === 1,
    `clicks during loading: ${results.join(",")}; settings buttons made: ${buttons}`);
}
