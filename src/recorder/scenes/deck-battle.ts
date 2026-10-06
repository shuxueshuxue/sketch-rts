import { shipItemMass } from "../../shared/equipment";
import { rebuildShipFittings } from "../../shared/ship-equipment";
import { boardUnit, syncDecks } from "../../shared/decks";
import { createGame } from "../../shared/sim";
import type { TrainableUnitKind } from "../../shared/types";
import { defineRecordingScene } from "../scene";

/** A small reproducible battle exercising hull movement and ordinary deck combat. */
export const deckBattle = defineRecordingScene({
  name: "deck-battle",
  description: "Archers and healers fight from moving decks, with heavy equipment aboard a carrier.",
  createGame() {
    const game = createGame("bareDuel", {
      players: ["player", "enemy"], aiPlayers: [],
      scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true },
    });
    game.scriptedVictory = true;
    game.map = { ...game.map, width: 2400, height: 2000, terrain: { cell: 40, cols: 60, rows: 50, cells: "~".repeat(3000) } };
    function ship(owner: "player" | "enemy", kind: TrainableUnitKind, x: number, y: number, heading: number, crew: TrainableUnitKind[]) {
      const hull = game.spawnUnit(owner, kind, x, y);
      hull.sailing = { heading, speed: 0, load: 0, balance: 0 };
      if(owner==='player' && kind==='warship'){
        for(const mountId of ['port0','port1'])game.items.push({id:`broadside-${mountId}`,kind:'shipCannon',shipId:hull.id,mountId,x,y,durability:90,cooldownRemaining:0});
        rebuildShipFittings(game,hull);hull.holdMass=shipItemMass(game,hull);
      }
      for (const kind of crew) {
        const unit = game.spawnUnit(owner, kind, x, y);
        if (!boardUnit(hull, unit, game.units)) throw new Error(`${kind} cannot fit on ${hull.kind}`);
      }
      return hull;
    }
    const escort = ship("player", "warship", 900, 875, .2, ["archer"]);
    const carrier = ship("player", "carrier", 865, 1120, -.15, ["ballista", "footman", "worker"]);
    ship("player", "transport", 640, 950, .3, ["summoner", "archer"]);
    const enemy = ship("enemy", "fireShip", 1270, 1010, Math.PI, ["sparkArcher"]);
    const gunship = ship("enemy", "warship", 1290, 800, Math.PI, ["sparkArcher"]);
    ship("enemy", "bombardShip", 1500, 1200, Math.PI+.3, []);
    ship("player", "cutter", 680, 1200, -.2, []);
    escort.order = { type: "attack", targetId: gunship.id };
    carrier.order = { type: "move", x: 1050, y: 1080 };
    enemy.order = { type: "attack", targetId: carrier.id };
    gunship.order = { type: "attack", targetId: escort.id };
    syncDecks(game.units);
    return game;
  },
  defaults: { seconds: 16, width: 960, height: 640, fps: 20, camera: { type: "fixed", x: 1050, y: 1000, zoom: 1.2 } },
});
