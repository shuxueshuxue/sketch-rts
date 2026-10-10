import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardUnit, syncDecks } from "../shared/decks";
import { createGame, snapshotGame } from "../shared/sim";
import { pointerTarget, targetCommand, unitAt, unitPointerPosition } from "./relations";
import { HOVER_CURSOR_ART, HOVER_CURSOR_HOTSPOT, HOVER_CURSOR_SIZE, unitHoverCursor, unitHoverCursorUrl } from "./unit-hover-cursor";

function fixture() {
  const game = createGame("verdantCrossroads", {
    players: ["player", "enemy", "enemy2"], aiPlayers: [],
    teams: { player: "north", enemy: "north", enemy2: "south" },
  });
  const own = game.spawnUnit("player", "footman", 600, 600);
  const ally = game.spawnUnit("enemy", "footman", 800, 600);
  const foe = game.spawnUnit("enemy2", "footman", 1000, 600);
  return { game, own, ally, foe };
}

describe("unit hover cursors", () => {
  it("uses the viewer and current teams, with distinct shapes as well as colors", () => {
    const { game, own, ally, foe } = fixture();
    const snapshot = snapshotGame(game);
    expect(unitHoverCursor(snapshot, "player", own.id).relation).toBe("own");
    expect(unitHoverCursor(snapshot, "player", ally.id).relation).toBe("ally");
    expect(unitHoverCursor(snapshot, "player", foe.id).relation).toBe("enemy");
    expect(unitHoverCursor(snapshot, "enemy2", foe.id).relation).toBe("own");
    expect(unitHoverCursor(snapshot, "enemy2", own.id).relation).toBe("enemy");
    expect(new Set([HOVER_CURSOR_ART.own.color, HOVER_CURSOR_ART.ally.color, HOVER_CURSOR_ART.enemy.color]).size).toBe(3);
    expect(new Set([HOVER_CURSOR_ART.own.shape, HOVER_CURSOR_ART.ally.shape, HOVER_CURSOR_ART.enemy.shape]).size).toBe(3);
    game.teams!.enemy2 = "north";
    expect(unitHoverCursor(snapshotGame(game), "player", foe.id).relation).toBe("ally");
  });

  it("resolves 2D body picks, raised deck crew and buildings through the same ID contract as 3D", () => {
    const { game, own, ally } = fixture();
    const picked = unitAt(game.units, ally, () => true)!;
    expect(unitHoverCursor(snapshotGame(game), "player", picked.id).relation).toBe("ally");
    const hall = game.buildings.find(building => building.owner === "enemy2")!;
    expect(unitHoverCursor(snapshotGame(game), "player", hall.id).relation).toBe("enemy");

    game.units = [];
    delete game.map.terrain;
    const ship = game.spawnUnit("enemy2", "warship", 900, 900);
    const crew = game.spawnUnit("player", "priest", 900, 900);
    expect(boardUnit(ship, crew, game.units)).toBe(true);
    syncDecks(game.units);
    const target = pointerTarget(snapshotGame(game), unitPointerPosition(game.units, crew));
    expect(target).toMatchObject({ kind: "unit", unit: { id: crew.id } });
    expect(unitHoverCursor(snapshotGame(game), "player", target?.kind === "unit" ? target.unit.id : undefined).relation).toBe("own");
    expect(unitHoverCursor(snapshotGame(game), "player", ship.id).relation).toBe("enemy");
    expect(unitHoverCursor(snapshotGame(game), "player", own.id)).toEqual({ nativeCursor: "default" });
  });

  it("removes stale ownership and dead or sheltered targets immediately", () => {
    const { game, foe } = fixture();
    expect(unitHoverCursor(snapshotGame(game), "player", foe.id).relation).toBe("enemy");
    foe.owner = "player";
    expect(unitHoverCursor(snapshotGame(game), "player", foe.id).relation).toBe("own");
    foe.deck = { shipId: "ship", x: 0, y: 0 };
    foe.cabin = { shipId: "ship" };
    expect(unitHoverCursor(snapshotGame(game), "player", foe.id)).toEqual({ nativeCursor: "default" });
    delete foe.cabin;
    delete foe.deck;
    foe.hp = 0;
    expect(unitHoverCursor(snapshotGame(game), "player", foe.id)).toEqual({ nativeCursor: "default" });
    game.units = game.units.filter(unit => unit.id !== foe.id);
    expect(unitHoverCursor(snapshotGame(game), "player", foe.id)).toEqual({ nativeCursor: "default" });
    const hall = game.buildings[0]!;
    hall.hp = 0;
    expect(unitHoverCursor(snapshotGame(game), "player", hall.id)).toEqual({ nativeCursor: "default" });
  });

  it("keeps blank ground and spectators ordinary and neutral sites inspectable", () => {
    const { game, foe } = fixture();
    const snapshot = snapshotGame(game);
    expect(unitHoverCursor(snapshot, "player", undefined)).toEqual({ nativeCursor: "default" });
    expect(unitHoverCursor(snapshot, undefined, foe.id)).toEqual({ nativeCursor: "default" });
    expect(unitHoverCursor(snapshot, "spectator", foe.id)).toEqual({ nativeCursor: "default" });
    expect(unitHoverCursor(undefined, "player", foe.id)).toEqual({ nativeCursor: "default" });
    const neutral = game.spawnUnit("neutral", "footman", 1200, 600);
    expect(unitHoverCursor(snapshotGame(game), "player", neutral.id).relation).toBe("creep");
    const camp = snapshot.mercenaryCamps[0]!;
    expect(unitHoverCursor(snapshot, "player", camp.id).relation).toBe("creep");
    game.shops = [{ id: "shop", x: 1200, y: 1000, radius: 48, goods: [] }];
    expect(unitHoverCursor(snapshotGame(game), "player", "shop").relation).toBe("creep");
  });

  it.each([
    ["placement", "copy"], ["targeting", "crosshair"], ["unavailable", "not-allowed"],
  ] as const)("preserves %s priority over every relationship", (mode, cursor) => {
    const { game, own, ally, foe } = fixture();
    const snapshot = snapshotGame(game);
    for (const unit of [own, ally, foe]) {
      expect(unitHoverCursor(snapshot, "player", unit.id, { mode })).toEqual({ nativeCursor: cursor });
      expect(unitHoverCursor(snapshot, "player", unit.id, { mode, pointerLocked: true })).toEqual({ nativeCursor: "none" });
    }
  });

  it("offers enemy inspection even when the selected land unit cannot attack a hull", () => {
    const { game, own } = fixture();
    const ship = game.spawnUnit("enemy2", "warship", 1000, 1000);
    const snapshot = snapshotGame(game);
    expect(targetCommand(snapshot, "player", [own], { kind: "unit", unit: ship })).toBeUndefined();
    const cursor = unitHoverCursor(snapshot, "player", ship.id);
    expect(cursor.relation).toBe("enemy");
    expect(cursor.nativeCursor).toContain("enemy.svg");
    expect(cursor.nativeCursor).not.toContain("crosshair");
  });

  it("keeps the native cursor hidden under pointer lock while returning the same visual and hotspot", () => {
    const { game, foe } = fixture();
    const cursor = unitHoverCursor(snapshotGame(game), "player", foe.id, { pointerLocked: true, basePath: "/rts/" });
    expect(cursor).toEqual({ nativeCursor: "none", relation: "enemy", iconUrl: "/rts/art/cursors/enemy.svg", hotspot: [4, 3] });
    expect(unitHoverCursor(snapshotGame(game), "player", undefined, { pointerLocked: true })).toEqual({ nativeCursor: "none" });
  });

  it("serves each small SVG below the deployment base with the drawn tip at the native hotspot", () => {
    for (const relation of ["own", "ally", "enemy", "creep"] as const) {
      expect(unitHoverCursorUrl(relation, "rts")).toBe(`/rts/art/cursors/${HOVER_CURSOR_ART[relation].file}`);
      const svg = readFileSync(new URL(`../../public/art/cursors/${HOVER_CURSOR_ART[relation].file}`, import.meta.url), "utf8");
      expect(svg).toContain(`width="${HOVER_CURSOR_SIZE}" height="${HOVER_CURSOR_SIZE}" viewBox="0 0 32 32"`);
      expect(svg).toContain(`M${HOVER_CURSOR_HOTSPOT[0]} ${HOVER_CURSOR_HOTSPOT[1]}`);
      expect(svg).toContain(HOVER_CURSOR_ART[relation].color);
      expect(svg).not.toMatch(/<script|<image|href=|foreignObject/);
    }
    const { game, ally } = fixture();
    expect(unitHoverCursor(snapshotGame(game), "player", ally.id, { basePath: "/rts" }).nativeCursor)
      .toBe('url("/rts/art/cursors/ally.svg") 4 3, default');
  });
});
