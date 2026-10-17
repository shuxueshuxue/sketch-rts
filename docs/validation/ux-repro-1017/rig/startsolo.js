// Start a server room (human "player" + AI) via the real menu, on MAP, with SCENARIO json file reset if given.
import { roomUiFlowCode } from "/Users/mac1/work/sketch-uxfix-1017/repo/scripts/room-ui-flow.mjs";
export default async (page, { base, must, sleep, api, shot }) => {
  const mapId = process.env.MAP ?? "bareDuel";
  const flow = new Function("page", "must", roomUiFlowCode + "; return { confirmedSoloSetup, serverSetupFromSolo, serverFixtureMap };")(page, must);
  await page.goto(base, { waitUntil: "load" });
  await page.locator("[data-open-create]").click();
  await flow.confirmedSoloSetup(process.env.POOL);
  const roomId = "solo";

  await page.locator("[data-start-room]").click();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 10000 });
  await sleep(1500);
  const gate = page.locator("[data-pointer-lock-gate-action]");
  if (await gate.isVisible()) { await gate.click(); await sleep(500); }
  await shot("start-" + mapId);
  return { roomId, view: await page.evaluate(() => window.__sketchRtsView) };
};
