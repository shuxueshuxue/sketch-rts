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
