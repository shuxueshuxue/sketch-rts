import { describe, expect, it } from "vitest";
import { RANKED_UNIT_VISUAL_PROFILES, UNIT_VISUAL_PROFILES, unitVisualProfile, unitVisualValueScore } from "./unit-visual-profile";
import { UNIT_DEFS } from "../shared/catalog";

describe("catalog-driven unit visual hierarchy", () => {
  it("keeps every simulation unit in the visual ranking", () => {
    expect(Object.keys(UNIT_VISUAL_PROFILES).sort()).toEqual(Object.keys(UNIT_DEFS).sort());
    expect(RANKED_UNIT_VISUAL_PROFILES).toHaveLength(Object.keys(UNIT_DEFS).length);
    expect(RANKED_UNIT_VISUAL_PROFILES[0]!.valueScore).toBeGreaterThanOrEqual(RANKED_UNIT_VISUAL_PROFILES.at(-1)!.valueScore);
  });

  it("separates the expensive heavy knight from the cheaper ember bruiser", () => {
    const knight = unitVisualProfile("knight");
    const ravager = unitVisualProfile("emberRavager");

    expect(unitVisualValueScore("knight")).toBeGreaterThan(unitVisualValueScore("emberRavager"));
    expect(knight.tier).toBeGreaterThan(ravager.tier);
    expect(knight.bodyScale).toBeGreaterThan(ravager.bodyScale);
    expect(knight.armor).toBe("stone");
    expect(ravager.role).toBe("bruiser");
    expect(ravager.accent).toBe("ember");
  });

  it("makes support and ranged units read lighter than frontline units", () => {
    expect(unitVisualProfile("archer").bodyScale).toBeLessThan(unitVisualProfile("footman").bodyScale);
    expect(unitVisualProfile("priest").bodyScale).toBeLessThan(unitVisualProfile("footman").bodyScale);
    expect(unitVisualProfile("golem").bodyScale).toBeGreaterThan(unitVisualProfile("knight").bodyScale);
  });
});
