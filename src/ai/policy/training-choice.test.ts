import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { soldierChoice, trainingChoice } from "./training-choice";

describe("AI training choice", () => {
  it("opens barracks production with footmen before mixing lancers", () => {
    const game = sketchScene("training-choice-footmen-first")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .build()
      .createGame();

    expect(soldierChoice(snapshotGame(game), "v2")).toBe("footman");
  });

  it("mixes lancers once enough footmen exist", () => {
    const game = sketchScene("training-choice-lancer-mix")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 620, 620)
      .unit("v2", "footman", 650, 620)
      .build()
      .createGame();

    expect(soldierChoice(snapshotGame(game), "v2")).toBe("lancer");
  });

  it("uses the production building role to choose non-barracks units", () => {
    const scene = sketchScene("training-choice-production-roles")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "archeryRange", 700, 620, { id: "range" })
      .building("v2", "stables", 780, 620, { id: "stables" });
    const game = scene.build().createGame();
    const snapshot = snapshotGame(game);
    const range = snapshot.buildings.find((building) => building.id === "range");
    const stables = snapshot.buildings.find((building) => building.id === "stables");
    if (!range || !stables) throw new Error("missing production building");

    expect(trainingChoice(snapshot, "v2", range)).toBe("archer");
    expect(trainingChoice(snapshot, "v2", stables)).toBe("raider");
  });

  it("lets v2 add a second round of casters once the army reaches the late-game mix", () => {
    const scene = sketchScene("training-choice-v2-late-casters")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "sanctum", 700, 620, { id: "sanctum" })
      .unit("v2", "priest", 760, 620)
      .unit("v2", "summoner", 790, 650)
      .unit("v2", "witch", 820, 680);
    for (let i = 0; i < 8; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 860 + i * 24, 720);
    const game = scene.build().createGame();
    game.players.v2!.gold = 520;
    const snapshot = snapshotGame(game);
    const sanctum = snapshot.buildings.find((building) => building.id === "sanctum");
    if (!sanctum) throw new Error("missing sanctum");

    expect(trainingChoice(snapshot, "v2", sanctum, { version: "v2" })).toBe("summoner");
  });

  it("lets v2 train a second priest before other second casters when a wounded group needs healing", () => {
    const scene = sketchScene("training-choice-v2-wounded-priest")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .building("v2", "sanctum", 700, 620, { id: "sanctum" })
      .unit("v2", "priest", 760, 620)
      .unit("v2", "summoner", 790, 650)
      .unit("v2", "witch", 820, 680)
      .unit("v2", "footman", 860, 720, { hp: 34 })
      .unit("v2", "lancer", 890, 720, { hp: 38 })
      .unit("v2", "archer", 920, 720, { hp: 24 });
    for (let i = 0; i < 5; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 960 + i * 24, 760);
    const game = scene.build().createGame();
    game.players.v2!.gold = 520;
    const snapshot = snapshotGame(game);
    const sanctum = snapshot.buildings.find((building) => building.id === "sanctum");
    if (!sanctum) throw new Error("missing sanctum");

    expect(trainingChoice(snapshot, "v2", sanctum, { version: "v2" })).toBe("priest");
  });
});
