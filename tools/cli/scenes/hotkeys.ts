// The match's keys as a player presses them, on the bare duel map with a priest carrying a staff, a barracks and a
// shipyard. Alt+1 uses the carried item and a bare 1 recalls the group; A and Shift+A start an attack-move; holding W
// leaves the view where it is (ArrowUp moves it, no key leaves it); the shipyard's keys are each its own, and U opens
// its buy card; the barracks focused beside a selected priest offers its own keys, no attack-move and no unload; F10 opens the
// menu. Rewritten from Art Lane's hkshot.mjs.
import type { Scene } from "../drivers/browser";

type Snap = { map: { width: number; height: number }; players: Record<string, unknown> };

export default async function (s: Scene) {
  await s.room("templeSpring");
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [] } });
  const duel = await s.snapshot() as Snap;
  // The middle of the map, away from its edges where the camera stops short of centring.
  const O = { x: Math.round(duel.map.width / 2), y: Math.round(duel.map.height / 2) };
  const P = { train: { x: O.x - 260, y: O.y - 170 }, yard: { x: O.x + 260, y: O.y - 170 }, priest: { x: O.x - 200, y: O.y + 160 } };
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [], races: { player: "grove" }, scenario: {
    replaceDefaultUnits: true,
    addBuildings: [{ id: "pb-train", owner: "player", kind: "barracks", ...P.train, complete: true }, { id: "pb-yard", owner: "player", kind: "shipyard", ...P.yard, complete: true }],
    addUnits: [{ id: "pu-priest", owner: "player", kind: "priest", ...P.priest }],
    addItems: [{ id: "pi-staff", kind: "stormStaff", x: P.priest.x, y: P.priest.y, carrierId: "pu-priest", slot: "carry0", cooldownRemaining: 0 }],
  } } });
  await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 10 });
  await s.reload();
  const page = s.page;
  const keys = () => page.evaluate(`[...document.querySelectorAll(".control-deck .command-button:not([hidden])")].map(function (b) { return b.dataset.hotkey; }).filter(Boolean)`) as Promise<string[]>;
  const targeting = () => page.evaluate(`document.querySelector(".targeting-active") !== null`) as Promise<boolean>;
  const subject = () => page.evaluate(`document.querySelector("[data-subject]:not([hidden])")?.dataset.subject`) as Promise<string | undefined>;
  const seen: Record<string, unknown> = {};

  await s.camera(P.priest.x, P.priest.y);
  await s.select(["pu-priest"]);
  seen.priest = await keys();
  await s.shot("priest");
  await s.key("Shift+1"); await s.key("Escape");
  await s.key("1");
  s.must(!await targeting(), "a bare 1 started the item's targeting instead of recalling the group");
  await s.key("Escape");
  await s.key("Alt+1");
  s.must(await targeting(), "Alt+1 did not use the carried item");
  await s.shot("alt-1");
  await s.key("Escape");
  await s.key("a");
  s.must(await targeting(), "A did not start an attack-move");
  await s.key("Escape");
  await s.key("Shift+A");
  s.must(await targeting(), "Shift+A did not start an attack-move");
  await s.key("Escape");

  // Whether a held key moves the view, seen on a patch of still ground (the minimap's frame is not the camera).
  await s.camera(O.x, O.y);
  const patch = () => page.screenshot({ clip: { x: 200, y: 120, width: 360, height: 200 } }) as Promise<Buffer>;
  const moves = async (key?: string) => {
    await page.mouse.move(800, 300); await s.wait(300);
    const before = await patch();
    if (key) await page.keyboard.down(key);
    await s.wait(900);
    if (key) await page.keyboard.up(key);
    await s.wait(300);
    return !before.equals(await patch());
  };
  s.must(!await moves(), "the view changed with no key held: the patch is not still, so the next two say nothing");
  s.must(await moves("ArrowUp"), "holding ArrowUp did not move the view");
  s.must(!await moves("w"), "holding W moved the view");

  await s.camera(P.yard.x, P.yard.y);
  await s.select(["pb-yard"]);
  const yard = await keys(); seen.shipyard = yard;
  s.must(new Set(yard).size === yard.length, `the shipyard's card repeats a key: ${yard.join(" ")}`);
  await s.shot("shipyard");
  await s.key("u");
  const buy = await keys(); seen.shipyardBuy = buy;
  s.must(["Q", "W", "E", "O", "Esc"].every((key) => buy.includes(key)), `U did not open the buy card (Q W E O Esc): ${buy.join(" ")}`);
  await s.shot("shipyard-buy");
  await s.key("Escape");

  await s.camera(P.train.x, P.train.y + 150);
  await s.select(["pb-train", "pu-priest"]);
  for (let i = 0; i < 3 && await subject() !== "pb-train"; i++) await s.key("Tab");
  const mixed = await keys(); seen.mixed = mixed;
  s.must(await subject() === "pb-train", `Tab did not focus the barracks: ${await subject()}`);
  s.must(["F", "L", "W", "P"].every((key) => mixed.includes(key)) && !mixed.includes("A") && !mixed.includes("D"), `the barracks beside a priest should offer F L W P, no attack-move (A) and no unload (D): ${mixed.join(" ")}`);
  await s.shot("mixed");
  await s.key("F10");
  s.must(await page.evaluate(`!document.querySelector("[data-match-menu]").classList.contains("hidden")`), "F10 did not open the match menu");
  await s.shot("f10");
  s.record("hotkeys", seen);
}
