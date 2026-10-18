// The home screen's backdrops (capital, woods, fleet) once each has settled, the menu window hidden so the scene shows
// whole. Rewritten from Art Lane's sceneshot.mjs; on mac1 its machine flags draw on Metal.
import type { Scene } from "../drivers/browser";

const SCENES = ["capital", "woods", "fleet"];

export default async function (s: Scene) {
  for (const id of SCENES) {
    await s.page.evaluate(`localStorage.setItem("sketch-rts-menu-scene", ${JSON.stringify(id)})`);
    await s.page.reload({ waitUntil: "load" });
    await s.page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 180_000 });
    // The page's own word that its first screen is up and no art is loading (see @@@debug-hooks).
    await s.page.waitForFunction("!window.__sketchRtsDebug || !window.__sketchRtsDebug.ready || window.__sketchRtsDebug.ready()", null, { timeout: 180_000 });
    await s.page.addStyleTag({ content: ".menu-window,.main-menu .menu-window{opacity:0!important}" });
    // A home battle takes a few seconds to close; the capital's street fills over the same time.
    await s.wait(9000);
    await s.shot(`home-${id}`);
  }
}
