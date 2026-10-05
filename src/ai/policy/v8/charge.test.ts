import { describe, expect, it } from "vitest";
import { ABILITY_DEFS, BUILDING_DEFS } from "../../../shared/catalog";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import type { GameCommand } from "../../../shared/types";
import { createAiPolicyMemory } from "../../memory";
import { planV8Charge } from "./charge";

const V8 = { version: "v2", requestedVersion: "v8" } as const;
const charge = ABILITY_DEFS.charge as Extract<(typeof ABILITY_DEFS)["charge"], { behavior: "charge" }>;
// A gap well inside the charge window.
const REACH = (charge.minRange + charge.plannerRange) / 2;
const RIDER = { x: 1_500, y: 1_500 };

function field(name: string, add: (scene: ReturnType<typeof sketchScene>) => ReturnType<typeof sketchScene>, riderOrder?: { type: "move"; x: number; y: number }) {
  const scene = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v8", { team: "north", race: "grove" })
    .player("v5", { team: "south", race: "grove" })
    .player("v7", { team: "south", race: "ember" })
    .townHall("v8", 500, 1_500)
    .townHall("v5", 3_300, 3_300)
    .townHall("v7", 3_300, 3_800)
    .unit("v8", "raider", RIDER.x, RIDER.y, { id: "rider", ...(riderOrder ? { order: riderOrder } : {}) });
  const game = add(scene).build().createGame();
  return game;
}

function plan(game: ReturnType<typeof field>): GameCommand[] {
  return planV8Charge(snapshotGame(game), "v8", { ...V8, teams: game.teams, memory: createAiPolicyMemory() });
}

describe("v8 charge", () => {
  // @@@v8-charge
  it("switches the engine's charge off and charges the archer in its window before a nearer spirit", () => {
    const game = field("v8-charge-archer", (scene) => scene.unit("v7", "spirit", RIDER.x + charge.minRange + 30, RIDER.y, { id: "spirit" }).unit("v5", "archer", RIDER.x + REACH, RIDER.y + 40, { id: "archer" }));
    game.units.find((unit) => unit.id === "spirit")!.expiresTick = 1_200;
    const commands = plan(game);
    expect(commands).toContainEqual({ type: "setAutocast", unitIds: ["rider"], ability: "charge", enabled: false });
    expect(commands).toContainEqual({ type: "cast", unitId: "rider", ability: "charge", targetId: "archer" });
  });

  it("does not charge into the reach of an enemy tower it is not already in", () => {
    const archerX = RIDER.x + REACH;
    const game = field("v8-charge-tower", (scene) => scene.unit("v5", "archer", archerX, RIDER.y, { id: "archer" }).tower("v5", archerX + BUILDING_DEFS.defenseTower.attackRange - 60, RIDER.y));
    expect(plan(game).filter((command) => command.type === "cast")).toEqual([]);
  });

  it("leaves a rider walking under a move order to its walk", () => {
    const game = field("v8-charge-walking", (scene) => scene.unit("v5", "archer", RIDER.x + REACH, RIDER.y, { id: "archer" }), { type: "move", x: 500, y: 1_500 });
    expect(plan(game).filter((command) => command.type === "cast")).toEqual([]);
  });
});
