import { describe, expect, it } from "vitest";
import { tickedAbilityCooldowns } from "./ability-cooldowns";
import type { Unit } from "./types";

describe("ability cooldown countdown", () => {
  it("returns a new table in key order while leaving a shared input unchanged", () => {
    const cooldowns = Object.freeze({ bloodlust: 4, heal: 1, curse: 8 });
    const left = tickedAbilityCooldowns(cooldowns)!;
    expect(left).toEqual({ bloodlust: 3, curse: 7 });
    expect(Object.keys(left)).toEqual(["bloodlust", "curse"]);
    expect(left).not.toBe(cooldowns);
    left.bloodlust = 99;
    expect(cooldowns).toEqual({ bloodlust: 4, heal: 1, curse: 8 });
  });

  it("releases absent and fully expired tables and preserves numeric countdown behavior", () => {
    expect(tickedAbilityCooldowns(undefined)).toBeUndefined();
    expect(tickedAbilityCooldowns({})).toBeUndefined();
    expect(tickedAbilityCooldowns({ heal: 1, curse: 0, summon: -1, bloodlust: NaN })).toBeUndefined();
    const fractional = { heal: 1.5, curse: Infinity };
    Object.defineProperty(fractional, "summon", { value: undefined, enumerable: true });
    expect(tickedAbilityCooldowns(fractional)).toEqual({ heal: .5, curse: Infinity });
  });

  it("counts only own enumerable string keys", () => {
    const cooldowns = Object.create({ heal: 99 }) as NonNullable<Unit["abilityCooldowns"]>;
    cooldowns.bloodlust = 4;
    Object.defineProperty(cooldowns, "curse", { value: 8, enumerable: false });
    Object.defineProperty(cooldowns, Symbol("cooldown"), { value: 12, enumerable: true });
    expect(tickedAbilityCooldowns(cooldowns)).toEqual({ bloodlust: 3 });
    expect(cooldowns.heal).toBe(99);
    expect(cooldowns.curse).toBe(8);
  });

  it("keeps a prototype-named enumerable key as data on an ordinary result object", () => {
    const cooldowns = Object.fromEntries([["bloodlust", 4], ["__proto__", 6], ["heal", 3]]) as NonNullable<Unit["abilityCooldowns"]>;
    const left = tickedAbilityCooldowns(cooldowns)!;
    expect(Object.getPrototypeOf(left)).toBe(Object.prototype);
    expect(Object.keys(left)).toEqual(["bloodlust", "__proto__", "heal"]);
    expect(Object.getOwnPropertyDescriptor(left, "__proto__")).toEqual({ value: 5, writable: true, enumerable: true, configurable: true });
    expect(Object.getOwnPropertyDescriptor(cooldowns, "__proto__")?.value).toBe(6);
  });
});
