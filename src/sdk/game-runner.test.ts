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
        player: { controller: "external-agent", team: "north", race: "grove", versionLabel: "manual" },
        enemy: { controller: "external-agent", team: "south", race: "ember", versionLabel: "manual" },
      },
      commandPlanner,
      maxTicks: 1,
      thinkInterval: 1,
      trace: { commands: true },
    });

    expect(report.commandCounts.mine).toBe(1);
    expect(report.commands[0]).toMatchObject({ owner: "player", source: "external-agent", scriptId: "sdk-test-planner" });
  });

  it("separates seat controller setup from trace source labels", () => {
    const seenSources: string[] = [];
    const commandPlanner: SdkGameCommandPlanner = ({ owner, source }) => {
      seenSources.push(`${owner}:${source}`);
      return [];
    };

    const report = runGame({
      name: "controller-trace-split",
      mapId: "bareDuel",
      agents: {
        player: { controller: "internal-ai", traceSource: "external-agent", team: "north", race: "grove", versionLabel: "manual" },
        enemy: { controller: "external-agent", traceSource: "internal-ai", team: "south", race: "ember", versionLabel: "manual" },
      },
      commandPlanner,
      maxTicks: 1,
      thinkInterval: 1,
    });

    expect(seenSources).toEqual(["player:external-agent", "enemy:internal-ai"]);
    expect(report.tick).toBe(1);
  });

  it("does not issue commands when no planner is supplied", () => {
    const loop = runGameLoop({
      name: "no-planner",
      mapId: "bareDuel",
      agents: {
        player: { controller: "external-agent", team: "north", race: "grove", versionLabel: "manual" },
        enemy: { controller: "external-agent", team: "south", race: "ember", versionLabel: "manual" },
      },
      maxTicks: 2,
      thinkInterval: 1,
    });

    expect(loop.game.tick).toBe(2);
  });

  it("does not let building elimination decide combat-elimination runs", () => {
    const game = sketchScene("combat-runner-ignores-building-victory")
      .map("combatArena")
      .replaceDefaults()
      .player("north", { team: "north", race: "grove" })
      .player("south", { team: "south", race: "grove" })
      .townHall("south", 1450, 800)
      .unit("north", "footman", 520, 800)
      .unit("south", "footman", 1080, 800)
      .build()
      .createGame();

    const report = runGame({
      name: "combat-elimination-no-building-win",
      game,
      winnerMode: "combatElimination",
      agents: {
        north: { controller: "external-agent", team: "north", race: "grove", versionLabel: "manual" },
        south: { controller: "external-agent", team: "south", race: "grove", versionLabel: "manual" },
      },
      maxTicks: 2,
      thinkInterval: 1,
    });

    expect(report.winner).toBeNull();
    expect(report.winnerTeam).toBe("timeout");
    expect(report.timeout).toBe(true);
  });

  it("declares the combat survivor as winner even when the opponent still has buildings", () => {
    const game = sketchScene("combat-runner-survivor-wins")
      .map("combatArena")
      .replaceDefaults()
      .player("north", { team: "north", race: "grove" })
      .player("south", { team: "south", race: "grove" })
      .townHall("south", 1450, 800)
      .unit("north", "footman", 520, 800)
      .build()
      .createGame();

    const report = runGame({
      name: "combat-elimination-survivor",
      game,
      winnerMode: "combatElimination",
      agents: {
        north: { controller: "external-agent", team: "north", race: "grove", versionLabel: "manual" },
        south: { controller: "external-agent", team: "south", race: "grove", versionLabel: "manual" },
      },
      maxTicks: 2,
      thinkInterval: 1,
    });

    expect(report.winner).toBe("north");
    expect(report.winnerTeam).toBe("north");
    expect(report.timeout).toBe(false);
  });
});
