// The setup's map list with the pointer on the chosen map, alone, as a room's host and as its guest: the chosen row
// keeps the background it has without the pointer (it once went white). Rewritten from Art Lane's hovershot.mjs.
import type { Scene } from "../drivers/browser";

export default async function (s: Scene) {
  const backgrounds: Record<string, { resting: string; hovered: string }> = {};
  const hover = async (page: typeof s.page, who: string) => {
    await page.waitForSelector(".room-setup .map-row.is-selected", { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const row = page.locator(".room-setup .map-row.is-selected");
    const background = () => row.evaluate((e: Element) => `${getComputedStyle(e).backgroundImage} | ${getComputedStyle(e).backgroundColor}`) as Promise<string>;
    await row.scrollIntoViewIfNeeded(); await page.mouse.move(2, 2); await page.waitForTimeout(500);
    const resting = await background();
    await row.hover({ force: true }); await page.waitForTimeout(500);
    const hovered = await background();
    backgrounds[who] = { resting, hovered };
    s.must(hovered === resting, `${who}: the chosen map row changes its background under the pointer:\n  resting ${resting}\n  hovered ${hovered}`);
    const box = (await page.locator(".room-setup .map-browser").boundingBox())!;
    await s.shot(`${who}-hover`, { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.width + 8, height: Math.min(box.height + 8, 420) }, page);
  };
  await s.home();
  await s.page.click("[data-open-create]");
  await hover(s.page, "solo");
  await s.home();
  await s.page.click("[data-open-room-browser]");
  await s.page.waitForSelector("[data-create-room]", { state: "visible", timeout: 60_000 });
  await s.page.click("[data-create-room]");
  await hover(s.page, "host");
  // The guest joins the host's room from a second browser, the host's page still open.
  const context = await s.page.context().browser().newContext({ viewport: s.page.viewportSize() ?? undefined });
  const guest = await context.newPage();
  await guest.goto(s.page.url(), { waitUntil: "load" });
  await hover(guest, "guest");
  await context.close();
  s.record("selected-map-hover", backgrounds);
}
