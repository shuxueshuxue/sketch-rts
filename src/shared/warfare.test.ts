import { perTick, SIM_TICKS_PER_SECOND } from "./time";
import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, removeUnit, snapshotGame, stepGame, type Game } from "./sim";
import { canonicalGameState } from "./sim/canonical";
import { checksumGame } from "./sim/checksum";
import { commandValidationError } from "./sim/command-validation";
import type { ScenarioUnitSeed } from "./types";
import { UNIT_DEFS } from "./catalog";
import { isGameCommand } from "./command-schema";
import { aimingProfile } from "./aiming";
function battle(units: ScenarioUnitSeed[]): Game {
    const game = createGame("bareDuel", { players: ["p1", "p2"], scenario: { replaceDefaultUnits: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, addUnits: units } });
    game.scriptedVictory = true;
    for (const unit of game.units) {
        unit.cooldown = 9999;
        unit.order = { type: "hold", x: unit.x, y: unit.y };
    }
    return game;
}
function run(game: Game, ticks: number) { for (let i = 0; i < ticks; i++)
    stepGame(game); }
const get = (game: Game, id: string) => game.units.find(unit => unit.id === id)!;
describe("native engineering weapons", () => {
    it("fires a fixed shell landing; a moving target can dodge, while clustered enemies take splash", () => {
        const game = battle([{ id: "gun", owner: "p1", kind: "catapult", x: 1000, y: 1000 }, { id: "a", owner: "p2", kind: "cinderRunner", x: 1500, y: 1000 }, { id: "b", owner: "p2", kind: "footman", x: 1560, y: 1020 }, { id: "ally", owner: "p1", kind: "footman", x: 1600, y: 1070 }]);
        get(game, "gun").cooldown = 0;
        issuePlayerCommand(game, "p1", { type: "attack", unitIds: ["gun"], targetId: "a" });
        run(game, Math.ceil(500 / aimingProfile(UNIT_DEFS.catapult)!.speed * SIM_TICKS_PER_SECOND));
        expect(game.projectiles).toHaveLength(1);
        get(game, "gun").cooldown = 9999;
        issuePlayerCommand(game, "p2", { type: "move", unitIds: ["a"], x: 1500, y: 1500 });
        run(game, game.projectiles[0]!.remaining);
        expect(get(game, "a").hp).toBe(UNIT_DEFS.cinderRunner.hp);
        expect(get(game, "b").hp).toBeLessThan(UNIT_DEFS.footman.hp);
        expect(get(game, "ally").hp).toBe(UNIT_DEFS.footman.hp);
        expect(game.effects.some(effect => effect.type === "siegeImpact")).toBe(true);
    });
    it("pierces a line with diminishing damage and roots targets instead of homing after a dodging unit", () => {
        const game = battle([{ id: "gun", owner: "p1", kind: "ballista", x: 1030, y: 1000 }, ...[1300, 1400, 1500].map((x, i) => ({ id: `f${i}`, owner: "p2", kind: "footman" as const, x, y: 1000 })), { id: "side", owner: "p2", kind: "footman", x: 1400, y: 1100 }]);
        const command = { type: "cast" as const, unitId: "gun", ability: "pinningBolt" as const, targetId: "f2" };
        expect(commandValidationError(snapshotGame(game), "p1", command)).toBeUndefined();
        issuePlayerCommand(game, "p1", command);
        run(game, Math.ceil(470 / aimingProfile(UNIT_DEFS.ballista)!.speed * SIM_TICKS_PER_SECOND) + Math.ceil(470 / perTick(560)));
        expect(get(game, "f0").hp).toBeLessThan(get(game, "f1").hp);
        expect(get(game, "f1").hp).toBeLessThan(get(game, "f2").hp);
        expect(get(game, "f0").effects.some(effect => effect.type === "root")).toBe(true);
        expect(get(game, "side").hp).toBe(UNIT_DEFS.footman.hp);
    });
    it("rejects shell fire inside the dead zone and makes attacking artillery back away", () => {
        const game = battle([{ id: "gun", owner: "p1", kind: "catapult", x: 1000, y: 1000 }, { id: "foe", owner: "p2", kind: "footman", x: 1100, y: 1000 }]);
        get(game, "gun").cooldown = 0;
        issuePlayerCommand(game, "p1", { type: "attack", unitIds: ["gun"], targetId: "foe" });
        run(game, 40);
        expect(get(game, "gun").x).toBeLessThan(1000);
        expect(get(game, "foe").hp).toBe(UNIT_DEFS.footman.hp);
    });
    it("uses a directional fan for ordinary organ gun volleys, with no damage behind the gun", () => {
        const game = battle([{ id: "gun", owner: "p1", kind: "organGun", x: 1000, y: 1000 }, { id: "front", owner: "p2", kind: "footman", x: 1250, y: 1030 }, { id: "back", owner: "p2", kind: "footman", x: 750, y: 1000 }]);
        get(game, "gun").cooldown = 0;
        issuePlayerCommand(game, "p1", { type: "attack", unitIds: ["gun"], targetId: "front" });
        run(game, Math.ceil(Math.hypot(250, 30) / aimingProfile(UNIT_DEFS.organGun)!.speed * SIM_TICKS_PER_SECOND));
        expect(get(game, "front").hp).toBeLessThan(UNIT_DEFS.footman.hp);
        expect(get(game, "back").hp).toBe(UNIT_DEFS.footman.hp);
        expect(game.effects.some(effect => effect.type === "grapeshot")).toBe(true);
    });
    it("keeps shell flight, burn damage and source attribution deterministic after saving and the shooter's death", () => {
        const game = battle([{ id: "gun", owner: "p1", kind: "fireShip", x: 1030, y: 1000 }, { id: "foe", owner: "p2", kind: "footman", x: 1250, y: 1000 }]);
        issuePlayerCommand(game, "p1", { type: "cast", unitId: "gun", ability: "incendiaryFlume", x: 1250, y: 1000 });
        run(game, Math.ceil(220 / aimingProfile(UNIT_DEFS.fireShip)!.speed * SIM_TICKS_PER_SECOND));
        expect(game.projectiles).toHaveLength(1);
        removeUnit(game, "gun");
        const restored = createGame("bareDuel");
        restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
        restored.scriptedVictory = true;
        run(game, 100);
        run(restored, 100);
        expect(snapshotGame(restored)).toEqual(snapshotGame(game));
        expect(canonicalGameState(restored)).toEqual(canonicalGameState(game));
        expect(checksumGame(restored)).toBe(checksumGame(game));
        expect(get(game, "foe").hp).toBeLessThan(UNIT_DEFS.footman.hp - 14);
        expect(Number.isFinite(get(game, "foe").hp)).toBe(true);
    });
    it("keeps the ram's bonus structure damage in its ordinary attack", () => {
        const game = battle([{ id: "ram", owner: "p1", kind: "siegeRam", x: 1000, y: 1000 }, { id: "foe", owner: "p2", kind: "footman", x: 1060, y: 1000 }]);
        get(game, "ram").cooldown = 0;
        const hall = game.buildings.find(building => building.owner === "p2")!;
        hall.x = 1080;
        hall.y = 1000;
        const hp = hall.hp;
        issuePlayerCommand(game, "p1", { type: "attack", unitIds: ["ram"], targetId: hall.id });
        run(game, 1);
        expect(hp - hall.hp).toBe(Math.round(UNIT_DEFS.siegeRam.attackDamage * UNIT_DEFS.siegeRam.weapon!.buildingMultiplier!));
    });
    it("removes duplicate weapon skills from commands while retaining distinct control and area denial", () => {
        for (const ability of ["ramBreach", "siegeBarrage", "grapeshot"]) {
            expect(isGameCommand({ type: "cast", unitId: "gun", ability, x: 1300, y: 1000 })).toBe(false);
        }
        for (const kind of ["siegeRam", "catapult", "organGun", "bombardShip"] as const) expect(UNIT_DEFS[kind].abilities).toEqual([]);
        expect(UNIT_DEFS.ballista.abilities).toContain("pinningBolt");
        expect(UNIT_DEFS.fireShip.abilities).toContain("incendiaryFlume");
    });
    it("repairs a damaged ship at its own dock for gold, while an attacking ship receives no repair", () => {
        const game = battle([{ id: "repair", owner: "p1", kind: "transport", x: 1000, y: 1000 },
            { id: "fighting", owner: "p1", kind: "warship", x: 1000, y: 1080 },
            { id: "foe", owner: "p2", kind: "footman", x: 1600, y: 1080 }]);
        const yard = game.buildings[0]!;
        yard.kind = "shipyard"; yard.x = 1000; yard.y = 1000;
        game.players.p1!.gold = 1;
        get(game, "repair").hp = 10;
        get(game, "fighting").hp = 10;
        issuePlayerCommand(game, "p1", { type: "attack", unitIds: ["fighting"], targetId: "foe" });
        run(game, 20);
        expect(get(game, "repair").hp).toBe(13);
        expect(get(game, "fighting").hp).toBe(10);
        expect(game.players.p1!.gold).toBe(0);
        run(game, 20);
        expect(get(game, "repair").hp).toBe(13);
    });

});
