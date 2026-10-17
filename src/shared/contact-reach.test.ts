import { describe, expect, it } from "vitest";
import { UNIT_DEFS, unitMover } from "./catalog";
import { CONTACT_SLACK } from "./combat-geometry";
import { RANGED_ATTACK_RANGE_THRESHOLD } from "./aiming";
import { isShipKind } from "./ship-geometry";
import { createGame, issuePlayerCommand, stepGame } from "./sim";
import type { UnitKind } from "./types";

function duel(attackerKind: UnitKind, targetKind: UnitKind, gap = 0) {
  const game = createGame("bareDuel", { players: ["p1", "p2"], aiPlayers: [] });
  game.units = [];
  game.scriptedVictory = true;
  const attacker = game.spawnUnit("p1", attackerKind, 1000, 1000);
  const target = game.spawnUnit("p2", targetKind, 1000 + attacker.radius + UNIT_DEFS[targetKind].radius + gap, 1000);
  target.attackDamage = 0;
  target.order = { type: "hold", x: target.x, y: target.y };
  issuePlayerCommand(game, "p1", { type: "attack", unitIds: [attacker.id], targetId: target.id });
  return { game, attacker, target };
}

const land = (kind: UnitKind) => unitMover(kind) === "land" && !isShipKind(kind);

// @@@contact-reach - A melee blow lands on any land unit its striker stands pressed against.
describe("melee reach on contact", () => {
  it("lets a worker strike an ogre it walks up to, instead of shoving it across the field", () => {
    const { game, target } = duel("worker", "ogreWarrior", 60);
    const startX = target.x;
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(Math.abs(target.x - startX)).toBeLessThan(40);
  });

  // Only pairs whose touching bodies stand farther apart than the striker's reach were ever in doubt.
  const melee = (Object.keys(UNIT_DEFS) as UnitKind[]).filter(kind => land(kind) && UNIT_DEFS[kind].attackDamage > 0 && UNIT_DEFS[kind].attackRange <= RANGED_ATTACK_RANGE_THRESHOLD);
  const pairs = melee.flatMap(attacker => (Object.keys(UNIT_DEFS) as UnitKind[])
    .filter(target => land(target) && UNIT_DEFS[attacker].radius + UNIT_DEFS[target].radius + CONTACT_SLACK > UNIT_DEFS[attacker].attackRange)
    .map(target => [attacker, target] as const));
  it.each(pairs)("lets a %s strike a %s its body touches", (attackerKind, targetKind) => {
    const { game, target } = duel(attackerKind, targetKind);
    for (let tick = 0; tick < 60 && target.hp === target.maxHp; tick++) stepGame(game);
    expect(target.hp).toBeLessThan(target.maxHp);
  });
});
