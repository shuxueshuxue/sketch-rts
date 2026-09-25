import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../../shared/sim";
import { sketchScene } from "../../../sdk/scene";
import type { GameCommand } from "../../../shared/types";
import { createAiPolicyMemory } from "../../memory";
import { AI_SCRIPT_LIBRARY, planAiCommandsFromScripts } from "../../policy";
import type { AiScript } from "../types";
import { planV6CasterScreen } from "./backline";

const V6 = { version: "v2", requestedVersion: "v6" } as const;

function field(name: string, spirits: number) {
  let scene = sketchScene(name)
    .map("openClaims")
    .replaceDefaults()
    .player("v6", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v5", { team: "south", race: "grove" })
    .townHall("v6", 500, 1_500)
    .townHall("v3", 3_300, 3_300)
    .townHall("v5", 3_300, 3_800)
    .unit("v6", "summoner", 1_650, 1_500, { id: "summoner" });
  for (let index = 0; index < spirits; index += 1) scene = scene.unit("v6", "spirit", 1_700, 1_440 + index * 30);
  for (let index = 0; index < 4; index += 1) scene = scene.unit("v5", "archer", 2_050, 1_450 + index * 30);
  const game = scene.build().createGame();
  return { game, snapshot: snapshotGame(game) };
}

describe("v6 backline", () => {
  it("stands a summoner behind its spirits, on the far side from the enemy and out of the shooters' reach", () => {
    const { game, snapshot } = field("v6-screen-behind", 4);
    const [command] = planV6CasterScreen(snapshot, "v6", { ...V6, teams: game.teams, memory: createAiPolicyMemory() }) as Extract<GameCommand, { type: "move" }>[];
    expect(command).toMatchObject({ type: "move", unitIds: ["summoner"] });
    expect(command!.x).toBeLessThan(1_700);
    expect(2_050 - command!.x).toBeGreaterThan(399 + 90);
  });

  it("falls back toward home when no spirits are left to hide behind", () => {
    const { game, snapshot } = field("v6-screen-fallback", 0);
    const [command] = planV6CasterScreen(snapshot, "v6", { ...V6, teams: game.teams, memory: createAiPolicyMemory() }) as Extract<GameCommand, { type: "move" }>[];
    expect(command).toMatchObject({ type: "move", unitIds: ["summoner"] });
    expect(command!.x).toBeLessThan(1_650 - 250);
  });

  it("does not follow two stray spirits: it goes back to where the general holds", () => {
    const { game, snapshot } = field("v6-screen-thin", 2);
    const memory = createAiPolicyMemory();
    memory.v6 = { general: { mode: "hold", target: { x: 880, y: 1_500 } } };
    const [command] = planV6CasterScreen(snapshot, "v6", { ...V6, teams: game.teams, memory }) as Extract<GameCommand, { type: "move" }>[];
    expect(command).toMatchObject({ type: "move", unitIds: ["summoner"] });
    expect(Math.hypot(command!.x - 880, command!.y - 1_500)).toBeLessThan(200);
  });

  it("drops every other script's orders for the summoners it owns", () => {
    const { game, snapshot } = field("v6-screen-claims", 4);
    const charge: AiScript = {
      id: "charge",
      phase: "tactics",
      run: (current, owner) => ({ type: "attackMove", unitIds: current.units.filter((unit) => unit.owner === owner).map((unit) => unit.id), x: 2_050, y: 1_500 }),
    };
    const commands = planAiCommandsFromScripts(snapshot, "v6", [charge, AI_SCRIPT_LIBRARY.v6Backline], { ...V6, teams: game.teams });
    const attackMove = commands.find((command) => command.type === "attackMove") as Extract<GameCommand, { type: "attackMove" }>;
    expect(attackMove.unitIds).toHaveLength(4);
    expect(attackMove.unitIds).not.toContain("summoner");
    expect(commands).toContainEqual(expect.objectContaining({ type: "move", unitIds: ["summoner"] }));
  });
});
