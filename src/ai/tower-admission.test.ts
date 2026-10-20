import { expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { createBuilding } from "../shared/map";
import { planAiOwnerCommandEntries } from "./planner-context";
import type { AiScript } from "./policy";

it("filters every non-infantry tower candidate with the shared rule before recording AI commands", () => {
  const game = createGame("bareDuel", { aiPlayers: [] }); game.units = [];
  const tower = createBuilding("tower", "player", "fortifiedTower", 1000, 1000, true); game.buildings.push(tower);
  const ballista = game.spawnUnit("player", "ballista", 1000, 1100), footman = game.spawnUnit("player", "footman", 1100, 1100);
  const others = (["knight", "raider", "horseArcher", "ancientStag", "spirit"] as const).map(kind => game.spawnUnit("player", kind, 1200, 1100));
  const script: AiScript = { id: "tower-test", phase: "tactics", run: () => ({ type: "garrison", unitIds: [ballista.id, footman.id, ...others.map(unit => unit.id)], buildingId: tower.id }) };
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", version: "v2", scripts: [script] });
  expect(entries.map(entry => entry.command)).toEqual([{ type: "garrison", unitIds: [footman.id], buildingId: tower.id }]);
  game.units = [ballista, ...others];
  expect(planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", version: "v2", scripts: [script] })).toEqual([]);
});
