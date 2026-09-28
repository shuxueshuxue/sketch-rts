import { describe, expect, it } from "vitest";
import { resolveVariant, UNIT_DEFS, UPGRADE_DEFS, unitRules } from "./catalog";
import { createGame, issuePlayerCommand, refreshUnitStats, restoreSnapshotIntoGame, snapshotGame, spawnVariantUnit, stepGame } from "./sim";
import { createBuilding } from "./map";
import { checkCommandLegality } from "./sim/command-validation";

function duel() {
  return createGame("bareDuel", {
    players: ["north", "south"],
    aiPlayers: [],
    teams: { north: "north", south: "south" },
    races: { north: "grove", south: "ember" },
    scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true },
  });
}

describe("unit variants", () => {
  it("plays a variant by its own numbers while it keeps its base kind", () => {
    const game = duel();
    game.variants = { "test/champion": resolveVariant({ base: "footman", hp: 600, attackDamage: 40, speed: 4, radius: 22 }) };
    const champion = spawnVariantUnit(game, "north", "test/champion", 1000, 1000);
    expect(champion.kind).toBe("footman");
    expect(champion.variant).toBe("test/champion");
    expect([champion.hp, champion.maxHp, champion.attackDamage, champion.speed, champion.radius]).toEqual([600, 600, 40, 4, 22]);
    // Whatever it does not restate, it takes from its base.
    expect(unitRules(game, champion).attackCooldown).toBe(UNIT_DEFS.footman.attackCooldown);
  });

  it("never touches the catalog: another game's footmen are footmen", () => {
    const game = duel();
    game.variants = { "test/footman": resolveVariant({ base: "footman", hp: 1 }) };
    spawnVariantUnit(game, "north", "test/footman", 1000, 1000);
    const plain = duel().spawnUnit("north", "footman", 1000, 1000);
    expect(plain.maxHp).toBe(UNIT_DEFS.footman.hp);
    expect(UNIT_DEFS.footman.hp).toBe(145);
  });

  it("takes upgrades on its base's terms, and re-derives when its rules are rewritten", () => {
    const game = duel();
    game.players.north!.upgrades.weaponTraining = 1;
    game.variants = { "test/champion": resolveVariant({ base: "footman", attackDamage: 40 }) };
    const champion = spawnVariantUnit(game, "north", "test/champion", 1000, 1000);
    const weapons = UPGRADE_DEFS.weaponTraining.levels[0]!.attackMultiplier!;
    expect(champion.attackDamage).toBe(Math.round(40 * weapons));
    game.variants["test/champion"] = resolveVariant({ base: "footman", attackDamage: 50, hp: 300 });
    refreshUnitStats(game, champion);
    expect(champion.attackDamage).toBe(Math.round(50 * weapons));
    expect(champion.maxHp).toBe(300);
  });

  it("gives a heroic unit no veterancy stars: its growth is the story's", () => {
    const game = duel();
    game.variants = { "test/hero": resolveVariant({ base: "archer", heroic: true, hp: 300 }), "test/prey": resolveVariant({ base: "footman", hp: 1, xpReward: 400 }) };
    const hero = spawnVariantUnit(game, "north", "test/hero", 1000, 1000);
    const prey = spawnVariantUnit(game, "south", "test/prey", 1100, 1000);
    issuePlayerCommand(game, "north", { type: "attack", unitIds: [hero.id], targetId: prey.id });
    for (let tick = 0; tick < 80; tick += 1) stepGame(game);
    expect(hero.xp).toBe(400);
    expect(hero.level).toBe(0);
  });

  it("travels with the game's snapshot, and a standard match's snapshot has no such field", () => {
    expect("variants" in snapshotGame(duel())).toBe(false);
    const game = duel();
    game.variants = { "test/champion": resolveVariant({ base: "footman", hp: 600 }) };
    spawnVariantUnit(game, "north", "test/champion", 1000, 1000, "champion");
    const copy = duel();
    restoreSnapshotIntoGame(copy, snapshotGame(game), game.nextId);
    expect(copy.variants?.["test/champion"]?.hp).toBe(600);
    expect(copy.units.find((unit) => unit.id === "champion")?.maxHp).toBe(600);
  });

  it("counts a variant's supply as the variant says when a command is checked", () => {
    const game = duel();
    game.buildings.push(createBuilding("north-hall", "north", "townHall", 800, 800, true));
    game.variants = { "test/free": resolveVariant({ base: "footman", supplyUsed: 0 }) };
    // Five footmen would fill a hall's 8 supply; five that cost none leave room for a worker.
    for (let index = 0; index < 5; index += 1) spawnVariantUnit(game, "north", "test/free", 900 + index * 30, 900);
    expect(game.players.north!.supplyUsed).toBe(0);
    expect(checkCommandLegality(snapshotGame(game), "north", { type: "train", buildingId: "north-hall", unitKind: "worker" })).toBeUndefined();
  });
});
