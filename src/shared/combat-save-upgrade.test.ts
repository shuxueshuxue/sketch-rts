import { describe, expect, it } from "vitest";
import { upgradeSavedCombat } from "./combat-save-upgrade";
import { DAMAGE_PROFILES as P } from "./damage-types";
import { createGame, snapshotGame } from "./sim";
import type { Projectile } from "./types";

function projectile(id: string, extra: Partial<Projectile> = {}): Projectile {
  return { id, owner: "player", attackerId: "gone-source", targetId: "target", fromX: 0, fromY: 0, toX: 100, toY: 0, damage: 14, remaining: 4, duration: 8, ...extra };
}

describe("combat save upgrade", () => {
  it("marks only old ordinary shots as having already settled heavy armor", () => {
    const snapshot = snapshotGame(createGame("bareDuel", { aiPlayers: [] }));
    snapshot.projectiles = [
      projectile("arrow", { sourceKind: "archer" }),
      projectile("caster", { sourceKind: "priest" }),
      projectile("tower"),
      projectile("cannon", { sourceKind: "warship", weapon: { delivery: "bolt", presentation: "cannon" } }),
      projectile("new-arrow", { sourceKind: "archer", damageProfile: { ...P.RANGED_PIERCE } }),
    ];
    const original = JSON.stringify(snapshot);
    const restored = upgradeSavedCombat(snapshot);
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(restored.projectiles.map(shot => shot.damageProfile)).toEqual([P.RANGED_PIERCE, P.MAGIC_RANGED, P.TOWER_ARROW, P.RANGED_BLUNT, P.RANGED_PIERCE]);
    expect(restored.projectiles.map(shot => shot.armorAlreadyApplied)).toEqual([true, true, true, undefined, undefined]);
    expect(restored.projectiles.map(shot => shot.damage)).toEqual([14, 14, 14, 14, 14]);
    expect(restored.projectiles[4]!.damageProfile).not.toBe(snapshot.projectiles[4]!.damageProfile);
    expect(upgradeSavedCombat(restored)).toEqual(restored);
  });
});
