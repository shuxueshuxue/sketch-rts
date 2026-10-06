import { boardUnit, syncDecks } from "../../shared/decks";
import { createBuilding } from "../../shared/map";
import { createGame } from "../../shared/sim";
import { defineRecordingScene } from "../scene";

/** Reproducible full-hull docking and individual physical landing positions. */
export const coastLanding = defineRecordingScene({
  name: "coast-landing",
  description: "A transport approaches a working harbor and sets its live deck crew ashore.",
  createGame() {
    const game = createGame("bareDuel", {
      players: ["player", "enemy"], aiPlayers: [],
      scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true },
    });
    game.scriptedVictory = true;
    let cells = "";
    for (let row = 0; row < 50; row++) for (let col = 0; col < 60; col++) cells += col < 20 ? "." : col === 20 ? "," : "~";
    game.map = { ...game.map, width: 2400, height: 2000, terrain: { cell: 40, cols: 60, rows: 50, cells } };
    game.buildings = [
      createBuilding("yard", "player", "shipyard", 760, 760, true),
      createBuilding("hall", "player", "townHall", 530, 970, true),
      createBuilding("farm", "player", "farm", 660, 1150, true),
    ];
    const ferry = game.spawnUnit("player", "transport", 1270, 1030);
    ferry.sailing = { heading: Math.PI, speed: 0, load: 0, balance: 0 };
    for (const kind of ["footman", "archer", "worker"] as const) {
      const crew = game.spawnUnit("player", kind, ferry.x, ferry.y);
      if (!boardUnit(ferry, crew, game.units)) throw new Error(`${kind} cannot fit on transport`);
    }
    const escort = game.spawnUnit("player", "warship", 1100, 800);
    escort.sailing = { heading: Math.PI, speed: 0, load: 0, balance: 0 };
    escort.order = { type: "move", x: 970, y: 800 };
    ferry.order = { type: "unload", x: 770, y: 1030 };
    syncDecks(game.units);
    return game;
  },
  defaults: { seconds: 14, width: 960, height: 640, fps: 20, camera: { type: "fixed", x: 900, y: 975, zoom: 1.1 } },
});
