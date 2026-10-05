import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./time");
  vi.resetModules();
});

describe("simulation rates defined per second", () => {
  it.each([10, 20, 40])("preserves walking, aiming, projectile flight and shoves at %i Hz", async (frequency) => {
    vi.resetModules();
    vi.doMock("./time", () => ({
      SIM_TICKS_PER_SECOND: frequency,
      seconds: (duration: number) => Math.max(1, Math.round(duration * frequency)),
      perTick: (rate: number) => rate / frequency,
    }));
    const { createGame, stepGame } = await import("./sim");
    const { UNIT_DEFS } = await import("./catalog");
    const { aimingProfile } = await import("./aiming");
    const { shove } = await import("./push");
    const game = createGame("bareDuel", { players: ["p1", "p2"], aiPlayers: [], scenario: {
      replaceDefaultUnits: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true,
      addUnits: [
        { id: "walker", owner: "p1", kind: "footman", x: 500, y: 500, order: { type: "move", x: 1500, y: 500 } },
        { id: "shooter", owner: "p1", kind: "archer", x: 1000, y: 1000, order: { type: "attack", targetId: "foe" } },
        { id: "foe", owner: "p2", kind: "knight", x: 1288, y: 1000, order: { type: "hold", x: 1288, y: 1000 } },
        { id: "pushed", owner: "p1", kind: "footman", x: 500, y: 1500, order: { type: "hold", x: 500, y: 1500 } },
      ],
    } });
    game.scriptedVictory = true;
    const [walker, shooter, foe, pushed] = game.units;
    foe!.cooldown = 99999;
    shove(pushed!, 1, 0, 100);
    expect(UNIT_DEFS.footman.speed).toBe(62);
    expect(aimingProfile(UNIT_DEFS.archer)!.speed).toBe(320);
    expect(shooter!.attackCooldown / frequency).toBe(1.5);
    for (let tick = 1; tick <= frequency; tick++) {
      stepGame(game);
      if (tick === frequency / 2) {
        expect(walker!.x).toBeCloseTo(531);
        expect(shooter!.aim!.x).toBeCloseTo(1160);
        expect(game.projectiles).toHaveLength(0);
      }
      if (tick === Math.ceil(0.9 * frequency)) {
        expect(game.projectiles).toHaveLength(1);
        expect(game.projectiles[0]!.duration).toBe(Math.ceil(0.8 * frequency));
      }
    }
    expect(walker!.x).toBeCloseTo(562);
    expect(shooter!.x).toBe(1000);
    expect(pushed!.x).toBeCloseTo(600);
    expect(pushed!.pushX).toBeUndefined();
  });
});
