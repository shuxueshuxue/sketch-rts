import { describe, expect, it } from "vitest";
import { runGame, runGameLoop, type SdkGameCommandPlanner } from "./game-runner";
import { sketchScene } from "./scene";

describe("SDK game runner", () => {
  it("runs generic command planners without depending on AI policy", () => {
    const game = sketchScene("sdk-runner-command-planner")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north", race: "grove" })
      .player("enemy", { team: "south", race: "ember" })
      .townHall("player", 500, 500)
      .worker("player", 520, 500, { id: "worker" })
      .goldMine("mine", 580, 500, 4000)
      .townHall("enemy", 3400, 3400)
      .build()
      .createGame();
    const commandPlanner: SdkGameCommandPlanner = ({ owner, source }) =>
      owner === "player"
        ? [
            {
              playerId: owner,
              source,
              scriptId: "sdk-test-planner",
              command: { type: "mine", unitIds: ["worker"], resourceId: "mine" },
            },
          ]
        : [];

    const report = runGame({
      name: "generic-planner",
      game,
      agents: {
        player: { adapter: "external", team: "north", race: "grove", versionLabel: "manual" },
        enemy: { adapter: "external", team: "south", race: "ember", versionLabel: "manual" },
      },
      commandPlanner,
      maxTicks: 1,
      thinkInterval: 1,
      trace: { commands: true },
    });

    expect(report.commandCounts.mine).toBe(1);
    expect(report.commands[0]).toMatchObject({ owner: "player", source: "external-agent", scriptId: "sdk-test-planner" });
  });

  it("does not issue commands when no planner is supplied", () => {
    const loop = runGameLoop({
      name: "no-planner",
      mapId: "bareDuel",
      agents: {
        player: { adapter: "external", team: "north", race: "grove", versionLabel: "manual" },
        enemy: { adapter: "external", team: "south", race: "ember", versionLabel: "manual" },
      },
      maxTicks: 2,
      thinkInterval: 1,
    });

    expect(loop.game.tick).toBe(2);
  });
});
