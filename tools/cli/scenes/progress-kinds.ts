// Every kind of progress a card shows, in one room on the bare duel map: a unit training, a research, an ability and an
// item cooling down, a camp's wait to hire; then a building going up and a shop's good bought out. Two stages from the
// same seeds, as the start gold (the reset keeps the map's own, 500) pays for one. Rewritten from Art Lane's
// progshot.mjs.
import type { Scene } from "../drivers/browser";

type Shop = { id: string; x: number; y: number; radius: number };
type Snap = { map: { width: number; height: number }; players: Record<string, unknown>; shops: Shop[]; buildings: { id: string; kind: string; owner: string; x: number; y: number }[] };

export default async function (s: Scene) {
  await s.room("templeSpring");
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [] } });
  const duel = await s.snapshot() as Snap;
  const O = { x: Math.round(duel.map.width / 2), y: Math.round(duel.map.height / 2) }, at = (dx: number, dy: number) => ({ x: O.x + dx, y: O.y + dy });
  const hall = duel.buildings.find((b) => b.owner === "player" && b.kind === "townHall")!;
  // The map's shop nearest the scene: a reset takes no shop of its own.
  const shop = [...duel.shops].sort((a, b) => Math.hypot(a.x - O.x, a.y - O.y) - Math.hypot(b.x - O.x, b.y - O.y))[0];
  s.must(shop, "bareDuel has no shop");
  const P = { train: at(-260, -170), research: at(240, -170), camp: at(-50, -320), priest: at(-330, 170), site: at(0, 120) };
  const hurt = [[40, 0], [-40, 10], [10, 40], [0, -40], [50, 40]].map(([dx, dy], i) => ({ id: `pu-hurt-${i}`, owner: "player", kind: "footman", x: P.priest.x + dx!, y: P.priest.y + dy!, hpRatio: 0.25 }));
  const stage = async (building: boolean) => {
    await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: "bareDuel", options: { aiPlayers: [], races: { player: "grove" }, scenario: {
      replaceDefaultUnits: true, replaceDefaultMercenaryCamps: true,
      addBuildings: [
        { id: "pb-train", owner: "player", kind: "barracks", ...P.train, complete: true },
        { id: "pb-research", owner: "player", kind: "barracks", ...P.research, complete: true },
        ...[0, 1, 2].map((i) => ({ id: `pb-farm-${i}`, owner: "player", kind: "farm", x: hall.x + (i - 1) * 80, y: hall.y + 160, complete: true })),
      ],
      addUnits: [
        { id: "pu-priest", owner: "player", kind: "priest", ...P.priest }, ...hurt,
        { id: "pu-buyer", owner: "player", kind: "footman", x: shop!.x - shop!.radius - 30, y: shop!.y },
        { id: "pu-worker", owner: "player", kind: "worker", x: P.site.x - 80, y: P.site.y + 80 },
      ],
      addItems: [{ id: "pi-staff", kind: "stormStaff", x: P.priest.x, y: P.priest.y, carrierId: "pu-priest", slot: "carry0", cooldownRemaining: 0 }],
      addMercenaryCamps: [{ id: "pc", ...P.camp, radius: 50, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 6000, cooldownRemaining: 4000 }],
    } } });
    if (building) {
      await s.order("player", { type: "build", unitId: "pu-worker", buildingKind: "sanctum", ...P.site });
      await s.order("player", { type: "buy", shopId: shop!.id, item: "regenRing", recipientId: "pu-buyer" });
    } else {
      await s.order("player", { type: "research", buildingId: "pb-research", upgradeKind: "weaponTraining" });
      for (let i = 0; i < 3; i++) await s.order("player", { type: "train", buildingId: "pb-train", unitKind: "footman" });
    }
    await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: building ? 40 : 20 });
    await s.reload();
  };
  const look = async (id: string, x: number, y: number) => { await s.camera(x, y); await s.select([id]); await s.page.mouse.move(800, 60); await s.wait(600); };
  const deck = () => s.page.locator(".control-deck").boundingBox() as Promise<{ x: number; y: number; width: number; height: number }>;

  await stage(false);
  await look("pb-train", P.train.x, P.train.y);
  const badges = await s.page.evaluate(`[...document.querySelectorAll("[data-training-progress] .research-progress-text")].map(function (e) { return e.textContent; })`) as string[];
  s.must(badges.length > 0, "the barracks shows no training");
  s.must(badges.some((badge) => /\d+:\d\d|\d+s/.test(badge)) && !badges.some((badge) => badge.includes("%")), `the training badge should show a time, not a share: ${badges.join(" | ")}`);
  await s.shot("training");
  await s.page.locator("[data-training-progress]").first().hover({ force: true }); await s.wait(700);
  await s.shot("training-tooltip");
  await look("pb-research", P.research.x, P.research.y);
  s.must((await s.readDom("[data-research-progress]")).length > 0, "the second barracks shows no research");
  await s.shot("research");
  await s.order("player", { type: "useItem", unitId: "pu-priest", itemId: "pi-staff", x: P.priest.x + 220, y: P.priest.y - 60 });
  await s.tick(30);
  await look("pu-priest", P.priest.x, P.priest.y);
  const cooling = await s.readDom(".control-deck [data-cooldown-label]");
  s.must(cooling.length > 0, "nothing on the priest's card shows a cooldown after the staff was used");
  await s.shot("cooldowns", await deck());
  await look("pc", P.camp.x, P.camp.y);
  await s.shot("camp");

  await stage(true);
  const site = (await s.snapshot() as Snap).buildings.find((b) => b.kind === "sanctum");
  s.must(site, "the worker started no sanctum");
  await look(site!.id, site!.x, site!.y);
  await s.shot("construction");
  await look(shop!.id, shop!.x, shop!.y);
  await s.shot("shop");
  s.record("progress-kinds", { badges, cooling: cooling.map((c) => c.data.cooldownLabel) });
}
