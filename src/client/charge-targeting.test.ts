import { describe, expect, it } from "vitest";
import { ABILITY_DEFS } from "../shared/catalog";
import type { Unit } from "../shared/types";
import { chargeRiderFor, chargeWindow, readyChargers } from "./charge-targeting";

const CHARGE = ABILITY_DEFS.charge;
if (CHARGE.behavior !== "charge") throw new Error("charge is not a charge");
const WINDOW = { minRange: CHARGE.minRange, range: CHARGE.range };
const MIDDLE = (WINDOW.minRange + WINDOW.range) / 2;

describe("charge targeting", () => {
  it("reads the charge window from the catalog and has none for spells", () => {
    expect(chargeWindow("charge")).toEqual(WINDOW);
    expect(chargeWindow("heal")).toBeUndefined();
    expect(chargeWindow("curse")).toBeUndefined();
  });

  it("offers only riders whose charge has cooled down", () => {
    const ready = rider("ready", 0);
    const cooling = { ...rider("cooling", 0), abilityCooldowns: { charge: 40 } };
    const footman = { ...rider("footman", 0), kind: "footman" as const };
    expect(readyChargers([ready, cooling, footman], "charge").map((unit) => unit.id)).toEqual(["ready"]);
  });

  it("lets the armed rider charge unless the target is too near it, else the nearest rider it is not too near, else nobody", () => {
    const target = { x: 0, y: 0 };
    const near = rider("near", WINDOW.minRange + 10);
    const far = rider("far", WINDOW.range - 10);
    const tooClose = rider("tooClose", WINDOW.minRange - 50);
    const beyond = rider("beyond", WINDOW.range + 50);

    expect(chargeRiderFor([far, near], target, WINDOW, "far")?.id).toBe("far");
    expect(chargeRiderFor([far, near], target, WINDOW, "tooClose")?.id).toBe("near");
    expect(chargeRiderFor([tooClose, far, near], target, WINDOW)?.id).toBe("near");
    // Beyond the window is no bar: that rider rides up first.
    expect(chargeRiderFor([tooClose, beyond], target, WINDOW, "tooClose")?.id).toBe("beyond");
    expect(chargeRiderFor([near, beyond], target, WINDOW, "beyond")?.id).toBe("beyond");
    expect(chargeRiderFor([tooClose], target, WINDOW, "tooClose")).toBeUndefined();
    expect(chargeRiderFor([rider("middle", MIDDLE)], target, WINDOW)?.id).toBe("middle");
  });
});

function rider(id: string, x: number): Unit {
  return {
    id,
    owner: "player",
    kind: "raider",
    x,
    y: 0,
    hp: 115,
    maxHp: 115,
    speed: 4,
    attackDamage: 14,
    attackRange: 48,
    attackCooldown: 20,
    cooldown: 0,
    radius: 18,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 0,
    effects: [],
    order: { type: "idle" },
  };
}
