import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame } from "./sim";
import { createShop } from "./shop";
import { commandValidationError } from "./sim/command-validation";
import { shipHoldSlots, ITEM_DEFS } from "./equipment";
import { shipProfile } from "./ship-geometry";
import { bodyMass } from "./physical-body";
import { purchasePlacement, findPurchaseRecipient } from "./purchase";
import type { GameCommand } from "./types";
function fixture() {
  const game = createGame("bareDuel", { players: ["player", "enemy"] });
  game.units = [];
  game.items = [];
  game.buildings = [];
  game.players.player!.gold = 3000;
  const shop = createShop("shop", 600, 600);
  game.shops = [shop];
  const dock = { ...createGame("bareDuel").buildings[0]!, id: "dock", kind: "shipyard" as const, owner: "player", x: 600, y: 600, radius: 44, complete: true };
  game.buildings = [dock];
  const worker = game.spawnUnit("player", "worker", 600, 690), ship = game.spawnUnit("player", "transport", 720, 600);
  return { game, shop, dock, worker, ship };
}
describe("explicit purchase recipients", () => {
  it("delivers to the chosen character rather than a nearer one, with a recipient effect", () => {
    const { game, shop, worker } = fixture();
    game.spawnUnit("player", "footman", 600, 650);
    issuePlayerCommand(game, "player", { type: "buy", shopId: shop.id, item: "speedBoots", recipientId: worker.id });
    expect(game.items.find(item => item.kind === "speedBoots")).toMatchObject({ carrierId: worker.id, slot: "feet" });
    expect(game.effects.at(-1)).toMatchObject({ x: worker.x, y: worker.y, type: "itemReceived" });
  });
  it("delivers shop goods and a dock cannon into the hold without a porter", () => {
    const { game, shop, dock, ship } = fixture();
    issuePlayerCommand(game, "player", { type: "buy", shopId: shop.id, item: "healingScroll", recipientId: ship.id });
    issuePlayerCommand(game, "player", { type: "buyShipEquipment", buildingId: dock.id, item: "shipCannon", recipientId: ship.id });
    expect(game.items.find(item => item.kind === "healingScroll")).toMatchObject({ shipId: ship.id, holdSlot: 0 });
    expect(game.items.find(item => item.kind === "shipCannon")).toMatchObject({ shipId: ship.id, holdSlot: 1 });
    expect(game.items.every(item => !item.carrierId && !item.mountId)).toBe(true);
    expect(game.players.player!.gold).toBe(2680);
  });
  it("rejects far, foreign, dead and full recipients before charging or reducing stock", () => {
    const { game, shop, worker, ship } = fixture();
    const far = game.spawnUnit("player", "worker", 1200, 1200), enemy = game.spawnUnit("enemy", "worker", 600, 650), dead = game.spawnUnit("player", "worker", 600, 680);
    dead.hp = 0;
    for (const id of [far.id, enemy.id, dead.id]) {
      const command: GameCommand = { type: "buy", shopId: shop.id, item: "healingScroll", recipientId: id };
      expect(commandValidationError(snapshotGame(game), "player", command)).toBeTruthy();
      expect(() => issuePlayerCommand(game, "player", command)).toThrow();
    }
    for (let i = 0; i < 4; i++)
      game.items.push({ id: `book-${i}`, kind: "experienceBook", carrierId: worker.id, slot: `carry${i}` as "carry0", x: worker.x, y: worker.y, cooldownRemaining: 0 });
    for (let i = 0; i < shipHoldSlots(ship); i++)
      game.items.push({ id: `cargo-${i}`, kind: "experienceBook", shipId: ship.id, holdSlot: i, x: ship.x, y: ship.y, cooldownRemaining: 0 });
    for (const id of [worker.id, ship.id])
      expect(() => issuePlayerCommand(game, "player", { type: "buy", shopId: shop.id, item: "healingScroll", recipientId: id })).toThrow(/free position/);
    expect(game.players.player!.gold).toBe(3000);
    expect(shop.goods.find(good => good.kind === "healingScroll")!.stock).toBe(2);
    expect(game.items.some(item => item.kind === "healingScroll")).toBe(false);
  });
  it("checks contiguous heavy cargo space and crew weight independently", () => {
    const { game, dock, ship } = fixture();
    for (let i = 0; i < shipHoldSlots(ship); i += 3)
      game.items.push({ id: `cargo-${i}`, kind: "experienceBook", shipId: ship.id, holdSlot: i, x: ship.x, y: ship.y, cooldownRemaining: 0 });
    expect(purchasePlacement(game, "player", dock, "shipCannon", ship.id)).toEqual({ refusal: "The hold needs four consecutive free positions" });
    game.items = [];
    const profile = shipProfile(ship)!;
    const count = Math.ceil((profile.loadCapacity - ITEM_DEFS.shipCannon.mass) / bodyMass(game.spawnUnit("player", "footman", 0, 0)));
    for (let i = 0; i < count; i++)
      game.spawnUnit("player", "footman", ship.x, ship.y).deck = { shipId: ship.id, x: 0, y: 0 };
    expect(purchasePlacement(game, "player", dock, "shipCannon", ship.id)).toEqual({ refusal: "The ship cannot carry more weight" });
    expect(() => issuePlayerCommand(game, "player", { type: "buyShipEquipment", buildingId: dock.id, item: "shipCannon", recipientId: ship.id })).toThrow(/weight/);
    expect(game.players.player!.gold).toBe(3000);
  });
});

describe("purchase recipient resolution", () => {
  it("preserves a manual recipient and replaces out-of-range, dead or captured recipients", () => {
    const {game,shop,worker,ship}=fixture();
    expect(findPurchaseRecipient(game,"player",shop,worker.id)?.id).toBe(worker.id);
    worker.x=2000;
    expect(findPurchaseRecipient(game,"player",shop,worker.id)?.id).toBe(ship.id);
    worker.x=600;worker.hp=0;
    expect(findPurchaseRecipient(game,"player",shop,worker.id)?.id).toBe(ship.id);
    worker.hp=100;worker.owner="enemy";
    expect(findPurchaseRecipient(game,"player",shop,worker.id)?.id).toBe(ship.id);
    ship.x=2000;
    expect(findPurchaseRecipient(game,"player",shop,worker.id)).toBeUndefined();
  });
  it("prefers dockside ships but keeps a full explicitly chosen hold for clear purchase feedback", () => {
    const {game,dock,worker,ship}=fixture();
    expect(findPurchaseRecipient(game,"player",dock,undefined,true)?.id).toBe(ship.id);
    expect(findPurchaseRecipient(game,"player",dock,worker.id,true)?.id).toBe(worker.id);
    for(let i=0;i<shipHoldSlots(ship);i++)game.items.push({id:`full-${i}`,kind:"experienceBook",shipId:ship.id,holdSlot:i,x:ship.x,y:ship.y,cooldownRemaining:0});
    expect(findPurchaseRecipient(game,"player",dock,ship.id,true)?.id).toBe(ship.id);
    expect(purchasePlacement(game,"player",dock,"shipCannon",ship.id)).toHaveProperty("refusal");
  });
});
