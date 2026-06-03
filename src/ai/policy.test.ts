import { describe, expect, it } from "vitest";
import { createBuilding } from "../shared/map";
import { runAiGame } from "./game-runner";
import { createAiRuntime, runPresetAiRuntime } from "./runtime";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../shared/sim";
import { AI_SCRIPT_LIBRARY, AI_SCRIPT_VERSIONS, createAiPolicyMemory, createAiTelemetry, planAiCommandEntriesFromScripts, planAiCommandsFromScripts, planPresetAiCommandEntries, planPresetAiCommands } from "./policy";
import { sketchScene } from "../sdk/scene";

describe("SDK preset AI policy", () => {
  it("exposes named AI script versions for SDK and room adapters", () => {
    expect(Object.keys(AI_SCRIPT_VERSIONS)).toEqual(["v1", "v2"]);
    expect(AI_SCRIPT_VERSIONS.v1.length).toBeGreaterThan(0);
    expect(AI_SCRIPT_VERSIONS.v2.map((script) => script.id)).toEqual(AI_SCRIPT_VERSIONS.v1.map((script) => script.id));

    const game = createGame("bareDuel", { aiPlayers: [] });
    const v1 = planPresetAiCommands(snapshotGame(game), "player", { version: "v1" });
    const v2 = planPresetAiCommands(snapshotGame(game), "player", { version: "v2" });

    expect(v1[0]).toMatchObject({ type: "mine" });
    expect(v2[0]).toMatchObject({ type: "mine" });
  });

  it("turns idle workers into ordinary player mine commands", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const command = planPresetAiCommands(snapshotGame(game), "player")[0];

    expect(command).toMatchObject({ type: "mine" });
    if (command?.type === "mine") {
      issuePlayerCommand(game, "player", command);
      expect(command.unitIds.length).toBeGreaterThan(0);
      for (let i = 0; i < 5; i += 1) {
        for (const nextCommand of planPresetAiCommands(snapshotGame(game), "player")) {
          if (nextCommand.type === "mine") issuePlayerCommand(game, "player", nextCommand);
        }
      }
      expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker").every((unit) => unit.order.type === "mine")).toBe(true);
    }
  });

  it("uses local scripts without internal AI ownership to build train and attack", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });

    for (let i = 0; i < 1200; i += 1) {
      for (const owner of ["player", "enemy"] as const) {
        for (const command of planPresetAiCommands(snapshotGame(game), owner)) {
          issuePlayerCommand(game, owner, command);
        }
      }
      stepGame(game);
    }

    expect("ai" in game).toBe(false);
    expect(game.match.stats.goldSpent.player + game.match.stats.goldSpent.enemy).toBeGreaterThan(0);
    expect(game.buildings.some((building) => building.owner === "player" && building.kind === "barracks")).toBe(true);
    expect(game.buildings.some((building) => building.owner === "enemy" && building.kind === "barracks")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "player" && unit.kind !== "worker")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "enemy" && unit.kind !== "worker")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "player" && unit.order.type === "attackMove")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "enemy" && unit.order.type === "attackMove")).toBe(true);
  });

  it("does not spam identical attack-move commands when the army is already on the current objective", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const soldiers = Array.from({ length: 5 }, (_, index) => game.spawnUnit("player", "footman", 900 + index * 12, 900));
    const firstAttack = planPresetAiCommands(snapshotGame(game), "player").find((command) => command.type === "attackMove");
    expect(firstAttack).toBeDefined();
    if (firstAttack?.type !== "attackMove") throw new Error("expected attackMove");
    for (const soldier of soldiers) soldier.order = { type: "attackMove", x: firstAttack.x, y: firstAttack.y };

    const repeatedAttack = planPresetAiCommands(snapshotGame(game), "player").find((command) => command.type === "attackMove");

    expect(repeatedAttack).toBeUndefined();
  });

  it("redirects attack-move armies when their current objective is stale", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const soldiers = Array.from({ length: 5 }, (_, index) => game.spawnUnit("player", "footman", 900 + index * 12, 900));
    for (const soldier of soldiers) soldier.order = { type: "attackMove", x: 80, y: 80 };

    const attack = planPresetAiCommands(snapshotGame(game), "player").find((command) => command.type === "attackMove");

    expect(attack).toBeDefined();
    expect(attack?.type === "attackMove" ? attack.unitIds.length : 0).toBe(5);
  });

  it("goes straight for the last enemy town hall when only a few defenders remain", () => {
    const scene = sketchScene("endgame-town-hall-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("winner", { team: "north", race: "grove" })
      .player("loser", { team: "south", race: "ember" })
      .townHall("winner", 3300, 3300)
      .unit("winner", "footman", 1800, 1700)
      .unit("winner", "footman", 1840, 1720)
      .unit("winner", "lancer", 1880, 1740)
      .unit("winner", "archer", 1920, 1760)
      .unit("winner", "archer", 1960, 1780)
      .townHall("loser", 500, 1450, { id: "loser-last-hall" })
      .unit("loser", "mercenary", 1150, 1220)
      .unit("loser", "contractArcher", 1200, 1240)
      .unit("loser", "fieldMedic", 1250, 1260)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "winner", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 500, y: 1450 });
  });

  it("does not let a few last defenders drag the winning army away from a building closeout", () => {
    const scene = sketchScene("endgame-closeout-beats-light-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("winner", { team: "north", race: "grove" })
      .player("loser", { team: "south", race: "ember" })
      .townHall("winner", 3300, 3300)
      .building("winner", "defenseTower", 1220, 1200, { id: "winner-pressured-tower" })
      .unit("winner", "footman", 1800, 1700)
      .unit("winner", "footman", 1840, 1720)
      .unit("winner", "lancer", 1880, 1740)
      .unit("winner", "lancer", 1920, 1760)
      .unit("winner", "archer", 1960, 1780)
      .unit("winner", "archer", 2000, 1800)
      .townHall("loser", 500, 1450, { id: "loser-last-hall" })
      .unit("loser", "mercenary", 1160, 1210)
      .unit("loser", "contractArcher", 1200, 1240)
      .unit("loser", "fieldMedic", 1240, 1270)
      .build();
    const game = scene.createGame();
    const pressuredTower = game.buildings.find((building) => building.id === "winner-pressured-tower");
    if (!pressuredTower) throw new Error("missing pressured tower");
    pressuredTower.hp = pressuredTower.maxHp * 0.6;

    const command = planAiCommandsFromScripts(snapshotGame(game), "winner", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 500, y: 1450 });
  });

  it("v2 targets a surviving combat group before the last town hall when the loser still has an army", () => {
    const scene = sketchScene("v2-endgame-army-before-last-hall")
      .map("openClaims")
      .replaceDefaults()
      .player("winner", { team: "north", race: "grove" })
      .player("loser", { team: "south", race: "ember" })
      .townHall("winner", 3300, 3300)
      .unit("winner", "footman", 1300, 1500)
      .unit("winner", "footman", 1340, 1520)
      .unit("winner", "lancer", 1380, 1540)
      .unit("winner", "lancer", 1420, 1560)
      .unit("winner", "archer", 1460, 1580)
      .unit("winner", "archer", 1500, 1600)
      .townHall("loser", 500, 1450, { id: "loser-last-hall" })
      .unit("loser", "footman", 1780, 1940)
      .unit("loser", "lancer", 1820, 1960)
      .unit("loser", "archer", 1860, 1980)
      .unit("loser", "contractArcher", 1900, 2000)
      .unit("loser", "fieldMedic", 1940, 2020)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "winner", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attack" });
    expect(command?.type === "attack" ? command.targetId : "").toContain("loser");
  });

  it("v2 cleans up a crippled opponent's buildings even while another enemy player still has an army elsewhere", () => {
    const scene = sketchScene("v2-cleanup-crippled-player-before-far-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "footman", 1320, 1420)
      .unit("v2", "lancer", 1360, 1440)
      .unit("v2", "lancer", 1400, 1460)
      .unit("v2", "archer", 1440, 1480)
      .unit("v2", "archer", 1480, 1500)
      .unit("v2", "raider", 1520, 1520)
      .unit("v2", "knight", 1560, 1540)
      .unit("v2", "knight", 1600, 1560)
      .unit("v2", "priest", 1640, 1580)
      .townHall("v1a", 1760, 1540, { id: "v1a-crippled-hall" })
      .building("v1a", "barracks", 1840, 1620, { id: "v1a-crippled-barracks" })
      .townHall("v1b", 3400, 3400)
      .unit("v1b", "footman", 3300, 3300)
      .unit("v1b", "footman", 3340, 3320)
      .unit("v1b", "lancer", 3380, 3340)
      .unit("v1b", "archer", 3420, 3360)
      .unit("v1b", "contractArcher", 3460, 3380)
      .unit("v1b", "fieldMedic", 3500, 3400)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1840, y: 1620 });
  });

  it("v2 does not trickle a tiny free squad into crippled cleanup while another enemy economy is alive", () => {
    const scene = sketchScene("v2-no-tiny-crippled-cleanup")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400, { id: "busy-1", order: { type: "attack", targetId: "v1b-front-1" } })
      .unit("v2", "footman", 1320, 1420, { id: "busy-2", order: { type: "attack", targetId: "v1b-front-1" } })
      .unit("v2", "lancer", 1360, 1440, { id: "busy-3", order: { type: "attack", targetId: "v1b-front-2" } })
      .unit("v2", "lancer", 1400, 1460, { id: "busy-4", order: { type: "attack", targetId: "v1b-front-2" } })
      .unit("v2", "archer", 1440, 1480, { id: "busy-5", order: { type: "attack", targetId: "v1b-front-3" } })
      .unit("v2", "footman", 1480, 1500)
      .unit("v2", "lancer", 1520, 1520)
      .townHall("v1a", 1760, 1540, { id: "v1a-crippled-hall" })
      .building("v1a", "barracks", 1840, 1620, { id: "v1a-crippled-barracks" })
      .townHall("v1b", 3400, 3400)
      .worker("v1b", 3360, 3380)
      .worker("v1b", 3380, 3420)
      .unit("v1b", "footman", 3300, 3300, { id: "v1b-front-1" })
      .unit("v1b", "lancer", 3340, 3320, { id: "v1b-front-2" })
      .unit("v1b", "archer", 3380, 3340, { id: "v1b-front-3" })
      .unit("v1b", "contractArcher", 3420, 3360)
      .unit("v1b", "fieldMedic", 3460, 3380)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 waits for a real wave before crossing the map in ordinary one-on-one pressure", () => {
    const scene = sketchScene("v2-no-single-unit-cross-map-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 720, 600)
      .townHall("v1", 3300, 3300)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not count untouched neutral camps as enemy army when deciding whether to push", () => {
    const scene = sketchScene("v2-neutral-camps-do-not-freeze-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "footman", 1320, 1420)
      .unit("v2", "lancer", 1360, 1440)
      .unit("v2", "lancer", 1400, 1460)
      .unit("v2", "archer", 1440, 1480)
      .unit("v2", "archer", 1480, 1500)
      .unit("v2", "raider", 1520, 1520)
      .townHall("v1a", 1760, 1540, { id: "v1a-last-hall" })
      .unit("neutral", "ancientStag", 3400, 3400)
      .unit("neutral", "ancientStag", 3480, 3440)
      .unit("neutral", "stonebackBrute", 3520, 3360)
      .unit("neutral", "gladeWitch", 3560, 3420)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1760, y: 1540 });
  });

  it("v2 does not target nearby neutral camps as attack-wave enemy army", () => {
    const scene = sketchScene("v2-attack-wave-ignores-neutral-army-target")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "archer", 1320, 1420)
      .unit("v2", "footman", 1360, 1380)
      .unit("v2", "lancer", 1400, 1400)
      .unit("v2", "archer", 1440, 1420)
      .townHall("v1a", 3100, 1450, { id: "v1a-last-hall" })
      .unit("neutral", "stonebackBrute", 1520, 1460, { id: "neutral-brute" })
      .unit("neutral", "thornSlinger", 1560, 1500)
      .unit("neutral", "gladeWitch", 1600, 1460)
      .unit("neutral", "wildling", 1640, 1500)
      .unit("neutral", "mossGnawer", 1680, 1460)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command).not.toMatchObject({ type: "attack", targetId: "neutral-brute" });
  });

  it("v2 holds the main rally instead of oscillating back to natural clearing while a stronger army approaches", () => {
    const scene = sketchScene("v2-main-hold-blocks-natural-oscillation")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 500, 500)
      .unit("v2", "lancer", 530, 520)
      .unit("v2", "archer", 470, 520)
      .unit("v2", "contractArcher", 510, 540)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 1250, 500)
      .unit("v1", "footman", 1280, 530)
      .unit("v1", "lancer", 1310, 560)
      .unit("v1", "lancer", 1340, 590)
      .unit("v1", "archer", 1370, 620)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 920, 920, 4000)
      .unit("neutral", "stonebackBrute", 920, 920)
      .unit("neutral", "thornSlinger", 960, 960)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove" || candidate.type === "move");

    expect(command).toBeUndefined();
  });

  it("v2 keeps ordinary neutral objective control pointed at the guarded first natural", () => {
    const scene = sketchScene("v2-natural-preempts-neutral-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 900, 760)
      .unit("v2", "footman", 930, 790)
      .unit("v2", "lancer", 960, 820)
      .unit("v2", "archer", 990, 850)
      .unit("v2", "footman", 1020, 880)
      .townHall("v1", 3400, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1000, 2200, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .unit("neutral", "stonebackBrute", 1000, 2200)
      .unit("neutral", "thornSlinger", 1040, 2240)
      .unit("neutral", "gladeWitch", 960, 2240)
      .unit("neutral", "mossGnawer", 1600, 1150)
      .unit("neutral", "wildling", 1640, 1190)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1000, y: 2226.6666666666665 });
  });

  it("v2 lets attack-wave closeout preempt neutral objective control when the enemy has no army or workers", () => {
    const scene = sketchScene("v2-closeout-preempts-neutral-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "footman", 1320, 1420)
      .unit("v2", "lancer", 1360, 1440)
      .unit("v2", "lancer", 1400, 1460)
      .unit("v2", "archer", 1440, 1480)
      .unit("v2", "archer", 1480, 1500)
      .unit("v2", "raider", 1520, 1520)
      .townHall("v1a", 3100, 1450, { id: "v1a-last-hall" })
      .unit("neutral", "ancientStag", 1300, 2500)
      .unit("neutral", "stonebackBrute", 1360, 2560)
      .unit("neutral", "gladeWitch", 1420, 2520)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "objectiveControl")).toBe(false);
    expect(entries.find((entry) => entry.scriptId === "attackWave")?.command).toMatchObject({ type: "attackMove", x: 3100, y: 1450 });
  });

  it("worker-pressure closeout targets a weak single opponent as a rewrite candidate module", () => {
    const scene = sketchScene("v2-closeout-preempts-cleared-mercenary")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .unit("v2", "footman", 1480, 1400)
      .unit("v2", "footman", 1520, 1420)
      .unit("v2", "lancer", 1560, 1440)
      .unit("v2", "archer", 1600, 1460)
      .unit("v2", "contractArcher", 1640, 1480)
      .townHall("v1a", 3100, 1450)
      .worker("v1a", 3040, 1440)
      .worker("v1a", 3060, 1480)
      .unit("v1a", "footman", 2980, 1450)
      .unit("v1a", "archer", 3000, 1490)
      .mercenaryCamp("cleared-contract-post", 1800, 1540, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressureCloseout], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command).toMatchObject({ type: "attack" });
  });

  it("v2 does not call worker pressure closeout while a single opponent can still produce and fight", () => {
    const scene = sketchScene("v2-no-fake-worker-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .unit("v2", "footman", 1480, 1400)
      .unit("v2", "footman", 1520, 1420)
      .unit("v2", "lancer", 1560, 1440)
      .townHall("v1a", 3100, 1450)
      .building("v1a", "barracks", 3000, 1360)
      .tower("v1a", 2960, 1500)
      .worker("v1a", 3040, 1440)
      .worker("v1a", 3060, 1480)
      .unit("v1a", "footman", 2980, 1450)
      .unit("v1a", "archer", 3000, 1490)
      .mercenaryCamp("cleared-contract-post", 1800, 1540, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "workerPressureCloseout")).toBe(false);
  });

  it("v2 builds missing core production before spending the economy frame on mercenary control", () => {
    const scene = sketchScene("v2-production-before-mercenary")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "barracks", 650, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 820, 700)
      .unit("v2", "footman", 860, 720)
      .unit("v2", "lancer", 900, 740)
      .townHall("v1a", 3100, 1450)
      .building("v1a", "barracks", 3000, 1360)
      .worker("v1a", 3040, 1440)
      .unit("v1a", "footman", 2980, 1450)
      .mercenaryCamp("cleared-contract-post", 1080, 860, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 200;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", buildingKind: "archeryRange" });
    expect(entries.some((entry) => entry.scriptId === "mercenary")).toBe(false);
  });

  it("expansion candidate builds a cleared first expansion before mercenary control", () => {
    const scene = sketchScene("v2-expansion-before-mercenary")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 820, 700)
      .unit("v2", "footman", 860, 720)
      .unit("v2", "lancer", 900, 740)
      .unit("v2", "archer", 940, 760)
      .townHall("v1a", 3100, 1450)
      .worker("v1a", 3040, 1440)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .mercenaryCamp("cleared-contract-post", 1060, 860, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 420;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion, AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(entries.some((entry) => entry.scriptId === "mercenary")).toBe(false);
  });

  it("v2 does not spend catch-up expansion gold before a five-unit field group exists", () => {
    const scene = sketchScene("v2-no-thin-catchup-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 820, 700)
      .unit("v2", "lancer", 860, 720)
      .unit("v2", "archer", 900, 740)
      .unit("v2", "contractArcher", 940, 760)
      .townHall("v1", 3100, 1450)
      .townHall("v1", 2860, 1600)
      .worker("v1", 3040, 1440)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 335;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 does not spend near-complete first-expansion gold on a moon well", () => {
    const scene = sketchScene("v2-holds-first-expansion-gold-before-moon-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "farm", 690, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .tower("v2", 590, 620)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 650, 620, { hp: 80 })
      .unit("v2", "footman", 690, 640, { hp: 82 })
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "lancer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .unit("v2", "archer", 850, 720)
      .unit("v2", "footman", 890, 740)
      .unit("v2", "lancer", 930, 760)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1560, 500)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 285;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 does not spend near-complete first-expansion gold on routine training", () => {
    const scene = sketchScene("v2-holds-first-expansion-gold-before-training")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "farm", 690, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .building("v2", "stables", 770, 560)
      .tower("v2", 590, 620)
      .worker("v2", 560, 540)
      .worker("v2", 580, 540)
      .worker("v2", 600, 540)
      .worker("v2", 620, 540)
      .worker("v2", 640, 540)
      .unit("v2", "footman", 650, 620, { hp: 80 })
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "lancer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .unit("v2", "archer", 850, 720)
      .unit("v2", "footman", 890, 740)
      .unit("v2", "lancer", 930, 760)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1560, 500)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 285;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 keeps combat production active before the first expansion bank in the copperWeald control timing", () => {
    const report = runAiGame({
      name: "copperWeald first expansion training timing",
      mapId: "copperWeald",
      agents: {
        v2: { adapter: "external", team: "north", race: "grove", version: "v2", versionLabel: "v2" },
        v1a: { adapter: "external", team: "south", race: "grove", version: "v1", versionLabel: "v1" },
      },
      maxTicks: 4_501,
      thinkInterval: 45,
      trace: { commands: true },
    });

    const combatTrainingBeforeBankStall = report.commands.filter(
      (entry) =>
        entry.tick >= 2_000 &&
        entry.tick <= 3_600 &&
        entry.owner === "v2" &&
        entry.scriptId === "training" &&
        entry.command.type === "train" &&
        entry.command.unitKind !== "worker",
    );

    expect(combatTrainingBeforeBankStall.length).toBeGreaterThanOrEqual(2);
  });

  it("v2 preserves worker gold for first combat recovery when its army has been wiped", () => {
    const scene = sketchScene("v2-first-combat-recovery-before-workers")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1_250, 760, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .townHall("v1a", 3_300, 3_300)
      .unit("v1a", "footman", 850, 820)
      .unit("v1a", "lancer", 900, 840)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1_300, 760, 4000)
      .goldMine("v1a-main-mine", 3_300, 3_240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 75;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands.find((command) => command.type === "train")).toBeUndefined();
  });

  it("v2 does not split a thin post-expansion army just to pre-claim a mercenary camp", () => {
    const scene = sketchScene("v2-no-thin-merc-preclaim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1_250, 760)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 1_850, 1_650)
      .unit("v2", "footman", 1_890, 1_680)
      .unit("v2", "lancer", 1_930, 1_710)
      .unit("v2", "footman", 1_970, 1_740)
      .unit("v2", "lancer", 2_010, 1_770)
      .unit("v2", "footman", 2_050, 1_800)
      .townHall("v1a", 3_300, 3_300)
      .unit("v1a", "footman", 2_350, 2_200)
      .unit("v1a", "footman", 2_390, 2_230)
      .unit("v1a", "lancer", 2_430, 2_260)
      .unit("v1a", "lancer", 2_470, 2_290)
      .unit("v1a", "archer", 2_510, 2_320)
      .unit("v1a", "archer", 2_550, 2_350)
      .mercenaryCamp("thin-claim-camp", 1_340, 1_520, { hireKind: "mercenary", stock: 2, cost: 220 })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1_300, 760, 4000)
      .goldMine("v1a-main-mine", 3_300, 3_240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 50;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams });

    expect(commands.find((command) => command.type === "attackMove")).toBeUndefined();
  });

  it("v2 does not pre-claim a mercenary camp with only the first three fighters", () => {
    const scene = sketchScene("v2-no-first-three-merc-preclaim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .unit("v2", "footman", 900, 780)
      .unit("v2", "footman", 940, 800)
      .unit("v2", "lancer", 980, 820)
      .townHall("v1a", 3_300, 3_300)
      .mercenaryCamp("first-three-camp", 1_120, 920, { hireKind: "mercenary", stock: 2, cost: 220 })
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams });

    expect(commands.find((command) => command.type === "attackMove")).toBeUndefined();
  });

  it("v2 does not spend near-complete first-expansion gold on extra supply", () => {
    const scene = sketchScene("v2-holds-first-expansion-gold-before-supply")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .tower("v2", 590, 620)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 650, 620)
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "lancer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .unit("v2", "archer", 850, 720)
      .unit("v2", "footman", 890, 740)
      .unit("v2", "lancer", 930, 760)
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 285;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.supply], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 does not spend the first main-guard tower bank on a moon well", () => {
    const scene = sketchScene("v2-main-guard-tower-before-moon-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1160, 980, { id: "v2-natural" })
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 780, 620, { hp: 85 })
      .unit("v2", "footman", 820, 650, { hp: 90 })
      .unit("v2", "lancer", 860, 680)
      .unit("v2", "contractArcher", 900, 710)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1_160, 760)
      .unit("v1", "lancer", 1_200, 790)
      .unit("v1", "contractArcher", 1_240, 820)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 115;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 restores combat before extra workers when production survives an army wipe", () => {
    const scene = sketchScene("v2-combat-before-worker-after-army-wipe")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1160, 980)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 560, 540)
      .worker("v2", 590, 540)
      .worker("v2", 620, 540)
      .worker("v2", 1160, 980)
      .worker("v2", 1190, 980)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 900, 700)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 105;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([{ type: "train", buildingId: "scene-v2-combat-before-worker-after-army-wipe-v2-barracks-1", unitKind: "footman" }]);
  });

  it("v2 trains a sixth one-base worker as build and repair labor after core production exists", () => {
    const scene = sketchScene("v2-one-base-repair-labor-worker")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 540, 520, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 560, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 590, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 620, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 650, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 800, 640)
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 125;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([{ type: "train", buildingId: "v2-main", unitKind: "worker" }]);
  });

  it("v2 keeps training workers toward two-mine saturation when it can also rebuild army", () => {
    const scene = sketchScene("v2-two-mine-worker-saturation-after-army-loss")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1160, 980, { id: "v2-natural" })
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 710, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 560, 540, { id: "main-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 590, 540, { id: "main-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 620, 540, { id: "main-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1160, 980, { id: "natural-worker-a", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1190, 980, { id: "natural-worker-b", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 1000;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual(
      expect.arrayContaining([
        { type: "train", buildingId: "v2-main", unitKind: "worker" },
        { type: "train", buildingId: "v2-barracks", unitKind: "footman" },
      ]),
    );
  });

  it("v2 does not spend the thin two-mine defense bank on extra workers", () => {
    const scene = sketchScene("v2-two-mine-defense-bank-before-workers")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1160, 980, { id: "v2-natural" })
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 710, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 560, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 590, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 620, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1160, 980, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1190, 980, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .unit("v2", "footman", 780, 620)
      .unit("v2", "footman", 820, 650)
      .unit("v2", "lancer", 860, 680)
      .unit("v2", "contractArcher", 900, 710)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1180, 760)
      .unit("v1", "footman", 1220, 790)
      .unit("v1", "lancer", 1260, 820)
      .unit("v1", "contractArcher", 1300, 850)
      .unit("v1", "mercenary", 1340, 880)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 75;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).not.toContainEqual({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 still saturates the main mine to five workers while banking for the first expansion", () => {
    const scene = sketchScene("v2-main-mine-workers-before-expansion-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "farm", 560, 660)
      .building("v2", "farm", 610, 700)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 540, 520)
      .worker("v2", 570, 520)
      .worker("v2", 600, 520)
      .unit("v2", "footman", 650, 620)
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "archer", 770, 680)
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 300;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toContainEqual({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 does not trickle the first soldier into two enemy economies", () => {
    const teams = { v2: "north", v1a: "south", v1b: "south" };
    const game = createGame("bareDuel", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams,
      races: { v2: "grove", v1a: "grove", v1b: "ember" },
    });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    game.spawnUnit("v2", "footman", 900, 2050);
    game.spawnUnit("v1a", "footman", 3000, 1600);
    game.spawnUnit("v1b", "lancer", 3000, 2600);

    const attack = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams }).find((command) => command.type === "attackMove");

    expect(attack).toBeUndefined();
  });

  it("v2 does not spend its first two soldiers on a worker raid against two economies", () => {
    const scene = sketchScene("v2-no-first-pair-raid")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "archer", 790, 650)
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attack")).toBe(false);
  });

  it("places early main-base production away from nearby neutral camps on multiplayer starts", () => {
    const game = createGame("wildMarches", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams: { v2: "north", v1a: "south", v1b: "south" },
      races: { v2: "grove", v1a: "grove", v1b: "ember" },
    });

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build" && candidate.buildingKind === "barracks");
    const nearestNeutralDistance =
      command?.type === "build"
        ? Math.min(...game.units.filter((unit) => unit.owner === "neutral").map((unit) => Math.hypot(unit.x - command.x, unit.y - command.y)))
        : 0;

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
    expect(nearestNeutralDistance).toBeGreaterThan(330);
  });

  it("worker-pressure candidate uses a committed job instead of the fragile pair raid while globally outmatched", () => {
    const scene = sketchScene("v2-no-outmatched-raid")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "archer", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 3360, 3300)
      .unit("v1a", "footman", 3280, 3300)
      .unit("v1a", "archer", 3300, 3340)
      .unit("v1a", "lancer", 3320, 3380)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .unit("v1b", "raider", 3280, 3800)
      .unit("v1b", "lancer", 3300, 3840)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment, AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "earlyHarassment")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "workerPressure")).toMatchObject({ command: { type: "attack" } });
  });

  it("v2 pulls a wounded melee unit out of a neutral camp instead of donating it while creeping", () => {
    const scene = sketchScene("v2-neutral-creep-wounded-melee-save")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 910, 2520, { id: "wounded-footman", hp: 42, order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "lancer", 950, 2530, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 990, 2540, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("neutral", "stonebackBrute", 850, 2515)
      .unit("neutral", "thornSlinger", 820, 2560)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move", unitIds: expect.arrayContaining(["wounded-footman"]), x: 520, y: 520 });
  });

  it("v2 preset combat policy pulls wounded units before attack-wave can retask them", () => {
    const scene = sketchScene("v2-combat-preset-wounded-retreat")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 150, 800, { id: "v2-anchor" })
      .unit("v2", "archer", 700, 800, { id: "wounded-archer", hp: 28 })
      .unit("v2", "footman", 680, 835, { id: "healthy-footman" })
      .unit("v1a", "footman", 740, 800, { id: "enemy-footman" })
      .townHall("v1a", 1450, 800, { id: "v1a-anchor" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat", memory });
    const retreat = entries.find((entry) => entry.scriptId === "skirmishPreservation" && entry.command.type === "move")?.command;

    expect(retreat).toMatchObject({ type: "move", unitIds: ["wounded-archer"], x: 502, y: 800 });
    expect(memory.unitClaims["wounded-archer"]).toMatchObject({ kind: "retreat", targetId: "retreat", x: 502, y: 800 });
    expect(entries.filter((entry) => entry.command.type === "attack" || entry.command.type === "attackMove").some((entry) => "unitIds" in entry.command && entry.command.unitIds.includes("wounded-archer"))).toBe(false);
  });

  it("v2 pulls wounded units away from neutral camps that are already near the main economy", () => {
    const scene = sketchScene("v2-neutral-near-main-retreat-away")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 610, 500)
      .townHall("v1", 3400, 3400)
      .unit("v2", "footman", 700, 560, { id: "wounded-footman", hp: 40, order: { type: "attackMove", x: 760, y: 560 } })
      .unit("neutral", "stonebackBrute", 820, 560)
      .unit("neutral", "thornSlinger", 860, 600)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move", unitIds: expect.arrayContaining(["wounded-footman"]) });
    expect(command?.type === "move" ? command.x : 500).toBeLessThan(500);
  });

  it("does not let objective control keep sending a sliced remnant squad after creep-preservation retreats", () => {
    const scene = sketchScene("v2-neutral-creep-sliced-squad")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 910, 2520, { id: "wounded-footman-a", hp: 42, order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "footman", 940, 2540, { id: "wounded-footman-b", hp: 42, order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 980, 2560, { id: "fresh-archer" })
      .unit("v2", "lancer", 1020, 2520, { id: "fresh-lancer-a" })
      .unit("v2", "lancer", 1050, 2540, { id: "fresh-lancer-b" })
      .unit("neutral", "mossGnawer", 850, 2515)
      .unit("neutral", "wildling", 880, 2540)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands.filter((command) => command.type === "move").length).toBeGreaterThan(0);
    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("does not treat a nearby neutral camp as main-base pressure for attack-wave rally logic", () => {
    const scene = sketchScene("v2-neutral-camp-not-main-pressure")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 2048)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 760, 2350, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "footman", 790, 2370, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "lancer", 820, 2390, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 850, 2410, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 880, 2430, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("neutral", "stonebackBrute", 860, 2520)
      .unit("neutral", "thornSlinger", 900, 2560)
      .unit("neutral", "gladeWitch", 820, 2560)
      .unit("neutral", "barkMender", 860, 2600)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 pauses neutral objective control when an enemy combat unit reaches the main worker line", () => {
    const scene = sketchScene("v2-main-worker-line-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 650, 620)
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "archer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .townHall("v1", 3100, 1450)
      .unit("v1", "mercenary", 660, 540)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .unit("neutral", "stonebackBrute", 1180, 760)
      .unit("neutral", "thornSlinger", 1220, 800)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 does not send leftover ranged units as an attack wave while the main group is recovering", () => {
    const scene = sketchScene("v2-no-leftover-ranged-attack-wave")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 491.52, 2048)
      .unit("v2", "footman", 620, 2050, { hp: 55, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "lancer", 650, 2070, { hp: 58, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "fieldMedic", 680, 2090, { hp: 40, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "fieldMedic", 710, 2110, { hp: 42, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "footman", 740, 2130, { hp: 56, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "contractArcher", 1050, 1580)
      .unit("v2", "contractArcher", 1080, 1600)
      .unit("v2", "contractArcher", 1110, 1620)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 1220, 1640)
      .unit("v1", "contractArcher", 1260, 1660)
      .unit("v1", "mercenary", 1300, 1680)
      .unit("v1", "fieldMedic", 1340, 1700)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 keeps expansion regroup from pulling defenders away while the main worker line is under attack", () => {
    const scene = sketchScene("v2-main-mine-does-not-regroup-to-expansion")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 491.52, 2048)
      .townHall("v2", 720, 2540)
      .worker("v2", 608, 2002)
      .unit("v2", "footman", 670, 2511)
      .unit("v2", "lancer", 705, 2511)
      .unit("v2", "fieldMedic", 757, 2536)
      .unit("v2", "fieldMedic", 742, 2566)
      .unit("v2", "footman", 678, 2544)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 645, 2148)
      .unit("v1", "contractArcher", 680, 2160)
      .unit("v1", "contractArcher", 710, 2180)
      .unit("v1", "mercenary", 740, 2200)
      .unit("v1", "contractArcher", 770, 2220)
      .unit("v1", "mercenary", 800, 2240)
      .unit("v1", "fieldMedic", 830, 2260)
      .unit("v1", "footman", 860, 2280)
      .goldMine("v2-main-mine", 640, 2040, 4000)
      .goldMine("v2-natural-mine", 720, 2540, 4000)
      .goldMine("v1-main-mine", 3300, 3300, 4000)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionRegroup], { version: "v2", teams: game.teams });

    expect(commands[0]).toMatchObject({ type: "move", x: 491.52, y: 2048 });
  });

  it("does not reassign wounded units that are already moving home into another neutral objective", () => {
    const scene = sketchScene("v2-neutral-creep-recovery-commitment")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 760, 2350, { id: "recovering-a", hp: 48, order: { type: "move", x: 520, y: 520 } })
      .unit("v2", "footman", 800, 2370, { id: "recovering-b", hp: 48, order: { type: "move", x: 520, y: 520 } })
      .unit("v2", "archer", 980, 2560, { id: "fresh-archer" })
      .unit("v2", "lancer", 1020, 2520, { id: "fresh-lancer-a" })
      .unit("v2", "lancer", 1050, 2540, { id: "fresh-lancer-b" })
      .unit("neutral", "mossGnawer", 850, 2515)
      .unit("neutral", "wildling", 880, 2540)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("does not count wounded attack movers as ready for a fresh neutral objective", () => {
    const scene = sketchScene("v2-wounded-attack-movers-not-fresh-objective-power")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1a", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 980, 2360, { id: "wounded-footman-a", hp: 32, order: { type: "attackMove", x: 980, y: 2360 } })
      .unit("v2", "lancer", 1020, 2380, { id: "wounded-lancer-a", hp: 38, order: { type: "attackMove", x: 980, y: 2360 } })
      .unit("v2", "footman", 1060, 2400)
      .unit("v2", "archer", 1100, 2420)
      .unit("v2", "contractArcher", 1140, 2440)
      .unit("neutral", "wildling", 1380, 2560)
      .unit("neutral", "thornSlinger", 1420, 2600)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 waits for a full first squad before taking neutral objectives", () => {
    const scene = sketchScene("v2-no-first-three-neutral-objective")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1a", 3400, 3400)
      .unit("v2", "footman", 900, 2000)
      .unit("v2", "footman", 940, 2020)
      .unit("v2", "lancer", 980, 2040)
      .unit("neutral", "mossGnawer", 1260, 1550)
      .unit("neutral", "wildling", 1300, 1580)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 still takes a locally safe neutral objective while globally outpowered in a 1v2", () => {
    const scene = sketchScene("v2-local-objective-while-globally-outpowered")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 2048)
      .unit("v2", "footman", 900, 2000)
      .unit("v2", "footman", 940, 2020)
      .unit("v2", "lancer", 980, 2040)
      .unit("v2", "lancer", 1020, 2060)
      .unit("v2", "archer", 1060, 2080)
      .unit("v2", "archer", 1100, 2100)
      .unit("v2", "footman", 1140, 2120)
      .unit("v2", "archer", 1180, 2140)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 2600, 3200)
      .unit("v1a", "footman", 2640, 3220)
      .unit("v1a", "lancer", 2680, 3240)
      .unit("v1a", "lancer", 2720, 3260)
      .unit("v1a", "archer", 2760, 3280)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "raider", 2600, 3600)
      .unit("v1b", "footman", 2640, 3620)
      .unit("v1b", "lancer", 2680, 3640)
      .unit("v1b", "archer", 2720, 3660)
      .unit("v1b", "archer", 2760, 3680)
      .unit("neutral", "stonebackBrute", 1260, 1550)
      .unit("neutral", "thornSlinger", 1300, 1580)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands[0]).toMatchObject({ type: "attackMove", x: 1280, y: 1565 });
  });

  it("v2 skips a neutral objective when an enemy detachment already controls that local area", () => {
    const scene = sketchScene("v2-no-creep-through-local-enemy-control")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1650, 1650)
      .unit("v2", "footman", 1690, 1670)
      .unit("v2", "lancer", 1730, 1690)
      .unit("v2", "lancer", 1770, 1710)
      .unit("v2", "archer", 1810, 1730)
      .unit("v2", "archer", 1850, 1750)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "footman", 2120, 2060)
      .unit("v1b", "lancer", 2160, 2100)
      .unit("v1b", "archer", 2200, 2140)
      .unit("v1b", "footman", 2240, 2180)
      .unit("v1b", "lancer", 2280, 2220)
      .unit("neutral", "stonebackBrute", 2060, 2020)
      .unit("neutral", "thornSlinger", 2100, 2060)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 still takes a neutral objective through a weaker local enemy screen", () => {
    const scene = sketchScene("v2-creeps-through-weaker-local-screen")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1650, 1650)
      .unit("v2", "footman", 1690, 1670)
      .unit("v2", "lancer", 1730, 1690)
      .unit("v2", "lancer", 1770, 1710)
      .unit("v2", "archer", 1810, 1730)
      .unit("v2", "archer", 1850, 1750)
      .unit("v2", "footman", 1890, 1770)
      .unit("v2", "archer", 1930, 1790)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "footman", 2120, 2060)
      .unit("v1b", "lancer", 2160, 2100)
      .unit("v1b", "archer", 2200, 2140)
      .unit("neutral", "stonebackBrute", 2060, 2020)
      .unit("neutral", "thornSlinger", 2100, 2060)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands[0]).toMatchObject({ type: "attackMove", x: 2080, y: 2040 });
  });

  it("does not reassign wounded units that are already moving home into an attack wave", () => {
    const scene = sketchScene("v2-attack-wave-respects-wounded-retreat")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 5; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "lancer", 1500 + i * 30, 1450 + i * 20, { hp: 42, order: { type: "move", x: 500, y: 500 } });
    scene
      .unit("v2", "archer", 1640, 1540)
      .unit("v2", "raider", 1680, 1560)
      .townHall("v1a", 2200, 1600)
      .building("v1a", "barracks", 2140, 1560)
      .unit("v1a", "footman", 2100, 1560)
      .unit("v1a", "archer", 2140, 1600)
      .townHall("v1b", 3600, 3600)
      .unit("v1b", "footman", 3500, 3500)
      .unit("v1b", "archer", 3540, 3540);
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove" || candidate.type === "attack");

    expect(command).toBeUndefined();
  });

  it("v2 can fold safe stopped retreat claims back into a full attack wave", () => {
    const scene = sketchScene("v2-retreat-claims-rejoin-wave")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500);
    scene
      .unit("v2", "footman", 520, 500, { id: "recovered-footman", hp: 36 })
      .unit("v2", "lancer", 550, 520, { id: "recovered-lancer", hp: 42 })
      .unit("v2", "archer", 580, 540, { id: "recovered-archer", hp: 70 })
      .unit("v2", "footman", 620, 560, { id: "fresh-footman" })
      .unit("v2", "archer", 650, 580, { id: "fresh-archer" })
      .townHall("v1", 2200, 1600)
      .building("v1", "barracks", 2140, 1560)
      .unit("v1", "footman", 2080, 1540)
      .unit("v1", "lancer", 2110, 1570)
      .unit("v1", "archer", 2140, 1600);
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["recovered-footman", "recovered-lancer", "recovered-archer"]) {
      memory.unitClaims[unitId] = { kind: "retreat", targetId: "retreat", x: 500, y: 500, sinceTick: 0, expiresTick: 900 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove" || candidate.type === "attack");

    expect(command).toBeDefined();
    expect(command && "unitIds" in command ? command.unitIds : []).toEqual(expect.arrayContaining(["recovered-footman", "recovered-lancer", "recovered-archer", "fresh-footman", "fresh-archer"]));
  });

  it("worker-pressure candidate raids an exposed enemy economy when the other enemy army is too far away to matter", () => {
    const scene = sketchScene("v2-local-worker-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 2780, 3250)
      .unit("v2", "archer", 2810, 3280)
      .unit("v2", "lancer", 2840, 3310)
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3240, 3300, { id: "exposed-worker-a" })
      .worker("v1a", 3270, 3330)
      .worker("v1a", 3300, 3360)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .unit("v1b", "raider", 3600, 3900)
      .unit("v1b", "lancer", 3630, 3930)
      .unit("v1b", "footman", 3660, 3960)
      .unit("v1b", "archer", 3690, 3990)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "exposed-worker-a" });
  });

  it("worker-pressure candidate treats cross-map 1v2 pressure as a committed job, not a two-unit raid", () => {
    const scene = sketchScene("v2-no-cross-map-first-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "archer", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment, AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams });

    const pressure = entries.find((entry) => entry.scriptId === "workerPressure");
    expect(entries.find((entry) => entry.scriptId === "earlyHarassment")).toBeUndefined();
    expect(pressure).toMatchObject({ command: { type: "attack" } });
    expect(pressure?.command.type === "attack" ? pressure.command.unitIds.length : 0).toBe(3);
  });

  it("v2 does not send its first harassment pair across the whole map in a 1v1", () => {
    const scene = sketchScene("v2-no-cross-map-first-raid-1v1")
      .map("campRush")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 2048)
      .unit("v2", "footman", 720, 2030)
      .unit("v2", "footman", 760, 2070)
      .townHall("v1", 3600, 1840)
      .worker("v1", 3520, 1840, { id: "far-worker" })
      .worker("v1", 3560, 1880)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attack",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not launch an offensive attack wave into a much stronger combined army", () => {
    const scene = sketchScene("v2-no-outmatched-wave")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "lancer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .unit("v2", "footman", 910, 770)
      .unit("v2", "lancer", 940, 800)
      .townHall("v2", 1500, 900, { id: "v2-natural" })
      .worker("v2", 1480, 900)
      .goldMine("v2-natural-mine", 1560, 920, 3000)
      .townHall("v1a", 3400, 1400)
      .unit("v1a", "footman", 3000, 1400)
      .unit("v1a", "footman", 3040, 1420)
      .unit("v1a", "lancer", 3080, 1440)
      .unit("v1a", "archer", 3120, 1460)
      .unit("v1a", "footman", 3160, 1480)
      .unit("v1a", "lancer", 3200, 1500)
      .townHall("v1b", 3400, 2800)
      .unit("v1b", "raider", 3000, 2800)
      .unit("v1b", "lancer", 3040, 2820)
      .unit("v1b", "lancer", 3080, 2840)
      .unit("v1b", "footman", 3120, 2860)
      .unit("v1b", "footman", 3160, 2880)
      .unit("v1b", "archer", 3200, 2900)
      .build();
    const game = scene.createGame();
    for (const unit of game.units.filter((unit) => unit.owner === "v2" && unit.kind !== "worker")) unit.order = { type: "idle" };

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("v2 can pressure before expanding when no current expansion plan is actionable", () => {
    const scene = sketchScene("v2-pressure-before-nonactionable-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .unit("v2", "lancer", 910, 770)
      .unit("v2", "footman", 940, 800)
      .townHall("v1a", 3300, 3300)
      .building("v1a", "barracks", 3180, 3180, { id: "v1a-forward-barracks" })
      .worker("v1a", 3360, 3300)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .unit("v1b", "footman", 3500, 3900)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("central-but-unaffordable", 2060, 2030, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 120;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 0).toBeGreaterThan(2000);
  });

  it("v2 keeps objective control from pulling the defense squad out while the main is under pressure", () => {
    const scene = sketchScene("v2-objective-control-yields-to-main-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 610, 560)
      .unit("v2", "footman", 620, 580)
      .unit("v2", "footman", 650, 600)
      .unit("v2", "lancer", 680, 620)
      .unit("v2", "archer", 710, 640)
      .unit("v2", "archer", 740, 660)
      .townHall("v1", 3400, 3400, { id: "v1-main" })
      .unit("v1", "footman", 780, 560)
      .unit("v1", "footman", 820, 600)
      .unit("v1", "lancer", 860, 640)
      .unit("v1", "archer", 900, 680)
      .unit("neutral", "stonebackBrute", 1260, 1060)
      .unit("neutral", "thornSlinger", 1300, 1100)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "objectiveControl")).toBe(false);
    expect(entries.some((entry) => (entry.scriptId === "focusFire" || entry.scriptId === "attackWave") && (entry.command.type === "move" || entry.command.type === "attackMove" || entry.command.type === "attack"))).toBe(true);
  });

  it("v2 evacuates workers instead of ordering them to fight when the main defense line exists", () => {
    const scene = sketchScene("v2-worker-evacuation-under-main-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .worker("v2", 520, 500, { id: "v2-worker-a" })
      .worker("v2", 540, 520, { id: "v2-worker-b" })
      .worker("v2", 560, 540, { id: "v2-worker-c" })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    if (!workerDefense) throw new Error("expected worker defense command");
    expect(workerDefense).toMatchObject({ scriptId: "workerDefense", command: { type: "move" } });
    expect(workerDefense.command.type === "move" ? workerDefense.command.unitIds : []).toEqual(expect.arrayContaining(["v2-worker-a", "v2-worker-b", "v2-worker-c"]));
  });

  it("v2 keeps the only saturated mine working while a main defense line handles pressure", () => {
    const scene = sketchScene("v2-defended-main-keeps-saturated-mine")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v2 repairs a damaged main tower with an available non-mining worker", () => {
    const scene = sketchScene("v2-repairs-damaged-main-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .worker("v2", 520, 500, { id: "v2-builder" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .townHall("v1", 3400, 3400)
      .build();
    const game = scene.createGame();
    const tower = game.buildings.find((building) => building.id === "v2-main-tower");
    if (!tower) throw new Error("missing v2 tower");
    tower.hp = 80;
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 30;

    const repair = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.repair], { version: "v2", teams: game.teams })[0];

    expect(repair).toMatchObject({ scriptId: "repair", command: { type: "repair", buildingId: "v2-main-tower", unitIds: ["v2-builder"] } });
  });

  it("v2 trains a sixth one-base worker when the saturated main needs tower repair labor", () => {
    const scene = sketchScene("v2-one-base-repair-worker")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .building("v2", "barracks", 650, 560)
      .building("v2", "farm", 560, 700)
      .goldMine("v2-main-mine", 570, 530, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .build();
    const game = scene.createGame();
    const tower = game.buildings.find((building) => building.id === "v2-main-tower");
    if (!tower) throw new Error("missing v2 tower");
    tower.hp = 80;
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 80;

    const train = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(train).toMatchObject({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 keeps the only currently saturated mine working after a fresh second town hall completes", () => {
    const scene = sketchScene("v2-fresh-second-hall-keeps-paying-mine")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1100, 650, { id: "v2-natural" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .goldMine("v2-natural-mine", 1140, 650, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 1080, 650, { id: "v2-natural-builder" })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v2 keeps a damaged but still-paying sole mine working instead of zeroing income", () => {
    const scene = sketchScene("v2-damaged-paying-mine-keeps-working")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v2 keeps saturated main miners working even after a second mine is online", () => {
    const scene = sketchScene("v2-two-paying-mines-keep-main-saturation")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1120, 720, { id: "v2-natural" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .goldMine("v2-natural-mine", 1160, 720, 4000)
      .worker("v2", 520, 500, { id: "v2-main-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-main-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-main-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-main-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-main-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 1130, 720, { id: "v2-natural-worker-a", order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 1150, 740, { id: "v2-natural-worker-b", order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v2 rebuilds core production before spending its last recovery bank on an emergency tower", () => {
    const scene = sketchScene("v2-rebuilds-production-before-last-bank-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 610, 560)
      .unit("v2", "archer", 650, 590)
      .unit("v2", "lancer", 690, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 930, 650)
      .unit("v1a", "lancer", 970, 680)
      .unit("v1b", "footman", 900, 760)
      .unit("v1b", "archer", 940, 790)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.emergencyDefense, AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "emergencyDefense")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", unitId: "v2-builder", buildingKind: "barracks" });
  });

  it("v2 rebuilds core production before spending its last recovery bank on a routine defense tower", () => {
    const scene = sketchScene("v2-rebuilds-production-before-last-bank-defense")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 820, 600)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.defense, AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "defense")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", unitId: "v2-builder", buildingKind: "barracks" });
  });

  it("v2 guards a fresh 1v2 mining expansion before banking for late macro", () => {
    const scene = sketchScene("v2-fresh-expansion-guard")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1100, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 520)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1140, 650, 4000)
      .worker("v2", 1120, 650, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 1100, 700)
      .unit("v2", "archer", 1140, 720)
      .townHall("v1a", 3400, 3300)
      .townHall("v1b", 3400, 3800)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 130;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.defense], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 pulls workers into the fight when the main hall is dying and no combat unit remains", () => {
    const scene = sketchScene("v2-desperate-worker-fight-for-dying-main")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .worker("v2", 520, 500, { id: "v2-worker-a" })
      .worker("v2", 540, 520, { id: "v2-worker-b" })
      .worker("v2", 560, 540, { id: "v2-worker-c" })
      .townHall("v1", 3400, 3400)
      .unit("v1", "footman", 610, 520, { id: "main-killer-a" })
      .unit("v1", "lancer", 640, 550, { id: "main-killer-b" })
      .unit("v1", "raider", 670, 580, { id: "main-killer-c" })
      .build();
    const game = scene.createGame();
    const main = game.buildings.find((building) => building.id === "v2-main");
    if (!main) throw new Error("missing main");
    main.hp = main.maxHp * 0.32;

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toMatchObject({ scriptId: "workerDefense", command: { type: "attack" } });
  });

  it("v2 pulls a small worker group into a towerless close 1v2 main fight before the hall is critical", () => {
    const scene = sketchScene("v2-early-towerless-worker-fight")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .worker("v2", 510, 500, { id: "v2-worker-a" })
      .worker("v2", 530, 520, { id: "v2-worker-b" })
      .worker("v2", 550, 540, { id: "v2-worker-c" })
      .worker("v2", 570, 560, { id: "v2-worker-d" })
      .worker("v2", 505, 505, { id: "v2-new-near-worker" })
      .unit("v2", "footman", 620, 540)
      .unit("v2", "lancer", 650, 570)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 820, 540, { id: "enemy-front" })
      .unit("v1b", "lancer", 860, 590)
      .unit("v1b", "archer", 830, 620)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.desperateWorkerFight], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attack" });
    expect(command?.type === "attack" ? command.unitIds : []).toEqual(["v2-worker-a", "v2-worker-b", "v2-worker-c"]);
  });

  it("v2 rebuilds workers after a raid instead of reserving scarce gold for future macro", () => {
    const scene = sketchScene("v2-worker-recovery-after-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .worker("v2", 520, 520)
      .worker("v2", 540, 520)
      .goldMine("v2-main-mine", 570, 530, 4000)
      .townHall("v1", 3400, 3400)
      .unit("v1", "footman", 780, 560)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 120;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "train",
    );

    expect(command).toMatchObject({ type: "train", unitKind: "worker" });
  });

  it("v2 attacks an isolated opponent even when the two enemy armies are globally larger", () => {
    const scene = sketchScene("v2-isolated-opponent-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1550, 1500)
      .unit("v2", "footman", 1585, 1530)
      .unit("v2", "lancer", 1620, 1500)
      .unit("v2", "lancer", 1655, 1530)
      .unit("v2", "archer", 1690, 1500)
      .unit("v2", "archer", 1725, 1530)
      .unit("v2", "raider", 1760, 1500)
      .townHall("v1a", 2200, 1650, { id: "v1a-main" })
      .building("v1a", "barracks", 2100, 1600, { id: "isolated-v1a-barracks" })
      .unit("v1a", "footman", 2050, 1620)
      .unit("v1a", "archer", 2080, 1660)
      .townHall("v1b", 3600, 3600, { id: "v1b-main" })
      .unit("v1b", "footman", 3520, 3600)
      .unit("v1b", "footman", 3550, 3630)
      .unit("v1b", "lancer", 3580, 3660)
      .unit("v1b", "lancer", 3610, 3690)
      .unit("v1b", "archer", 3640, 3720)
      .unit("v1b", "raider", 3670, 3750)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toBeDefined();
    if (command?.type === "attack") expect(command.targetId).toContain("v1a");
    if (command?.type === "attackMove") {
      expect(command.x).toBeGreaterThan(1700);
      expect(command.x).toBeLessThan(2300);
    }
  });

  it("v2 concentrates on a small enemy detachment before respecting the global two-army disadvantage", () => {
    const scene = sketchScene("v2-local-detachment-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 1600 + i * 24, 1500 + i * 12);
    scene
      .townHall("v1a", 2300, 1620)
      .unit("v1a", "footman", 2060, 1540, { id: "isolated-footman" })
      .unit("v1a", "archer", 2100, 1580, { id: "isolated-archer" })
      .townHall("v1b", 3600, 3600);
    for (let i = 0; i < 9; i += 1) scene.unit("v1b", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 3500 + i * 30, 3500 + i * 25);
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: expect.stringContaining("isolated") });
  });

  it("v2 commits into one locally beatable opponent base even when the combined enemy army is larger", () => {
    const scene = sketchScene("v2-local-base-commit")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 1600 + i * 24, 1500 + i * 12);
    scene
      .townHall("v1a", 2300, 1620)
      .building("v1a", "barracks", 2200, 1580, { id: "locally-beatable-barracks" });
    for (let i = 0; i < 6; i += 1) scene.unit("v1a", i % 2 === 0 ? "footman" : "archer", 2140 + i * 25, 1580 + i * 20);
    scene.townHall("v1b", 3600, 3600);
    for (let i = 0; i < 9; i += 1) scene.unit("v1b", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 3500 + i * 30, 3500 + i * 25);
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 2200, y: 1580 });
  });

  it("v2 keeps a committed attack wave on the same opponent instead of pinballing between two enemy fronts", () => {
    const scene = sketchScene("v2-committed-attack-wave-owner")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 2300 + i * 20, 2300 + i * 10, { order: { type: "attackMove", x: 3380, y: 3300 } });
    scene
      .townHall("v1a", 2500, 2450, { id: "v1a-main" })
      .building("v1a", "barracks", 2440, 2390, { id: "v1a-closer-barracks" })
      .townHall("v1b", 3450, 3300, { id: "v1b-main" })
      .building("v1b", "barracks", 3380, 3300, { id: "v1b-committed-barracks" });
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    if (command?.type === "attackMove") expect(command.x).toBeGreaterThan(3200);
  });

  it("v2 stores a focused opponent owner when it chooses a 1v2 attack target", () => {
    const scene = sketchScene("v2-memory-focus-owner-record")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 1600 + i * 24, 1500 + i * 12);
    scene
      .townHall("v1a", 2300, 1620)
      .building("v1a", "barracks", 2200, 1580, { id: "focus-v1a-barracks" })
      .townHall("v1b", 3600, 3600);
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 2200, y: 1580 });
    expect(memory.strategicPlan?.focusTargetOwner).toBe("v1a");
  });

  it("v2 keeps attacking the remembered focused opponent instead of swapping to a closer building", () => {
    const scene = sketchScene("v2-memory-focus-owner-reuse")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 2300 + i * 20, 2300 + i * 10);
    scene
      .townHall("v1a", 2500, 2450, { id: "v1a-closer-main" })
      .building("v1a", "barracks", 2440, 2390, { id: "v1a-closer-barracks" })
      .townHall("v1b", 3450, 3300, { id: "v1b-focused-main" })
      .building("v1b", "barracks", 3380, 3300, { id: "v1b-focused-barracks" });
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1b" };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 3380, y: 3300 });
  });

  it("v1 keeps its expansion-map attack-wave gate so the version duel compares against a stable baseline", () => {
    const scene = sketchScene("v1-stable-expansion-gate")
      .map("openClaims")
      .replaceDefaults()
      .player("v1", { team: "south", race: "grove" })
      .player("target", { team: "north", race: "ember" })
      .townHall("v1", 3400, 3300)
      .unit("v1", "footman", 3300, 3200)
      .townHall("target", 500, 500)
      .worker("target", 540, 540)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .goldMine("target-main-mine", 560, 540, 4000)
      .goldMine("open-third", 2100, 2100, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v1", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v1 does not lock attack waves forever after an established expansion mine is depleted", () => {
    const scene = sketchScene("v1-depleted-expansion-still-attacks")
      .map("openClaims")
      .replaceDefaults()
      .player("v1", { team: "south", race: "grove" })
      .player("target", { team: "north", race: "ember" })
      .townHall("v1", 3400, 3300)
      .townHall("v1", 2500, 2800, { id: "v1-established-natural" })
      .unit("v1", "footman", 3300, 3200)
      .unit("v1", "footman", 3330, 3230)
      .unit("v1", "lancer", 3360, 3260)
      .unit("v1", "archer", 3390, 3290)
      .unit("v1", "archer", 3420, 3320)
      .townHall("target", 500, 500)
      .worker("target", 540, 540)
      .goldMine("v1-main-mine", 3340, 3300, 0)
      .goldMine("v1-depleted-natural", 2520, 2810, 0)
      .goldMine("open-third", 2100, 2100, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v1", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
  });

  it("does not let attack-wave commands override candidate retreat decisions in the same policy pass", () => {
    const scene = sketchScene("v2-retreat-not-overridden")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1450, 600, { id: "v2-expansion" })
      .unit("v2", "footman", 1400, 620)
      .unit("v2", "archer", 1430, 650)
      .unit("v2", "lancer", 1460, 680)
      .unit("v2", "footman", 620, 420)
      .unit("v2", "footman", 650, 450)
      .unit("v2", "archer", 680, 480)
      .unit("v2", "lancer", 710, 510)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 1500, 620)
      .unit("v1", "lancer", 1530, 650)
      .unit("v1", "archer", 1560, 680)
      .unit("v1", "raider", 1590, 710)
      .unit("v1", "footman", 1620, 740)
      .unit("v1", "lancer", 1650, 770)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-expansion-mine", 1520, 620, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "attackMove", x: 500, y: 500 });
  });

  it("v2 does not pull the whole army into a doomed expansion defense against a much stronger force", () => {
    const scene = sketchScene("v2-doomed-expansion-defense")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1400, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .unit("v2", "footman", 700, 560)
      .unit("v2", "footman", 735, 595)
      .unit("v2", "lancer", 770, 560)
      .unit("v2", "archer", 805, 595)
      .unit("v2", "archer", 840, 560)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3300, 3700, { id: "v1b-main" });
    for (let i = 0; i < 9; i += 1) {
      scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "raider" : "footman", 1360 + (i % 3) * 34, 680 + Math.floor(i / 3) * 34);
    }
    const game = scene.build().createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("v2 rallies the army at the main defense point after declining a doomed expansion defense", () => {
    const scene = sketchScene("v2-rally-main-after-doomed-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .townHall("v2", 1400, 650, { id: "v2-natural" })
      .unit("v2", "footman", 900, 560)
      .unit("v2", "footman", 935, 595)
      .unit("v2", "lancer", 970, 560)
      .unit("v2", "archer", 1005, 595)
      .unit("v2", "archer", 1040, 560)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3300, 3700, { id: "v1b-main" });
    for (let i = 0; i < 9; i += 1) {
      scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "raider" : "footman", 1360 + (i % 3) * 34, 680 + Math.floor(i / 3) * 34);
    }
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.x : 9999).toBeLessThan(720);
    expect(command?.type === "move" ? command.y : 9999).toBeLessThan(700);
  });

  it("v2 holds the main defense point instead of meeting a stronger army outside tower cover", () => {
    const scene = sketchScene("v2-main-defense-hold")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 860, 650)
      .unit("v2", "footman", 900, 690)
      .unit("v2", "lancer", 940, 650)
      .unit("v2", "archer", 980, 690)
      .unit("v2", "archer", 1020, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700);
    for (let i = 0; i < 9; i += 1) {
      scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "raider" : "footman", 1080 + (i % 3) * 34, 760 + Math.floor(i / 3) * 34);
    }
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.x : 9999).toBeLessThan(720);
    expect(command?.type === "move" ? command.y : 9999).toBeLessThan(700);
  });

  it("v2 does not leave main tower cover to body-block a pressured production building while outmatched", () => {
    const scene = sketchScene("v2-main-pressure-stays-in-cover")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 360, 500, { id: "v2-main-tower" })
      .building("v2", "barracks", 660, 560, { id: "v2-barracks" })
      .unit("v2", "footman", 660, 560)
      .unit("v2", "lancer", 690, 590)
      .unit("v2", "archer", 720, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800);
    for (let i = 0; i < 7; i += 1) scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "lancer" : "footman", 760 + (i % 3) * 32, 600 + Math.floor(i / 3) * 32);
    const game = scene.build().createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
    expect(commands.some((command) => command.type === "move" || command.type === "attack")).toBe(true);
  });

  it("v2 pulls nearby workers into a desperate main-base fight when no defense line exists", () => {
    const scene = sketchScene("v2-worker-emergency-defense")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .worker("v2", 520, 540, { id: "pulled-worker-a" })
      .worker("v2", 545, 560, { id: "pulled-worker-b" })
      .worker("v2", 570, 540)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 690, 610, { id: "base-invader" })
      .unit("v1b", "lancer", 720, 640)
      .unit("v1a", "footman", 750, 670)
      .unit("v1b", "lancer", 780, 700)
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attack" && candidate.unitIds.includes("pulled-worker-a"),
    );

    expect(command).toMatchObject({ type: "attack", targetId: "base-invader" });
  });

  it("v1 baseline also pulls workers when the main base is being overrun", () => {
    const scene = sketchScene("v1-worker-emergency-defense")
      .map("bareDuel")
      .replaceDefaults()
      .player("v1", { team: "south", race: "grove" })
      .player("v2", { team: "north", race: "grove" })
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .building("v1", "barracks", 3180, 3180, { id: "v1-barracks" })
      .worker("v1", 3260, 3300, { id: "v1-pulled-worker-a" })
      .worker("v1", 3290, 3330, { id: "v1-pulled-worker-b" })
      .worker("v1", 3320, 3300)
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 3210, 3230, { id: "v2-base-invader" })
      .unit("v2", "lancer", 3240, 3260)
      .unit("v2", "footman", 3270, 3290)
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v1", { version: "v1", teams: game.teams }).find(
      (candidate) => candidate.type === "attack" && candidate.unitIds.includes("v1-pulled-worker-a"),
    );

    expect(command).toMatchObject({ type: "attack" });
  });

  it("v2 focuses fire on a weak high-threat attacker inside the main defense zone", () => {
    const scene = sketchScene("v2-main-defense-focus")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 610, 560)
      .unit("v2", "lancer", 640, 590)
      .unit("v2", "archer", 670, 620)
      .unit("v2", "archer", 700, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .unit("v1a", "footman", 730, 650, { id: "healthy-front" })
      .unit("v1b", "raider", 760, 660, { id: "weak-raider", hp: 35 })
      .unit("v1a", "archer", 790, 670, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "weak-raider" });
  });

  it("v2 focus-fire module targets the highest-value nearby combat unit through a normal attack command", () => {
    const scene = sketchScene("v2-general-focus-fire")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 900, 900)
      .unit("v2", "lancer", 930, 930)
      .unit("v2", "archer", 960, 960)
      .townHall("v1", 3000, 3000)
      .unit("v1", "footman", 1000, 900, { id: "healthy-front" })
      .unit("v1", "raider", 1030, 930, { id: "weak-raider-focus", hp: 28 })
      .unit("v1", "archer", 1060, 960, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.focusFire], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "weak-raider-focus" });
    expect(command?.type === "attack" ? command.unitIds.length : 0).toBeGreaterThanOrEqual(2);
  });

  it("v2 preset reintroduces focus-fire through the memory-backed executable stack", () => {
    const scene = sketchScene("v2-preset-focus-fire-wiring")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 900, 900)
      .unit("v2", "lancer", 930, 930)
      .unit("v2", "archer", 960, 960)
      .townHall("v1", 3000, 3000)
      .unit("v1", "footman", 1000, 900, { id: "healthy-front" })
      .unit("v1", "raider", 1030, 930, { id: "weak-raider-preset", hp: 28 })
      .unit("v1", "archer", 1060, 960, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "focusFire")).toMatchObject({
      scriptId: "focusFire",
      command: { type: "attack", targetId: "weak-raider-preset" },
    });
    expect(entries.find((entry) => entry.scriptId === "attackWave" && entry.command.type === "attackMove")).toBeUndefined();
  });

  it("does not drag out-of-range melee out of tower cover for main-defense focus fire", () => {
    const scene = sketchScene("v2-main-defense-focus-leash")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 610, 560, { id: "cover-footman" })
      .unit("v2", "lancer", 640, 590, { id: "cover-lancer" })
      .unit("v2", "archer", 670, 620, { id: "cover-archer-a" })
      .unit("v2", "archer", 700, 650, { id: "cover-archer-b" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .unit("v1a", "footman", 730, 650, { id: "healthy-front" })
      .unit("v1b", "raider", 760, 660, { id: "weak-raider", hp: 35 })
      .unit("v1a", "archer", 790, 670, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "weak-raider" });
    expect(command?.type === "attack" ? command.unitIds : []).toEqual(["cover-archer-a", "cover-archer-b"]);
  });

  it("does not let main-defense focus override wounded-unit pullbacks in the same policy pass", () => {
    const scene = sketchScene("v2-wounded-pullback-not-overridden")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 610, 560)
      .unit("v2", "footman", 640, 590)
      .unit("v2", "lancer", 670, 620)
      .unit("v2", "archer", 700, 650, { id: "wounded-archer", hp: 20 })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .unit("v1a", "footman", 720, 650, { id: "enemy-front" })
      .unit("v1b", "raider", 760, 660, { id: "enemy-raider", hp: 35 })
      .unit("v1a", "archer", 790, 670, { id: "enemy-archer" })
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });
    const pullback = commands.find((command) => command.type === "move" && command.unitIds.includes("wounded-archer"));
    const overwrites = commands.filter((command) => (command.type === "attack" || command.type === "attackMove") && command.unitIds.includes("wounded-archer"));

    expect(pullback).toMatchObject({ type: "move" });
    expect(overwrites).toEqual([]);
  });

  it("prioritizes core production over expansion-guard tower spam", () => {
    const game = createGame("openClaims", { aiPlayers: [] });
    game.players.player.gold = 5000;
    game.buildings.push(createBuilding("building-player-expanded-townhall", "player", "townHall", 1800, 1800, true));
    const mine = game.resources[0]!;
    for (const worker of game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: mine.id, phase: "toMine", timer: 0 };
    }

    const command = planPresetAiCommands(snapshotGame(game), "player")[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v2 builds core production before economic catch-up expansions when outnumbered", () => {
    const teams = { v2: "north", v1a: "south", v1b: "south" };
    const game = createGame("openClaims", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams,
      races: { v2: "grove", v1a: "grove", v1b: "ember" },
    });
    game.players.v2!.gold = 1200;
    const mine = game.resources[0]!;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: mine.id, phase: "toMine", timer: 0 };
    }

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v2 scales production before spending catch-up gold on more towers", () => {
    const scene = sketchScene("v2-production-before-extra-tower")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .worker("v2", 1320, 620)
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .townHall("v1", 2800, 3000, { id: "v1-natural" })
      .townHall("v1", 2450, 2550, { id: "v1-third" })
      .worker("v1", 3350, 3300)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-natural-mine", 1420, 650, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .build();
    const game = scene.createGame();
    keepOnlyIds(game, {
      buildings: ["v2-main", "v2-natural", "v2-barracks", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v1-main-mine"],
    });
    game.players.v2!.gold = 1600;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "archeryRange" });
  });

  it("v2 scales core production before buying a comfort tower when facing two enemy economies", () => {
    const scene = sketchScene("v2-core-production-before-comfort-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 820, 660)
      .unit("v2", "archer", 850, 680)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 500;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "build", buildingKind: "archeryRange" });
  });

  it("v2 takes a safe catch-up expansion before finishing every production family once it has a first squad", () => {
    const scene = sketchScene("v2-safe-expansion-before-third-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2-safe-expansion" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3-safe-expansion" })
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 820, 660)
      .unit("v2", "footman", 850, 690)
      .unit("v2", "lancer", 880, 660)
      .unit("v2", "archer", 910, 690)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .townHall("v1a", 2900, 3050, { id: "v1a-natural" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .townHall("v1b", 2900, 3800, { id: "v1b-natural" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 560;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
  });

  it("v2 reserves gold for a safe catch-up expansion instead of spending the float on extra production or units", () => {
    const scene = sketchScene("v2-reserve-safe-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3" })
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 820, 660)
      .unit("v2", "footman", 850, 690)
      .unit("v2", "lancer", 880, 660)
      .unit("v2", "archer", 910, 690)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .townHall("v1a", 2900, 3050, { id: "v1a-natural" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .townHall("v1b", 2900, 3800, { id: "v1b-natural" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 250;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }

    const economicSpend = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economicSpend).toBeUndefined();
  });

  it("v2 reserves for a nearly cleared first natural before adding the third production building", () => {
    const scene = sketchScene("v2-reserve-nearly-cleared-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 920, 790)
      .unit("v2", "footman", 950, 820)
      .unit("v2", "lancer", 980, 790)
      .unit("v2", "lancer", 1010, 820)
      .unit("v2", "archer", 1040, 790)
      .unit("v2", "archer", 1070, 820)
      .unit("v2", "contractArcher", 1100, 790)
      .unit("v2", "fieldMedic", 1130, 820)
      .townHall("v1", 3400, 3300, { id: "v1-main" })
      .worker("v1", 3360, 3300)
      .worker("v1", 3380, 3340)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1120, 820, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .unit("neutral", "wildling", 1128, 820, { id: "last-natural-guard", hp: 56 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 235;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "productionBuilding")).toBe(false);
    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "attackMove", x: 1120, y: 820 });
  });

  it("v2 builds a cleared first natural before spending the bank on priority weapon tech", () => {
    const scene = sketchScene("v2-cleared-natural-before-weapon-tech")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 920, 790)
      .unit("v2", "lancer", 950, 820)
      .unit("v2", "archer", 980, 790)
      .unit("v2", "archer", 1010, 820)
      .townHall("v1", 3400, 3300, { id: "v1-main" })
      .worker("v1", 3360, 3300)
      .worker("v1", 3380, 3340)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1120, 820, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 340;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.command.type === "research")).toBe(false);
    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("queues training from multiple idle production buildings in one policy pass when resources allow it", () => {
    const scene = sketchScene("multi-production-training")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700, { id: "v2-farm-1" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3" })
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .townHall("target", 3300, 3300)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;
    game.players.v2.upgrades.weaponTraining = 3;
    game.players.v2.upgrades.reinforcedPlating = 3;

    const trainCommands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).filter((command) => command.type === "train");

    expect(trainCommands.map((command) => (command.type === "train" ? command.buildingId : ""))).toEqual(expect.arrayContaining(["v2-archery", "v2-barracks", "v2-sanctum", "v2-stables"]));
  });

  it("v2 rebuilds workers after a raid instead of waiting to afford the next tech building", () => {
    const scene = sketchScene("v2-worker-recovery-after-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .unit("v2", "footman", 650, 580)
      .unit("v2", "archer", 690, 610)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toMatchObject({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 saturates two mining bases to five workers each when two enemy economies are ahead", () => {
    const scene = sketchScene("v2-two-base-worker-saturation-against-two")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .unit("v2", "footman", 650, 580)
      .unit("v2", "archer", 690, 610)
      .unit("v2", "footman", 660, 620)
      .unit("v2", "archer", 710, 650)
      .unit("v2", "lancer", 740, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 470, 3000)
      .goldMine("v1a-main-mine", 3300, 3240, 3000)
      .goldMine("v1b-main-mine", 3400, 3740, 3000)
      .goldMine("v2-natural-mine", 1350, 620, 3000);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 20, 540 + i * 10);
    for (let i = 0; i < 4; i += 1) scene.worker("v2", 1330 + i * 20, 650 + i * 10);
    for (let i = 0; i < 8; i += 1) {
      scene.worker("v1a", 3280 + i * 12, 3300 + i * 8);
      scene.worker("v1b", 3380 + i * 12, 3800 + i * 8);
    }
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toMatchObject({ type: "train", unitKind: "worker" });
  });

  it("v2 does not delay its first fighting squad to saturate extra workers", () => {
    const scene = sketchScene("v2-first-squad-before-extra-workers")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .unit("v2", "footman", 650, 580)
      .unit("v2", "archer", 690, 610)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 470, 3000)
      .goldMine("v1a-main-mine", 3300, 3240, 3000)
      .goldMine("v1b-main-mine", 3400, 3740, 3000)
      .goldMine("v2-natural-mine", 1350, 620, 3000);
    for (let i = 0; i < 6; i += 1) scene.worker("v2", 520 + i * 20, 540 + i * 10);
    for (let i = 0; i < 8; i += 1) {
      scene.worker("v1a", 3280 + i * 12, 3300 + i * 8);
      scene.worker("v1b", 3380 + i * 12, 3800 + i * 8);
    }
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toBeUndefined();
  });

  it("v2 rebuilds a damaged two-base worker line even while core army is thin", () => {
    const scene = sketchScene("v2-worker-recovery-two-base-under-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .unit("v2", "footman", 650, 580)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 470, 3000)
      .goldMine("v2-natural-mine", 1350, 620, 3000)
      .goldMine("v1a-main-mine", 3300, 3240, 3000)
      .goldMine("v1b-main-mine", 3400, 3740, 3000);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 24, 540 + i * 12);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands).toContainEqual({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 trains cheap recovery workers when the main is pressured and it cannot afford soldiers", () => {
    const scene = sketchScene("v2-cheap-worker-recovery-under-main-pressure")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 1460, { id: "v2-main" })
      .building("v2", "barracks", 620, 1500, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 1500, { id: "v2-archery" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 760, 1500)
      .unit("v1b", "lancer", 790, 1530)
      .unit("v1a", "archer", 820, 1560);
    for (let i = 0; i < 6; i += 1) scene.worker("v2", 470 + i * 22, 1410 + i * 12);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toMatchObject({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("keeps scaling supply past seven farms when a rich army is population capped", () => {
    const scene = sketchScene("supply-scaling-past-seven-farms")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .worker("v2", 540, 520, { id: "v2-builder" })
      .townHall("v1", 3300, 3300);
    for (let i = 0; i < 7; i += 1) scene.building("v2", "farm", 560 + i * 45, 700 - i * 25);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 1000;
    game.players.v2.supplyUsed = game.players.v2.supplyCap;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build" && candidate.buildingKind === "farm");

    expect(command).toMatchObject({ type: "build", buildingKind: "farm" });
  });

  it("reserves near-duplicate-production gold instead of spending it on routine training", () => {
    const scene = sketchScene("v2-reserve-duplicate-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700);
    for (let i = 0; i < 9; i += 1) scene.worker("v2", 520 + i * 12, 540 + i * 6);
    for (let i = 0; i < 6; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 650 + i * 22, 720);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 215;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });
    const training = commands.find((candidate) => candidate.type === "train");
    const productionBuilding = commands.find((candidate) => candidate.type === "build" && candidate.buildingKind !== "townHall");

    expect(training).toBeUndefined();
    expect(productionBuilding).toBeUndefined();
  });

  it("hires from the nearer useful mercenary camp instead of blindly using the first camp", () => {
    const scene = sketchScene("v2-nearest-mercenary-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("far-melee", 3300, 3200, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .mercenaryCamp("near-archer", 760, 760, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("v2", "footman", 760, 760)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 450;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "near-archer" });
  });

  it("can hire a different mercenary role after already owning two melee mercenaries", () => {
    const scene = sketchScene("v2-diverse-mercenary-role")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .unit("v2", "mercenary", 650, 640)
      .unit("v2", "mercenary", 690, 660)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("field-medic-camp", 780, 760, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("v2", "footman", 780, 760)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 450;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "field-medic-camp" });
  });

  it("buys a combat mercenary before the first healer so camp control becomes fighting power", () => {
    const scene = sketchScene("first-mercenary-is-combat")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 720, { hp: 55 })
      .unit("v2", "lancer", 800, 740)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("field-medic-camp", 780, 760, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .mercenaryCamp("contract-archer-camp", 830, 780, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 900;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "hire");

    expect(command).toMatchObject({ type: "hire", campId: "contract-archer-camp" });
  });

  it("v2 clears a guarded mercenary camp before trying to hire from it", () => {
    const scene = sketchScene("v2-clear-guarded-merc-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "footman", 790, 750)
      .unit("v2", "lancer", 820, 720)
      .unit("v2", "archer", 850, 750)
      .unit("v2", "archer", 880, 720)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("guarded-contract-archers", 980, 860, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 950, 850)
      .unit("neutral", "thornSlinger", 1010, 890)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 250;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "hire")).toBe(false);
    expect(commands.find((command) => command.type === "attackMove")).toMatchObject({ type: "attackMove", x: 980, y: 860 });
  });

  it("v2 takes a slightly farther guarded mercenary objective with a five-unit squad when the fight is favorable", () => {
    const scene = sketchScene("v2-earlier-far-merc-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .unit("v2", "footman", 805, 790)
      .unit("v2", "archer", 840, 820)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("far-but-winnable-medic-camp", 1500, 1120, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1460, 1100)
      .unit("neutral", "thornSlinger", 1530, 1140)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1500, y: 1120 });
  });

  it("v2 counts neutral assist-linked guards as one camp before choosing a creep objective", () => {
    const scene = sketchScene("v2-counts-neutral-assist-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .townHall("v1", 3300, 3300)
      .unit("neutral", "ancientStag", 1120, 960)
      .unit("neutral", "ancientStag", 1460, 960)
      .unit("neutral", "ancientStag", 1800, 960)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not bleed a three-unit squad into medium guarded objectives while facing two economies", () => {
    const scene = sketchScene("v2-avoids-greedy-1v2-medium-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .mercenaryCamp("medium-field-camp", 1260, 1550, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 1220, 1530)
      .unit("neutral", "barkMender", 1300, 1570)
      .unit("neutral", "wildling", 1260, 1500)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 objective control does not trickle a lone stale unit into a camp while the squad is split", () => {
    const scene = sketchScene("v2-objective-control-no-trickle")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "lancer", 735, 730, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "archer", 770, 760, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "footman", 805, 790, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "archer", 840, 820)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .mercenaryCamp("medium-field-camp", 1260, 1550, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 1220, 1530)
      .unit("neutral", "barkMender", 1300, 1570)
      .unit("neutral", "wildling", 1260, 1500)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 clears nearby non-mercenary treasure camps instead of ignoring objective rewards", () => {
    const scene = sketchScene("v2-green-treasure-camp")
      .map("campRush")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "lancer", 750, 750)
      .unit("v2", "archer", 780, 720)
      .unit("v2", "footman", 810, 750)
      .unit("v2", "archer", 840, 720)
      .townHall("v1", 3300, 3300)
      .unit("neutral", "wildling", 1040, 980, { id: "book-guard-a" })
      .unit("neutral", "thornSlinger", 1090, 1015, { id: "book-guard-b" })
      .item("nearby-xp-book", "experienceBook", 0, 0, { carrierId: "book-guard-b" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    if (command?.type !== "attackMove") throw new Error("expected treasure-camp attackMove");
    expect(command.x).toBeCloseTo(1065, -1);
    expect(command.y).toBeCloseTo(998, -1);
    expect(command.unitIds.length).toBe(5);
  });

  it("records a creep claim when assigning a squad to a neutral treasure camp", () => {
    const scene = sketchScene("v2-green-treasure-camp-claim")
      .map("campRush")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 720, 720, { id: "creep-footman" })
      .unit("v2", "lancer", 750, 750, { id: "creep-lancer" })
      .unit("v2", "archer", 780, 720, { id: "creep-archer" })
      .unit("v2", "footman", 810, 750, { id: "creep-footman-b" })
      .unit("v2", "archer", 840, 720, { id: "creep-archer-b" })
      .townHall("v1", 3300, 3300)
      .unit("neutral", "wildling", 1040, 980, { id: "book-guard-a" })
      .unit("neutral", "thornSlinger", 1090, 1015, { id: "book-guard-b" })
      .item("nearby-xp-book", "experienceBook", 0, 0, { carrierId: "book-guard-b" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory });
    const command = entries.find((entry) => entry.scriptId === "objectiveControl" && entry.command.type === "attackMove")?.command;

    if (!command || command.type !== "attackMove") throw new Error("missing neutral camp assignment");
    expect(Object.keys(memory.unitClaims).sort()).toEqual([...command.unitIds].sort());
    expect(memory.unitClaims["creep-footman"]).toMatchObject({ kind: "creep", targetId: "book-guard-a", sinceTick: 0 });
  });

  it("v2 feeds experience books to a unit near a star breakpoint instead of a capped veteran", () => {
    const scene = sketchScene("v2-xp-book-breakpoint-carrier")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "knight", 760, 740, { id: "capped-knight" })
      .unit("v2", "contractArcher", 790, 760, { id: "near-breakpoint-archer" })
      .item("xp-book", "experienceBook", 780, 750)
      .townHall("v1", 3000, 3000)
      .build();
    const game = scene.createGame();
    const capped = game.units.find((unit) => unit.id === "capped-knight");
    const nearBreakpoint = game.units.find((unit) => unit.id === "near-breakpoint-archer");
    if (!capped || !nearBreakpoint) throw new Error("expected scene units");
    capped.level = 3;
    capped.xp = 360;
    nearBreakpoint.level = 1;
    nearBreakpoint.xp = 120;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.items], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "pickupItem",
    );

    expect(command).toMatchObject({ type: "pickupItem", unitId: "near-breakpoint-archer", itemId: "xp-book" });
  });

  it("v2 denies an exposed enemy expansion before routine pressure on a nearer production building", () => {
    const scene = sketchScene("v2-denies-exposed-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .building("v1b", "barracks", 1780, 1520, { id: "nearer-decoy-barracks" })
      .unit("v1b", "footman", 1760, 1580)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toMatchObject({ type: "attackMove", x: 2200, y: 1750 });
  });

  it("v2 does not deny an exposed expansion when the route is covered by a much stronger combined army", () => {
    const scene = sketchScene("v2-skips-covered-expansion-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .unit("v1a", "footman", 1580, 1220)
      .unit("v1a", "footman", 1620, 1260)
      .unit("v1a", "lancer", 1660, 1300)
      .unit("v1a", "archer", 1700, 1340)
      .unit("v1a", "archer", 1740, 1380)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .unit("v1b", "footman", 1600, 1820)
      .unit("v1b", "footman", 1640, 1860)
      .unit("v1b", "lancer", 1680, 1900)
      .unit("v1b", "raider", 1720, 1940)
      .unit("v1b", "archer", 1760, 1980)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not dive an enemy expansion pocket controlled by combined local armies", () => {
    const scene = sketchScene("v2-skips-locally-controlled-expansion-pocket")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .unit("v2", "footman", 1450, 1450)
      .unit("v2", "footman", 1490, 1470)
      .unit("v2", "footman", 1530, 1490)
      .unit("v2", "lancer", 1570, 1510)
      .unit("v2", "lancer", 1610, 1530)
      .unit("v2", "archer", 1650, 1550)
      .unit("v2", "archer", 1690, 1570)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .building("v1b", "townHall", 2600, 1760, { id: "v1b-pocket-expansion" })
      .worker("v1b", 2570, 1760)
      .worker("v1b", 2630, 1760)
      .unit("v1a", "archer", 2520, 980)
      .unit("v1a", "contractArcher", 2580, 960)
      .unit("v1a", "fieldMedic", 2640, 980)
      .unit("v1b", "footman", 2700, 1000)
      .unit("v1b", "footman", 2760, 1040)
      .unit("v1b", "lancer", 2820, 1080)
      .unit("v1b", "mercenary", 2880, 1120)
      .unit("v1b", "archer", 2760, 1180)
      .unit("v1a", "footman", 2460, 1080)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 keeps its main army on its own guarded natural before chasing enemy expansion denial", () => {
    const scene = sketchScene("v2-own-natural-before-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .goldMine("v2-natural", 820, 1120, 6000)
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .unit("neutral", "stonebackBrute", 820, 1120)
      .unit("neutral", "thornSlinger", 860, 1160)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not chase enemy expansion denial before claiming its own clear natural", () => {
    const scene = sketchScene("v2-own-clear-natural-before-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .goldMine("v2-natural", 820, 1120, 6000)
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 objective control does not pull a committed expansion-denial squad back into creeps", () => {
    const scene = sketchScene("v2-objective-control-yields-to-expansion-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1500, 1500, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "footman", 1540, 1500, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "lancer", 1500, 1540, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "archer", 1540, 1540, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "archer", 1580, 1520, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .townHall("v1a", 3300, 3300)
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800)
      .unit("neutral", "stonebackBrute", 1260, 1550)
      .unit("neutral", "thornSlinger", 1300, 1580)
      .unit("neutral", "barkMender", 1230, 1520)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v1 waits on the same farther guarded mercenary objective until it has a fuller squad", () => {
    const scene = sketchScene("v1-waits-far-merc-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v1", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v1", 500, 500)
      .unit("v1", "footman", 700, 700)
      .unit("v1", "lancer", 735, 730)
      .unit("v1", "archer", 770, 760)
      .unit("v1", "footman", 805, 790)
      .townHall("target", 3300, 3300)
      .mercenaryCamp("far-but-winnable-medic-camp", 1500, 1120, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1460, 1100)
      .unit("neutral", "thornSlinger", 1530, 1140)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v1", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 hires from a cleared mercenary camp after the guards are gone", () => {
    const scene = sketchScene("v2-hire-cleared-merc-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "lancer", 820, 720)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-contract-archers", 980, 860, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("v2", "footman", 980, 860)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 250;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "cleared-contract-archers" });
  });

  it("v2 does not preclaim a cleared mercenary camp while the first natural still needs clearing", () => {
    const scene = sketchScene("v2-natural-before-merc-preclaim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .goldMine("v2-main-mine", 570, 500, 6000)
      .goldMine("v2-natural-mine", 980, 860, 6000)
      .unit("v2", "footman", 1000, 720, { order: { type: "attackMove", x: 700, y: 760 } })
      .unit("v2", "lancer", 1040, 760, { order: { type: "attackMove", x: 980, y: 860 } })
      .unit("v2", "archer", 1080, 720, { order: { type: "attackMove", x: 980, y: 860 } })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-contract-archers", 700, 760, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 970, 850)
      .unit("neutral", "thornSlinger", 1010, 890)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 0;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 turns a controlled cleared mercenary objective into fighting power after the first expansion is secured", () => {
    const scene = sketchScene("v2-hire-controlled-camp-before-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 980, 860, { id: "v2-natural-townhall" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 950, 850)
      .unit("v2", "lancer", 990, 880)
      .unit("v2", "archer", 1020, 850)
      .unit("v2", "archer", 1040, 880)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 980, 860, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .mercenaryCamp("cleared-contract-archers", 980, 860, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 200;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "cleared-contract-archers" });
  });

  it("does not hire from a cleared mercenary camp until a friendly unit reaches it", () => {
    const scene = sketchScene("v2-no-remote-merc-hire")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 700, 700)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("distant-cleared-camp", 1400, 1200, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "hire");

    expect(command).toBeUndefined();
  });

  it("moves a squad to a cleared mercenary camp before hiring from it", () => {
    const scene = sketchScene("v2-move-to-cleared-merc-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1180, y: 980 });
  });

  it("v2 pre-claims a cleared mercenary camp with a small squad instead of one unit or the whole army", () => {
    const scene = sketchScene("v2-mercenary-claim-small-team")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 880, 740, { id: "near-claimant" })
      .unit("v2", "lancer", 735, 730, { id: "main-army-a" })
      .unit("v2", "archer", 770, 760, { id: "main-army-b" })
      .unit("v2", "footman", 805, 790, { id: "main-army-c" })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", unitIds: ["near-claimant", "main-army-c", "main-army-b"], x: 1180, y: 980 });
  });

  it("does not break a local mercenary route to chase a stronger distant army target", () => {
    const scene = sketchScene("v2-no-far-strong-army-chase")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1260, 1550, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "footman", 1290, 1570, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "lancer", 1320, 1590, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "contractArcher", 1240, 1580, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "contractArcher", 1270, 1610, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .mercenaryCamp("local-field-tent", 1260, 1550, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .townHall("v1", 3400, 2048)
      .unit("v1", "footman", 2920, 1940)
      .unit("v1", "footman", 2960, 1960)
      .unit("v1", "lancer", 2940, 2000)
      .unit("v1", "contractArcher", 2990, 1900, { id: "bait-archer" })
      .unit("v1", "contractArcher", 3010, 1940)
      .unit("v1", "contractArcher", 2970, 1980)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attack")).toBe(false);
  });

  it("records a mercenary unit claim when sending a squad to a cleared camp", () => {
    const scene = sketchScene("v2-mercenary-claim-memory")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 700, 700, { id: "claim-footman" })
      .unit("v2", "lancer", 735, 730, { id: "claim-lancer" })
      .unit("v2", "archer", 770, 760, { id: "claim-archer" })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;
    const memory = createAiPolicyMemory();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams, memory });
    const command = entries.find((entry) => entry.command.type === "attackMove")?.command;
    if (!command || command.type !== "attackMove") throw new Error("missing mercenary attackMove");

    expect(Object.keys(memory.unitClaims).sort()).toEqual([...command.unitIds].sort());
    expect(memory.unitClaims[command.unitIds[0]!]).toMatchObject({ kind: "mercenary", targetId: "cleared-melee-camp", x: 1180, y: 980, sinceTick: 0 });
  });

  it("records retreat claims so mercenary claims do not pull recovering units back out", () => {
    const scene = sketchScene("v2-retreat-memory-blocks-mercenary-reclaim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "townHall", 980, 860, { id: "v2-natural-townhall" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 900, 760, { id: "retreat-footman", hp: 28 })
      .unit("v2", "lancer", 940, 790, { id: "retreat-lancer", hp: 35 })
      .unit("v1", "footman", 980, 800, { id: "pressure-footman" })
      .unit("v1", "lancer", 1020, 830, { id: "pressure-lancer" })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1260, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;
    const memory = createAiPolicyMemory();

    const retreatEntries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, memory });
    const retreat = retreatEntries.find((entry) => entry.command.type === "move")?.command;
    if (!retreat || retreat.type !== "move") throw new Error("missing retreat move");

    expect(Object.fromEntries(Object.entries(memory.unitClaims).map(([unitId, claim]) => [unitId, claim.kind]))).toEqual({
      "retreat-footman": "retreat",
      "retreat-lancer": "retreat",
    });

    const mercenary = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove");

    expect(mercenary).toBeUndefined();
  });

  it("v2 still moves to claim a cleared mercenary camp before it has hire gold", () => {
    const scene = sketchScene("v2-claim-merc-camp-before-expansion-spend")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "footman", 760, 740)
      .unit("v2", "lancer", 800, 760)
      .unit("v2", "archer", 840, 780)
      .townHall("v1", 3300, 3300)
      .goldMine("v2-natural", 1180, 980, 4000)
      .mercenaryCamp("cleared-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;
    for (let index = 0; index < 10; index += 1) game.spawnUnit("v1", "worker", 3300 + index * 8, 3360);

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1300, y: 980 });
  });

  it("v2 does not pre-claim an enemy-side mercenary camp with a small squad before securing its first expansion", () => {
    const scene = sketchScene("v2-no-enemy-side-merc-preclaim-before-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1260, 980)
      .unit("v2", "footman", 1300, 1010)
      .unit("v2", "lancer", 1340, 1040)
      .unit("v2", "archer", 1380, 1070)
      .townHall("v1", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 1180, 980, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("enemy-side-contract-post", 3000, 1900, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not pre-claim an enemy-side mercenary camp with a larger army before securing its first expansion", () => {
    const scene = sketchScene("v2-no-enemy-side-merc-preclaim-even-with-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1260, 980)
      .unit("v2", "footman", 1300, 1010)
      .unit("v2", "lancer", 1340, 1040)
      .unit("v2", "lancer", 1380, 1070)
      .unit("v2", "archer", 1420, 1100)
      .unit("v2", "archer", 1460, 1130)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 3100, 3040)
      .unit("v1", "lancer", 3140, 3080)
      .unit("v1", "archer", 3180, 3120)
      .unit("v1", "footman", 3220, 3160)
      .unit("v1", "archer", 3260, 3200)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 1180, 980, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("enemy-side-contract-post", 3000, 1900, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not detour to a cleared mercenary camp before hire gold while facing two opponents", () => {
    const scene = sketchScene("v2-no-free-merc-detour-while-outnumbered")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "footman", 760, 740)
      .unit("v2", "lancer", 800, 760)
      .unit("v2", "archer", 840, 780)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3700)
      .goldMine("v2-natural", 1180, 980, 4000)
      .mercenaryCamp("cleared-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("keeps a mercenary-camp claim active while the squad is already walking there", () => {
    const scene = sketchScene("v2-keep-merc-claim-active")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 760, 700, { order: { type: "attackMove", x: 1180, y: 980 } })
      .unit("v2", "lancer", 790, 730, { order: { type: "attackMove", x: 1180, y: 980 } })
      .unit("v2", "archer", 820, 760, { order: { type: "attackMove", x: 1180, y: 980 } })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1180, y: 980 });
  });

  it("keeps mercenary claims alive across the next economy decision interval", () => {
    const scene = sketchScene("v2-merc-claim-survives-next-decision")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 760, 700, { id: "claim-a" })
      .unit("v2", "lancer", 790, 730, { id: "claim-b" })
      .unit("v2", "archer", 820, 760, { id: "claim-c" })
      .townHall("v1", 3300, 3300)
      .unit("neutral", "mossGnawer", 900, 1120, { id: "distracting-creep" })
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;
    const memory = createAiPolicyMemory();

    planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams, memory });
    game.tick = 225;

    const objectiveCommand = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(Object.keys(memory.unitClaims).sort()).toEqual(["claim-a", "claim-b", "claim-c"]);
    expect(objectiveCommand).toBeUndefined();
  });

  it("v2 yields mercenary-camp movement to main-base defense under real pressure", () => {
    const scene = sketchScene("v2-main-pressure-yields-mercenary-move")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 680, 620, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 740, { id: "defender-a" })
      .unit("v2", "footman", 790, 760, { id: "defender-b" })
      .unit("v2", "lancer", 820, 780, { id: "defender-c" })
      .unit("v2", "archer", 850, 800, { id: "defender-d" })
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .unit("v1a", "footman", 690, 620, { id: "attacker-a" })
      .unit("v1a", "lancer", 720, 650, { id: "attacker-b" })
      .unit("v1b", "raider", 735, 690, { id: "attacker-c" })
      .unit("v1b", "archer", 760, 680, { id: "attacker-d" })
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "mercenary")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "attackWave")).toMatchObject({ command: { type: "attack" } });
  });

  it("does not let a later attack wave steal units claimed by a previous mercenary task", () => {
    const scene = sketchScene("v2-attack-wave-respects-memory-claims")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1260, 980, { id: "claimed-a" })
      .unit("v2", "footman", 1300, 1010, { id: "claimed-b" })
      .unit("v2", "lancer", 1340, 1040, { id: "claimed-c" })
      .unit("v2", "lancer", 1380, 1070, { id: "claimed-d" })
      .unit("v2", "archer", 1420, 1100, { id: "claimed-e" })
      .unit("v2", "archer", 1460, 1130, { id: "claimed-f" })
      .unit("v2", "raider", 1500, 1160, { id: "claimed-g" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3700)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["claimed-a", "claimed-b", "claimed-c", "claimed-d", "claimed-e", "claimed-f", "claimed-g"]) {
      memory.unitClaims[unitId] = { kind: "mercenary", targetId: "cleared-melee-camp", x: 1180, y: 980, sinceTick: 0, expiresTick: 900 };
    }

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(entries).toEqual([]);
  });

  it("keeps a committed attack wave from being tugged into neutral objective control", () => {
    const scene = sketchScene("v2-attack-wave-claim-blocks-creep-tug")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 980, 980, { id: "wave-a" })
      .unit("v2", "footman", 1010, 1000, { id: "wave-b" })
      .unit("v2", "lancer", 1040, 1020, { id: "wave-c" })
      .unit("v2", "archer", 1070, 1040, { id: "wave-d" })
      .unit("v2", "archer", 1100, 1060, { id: "wave-e" })
      .townHall("v1a", 1750, 980, { id: "v1a-main" })
      .building("v1a", "barracks", 1680, 960, { id: "v1a-barracks" })
      .unit("neutral", "wildling", 860, 900, { id: "camp-a" })
      .unit("neutral", "thornSlinger", 900, 940, { id: "camp-b" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    const snapshot = snapshotGame(game);

    const firstWave = planAiCommandEntriesFromScripts(snapshot, "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });
    const objective = planAiCommandEntriesFromScripts(snapshot, "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory });
    const secondWave = planAiCommandEntriesFromScripts(snapshot, "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(firstWave.find((entry) => entry.scriptId === "attackWave")?.command).toMatchObject({ type: "attackMove" });
    expect(Object.fromEntries(Object.entries(memory.unitClaims).map(([unitId, claim]) => [unitId, claim.kind]))).toEqual({
      "wave-a": "attack",
      "wave-b": "attack",
      "wave-c": "attack",
      "wave-d": "attack",
      "wave-e": "attack",
    });
    expect(objective).toEqual([]);
    expect(secondWave.find((entry) => entry.scriptId === "attackWave")?.command).toMatchObject({ type: "attackMove" });
  });

  it("keeps a committed attack wave from being retasked into worker pressure", () => {
    const scene = sketchScene("v2-attack-wave-claim-blocks-worker-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520, { id: "wave-a" })
      .unit("v2", "footman", 790, 550, { id: "wave-b" })
      .unit("v2", "lancer", 820, 580, { id: "wave-c" })
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520, { id: "v1a-target-worker" })
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["wave-a", "wave-b", "wave-c"]) {
      memory.unitClaims[unitId] = { kind: "attack", targetId: "v1a-main", x: 1350, y: 520, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toBeUndefined();
  });

  it("lets worker pressure continue units already claimed for harassment", () => {
    const scene = sketchScene("v2-harass-claim-continues-worker-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520, { id: "harass-a" })
      .unit("v2", "footman", 790, 550, { id: "harass-b" })
      .unit("v2", "lancer", 820, 580, { id: "harass-c" })
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520, { id: "v1a-target-worker" })
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["harass-a", "harass-b", "harass-c"]) {
      memory.unitClaims[unitId] = { kind: "harass", targetId: "v1a-target-worker", x: 1290, y: 520, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "v1a-target-worker" } });
    expect(entry?.command.type === "attack" ? entry.command.unitIds : []).toEqual(["harass-a", "harass-b", "harass-c"]);
  });

  it("keeps a committed attack wave from being retasked into early harassment", () => {
    const scene = sketchScene("v2-attack-wave-claim-blocks-early-harass")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "raider", 1220, 520, { id: "wave-a" })
      .unit("v2", "archer", 1240, 550, { id: "wave-b" })
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520, { id: "v1-worker-a" })
      .worker("v1", 1320, 560)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["wave-a", "wave-b"]) {
      memory.unitClaims[unitId] = { kind: "attack", targetId: "v1-main", x: 1350, y: 520, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toBeUndefined();
  });

  it("v2 pauses neutral objectives when two enemy armies are approaching the main before buildings are hit", () => {
    const scene = sketchScene("v2-pre-pressure-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .unit("v2", "footman", 820, 760)
      .unit("v2", "footman", 850, 790)
      .unit("v2", "lancer", 880, 820)
      .unit("v2", "archer", 910, 850)
      .unit("v2", "archer", 940, 880)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 1540, 520)
      .unit("v1a", "lancer", 1580, 560)
      .unit("v1b", "footman", 1500, 650)
      .unit("v1b", "archer", 1560, 700)
      .mercenaryCamp("tempting-cleared-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1120, 930)
      .unit("neutral", "thornSlinger", 1210, 1010)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "objectiveControl")).toBeUndefined();
  });

  it("does not let later tactics overwrite a mercenary-camp move in the same policy pass", () => {
    const scene = sketchScene("v2-merc-move-arbitration")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 3100, 3100)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 900, 1180, { id: "tempting-free-camp-1" })
      .unit("neutral", "thornSlinger", 940, 1200, { id: "tempting-free-camp-2" })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary, AI_SCRIPT_LIBRARY.objectiveControl, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });
    const mercenaryMove = entries.find((entry) => entry.scriptId === "mercenary" && entry.command.type === "attackMove");
    if (!mercenaryMove || mercenaryMove.command.type !== "attackMove") throw new Error("missing mercenary move");
    const movingToMerc = new Set(mercenaryMove.command.unitIds);
    const conflicting = entries
      .filter((entry) => entry.scriptId !== "mercenary")
      .filter((entry) => (entry.command.type === "attack" || entry.command.type === "attackMove" || entry.command.type === "move") && entry.command.unitIds.some((unitId) => movingToMerc.has(unitId)));

    expect(conflicting).toEqual([]);
  });

  it("v2 assigns flame cloak pickup to a high-star durable melee unit instead of the closest body", () => {
    const scene = sketchScene("v2-flame-cloak-carrier")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "archer", 760, 740, { id: "closer-archer" })
      .unit("v2", "knight", 800, 760, { id: "star-knight" })
      .item("red-flame-cloak", "flameCloak", 770, 748)
      .build();
    const game = scene.createGame();
    const knight = game.units.find((unit) => unit.id === "star-knight")!;
    knight.level = 3;
    knight.xp = 360;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "pickupItem");

    expect(command).toMatchObject({ type: "pickupItem", unitId: "star-knight", itemId: "red-flame-cloak" });
  });

  it("uses an active carried item through the same AI command path", () => {
    const scene = sketchScene("ai-active-item-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "contractArcher", 900, 900, { id: "rod-carrier" })
      .unit("v1", "footman", 1040, 900, { id: "chain-target-a" })
      .unit("v1", "archer", 1080, 925, { id: "chain-target-b" })
      .item("blue-lightning-rod", "lightningRod", 0, 0, { carrierId: "rod-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "rod-carrier", itemId: "blue-lightning-rod", targetId: "chain-target-a" });
  });

  it("uses storm staff through the same AI command path", () => {
    const scene = sketchScene("ai-storm-staff-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "contractArcher", 900, 900, { id: "storm-carrier" })
      .unit("v1", "footman", 1050, 900, { id: "storm-target" })
      .item("blue-storm-staff", "stormStaff", 0, 0, { carrierId: "storm-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "storm-carrier", itemId: "blue-storm-staff", x: 1050, y: 900 });
  });

  it("uses breach charge on exposed enemy production instead of wasting it on units", () => {
    const scene = sketchScene("ai-breach-charge-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "raider", 900, 900, { id: "breach-carrier" })
      .building("v1", "barracks", 1060, 900, { id: "exposed-barracks" })
      .unit("v1", "footman", 1010, 900, { id: "nearby-footman" })
      .item("red-breach-charge", "breachCharge", 0, 0, { carrierId: "breach-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "breach-carrier", itemId: "red-breach-charge", targetId: "exposed-barracks" });
  });

  it("uses guardian scroll only when a real cluster fight is nearby", () => {
    const scene = sketchScene("ai-guardian-scroll-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "knight", 900, 900, { id: "scroll-carrier" })
      .unit("v2", "footman", 930, 900)
      .unit("v2", "lancer", 900, 930)
      .unit("v2", "archer", 930, 930)
      .unit("v1", "footman", 1080, 900)
      .unit("v1", "raider", 1100, 930)
      .unit("v1", "archer", 1090, 960)
      .item("green-guardian-scroll", "guardianScroll", 0, 0, { carrierId: "scroll-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "scroll-carrier", itemId: "green-guardian-scroll" });
  });

  it("v2 can research early weapon training before the full production chain exists", () => {
    const scene = sketchScene("v2-early-weapon-training")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620, { id: "early-tech-barracks" })
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 310;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "research", buildingId: "early-tech-barracks", upgradeKind: "weaponTraining" });
  });

  it("v2 early weapon training is not starved by the next production building", () => {
    const scene = sketchScene("v2-tech-before-production")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620, { id: "tech-priority-barracks" })
      .building("v2", "farm", 560, 700)
      .worker("v2", 540, 560, { id: "tech-builder" })
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 310;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "research", buildingId: "tech-priority-barracks", upgradeKind: "weaponTraining" });
  });

  it("v2 early weapon training can beat expansion gold reserve", () => {
    const scene = sketchScene("v2-tech-before-expansion-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620, { id: "tech-reserve-barracks" })
      .building("v2", "farm", 560, 700)
      .worker("v2", 540, 560, { id: "tech-reserve-builder" })
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .unit("v2", "archer", 820, 680)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .goldMine("v2-natural-mine", 1320, 780, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 310;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyTech], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toMatchObject({ type: "research", buildingId: "tech-reserve-barracks", upgradeKind: "weaponTraining" });
  });

  it("v2 keeps core production training before the first expansion bank is actually close", () => {
    const scene = sketchScene("v2-training-before-distant-expansion-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-range" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 590, 700)
      .worker("v2", 520, 520)
      .worker("v2", 540, 520)
      .worker("v2", 560, 520)
      .worker("v2", 580, 520)
      .worker("v2", 600, 520)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .unit("v2", "archer", 820, 680)
      .unit("v2", "footman", 850, 710)
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3280, 3300)
      .worker("v1a", 3300, 3320)
      .worker("v1a", 3320, 3300)
      .worker("v1a", 3340, 3300)
      .worker("v1a", 3360, 3300)
      .goldMine("v2-main-mine", 560, 520, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .goldMine("v2-natural-mine", 1320, 780, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 190;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toContainEqual(expect.objectContaining({ type: "train" }));
  });

  it("v2 builds cinderHeath stables before spending on a catch-up expansion", () => {
    const report = runAiGame({
      name: "cinderHeath catch-up expansion production timing",
      mapId: "cinderHeath",
      agents: {
        v2: {
          adapter: "external",
          team: "north",
          race: "grove",
          version: "v2",
          versionLabel: "v2",
          disabledBehaviors: ["workerHarassment"],
          scripts: [
            AI_SCRIPT_LIBRARY.economy,
            AI_SCRIPT_LIBRARY.constructionRecovery,
            AI_SCRIPT_LIBRARY.emergencyDefense,
            AI_SCRIPT_LIBRARY.repair,
            AI_SCRIPT_LIBRARY.supply,
            AI_SCRIPT_LIBRARY.earlyTech,
            AI_SCRIPT_LIBRARY.economicCatchUp,
            AI_SCRIPT_LIBRARY.productionBuilding,
            AI_SCRIPT_LIBRARY.expansion,
            AI_SCRIPT_LIBRARY.mercenary,
            AI_SCRIPT_LIBRARY.tech,
            AI_SCRIPT_LIBRARY.defense,
            AI_SCRIPT_LIBRARY.healingWell,
            AI_SCRIPT_LIBRARY.training,
            AI_SCRIPT_LIBRARY.attackWave,
          ],
        },
        v1a: { adapter: "external", team: "south", race: "grove", version: "v1", versionLabel: "v1" },
      },
      maxTicks: 14_000,
      thinkInterval: 45,
      trace: { commands: true },
    });

    const v2Builds = report.commands.filter((entry) => entry.owner === "v2" && entry.command.type === "build");
    const stablesTick = v2Builds.find((entry) => entry.command.type === "build" && entry.command.buildingKind === "stables")?.tick;
    const expansionTicks = v2Builds.filter((entry) => entry.command.type === "build" && entry.command.buildingKind === "townHall").map((entry) => entry.tick);

    expect(stablesTick).toBeDefined();
    expect(expansionTicks.length).toBeGreaterThan(0);
    const catchUpExpansionTick = expansionTicks[1];
    if (catchUpExpansionTick !== undefined) expect(stablesTick!).toBeLessThan(catchUpExpansionTick);
  });

  it("v2 takes weapon level two before a third town hall when its two-base army needs a timing upgrade", () => {
    const scene = sketchScene("v2-weapon-two-before-third-base")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 500, 540)
      .worker("v2", 540, 500)
      .unit("v2", "footman", 850, 680)
      .unit("v2", "footman", 885, 710)
      .unit("v2", "lancer", 920, 680)
      .unit("v2", "lancer", 955, 710)
      .unit("v2", "archer", 990, 680)
      .unit("v2", "archer", 1025, 710)
      .unit("v2", "raider", 1060, 680)
      .unit("v2", "footman", 1095, 710)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .townHall("v1a", 2920, 3060, { id: "v1a-natural" })
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .townHall("v1b", 2920, 3800, { id: "v1b-natural" })
      .goldMine("v2-main-mine", 560, 540, 6000)
      .goldMine("v2-natural-mine", 1420, 650, 6000)
      .goldMine("v2-third-mine", 2040, 980, 6000)
      .goldMine("v1a-main-mine", 3340, 3300, 6000)
      .goldMine("v1a-natural-mine", 2920, 3060, 6000)
      .goldMine("v1b-main-mine", 3340, 3800, 6000)
      .goldMine("v1b-natural-mine", 2920, 3800, 6000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 500;
    game.players.v2!.upgrades.weaponTraining = 1;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyTech, AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "research",
    );

    expect(command).toMatchObject({ type: "research", buildingId: "v2-barracks", upgradeKind: "weaponTraining" });
  });

  it("prioritizes a third mining base over duplicate production when two enemy economies are far ahead", () => {
    const scene = sketchScene("v2-third-base-before-duplicate-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .building("v2", "farm", 710, 805)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1a", 2920, 3060, { id: "v1a-natural" })
      .townHall("v1b", 3300, 3800, { id: "v1b-main" })
      .townHall("v1b", 2920, 3800, { id: "v1b-natural" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v2-third-mine", 2040, 980, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000);
    for (let i = 0; i < 10; i += 1) scene.worker("v2", 520 + i * 10, 540 + i * 5);
    for (let i = 0; i < 8; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 650 + i * 22, 720);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 520;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp, AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(command?.type === "build" ? command.x : 0).toBeCloseTo(1950, -2);
    expect(telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
  });

  it("reserves routine training gold for a third mining base when two enemy economies are far ahead", () => {
    const scene = sketchScene("v2-reserve-third-base")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .building("v2", "farm", 710, 805)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v2-third-mine", 2040, 980, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000);
    for (let i = 0; i < 10; i += 1) scene.worker("v2", 520 + i * 10, 540 + i * 5);
    for (let i = 0; i < 8; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 650 + i * 22, 720);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 260;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });
    const training = commands.find((candidate) => candidate.type === "train");
    const nonTownHallBuild = commands.find((candidate) => candidate.type === "build" && candidate.buildingKind !== "townHall");

    expect(training).toBeUndefined();
    expect(nonTownHallBuild).toBeUndefined();
  });

  it("v2 saves for a cleared nearby expansion instead of dribbling the money into one more soldier", () => {
    const scene = sketchScene("v2-cleared-natural-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "lancer", 800, 740)
      .unit("v2", "archer", 840, 720)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 260;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.find((candidate) => candidate.type === "train")).toBeUndefined();
    expect(commands.find((candidate) => candidate.type === "research")).toBeUndefined();
    expect(commands.find((candidate) => candidate.type === "build" && candidate.buildingKind !== "townHall")).toBeUndefined();
  });

  it("v2 preserves routine spending gold while its army is finishing a nearly cleared expansion camp", () => {
    const scene = sketchScene("v2-nearly-cleared-natural-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "lancer", 1080, 680, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "archer", 1010, 620, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "archer", 1000, 700, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("neutral", "mossGnawer", 1130, 655, { hp: 8 })
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-nearly-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 260;

    const economyCommand = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economyCommand).toBeUndefined();
  });

  it("v2 reserves first-natural gold while its army is clearing a guarded expansion", () => {
    const scene = sketchScene("v2-guarded-natural-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650)
      .unit("v2", "footman", 1080, 680)
      .unit("v2", "lancer", 1010, 620)
      .unit("v2", "archer", 1000, 700)
      .unit("v2", "archer", 960, 660)
      .unit("neutral", "mossGnawer", 1130, 655)
      .unit("neutral", "wildling", 1170, 690)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-guarded-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 250;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });
    const economyCommand = commands.find((candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire");

    expect(economyCommand).toBeUndefined();
    expect(commands.find((command) => command.type === "attackMove")).toBeDefined();
  });

  it("v2 redirects an attack-moving army to clear its guarded natural expansion", () => {
    const scene = sketchScene("v2-attackmove-army-clears-guarded-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 980, 760, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "footman", 1010, 790, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "lancer", 1040, 820, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "archer", 1070, 850, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .townHall("v1a", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1200, 900, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .unit("neutral", "stonebackBrute", 1190, 890)
      .unit("neutral", "thornSlinger", 1230, 930)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1200, y: 900 });
    expect(command?.type === "attackMove" ? command.unitIds.length : 0).toBe(4);
  });

  it("records an expansion claim when assigning a squad to clear a guarded natural", () => {
    const scene = sketchScene("v2-guarded-natural-expansion-claim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 980, 760, { id: "natural-footman", order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "footman", 1010, 790, { id: "natural-footman-b", order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "lancer", 1040, 820, { id: "natural-lancer", order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "archer", 1070, 850, { id: "natural-archer", order: { type: "attackMove", x: 2600, y: 2600 } })
      .townHall("v1a", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1200, 900, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .unit("neutral", "stonebackBrute", 1190, 890)
      .unit("neutral", "thornSlinger", 1230, 930)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams, memory });
    const command = entries.find((entry) => entry.scriptId === "expansion" && entry.command.type === "attackMove")?.command;

    if (!command || command.type !== "attackMove") throw new Error("missing guarded natural assignment");
    expect(Object.keys(memory.unitClaims).sort()).toEqual([...command.unitIds].sort());
    expect(memory.unitClaims["natural-footman"]).toMatchObject({ kind: "expansion", targetId: "v2-natural-mine", x: 1200, y: 900, sinceTick: 0 });
  });

  it("v2 waits before clearing a guarded natural that outpowers its current squad", () => {
    const scene = sketchScene("v2-waits-on-overpowered-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1040, 650)
      .unit("v2", "lancer", 1080, 680)
      .unit("v2", "archer", 1010, 620)
      .unit("v2", "archer", 1000, 700)
      .unit("neutral", "stonebackBrute", 1130, 655)
      .unit("neutral", "thornSlinger", 1170, 690)
      .unit("neutral", "gladeWitch", 1120, 610)
      .unit("neutral", "mossGnawer", 1080, 720)
      .unit("neutral", "wildling", 1200, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-hard-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 can take its first clear expansion with two production buildings before stables", () => {
    const scene = sketchScene("v2-two-production-first-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 900, 720)
      .unit("v2", "lancer", 940, 760)
      .unit("v2", "archer", 980, 800)
      .townHall("v1a", 3400, 3400)
      .townHall("v1a", 3000, 3000)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-clear-natural", 1200, 900, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .goldMine("v1a-natural-mine", 3040, 3000, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 340;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", unitId: "v2-builder", buildingKind: "townHall" });
  });

  it("v2 does not treat neutral guards at its natural as a main-base attack wave", () => {
    const scene = sketchScene("v2-natural-guards-are-objectives-not-main-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .unit("v2", "footman", 640, 640, { order: { type: "attackMove", x: 930, y: 930 } })
      .unit("v2", "footman", 670, 650, { order: { type: "attackMove", x: 930, y: 930 } })
      .unit("v2", "lancer", 700, 670, { order: { type: "attackMove", x: 930, y: 930 } })
      .unit("v2", "archer", 720, 620, { order: { type: "move", x: 650, y: 650 } })
      .unit("neutral", "stonebackBrute", 930, 930)
      .unit("neutral", "gladeWitch", 970, 960)
      .unit("neutral", "barkMender", 900, 970)
      .unit("neutral", "thornSlinger", 965, 900)
      .unit("neutral", "mossGnawer", 900, 900)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-guarded-natural", 930, 930, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove", x: 930, y: 930 });
  });

  it("v2 keeps moving toward its guarded natural on sundial reach instead of bouncing home from neutral pressure", () => {
    const players = ["v2", "v1a", "v1b"] as const;
    const teams = { v2: "north", v1a: "south", v1b: "south" };
    const game = createGame("sundialReach", {
      players: [...players],
      aiPlayers: [...players],
      teams,
      races: { v2: "grove", v1a: "grove", v1b: "grove" },
    });
    const runtime = createAiRuntime([...players], { versions: { v2: "v2", v1a: "v1", v1b: "v1" } });
    let v2Commands: ReturnType<typeof runPresetAiRuntime>["commands"] = [];
    while (game.tick <= 3060) {
      if (game.tick % 45 === 0) v2Commands = runPresetAiRuntime(game, runtime).commands.filter((entry) => entry.playerId === "v2");
      stepGame(game);
    }

    const attackWave = v2Commands.find((entry) => entry.scriptId === "attackWave")?.command;

    if (attackWave) {
      expect(attackWave.type).toBe("attackMove");
      if (attackWave.type === "attackMove") expect(attackWave.y).toBeGreaterThan(2400);
    }
  });

  it("v2 pauses distant objective control while a fresh expansion is under pressure", () => {
    const scene = sketchScene("v2-expansion-pressure-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 2300, 620, { id: "v2-far-natural" })
      .unit("v2", "footman", 2210, 640)
      .unit("v2", "lancer", 2250, 660)
      .unit("v2", "archer", 2290, 640)
      .unit("v2", "archer", 2330, 660)
      .unit("v2", "contractArcher", 2370, 640)
      .unit("v2", "mercenary", 2410, 660)
      .unit("v1a", "footman", 2470, 650)
      .unit("v1a", "lancer", 2510, 680)
      .unit("v1b", "footman", 2450, 720)
      .unit("neutral", "mossGnawer", 3180, 940)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 2370, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 keeps objective armies home while an under-saturated expansion has approaching enemies", () => {
    const scene = sketchScene("v2-fragile-expansion-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 2300, 620, { id: "v2-far-natural" })
      .worker("v2", 2330, 650, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 620, 560)
      .unit("v2", "lancer", 660, 580)
      .unit("v2", "archer", 700, 560)
      .unit("v2", "archer", 740, 580)
      .unit("v2", "contractArcher", 780, 560)
      .unit("v2", "mercenary", 820, 580)
      .unit("v1a", "archer", 3450, 640)
      .unit("v1a", "contractArcher", 3490, 680)
      .unit("v1b", "footman", 3340, 900)
      .unit("neutral", "mossGnawer", 1020, 940)
      .townHall("v1a", 3600, 620)
      .townHall("v1b", 3600, 1100)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 2370, 650, 4000)
      .goldMine("v1a-main-mine", 3600, 680, 4000)
      .goldMine("v1b-main-mine", 3600, 1160, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 converts a cleared nearby expansion into a town hall as soon as it can afford one", () => {
    const scene = sketchScene("v2-cleared-natural-build")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 760, 720)
      .unit("v2", "lancer", 800, 740)
      .unit("v2", "archer", 840, 720)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 340;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("v2 adds duplicate core production on two bases when fighting two economies", () => {
    const scene = sketchScene("v2-duplicate-core-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1400, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 1420, 660)
      .worker("v2", 1440, 680)
      .worker("v2", 1460, 660)
      .worker("v2", 1480, 680)
      .unit("v2", "footman", 800, 620)
      .unit("v2", "footman", 830, 650)
      .unit("v2", "lancer", 860, 620)
      .unit("v2", "archer", 890, 650)
      .unit("v2", "archer", 920, 620)
      .unit("v2", "raider", 950, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2850, 3050)
      .townHall("v1b", 3300, 3700)
      .townHall("v1b", 2850, 3700)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3700, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 360;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v2 trains its first squad before buying static defense or extra production when outnumbered", () => {
    const scene = sketchScene("v2-first-squad-before-shell")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 500;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "train", unitKind: "footman" });
  });

  it("v2 builds an emergency main tower before a routine farm when two enemy groups are already approaching", () => {
    const scene = sketchScene("v2-emergency-tower-before-routine-farm")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 720, 620)
      .unit("v2", "footman", 750, 650)
      .unit("v2", "lancer", 780, 680)
      .unit("v2", "archer", 810, 710)
      .unit("v2", "lancer", 840, 740)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1280, 560)
      .unit("v1a", "lancer", 1320, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1280, 820)
      .unit("v1b", "footman", 1320, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;
    game.players.v2!.supplyUsed = 12;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 does not wait for a five-unit army before buying an emergency main tower under two-sided pressure", () => {
    const scene = sketchScene("v2-early-emergency-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620)
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1280, 560)
      .unit("v1a", "lancer", 1320, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1280, 820)
      .unit("v1b", "footman", 1320, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 buys an emergency main tower against a close single-army hit in 1v2", () => {
    const scene = sketchScene("v2-early-single-army-emergency-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620)
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1260, 560)
      .unit("v1a", "lancer", 1300, 600)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 preserves near-tower gold instead of routine training while two enemy groups approach the main", () => {
    const scene = sketchScene("v2-emergency-tower-reserve")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560)
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620)
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1300, 560)
      .unit("v1a", "lancer", 1340, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1300, 820)
      .unit("v1b", "footman", 1340, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 120;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const economyCommand = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economyCommand).toBeUndefined();
  });

  it("v2 builds a moon well after the emergency tower when early pressure leaves defenders wounded", () => {
    const scene = sketchScene("v2-wounded-defense-moon-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .building("v2", "defenseTower", 360, 360, { id: "v2-emergency-tower" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620, { hp: 48 })
      .unit("v2", "lancer", 740, 650, { hp: 54 })
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1880, 560)
      .unit("v1a", "lancer", 1920, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1880, 820)
      .unit("v1b", "footman", 1920, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 140;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
  });

  it("v2 rebuilds a fighting unit before spending scarce gold on a thin moon well", () => {
    const scene = sketchScene("v2-rebuilds-combat-before-thin-moon-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 700, 620, { hp: 48 })
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 920, 620)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1880, 820)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 140;
    game.players.v2!.supplyUsed = 7;
    game.players.v2!.supplyCap = 16;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell, AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      teams: game.teams,
    });

    expect(entries).toEqual([{ scriptId: "training", command: { type: "train", buildingId: "v2-barracks", unitKind: "footman" } }]);
  });

  it("v2 banks scarce one-base gold for combat recovery instead of a sixth worker", () => {
    const scene = sketchScene("v2-one-base-thin-combat-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560)
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 700, 620)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 920, 620)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 75;
    game.players.v2!.supplyUsed = 7;
    game.players.v2!.supplyCap = 16;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 preserves near-moon-well gold instead of routine training when wounded defenders are under pressure", () => {
    const scene = sketchScene("v2-moon-well-reserve")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .building("v2", "defenseTower", 360, 360, { id: "v2-emergency-tower" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 700, 620, { hp: 48 })
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1880, 560)
      .unit("v1a", "lancer", 1920, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1880, 820)
      .unit("v1b", "footman", 1920, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 110;
    game.players.v2!.supplyUsed = 9;
    game.players.v2!.supplyCap = 16;

    const economyCommand = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economyCommand).toBeUndefined();
  });

  it("researches combat upgrades through ordinary SDK policy commands once the economy can afford tech", () => {
    const scene = sketchScene("ai-tech-research")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .unit("v2", "footman", 820, 660)
      .unit("v2", "archer", 850, 680)
      .townHall("target", 1800, 1800, { id: "target-main" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toMatchObject({ type: "research", upgradeKind: "weaponTraining" });
    if (command?.type !== "research") throw new Error("expected research command");
    issuePlayerCommand(game, "v2", command);
    expect(game.players.v2.gold).toBe(620);
  });

  it("delays combat tech when v2 is economically outnumbered and still needs army tempo", () => {
    const scene = sketchScene("ai-tech-delay-when-outnumbered")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .unit("v2", "footman", 820, 660)
      .unit("v2", "archer", 850, 680)
      .worker("v2", 520, 560)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.some((candidate) => candidate.type === "research")).toBe(false);
    expect(commands.some((candidate) => candidate.type === "train" || candidate.type === "build")).toBe(true);
  });

  it("v2 builds a main guard tower before early weapon tech when fighting two economies", () => {
    const scene = sketchScene("ai-main-tower-before-early-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .unit("v2", "footman", 780, 640)
      .unit("v2", "footman", 810, 670)
      .unit("v2", "lancer", 840, 700)
      .unit("v2", "archer", 870, 730)
      .unit("v2", "archer", 900, 760)
      .worker("v2", 520, 560, { id: "v2-builder" })
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3260, 3300)
      .worker("v1a", 3300, 3340)
      .worker("v1a", 3340, 3380)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3400, 3840)
      .worker("v1b", 3440, 3880)
      .unit("v1b", "footman", 1320, 720)
      .unit("v1b", "lancer", 1360, 760)
      .unit("v1b", "archer", 1400, 800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 320;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "research")).toBe(false);
    expect(commands.find((command) => command.type === "build" && command.buildingKind === "defenseTower")).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("recalls attacking armies when owned buildings are under pressure", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const base = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    const enemyBase = game.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall")!;
    const soldiers = Array.from({ length: 7 }, (_, index) => game.spawnUnit("player", "footman", 3200 + index * 16, 3200));
    for (const soldier of soldiers) soldier.order = { type: "attack", targetId: enemyBase.id };
    base.hp = Math.floor(base.maxHp * 0.7);
    game.spawnUnit("enemy", "raider", base.x + 120, base.y);
    game.spawnUnit("enemy", "archer", base.x + 140, base.y + 40);

    const command = planPresetAiCommands(snapshotGame(game), "player").find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 0).toBeCloseTo(base.x, -2);
    expect(command?.type === "attackMove" ? command.unitIds.length : 0).toBeGreaterThanOrEqual(7);
  });

  it("recalls armies to defend pressured allied buildings in team games", () => {
    const game = createGame("bareDuel", { players: ["player", "ally", "enemy"], aiPlayers: [], teams: { player: "north", ally: "north", enemy: "south" } });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const alliedBase = game.buildings.find((building) => building.owner === "ally" && building.kind === "townHall")!;
    const enemyBase = game.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall")!;
    const soldiers = Array.from({ length: 6 }, (_, index) => game.spawnUnit("player", "footman", 3200 + index * 16, 3200));
    for (const soldier of soldiers) soldier.order = { type: "attack", targetId: enemyBase.id };
    alliedBase.hp = Math.floor(alliedBase.maxHp * 0.65);
    game.spawnUnit("enemy", "raider", alliedBase.x + 120, alliedBase.y);
    game.spawnUnit("enemy", "archer", alliedBase.x + 140, alliedBase.y + 40);

    const command = planPresetAiCommands(snapshotGame(game), "player", { teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 0).toBeCloseTo(alliedBase.x, -2);
  });

  it("v2 counts early harassment worker raids and the behavior can be disabled for A/B tests", () => {
    const scene = sketchScene("v2-harass-workers")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "raider", 760, 520)
      .unit("v2", "archer", 790, 550)
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520)
      .worker("v1", 1320, 560)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1-main", 1260, 520, 3000)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, telemetry }).find((command) => command.type === "attack");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, disabledBehaviors: ["earlyHarassment"], telemetry: createAiTelemetry() }).find((command) => command.type === "attack");

    expect(enabled).toMatchObject({ type: "attack" });
    expect(enabled?.type === "attack" ? enabled.targetId : "").toMatch(/worker/);
    expect(enabled?.type === "attack" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.earlyHarassment.attempts).toBe(1);
    expect(telemetry.behaviors.earlyHarassment.workerRaidCommands).toBe(1);
  });

  it("v2 does not restart early harassment after its first expansion is established", () => {
    const scene = sketchScene("v2-no-post-expansion-early-harass")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1040, 760)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 900, 640)
      .unit("v2", "archer", 930, 670)
      .unit("v2", "lancer", 960, 700)
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520)
      .worker("v1", 1320, 560)
      .goldMine("v2-main", 560, 540, 3000)
      .goldMine("v2-natural", 1080, 760, 3000)
      .goldMine("v1-main", 1260, 520, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams })[0];

    expect(entry).toBeUndefined();
  });

  it("v2 can disable the whole worker harassment strategy family", () => {
    const scene = sketchScene("v2-worker-harassment-family-off")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520)
      .unit("v2", "footman", 790, 550)
      .unit("v2", "lancer", 820, 580)
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520)
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure, AI_SCRIPT_LIBRARY.earlyHarassment], {
      version: "v2",
      teams: game.teams,
      telemetry,
      disabledBehaviors: ["workerHarassment"],
    });

    expect(entries.filter((entry) => entry.scriptId === "workerPressure" || entry.scriptId === "earlyHarassment")).toEqual([]);
    expect(telemetry.behaviors.workerHarassment.disabledSkips).toBe(2);
  });

  it("v2 commits a three-unit 1v2 worker-pressure job into memory", () => {
    const scene = sketchScene("v2-worker-pressure-job")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520, { id: "pressure-1" })
      .unit("v2", "footman", 790, 550, { id: "pressure-2" })
      .unit("v2", "lancer", 820, 580, { id: "pressure-3" })
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520, { id: "v1a-target-worker" })
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "v1a-target-worker" } });
    expect(entry?.command.type === "attack" ? entry.command.unitIds : []).toEqual(["pressure-1", "pressure-2", "pressure-3"]);
    expect(memory.strategicPlan?.focusTargetOwner).toBe("v1a");
    expect(Object.values(memory.unitClaims).map((claim) => claim.kind)).toEqual(["harass", "harass", "harass"]);
  });

  it("v2 chooses one pressure side by enemy base shape instead of chasing the nearest worker across owners", () => {
    const scene = sketchScene("v2-worker-pressure-base-shape")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520)
      .unit("v2", "footman", 790, 550)
      .unit("v2", "lancer", 820, 580)
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3000, 3180, { id: "nearer-cross-owner-worker" })
      .unit("v1a", "footman", 3160, 3300)
      .unit("v1a", "lancer", 3200, 3340)
      .townHall("v1b", 3280, 3320)
      .worker("v1b", 3220, 3320, { id: "chosen-base-worker" })
      .unit("v1b", "footman", 3150, 3320)
      .unit("v1b", "archer", 3190, 3360)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 3300, 3300, 3000)
      .goldMine("v1b-main", 3280, 3320, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1a" };

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "chosen-base-worker" } });
  });

  it("v2 counts early harassment retreats when a larger defending force answers", () => {
    const scene = sketchScene("v2-harass-retreat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "raider", 1220, 520)
      .unit("v2", "archer", 1240, 550)
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520)
      .worker("v1", 1320, 560)
      .unit("v1", "footman", 1260, 500)
      .unit("v1", "footman", 1260, 560)
      .unit("v1", "lancer", 1300, 590)
      .unit("v1", "archer", 1300, 460)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.x : 0).toBeCloseTo(500, -2);
    expect(telemetry.behaviors.earlyHarassment.retreatCommands).toBe(1);
  });

  it("v2 retreats disadvantaged open-field skirmish groups toward home and can disable the behavior", () => {
    const scene = sketchScene("v2-skirmish-retreat")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "footman", 1900, 1600)
      .unit("v2", "archer", 1940, 1640)
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "footman", 2040, 1600)
      .unit("v1", "lancer", 2060, 1640)
      .unit("v1", "archer", 2080, 1680)
      .unit("v1", "raider", 2100, 1720)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "attackMove");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, disabledBehaviors: ["earlyHarassment", "skirmishPreservation"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "move" && candidate.unitIds.some((id) => id.includes("footman") || id.includes("archer")),
    );

    expect(enabled).toMatchObject({ type: "attackMove" });
    expect(enabled?.type === "attackMove" ? enabled.x : 0).toBeCloseTo(500, -2);
    expect(enabled?.type === "attackMove" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.skirmishPreservation.disadvantagedRetreats).toBe(1);
  });

  it("v2 kites low-health ranged units away from melee units that have closed the distance", () => {
    const scene = sketchScene("v2-ranged-kite-melee")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "archer", 1000, 1000, { id: "kiting-archer", hp: 52 })
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "footman", 1030, 1000, { id: "closing-footman", hp: 92 })
      .build();
    const game = scene.createGame();
    const archer = game.units.find((unit) => unit.id === "kiting-archer")!;
    const footman = game.units.find((unit) => unit.id === "closing-footman")!;
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move", unitIds: ["kiting-archer"] });
    if (command?.type !== "move") throw new Error("expected ranged kite move");
    expect(command.x).toBeLessThan(archer.x);
    expect(distance(command, footman)).toBeGreaterThan(distance(archer, footman));
    expect(telemetry.behaviors.skirmishPreservation.rangedKites).toBe(1);
  });

  it("v2 pulls wounded ranged units behind the line and wounded melee units home", () => {
    const scene = sketchScene("v2-wounded-preserve")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "footman", 1660, 1500, { hp: 18 })
      .unit("v2", "archer", 1700, 1540, { hp: 16 })
      .unit("v2", "lancer", 1620, 1540)
      .unit("v2", "priest", 1580, 1580)
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "raider", 1800, 1520)
      .unit("v1", "archer", 1840, 1560)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, telemetry }).filter((candidate) => candidate.type === "move");

    expect(commands).toHaveLength(2);
    const meleeRetreat = commands.find((command) => command.type === "move" && command.unitIds.some((id) => id.includes("footman")));
    const rangedPullback = commands.find((command) => command.type === "move" && command.unitIds.some((id) => id.includes("archer")));
    expect(meleeRetreat?.type === "move" ? meleeRetreat.x : 0).toBeCloseTo(500, -2);
    expect(rangedPullback?.type === "move" ? rangedPullback.x : 0).toBeLessThan(1700);
    expect(rangedPullback?.type === "move" ? rangedPullback.x : 0).toBeGreaterThan(500);
    expect(telemetry.behaviors.skirmishPreservation.woundedMeleeSaves).toBe(1);
    expect(telemetry.behaviors.skirmishPreservation.woundedRangedPullbacks).toBe(1);
  });

  it("v2 regroups to a friendly expansion when losing a fight near an owned mine", () => {
    const scene = sketchScene("v2-expansion-regroup")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1450, 600, { id: "v2-expansion-townhall" })
      .worker("v2", 450, 500)
      .unit("v2", "footman", 650, 540)
      .unit("v2", "archer", 690, 560)
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "footman", 760, 540)
      .unit("v1", "lancer", 800, 580)
      .unit("v1", "archer", 820, 620)
      .unit("v1", "raider", 840, 660)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-expansion-mine", 1520, 620, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionRegroup], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionRegroup], { version: "v2", teams: game.teams, disabledBehaviors: ["expansionRegroup"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "move" && Math.abs(candidate.x - 1450) < 120,
    );

    expect(enabled).toMatchObject({ type: "move" });
    expect(enabled?.type === "move" ? enabled.x : 0).toBeCloseTo(1450, -2);
    expect(enabled?.type === "move" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.expansionRegroup.expansionRegroupRetreats).toBe(1);
  });

  it("v2 opens an extra expansion when the opponent economy is ahead", () => {
    const scene = sketchScene("v2-economic-extra-expand")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .tower("v2", 1370, 760, { id: "v2-natural-tower" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .worker("v2", 450, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .townHall("v1", 2800, 3000, { id: "v1-natural" })
      .townHall("v1", 2450, 2550, { id: "v1-third" })
      .worker("v1", 3350, 3300)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-natural-mine", 1420, 650, 3000)
      .goldMine("v2-third-mine", 2050, 980, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .goldMine("v1-natural-mine", 2820, 3040, 3000)
      .goldMine("v1-third-mine", 2480, 2580, 3000)
      .build();
    const game = scene.createGame();
    keepOnlyIds(game, {
      buildings: ["v2-main", "v2-natural", "v2-natural-tower", "v2-barracks", "v2-archery", "v2-stables", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v2-third-mine", "v1-main-mine", "v1-natural-mine", "v1-third-mine"],
    });
    if (!game.players["v2"]) throw new Error("missing v2 player");
    game.players["v2"].gold = 1200;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, disabledBehaviors: ["economicCatchUp"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "build" && candidate.buildingKind === "townHall",
    );

    expect(enabled).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(enabled?.type === "build" ? enabled.x : 0).toBeCloseTo(1960, -2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
  });

  it("v2 spends a two-base bank on army before a third base when the army is still thin", () => {
    const scene = sketchScene("v2-two-base-army-before-third")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-main-worker-1", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 550, 540, { id: "v2-main-worker-2", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 580, 540, { id: "v2-main-worker-3", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 610, 540, { id: "v2-main-worker-4", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 640, 540, { id: "v2-main-worker-5", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1360, 650, { id: "v2-natural-worker-1", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1390, 650, { id: "v2-natural-worker-2", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1420, 650, { id: "v2-natural-worker-3", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1450, 650, { id: "v2-natural-worker-4", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1480, 650, { id: "v2-natural-worker-5", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .unit("v2", "footman", 780, 640)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 860, 720)
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .townHall("v1", 2800, 3000, { id: "v1-natural" })
      .worker("v1", 3350, 3300)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-natural-mine", 1420, 650, 3000)
      .goldMine("v2-third-mine", 2050, 980, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .goldMine("v1-natural-mine", 2820, 3040, 3000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 340;
    game.players.v2!.supplyUsed = 16;
    game.players.v2!.supplyCap = 28;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.find((candidate) => candidate.type === "build" && candidate.buildingKind === "townHall")).toBeUndefined();
    expect(commands.find((candidate) => candidate.type === "research")).toBeUndefined();
    expect(commands.find((candidate) => candidate.type === "train" && candidate.unitKind !== "worker")).toMatchObject({ type: "train" });
  });

  it("v2 protects catch-up expansions with towers after core army plans exist", () => {
    const scene = sketchScene("v2-economic-tower")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .worker("v2", 1320, 620)
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .townHall("v1", 2800, 3000, { id: "v1-natural" })
      .townHall("v1", 2450, 2550, { id: "v1-third" })
      .worker("v1", 3350, 3300)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-natural-mine", 1420, 650, 3000)
      .goldMine("v2-third-mine", 2050, 980, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .goldMine("v1-natural-mine", 2820, 3040, 3000)
      .goldMine("v1-third-mine", 2480, 2580, 3000)
      .build();
    const game = scene.createGame();
    keepOnlyIds(game, {
      buildings: ["v2-main", "v2-natural", "v2-barracks", "v2-archery", "v2-stables", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v2-third-mine", "v1-main-mine", "v1-natural-mine", "v1-third-mine"],
    });
    if (!game.players["v2"]) throw new Error("missing v2 player");
    game.players["v2"].gold = 1200;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, disabledBehaviors: ["economicCatchUp"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "build" && candidate.buildingKind === "defenseTower" && candidate.x > 1200,
    );

    expect(enabled).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    expect(enabled?.type === "build" ? enabled.x : 0).toBeGreaterThan(1200);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.economicCatchUp.catchUpTowers).toBe(1);
  });

  it("keeps expanding across third and fourth mines instead of stopping after the first expansion", () => {
    const scene = sketchScene("v2-multi-mine-economy")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 470, 500)
      .worker("v2", 500, 540)
      .worker("v2", 540, 500)
      .worker("v2", 560, 540)
      .worker("v2", 580, 500)
      .worker("v2", 600, 540)
      .worker("v2", 620, 500)
      .worker("v2", 640, 540)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .townHall("target", 3800, 3800, { id: "target-main" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 1120, 620, 4000)
      .goldMine("v2-third", 1690, 760, 4000)
      .goldMine("v2-fourth", 2260, 920, 4000)
      .goldMine("v2-fifth", 2860, 1100, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 1800;
    const scripts = [AI_SCRIPT_LIBRARY.economy, AI_SCRIPT_LIBRARY.expansion, AI_SCRIPT_LIBRARY.productionBuilding, AI_SCRIPT_LIBRARY.training];

    runSdkPolicyLoop(game, "v2", scripts, 12_000);

    const minedBases = ownedMiningBases(game, "v2");
    expect(minedBases.length).toBeGreaterThanOrEqual(4);
    expect(minedBases.map((entry) => entry.mineId)).toEqual(expect.arrayContaining(["v2-natural", "v2-third", "v2-fourth"]));
  });

  it("moves on to fresh mines after several owned mines are exhausted", () => {
    const scene = sketchScene("v2-exhausted-mine-repath")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1120, 620, { id: "v2-natural-hall" })
      .townHall("v2", 1690, 760, { id: "v2-third-hall" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .worker("v2", 500, 540)
      .worker("v2", 540, 500)
      .worker("v2", 1120, 670)
      .worker("v2", 1150, 650)
      .worker("v2", 1690, 810)
      .worker("v2", 1720, 790)
      .townHall("target", 3800, 3800, { id: "target-main" })
      .goldMine("v2-main-mine", 560, 540, 0)
      .goldMine("v2-natural", 1120, 620, 0)
      .goldMine("v2-third", 1690, 760, 0)
      .goldMine("v2-fourth", 2260, 920, 1200)
      .goldMine("v2-fifth", 2860, 1100, 1200)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;
    const scripts = [AI_SCRIPT_LIBRARY.economy, AI_SCRIPT_LIBRARY.expansion, AI_SCRIPT_LIBRARY.productionBuilding, AI_SCRIPT_LIBRARY.training];

    runSdkPolicyLoop(game, "v2", scripts, 4_000);

    const freshBases = ownedMiningBases(game, "v2").filter((entry) => entry.mineId === "v2-fourth" || entry.mineId === "v2-fifth");
    expect(freshBases.length).toBeGreaterThan(0);
  });
});

function keepOnlyIds(game: ReturnType<typeof createGame>, ids: { buildings: string[]; resources: string[] }) {
  const buildings = new Set(ids.buildings);
  const resources = new Set(ids.resources);
  game.buildings = game.buildings.filter((building) => buildings.has(building.id));
  game.resources = game.resources.filter((resource) => resources.has(resource.id));
  game.units = game.units.filter((unit) => unit.id.startsWith("scene-"));
}

function runSdkPolicyLoop(game: ReturnType<typeof createGame>, owner: string, scripts: typeof AI_SCRIPT_VERSIONS.v2, maxTicks: number) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (tick % 30 === 0) {
      for (const command of planAiCommandsFromScripts(snapshotGame(game), owner, scripts, { version: "v2", teams: game.teams })) {
        issuePlayerCommand(game, owner, command);
      }
    }
    stepGame(game);
  }
}

function ownedMiningBases(game: ReturnType<typeof createGame>, owner: string) {
  return game.buildings
    .filter((building) => building.owner === owner && building.kind === "townHall" && building.complete)
    .flatMap((townHall) => {
      const mine = game.resources.find((resource) => resource.amount > 0 && distance(resource, townHall) < 260);
      if (!mine) return [];
      const miners = game.units.filter((unit) => unit.owner === owner && unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === mine.id);
      return miners.length > 0 ? [{ townHallId: townHall.id, mineId: mine.id, miners: miners.length }] : [];
    });
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
