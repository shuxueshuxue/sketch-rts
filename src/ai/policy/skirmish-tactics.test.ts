import { describe, expect, it } from "vitest";
import { BUILDING_DEFS } from "../../shared/catalog";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { planSkirmishPreservation } from "./skirmish-tactics";
import { distance } from "./spatial";

describe("AI skirmish tactics", () => {
  it("pulls a wounded ranged unit away from a melee unit that has closed the distance", () => {
    const game = sketchScene("skirmish-tactics-ranged-kite")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v2", "archer", 820, 520, { id: "wounded-archer", hp: 28 })
      .unit("v1", "footman", 850, 520, { id: "chaser" })
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", unitIds: ["wounded-archer"] });
    expect(command?.type === "move" ? command.x : 0).toBeLessThan(820);
  });

  it("falls back with attack-move when a modestly disadvantaged group is still healthy enough to trade", () => {
    const game = sketchScene("skirmish-tactics-modest-disadvantage")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3300, 3300)
      .unit("v2", "footman", 1800, 1600)
      .unit("v2", "lancer", 1840, 1640)
      .unit("v2", "archer", 1880, 1680)
      .unit("v1", "footman", 1940, 1600)
      .unit("v1", "lancer", 1980, 1640)
      .unit("v1", "contractArcher", 2020, 1680)
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove" });
  });

  it("v5 finishes a critical local ranged target before preserving a disadvantaged skirmish", () => {
    const game = sketchScene("skirmish-tactics-v5-critical-local-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 2048)
      .townHall("v3", 3400, 2048)
      .townHall("v4-tr", 3400, 2600)
      .unit("v5", "archer", 2420, 2100, { id: "v5-archer-a" })
      .unit("v5", "archer", 2470, 2075, { id: "v5-archer-b" })
      .unit("v5", "lancer", 2500, 2120, { id: "v5-lancer" })
      .unit("v5", "fieldMedic", 2440, 2140, { id: "v5-medic" })
      .unit("v3", "sparkArcher", 2560, 2080, { id: "critical-spark", hp: 12, xp: 220 })
      .unit("v3", "emberRavager", 2600, 2110)
      .unit("v3", "cinderRunner", 2630, 2070)
      .unit("v3", "contractArcher", 2660, 2050)
      .unit("v3", "emberAcolyte", 2580, 2140)
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v5", { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attack", targetId: "critical-spark" });
  });

  it("does not pull a healthy army home from a one-on-one opponent with no workers", () => {
    const scene = sketchScene("skirmish-tactics-dead-economy-no-home-pull")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "south" })
      .player("v1a", { team: "north" })
      .townHall("v2", 3604, 2048)
      .townHall("v2", 3376, 2680)
      .townHall("v1a", 492, 2048)
      .building("v1a", "barracks", 612, 2148);
    for (let i = 0; i < 22; i += 1) {
      scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 1500 + (i % 8) * 30, 1880 + Math.floor(i / 8) * 34);
    }
    for (let i = 0; i < 30; i += 1) {
      scene.unit("v1a", i % 2 === 0 ? "lancer" : "footman", 900 + (i % 10) * 26, 1850 + Math.floor(i / 10) * 32);
    }
    const game = scene.build().createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("does not pull a healthy army home from a one-on-one opponent with one remaining worker", () => {
    const scene = sketchScene("skirmish-tactics-nearly-dead-economy-no-home-pull")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "south" })
      .player("v1a", { team: "north" })
      .townHall("v2", 3604, 2048)
      .townHall("v2", 3376, 2680)
      .townHall("v1a", 492, 2048)
      .building("v1a", "barracks", 612, 2148)
      .worker("v1a", 540, 2040);
    for (let i = 0; i < 22; i += 1) {
      scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 1500 + (i % 8) * 30, 1880 + Math.floor(i / 8) * 34);
    }
    for (let i = 0; i < 30; i += 1) {
      scene.unit("v1a", i % 2 === 0 ? "lancer" : "footman", 900 + (i % 10) * 26, 1850 + Math.floor(i / 10) * 32);
    }
    const game = scene.build().createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("retreats a disadvantaged squad near a live enemy base", () => {
    const game = sketchScene("skirmish-tactics-live-base-disadvantage")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3300, 2100)
      .worker("v1", 3400, 2050)
      .unit("v2", "footman", 2920, 2140)
      .unit("v2", "footman", 2960, 2170)
      .unit("v2", "lancer", 3000, 2200)
      .unit("v2", "archer", 2880, 2200)
      .unit("v2", "contractArcher", 2840, 2170)
      .unit("v1", "footman", 3060, 2120)
      .unit("v1", "footman", 3100, 2150)
      .unit("v1", "footman", 3140, 2180)
      .unit("v1", "lancer", 3180, 2210)
      .unit("v1", "lancer", 3220, 2240)
      .unit("v1", "archer", 3120, 2060)
      .unit("v1", "contractArcher", 3160, 2030)
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 9999).toBeLessThan(2920);
  });

  it("does not pull wounded v4-tr ranged mercenaries out of a dead-economy closeout", () => {
    const scene = sketchScene("skirmish-tactics-v4-tr-closeout-no-pullback")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 492, 2048)
      .townHall("v3", 3604, 2048)
      .building("v3", "cinderSpire", 3518, 2176)
      .unit("v4", "contractArcher", 3032, 2197, { id: "wounded-closer", hp: 7, order: { type: "attackMove", x: 3518, y: 2176 } })
      .unit("v4", "contractArcher", 3060, 2208, { id: "healthy-closer-a", order: { type: "attackMove", x: 3518, y: 2176 } })
      .unit("v4", "contractArcher", 3088, 2220, { id: "healthy-closer-b", order: { type: "attackMove", x: 3518, y: 2176 } })
      .unit("v4", "fieldMedic", 3050, 2240, { id: "medic-a", order: { type: "attackMove", x: 3518, y: 2176 } })
      .unit("v4", "fieldMedic", 3090, 2250, { id: "medic-b", order: { type: "attackMove", x: 3518, y: 2176 } })
      .unit("v3", "emberRavager", 3180, 2198, { id: "last-defender" });
    const game = scene.build().createGame();

    const commands = planSkirmishPreservation(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("keeps v4-tr tower merc pressure committed near a live enemy base", () => {
    const scene = sketchScene("skirmish-tactics-v4-tr-live-base-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 492, 2048)
      .townHall("v3", 3604, 2048)
      .worker("v3", 3660, 1990)
      .worker("v3", 3660, 2048)
      .worker("v3", 3660, 2110)
      .unit("v4", "contractArcher", 3032, 2050)
      .unit("v4", "contractArcher", 3060, 2080)
      .unit("v4", "contractArcher", 3088, 2110)
      .unit("v4", "fieldMedic", 3050, 2140)
      .unit("v4", "fieldMedic", 3090, 2170)
      .unit("v3", "footman", 3180, 2050)
      .unit("v3", "footman", 3210, 2080)
      .unit("v3", "footman", 3240, 2110)
      .unit("v3", "lancer", 3270, 2140)
      .unit("v3", "lancer", 3300, 2170)
      .unit("v3", "archer", 3200, 2000)
      .unit("v3", "contractArcher", 3230, 1970);
    const game = scene.build().createGame();

    const commands = planSkirmishPreservation(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("sends an idle badly wounded v2 fighter home after the immediate fight is gone", () => {
    const game = sketchScene("skirmish-tactics-idle-wounded-recovery")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "moonWell", 414, 618)
      .unit("v2", "footman", 900, 900, { id: "idle-wounded-footman", hp: 32 })
      .unit("v2", "archer", 940, 920, { id: "healthy-archer" })
      .townHall("v1", 3300, 3300)
      .build()
      .createGame();
    const well = game.buildings.find((building) => building.owner === "v2" && building.kind === "moonWell")!;

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", unitIds: ["idle-wounded-footman"] });
    if (command?.type === "move") expect(distance(command, well)).toBeLessThanOrEqual(BUILDING_DEFS.moonWell.attackRange);
  });

  it("sends settled wounded fighters into moon well range instead of the neutral-leash retreat point", () => {
    const game = sketchScene("skirmish-tactics-wounded-moon-well-recovery")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 2600)
      .building("v2", "moonWell", 340, 2680)
      .unit("neutral", "wildling", 500, 2900)
      .unit("v2", "footman", 780, 2300, { id: "settled-wounded-footman", hp: 32, order: { type: "idle" } })
      .unit("v2", "archer", 820, 2320, { id: "healthy-archer" })
      .townHall("v1", 3300, 3300)
      .build()
      .createGame();
    const well = game.buildings.find((building) => building.owner === "v2" && building.kind === "moonWell")!;

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", unitIds: ["settled-wounded-footman"] });
    if (command?.type === "move") expect(distance(command, well)).toBeLessThanOrEqual(BUILDING_DEFS.moonWell.attackRange);
  });

  it("preserves a wounded high-level core fighter before ordinary critical-health retreat", () => {
    const game = sketchScene("skirmish-tactics-veteran-core-preservation")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .building("v2", "moonWell", 430, 620)
      .unit("v2", "knight", 940, 900, { id: "veteran-knight", xp: 260, hp: 170, order: { type: "attackMove", x: 1500, y: 1100 } })
      .unit("v2", "archer", 900, 940, { id: "healthy-archer" })
      .unit("v1", "footman", 1070, 900)
      .unit("v1", "lancer", 1110, 930)
      .townHall("v1", 3300, 3300)
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", unitIds: ["veteran-knight"] });
  });

  it("v5 preserves a near-star core fighter before it becomes a disposable frontliner", () => {
    const game = sketchScene("skirmish-tactics-v5-near-star-preservation")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north" })
      .player("v3", { team: "south" })
      .player("v4-tr", { team: "south" })
      .townHall("v5", 500, 500)
      .building("v5", "moonWell", 430, 620)
      .unit("v5", "footman", 940, 900, { id: "near-star-footman", xp: 55, hp: 70, order: { type: "attackMove", x: 1500, y: 1100 } })
      .unit("v5", "archer", 900, 940, { id: "healthy-archer" })
      .unit("v3", "footman", 1070, 900)
      .unit("v4-tr", "lancer", 1110, 930)
      .townHall("v3", 3300, 3300)
      .townHall("v4-tr", 3300, 3500)
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v5", { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", unitIds: ["near-star-footman"] });
  });

  it("does not recall a healthy objective squad before idle neutral camps have engaged", () => {
    const game = sketchScene("skirmish-tactics-idle-neutral-route")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 492, 2048)
      .townHall("v1", 3604, 2048)
      .unit("v2", "footman", 1623, 2313, { id: "objective-footman-a", hp: 127, order: { type: "attackMove", x: 2106, y: 2076 } })
      .unit("v2", "lancer", 1589, 2300, { id: "objective-lancer", hp: 76, order: { type: "attackMove", x: 2106, y: 2076 } })
      .unit("v2", "footman", 1563, 2276, { id: "objective-footman-b", hp: 121, order: { type: "attackMove", x: 2106, y: 2076 } })
      .unit("v2", "footman", 1617, 2277, { id: "objective-footman-c", hp: 109, order: { type: "attackMove", x: 2106, y: 2076 } })
      .unit("neutral", "stonebackBrute", 2062, 2006, { id: "center-brute" })
      .unit("neutral", "gladeWitch", 2150, 2126, { id: "center-witch" })
      .unit("neutral", "barkMender", 2106, 2076, { id: "center-mender" })
      .unit("neutral", "thornSlinger", 2053, 2122, { id: "center-slinger" })
      .unit("neutral", "gladeWitch", 1176, 2010, { id: "merc-witch" })
      .unit("neutral", "barkMender", 1156, 2090, { id: "merc-mender" })
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("still recalls a squad that has reached idle neutral camp contact range", () => {
    const game = sketchScene("skirmish-tactics-idle-neutral-contact")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 492, 2048)
      .townHall("v1", 3604, 2048)
      .unit("v2", "footman", 1600, 2048, { id: "contact-footman-a", hp: 120, order: { type: "attackMove", x: 1700, y: 2048 } })
      .unit("v2", "lancer", 1628, 2070, { id: "contact-lancer", hp: 78, order: { type: "attackMove", x: 1700, y: 2048 } })
      .unit("v2", "footman", 1590, 2080, { id: "contact-footman-b", hp: 115, order: { type: "attackMove", x: 1700, y: 2048 } })
      .unit("neutral", "stonebackBrute", 1740, 2048, { id: "contact-brute" })
      .unit("neutral", "ancientStag", 1760, 2068, { id: "contact-stag" })
      .unit("neutral", "gladeWitch", 1760, 2090, { id: "contact-witch" })
      .unit("neutral", "barkMender", 1780, 2010, { id: "contact-mender" })
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove" });
  });
});
