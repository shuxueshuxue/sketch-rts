import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { AI_SCRIPT_LIBRARY, planAiCommandEntriesFromScripts, planPresetAiCommandEntries } from "./core";

describe("V4-TR tower mercenary policy", () => {
  it("builds an early guard tower without requiring core production", () => {
    const scene = sketchScene("v4-tr-early-guard-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500, { id: "hall" })
      .worker("v4", 540, 520, { id: "builder" })
      .unit("v3", "footman", 860, 520);
    const game = scene.build().createGame();
    game.players.v4!.gold = 180;

    const buildCommands = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .filter((command) => command.type === "build");

    expect(buildCommands.some((command) => command.buildingKind === "defenseTower")).toBe(true);
  });

  it("repairs damaged towers", () => {
    const game = sketchScene("v4-tr-repair-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500)
      .tower("v4", 650, 520, { id: "tower" })
      .worker("v4", 620, 540, { id: "repairer" })
      .build()
      .createGame();
    game.players.v4!.gold = 80;
    const tower = game.buildings.find((building) => building.id === "tower");
    if (!tower) throw new Error("missing tower");
    tower.hp = 90;

    const repairCommands = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .filter((command) => command.type === "repair");

    expect(repairCommands).toContainEqual({ type: "repair", unitIds: ["repairer"], buildingId: "tower" });
  });

  it("hires mercenaries when a worker controls a cleared camp", () => {
    const game = sketchScene("v4-tr-worker-hires-merc")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500)
      .worker("v4", 900, 900, { id: "worker-at-camp" })
      .mercenaryCamp("camp", 900, 900, { hireKind: "mercenary", cost: 160, stock: 2 })
      .build()
      .createGame();
    game.players.v4!.gold = 260;

    const hireCommands = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .filter((command) => command.type === "hire");

    expect(hireCommands).toContainEqual({ type: "hire", campId: "camp" });
  });

  it("keeps hiring combat mercenaries past the ordinary support cap", () => {
    const scene = sketchScene("v4-tr-contract-archer-main-force")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500)
      .building("v4", "farm", 560, 660)
      .worker("v4", 900, 900, { id: "worker-at-camp" })
      .mercenaryCamp("camp", 900, 900, { hireKind: "contractArcher", cost: 145, stock: 2 });
    for (let index = 0; index < 3; index += 1) scene.unit("v4", "contractArcher", 700 + index * 24, 700);
    const game = scene.build().createGame();
    game.players.v4!.gold = 260;

    const hireCommands = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .filter((command) => command.type === "hire");

    expect(hireCommands).toContainEqual({ type: "hire", campId: "camp" });
  });

  it("sends a worker to control an unguarded mercenary camp before hiring", () => {
    const game = sketchScene("v4-tr-worker-claims-safe-merc")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500)
      .worker("v4", 540, 520, { id: "claim-worker" })
      .mercenaryCamp("camp", 900, 900, { hireKind: "mercenary", cost: 160, stock: 2 })
      .build()
      .createGame();
    game.players.v4!.gold = 80;

    const moveCommands = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .filter((command) => command.type === "move");

    expect(moveCommands).toContainEqual({ type: "move", unitIds: ["claim-worker"], x: 900, y: 900 });
  });

  it("builds a forward tower to unlock a guarded mercenary camp", () => {
    const game = sketchScene("v4-tr-forward-tower-merc")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500)
      .worker("v4", 540, 520, { id: "builder" })
      .mercenaryCamp("camp", 1_020, 520, { hireKind: "contractArcher", cost: 145, stock: 2 })
      .unit("neutral", "footman", 1_020, 520)
      .build()
      .createGame();
    game.players.v4!.gold = 180;

    const tower = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .find((command) => command.type === "build" && command.buildingKind === "defenseTower");

    expect(tower).toMatchObject({ type: "build", unitId: "builder", buildingKind: "defenseTower" });
    if (!tower || tower.type !== "build") throw new Error("missing forward tower command");
    expect(Math.hypot(tower.x - 1_020, tower.y - 520)).toBeLessThan(480);
  });

  it("spends late bank on a siege tower step toward an enemy tower", () => {
    const game = sketchScene("v4-tr-siege-tower-step")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v4", 1_000, 500)
      .worker("v4", 1_020, 540, { id: "builder" })
      .goldMine("main", 560, 500, 10_000)
      .goldMine("natural", 1_060, 500, 10_000)
      .tower("v3", 2_000, 500, { id: "enemy-tower" })
      .townHall("v3", 2_160, 500)
      .build()
      .createGame();
    game.players.v4!.gold = 900;

    const tower = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .find((command) => command.type === "build" && command.buildingKind === "defenseTower");

    expect(tower).toMatchObject({ type: "build", unitId: "builder", buildingKind: "defenseTower" });
    if (!tower || tower.type !== "build") throw new Error("missing siege tower command");
    expect(tower.x).toBeGreaterThan(1_450);
    expect(tower.x).toBeLessThan(1_700);
  });

  it("spends late bank on siege towers even after nearby mines are depleted", () => {
    const game = sketchScene("v4-tr-siege-tower-depleted-mines")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v4", 1_000, 500)
      .worker("v4", 1_020, 540, { id: "builder" })
      .goldMine("depleted-main", 560, 500, 0)
      .goldMine("depleted-natural", 1_060, 500, 0)
      .tower("v3", 2_000, 500, { id: "enemy-tower" })
      .townHall("v3", 2_160, 500)
      .build()
      .createGame();
    game.players.v4!.gold = 5_000;
    game.tick = 16_000;

    const tower = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .find((command) => command.type === "build" && command.buildingKind === "defenseTower");

    expect(tower).toMatchObject({ type: "build", unitId: "builder", buildingKind: "defenseTower" });
  });

  it("spends a modest late bank on a siege tower after the game has stalled", () => {
    const game = sketchScene("v4-tr-modest-bank-siege-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v4", 1_000, 500)
      .worker("v4", 1_020, 540, { id: "builder" })
      .goldMine("depleted-main", 560, 500, 0)
      .goldMine("depleted-natural", 1_060, 500, 0)
      .townHall("v3", 2_000, 500, { id: "enemy-hall" })
      .building("v3", "farm", 2_120, 560)
      .build()
      .createGame();
    game.players.v4!.gold = 2_400;
    game.tick = 16_000;

    const tower = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .find((command) => command.type === "build" && command.buildingKind === "defenseTower");

    expect(tower).toMatchObject({ type: "build", unitId: "builder", buildingKind: "defenseTower" });
  });

  it("spends late bank on a distant guarded mercenary camp tower step from an owned anchor", () => {
    const game = sketchScene("v4-tr-distant-guarded-merc-tower-step")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v4", 900, 500)
      .tower("v4", 1_200, 500, { id: "front-tower" })
      .worker("v4", 1_000, 540, { id: "builder" })
      .goldMine("main", 560, 500, 0)
      .goldMine("natural", 960, 500, 0)
      .mercenaryCamp("far-camp", 3_100, 500, { hireKind: "mercenary", cost: 160, stock: 4 })
      .unit("neutral", "footman", 3_100, 500)
      .build()
      .createGame();
    game.players.v4!.gold = 5_000;
    game.tick = 16_000;

    const tower = planAiCommandEntriesFromScripts(snapshotGame(game), "v4", [AI_SCRIPT_LIBRARY.defense], { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .find((command) => command.type === "build" && command.buildingKind === "defenseTower");

    expect(tower).toMatchObject({ type: "build", unitId: "builder", buildingKind: "defenseTower" });
    if (!tower || tower.type !== "build") throw new Error("missing distant mercenary tower command");
    expect(Math.hypot(tower.x - 3_100, tower.y - 500)).toBeLessThan(480);
  });

  it("builds healing wells for wounded mercenaries without requiring core production", () => {
    const game = sketchScene("v4-tr-merc-healing-without-core-production")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north", race: "grove" })
      .townHall("v4", 500, 500)
      .building("v4", "farm", 560, 660)
      .worker("v4", 540, 520, { id: "builder" })
      .unit("v4", "mercenary", 620, 540, { id: "wounded-merc-1", hp: 62 })
      .unit("v4", "contractArcher", 650, 550, { id: "wounded-merc-2", hp: 42 })
      .build()
      .createGame();
    game.players.v4!.gold = 160;

    const buildCommands = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .filter((command) => command.type === "build");

    expect(buildCommands.some((command) => command.buildingKind === "moonWell")).toBe(true);
  });

  it("commits a mercenary army to closeout without waiting for a first expansion", () => {
    const scene = sketchScene("v4-tr-merc-closeout-one-base")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .worker("v4", 540, 520)
      .townHall("v3", 1_500, 500, { id: "enemy-hall" })
      .goldMine("main", 560, 500, 10_000)
      .goldMine("natural", 900, 760, 10_000)
      .goldMine("enemy", 1_520, 560, 10_000);
    for (let index = 0; index < 5; index += 1) scene.unit("v4", "mercenary", 720 + index * 24, 500, { id: `merc-${index}` });
    const game = scene.build().createGame();

    const attackMove = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .find((command) => command.type === "attackMove");

    expect(attackMove).toMatchObject({ type: "attackMove", x: 1_500, y: 500 });
  });

  it("does not send a light mercenary wave through a strong neutral camp", () => {
    const scene = sketchScene("v4-tr-no-light-wave-through-neutral-camp")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v3", 3_000, 500, { id: "enemy-hall" })
      .unit("neutral", "stonebackBrute", 1_760, 500)
      .unit("neutral", "gladeWitch", 1_820, 540)
      .unit("neutral", "barkMender", 1_780, 560)
      .unit("neutral", "thornSlinger", 1_840, 500);
    for (let index = 0; index < 3; index += 1) scene.unit("v4", "contractArcher", 940 + index * 28, 500, { id: `archer-${index}` });
    for (let index = 0; index < 2; index += 1) scene.unit("v4", "fieldMedic", 920 + index * 28, 540, { id: `medic-${index}` });
    const game = scene.build().createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v4", [AI_SCRIPT_LIBRARY.attackWave], { version: "v4-tr", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "attackWave" && entry.command.type === "attackMove" && Math.abs(entry.command.x - 3_000) < 80)).toBe(false);
  });

  it("uses a small mercenary group to clear an enemy blocking the next expansion", () => {
    const scene = sketchScene("v4-tr-small-expansion-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .goldMine("depleted-main", 560, 500, 0)
      .goldMine("center", 1_200, 500, 10_000)
      .goldMine("enemy-main", 2_200, 500, 10_000)
      .townHall("v3", 2_160, 500)
      .unit("v3", "emberRavager", 1_180, 520, { id: "blocker" });
    for (let index = 0; index < 2; index += 1) scene.unit("v4", "contractArcher", 760 + index * 28, 500, { id: `archer-${index}` });
    for (let index = 0; index < 2; index += 1) scene.unit("v4", "fieldMedic", 730 + index * 28, 540, { id: `medic-${index}` });
    const game = scene.build().createGame();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries).toContainEqual(
      expect.objectContaining({
        scriptId: "attackWave",
        command: expect.objectContaining({ type: "attack", targetId: "blocker" }),
      }),
    );
  });

  it("lets closeout take priority over neutral objective control", () => {
    const scene = sketchScene("v4-tr-closeout-over-objective")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .worker("v4", 540, 520)
      .townHall("v3", 1_500, 500, { id: "enemy-hall" })
      .goldMine("main", 560, 500, 10_000)
      .goldMine("natural", 900, 760, 10_000)
      .goldMine("enemy", 1_520, 560, 10_000)
      .unit("neutral", "footman", 820, 760)
      .unit("neutral", "footman", 850, 790);
    for (let index = 0; index < 5; index += 1) scene.unit("v4", "mercenary", 720 + index * 24, 500, { id: `merc-${index}` });
    const game = scene.build().createGame();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "objectiveControl")).toBe(false);
    expect(entries.some((entry) => entry.scriptId === "attackWave" && entry.command.type === "attackMove")).toBe(true);
  });

  it("trains workers but not ordinary combat units from existing production buildings", () => {
    const scene = sketchScene("v4-tr-worker-only-training")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500, { id: "hall" })
      .building("v4", "farm", 560, 660)
      .building("v4", "barracks", 650, 520, { id: "barracks" })
      .building("v4", "archeryRange", 760, 520, { id: "range" });
    for (let index = 0; index < 5; index += 1) scene.worker("v4", 530 + index * 18, 560);
    const game = scene.build().createGame();
    game.players.v4!.gold = 600;

    const trainCommands = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .filter((command) => command.type === "train");

    expect(trainCommands).toContainEqual({ type: "train", buildingId: "hall", unitKind: "worker" });
    expect(trainCommands.filter((command) => command.unitKind !== "worker")).toEqual([]);
  });

  it("uses workers to finish a dead-economy building-only opponent when no mercenary army remains", () => {
    const scene = sketchScene("v4-tr-worker-closeout")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .tower("v3", 900, 500, { id: "last-tower" });
    for (let index = 0; index < 6; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 1_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "last-tower" });
    if (!closeout || closeout.type !== "attack") throw new Error("missing worker closeout attack command");
    expect(new Set(closeout.unitIds)).toEqual(new Set(["worker-0", "worker-1", "worker-2", "worker-3", "worker-4", "worker-5"]));
  });

  it("uses workers to break the last tower even when harmless mercenaries remain", () => {
    const scene = sketchScene("v4-tr-worker-closeout-with-mercs")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .tower("v3", 900, 500, { id: "last-tower" })
      .building("v3", "farm", 820, 560, { id: "last-farm" })
      .unit("v4", "contractArcher", 760, 500)
      .unit("v4", "contractArcher", 780, 520);
    for (let index = 0; index < 6; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 1_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "last-tower" });
  });

  it("uses a small mercenary squad to remove a worker-only opponent economy", () => {
    const scene = sketchScene("v4-tr-worker-only-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v3", 1_700, 500)
      .unit("v4", "contractArcher", 1_120, 500, { id: "archer-0" })
      .unit("v4", "contractArcher", 1_150, 525, { id: "archer-1" })
      .unit("v4", "fieldMedic", 1_090, 535, { id: "medic-0" })
      .worker("v3", 1_540, 500, { id: "enemy-worker" });
    const game = scene.build().createGame();
    game.tick = 12_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries).toContainEqual(
      expect.objectContaining({
        scriptId: "attackWave",
        command: expect.objectContaining({ type: "attack", targetId: "enemy-worker" }),
      }),
    );
  });

  it("does not turn early worker-only residue handling into mercenary worker harassment", () => {
    const scene = sketchScene("v4-tr-early-worker-only-no-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v3", 1_700, 500)
      .unit("v4", "contractArcher", 1_120, 500, { id: "archer-0" })
      .unit("v4", "contractArcher", 1_150, 525, { id: "archer-1" })
      .unit("v4", "fieldMedic", 1_090, 535, { id: "medic-0" })
      .worker("v3", 1_540, 500, { id: "enemy-worker" });
    const game = scene.build().createGame();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(
      entries.some((entry) => entry.scriptId === "attackWave" && entry.command.type === "attack" && entry.command.targetId === "enemy-worker"),
    ).toBe(false);
  });

  it("uses workers to finish a larger building-only opponent base", () => {
    const scene = sketchScene("v4-tr-large-building-closeout")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .tower("v3", 1_200, 500, { id: "enemy-tower" })
      .townHall("v3", 1_320, 500)
      .building("v3", "farm", 1_280, 610)
      .building("v3", "emberForge", 1_420, 560)
      .building("v3", "cinderSpire", 1_460, 440);
    for (let index = 0; index < 8; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 2_000;
    game.tick = 12_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "enemy-tower" });
  });

  it("uses workers to finish a sprawling building-only opponent in late cleanup", () => {
    const scene = sketchScene("v4-tr-sprawling-building-closeout")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .tower("v3", 1_200, 500, { id: "enemy-tower" })
      .townHall("v3", 1_320, 500)
      .townHall("v3", 1_540, 620)
      .building("v3", "farm", 1_280, 610)
      .building("v3", "farm", 1_380, 650)
      .building("v3", "farm", 1_480, 660)
      .building("v3", "barracks", 1_420, 560)
      .building("v3", "archeryRange", 1_540, 500)
      .building("v3", "stables", 1_620, 560)
      .building("v3", "moonWell", 1_680, 620);
    for (let index = 0; index < 8; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 5_000;
    game.tick = 12_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "enemy-tower" });
  });

  it("adds healthy medic attackers to late building-only closeout", () => {
    const scene = sketchScene("v4-tr-building-closeout-with-medics")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v3", 1_200, 500, { id: "enemy-hall" })
      .unit("v4", "fieldMedic", 620, 540, { id: "medic-0" })
      .unit("v4", "fieldMedic", 650, 540, { id: "medic-1" });
    for (let index = 0; index < 6; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 3_000;
    game.tick = 24_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "enemy-hall" });
    if (!closeout || closeout.type !== "attack") throw new Error("missing closeout");
    expect(new Set(closeout.unitIds)).toEqual(new Set(["worker-0", "worker-1", "worker-2", "worker-3", "worker-4", "worker-5", "medic-0", "medic-1"]));
  });

  it("uses workers to clear a residual enemy unit that is not protected by an enemy tower", () => {
    const scene = sketchScene("v4-tr-worker-residual-unit-closeout")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v3", 1_800, 500)
      .tower("v3", 1_850, 500, { id: "enemy-tower" })
      .unit("v3", "sparkArcher", 920, 760, { id: "residual" });
    for (let index = 0; index < 7; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 2_000;
    game.tick = 12_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "residual" });
  });

  it("uses workers to clear a residual enemy unit in late cleanup without requiring a huge bank", () => {
    const scene = sketchScene("v4-tr-residual-unit-late-modest-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v3", 1_800, 500)
      .townHall("v3", 1_900, 660)
      .building("v3", "farm", 1_760, 620)
      .building("v3", "farm", 1_860, 640)
      .building("v3", "farm", 1_960, 620)
      .building("v3", "emberForge", 1_850, 460)
      .building("v3", "cinderSpire", 1_960, 500)
      .building("v3", "emberShrine", 2_040, 560)
      .unit("v3", "sparkArcher", 980, 760, { id: "residual" });
    for (let index = 0; index < 7; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 3_200;
    game.tick = 24_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "residual" });
  });

  it("does not feed workers into a veteran melee residual unit", () => {
    const scene = sketchScene("v4-tr-veteran-melee-residual-no-worker-feed")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v4", 900, 500)
      .townHall("v3", 1_800, 500)
      .building("v3", "emberShrine", 1_900, 560)
      .unit("v3", "emberRavager", 1_720, 500, { id: "veteran-ravager" });
    for (let index = 0; index < 8; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 1_500;
    game.tick = 24_000;
    const ravager = game.units.find((unit) => unit.id === "veteran-ravager");
    if (!ravager) throw new Error("missing veteran ravager");
    ravager.level = 3;
    ravager.maxHp = 207;
    ravager.hp = 207;
    ravager.attackDamage = 24;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(
      entries.some((entry) => entry.scriptId === "workerPressureCloseout" && entry.command.type === "attack" && entry.command.targetId === "veteran-ravager"),
    ).toBe(false);
  });

  it("uses workers to clear the nearest target from a two-unit residual enemy group", () => {
    const scene = sketchScene("v4-tr-two-residual-unit-cleanup")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v3", 1_800, 500)
      .unit("v3", "sparkArcher", 980, 760, { id: "near-residual" })
      .unit("v3", "emberRavager", 1_700, 520, { id: "far-residual" });
    for (let index = 0; index < 7; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 3_200;
    game.tick = 24_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "near-residual" });
  });

  it("uses a worker swarm to clear a normal melee residual in a dead-economy closeout", () => {
    const scene = sketchScene("v4-tr-normal-melee-residual-swarm")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .townHall("v4", 900, 500)
      .townHall("v3", 1_800, 500)
      .building("v3", "emberShrine", 1_880, 560)
      .unit("v3", "emberRavager", 1_260, 620, { id: "normal-ravager" });
    for (let index = 0; index < 10; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 3_000;
    game.tick = 24_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "normal-ravager" });
  });

  it("uses workers to break a wounded enemy tower protecting residual units", () => {
    const scene = sketchScene("v4-tr-wounded-protecting-tower-break")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .building("v4", "farm", 620, 640)
      .townHall("v3", 1_800, 500)
      .tower("v3", 1_240, 560, { id: "wounded-tower" })
      .unit("v3", "sparkArcher", 1_220, 700, { id: "protected-residual" });
    for (let index = 0; index < 8; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 4_000;
    game.tick = 16_000;
    const tower = game.buildings.find((building) => building.id === "wounded-tower");
    if (!tower) throw new Error("missing wounded tower");
    tower.hp = 60;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "wounded-tower" });
  });

  it("uses workers to break a full enemy tower protecting residual units when late bank is high", () => {
    const scene = sketchScene("v4-tr-full-protecting-tower-break")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .building("v4", "farm", 620, 640)
      .townHall("v3", 1_800, 500)
      .tower("v3", 1_240, 560, { id: "protecting-tower" })
      .unit("v3", "sparkArcher", 1_220, 700, { id: "protected-residual" });
    for (let index = 0; index < 10; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 6_000;
    game.tick = 16_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    const closeout = entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command;
    expect(closeout).toMatchObject({ type: "attack", targetId: "protecting-tower" });
  });

  it("sends one worker to a distant safe mercenary camp to rearm a dead-economy closeout", () => {
    const scene = sketchScene("v4-tr-distant-rearm")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .building("v4", "farm", 620, 620)
      .tower("v3", 3_500, 500, { id: "enemy-tower" })
      .unit("v3", "footman", 3_520, 260, { hp: 36 })
      .mercenaryCamp("far-camp", 2_600, 500, { hireKind: "contractArcher", cost: 145, stock: 2 });
    for (let index = 0; index < 6; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 1_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries).toContainEqual(
      expect.objectContaining({
        scriptId: "mercenary",
        command: { type: "move", unitIds: ["worker-5"], x: 2_600, y: 500 },
      }),
    );
  });

  it("does not send a camp worker through an uncleared neutral route", () => {
    const scene = sketchScene("v4-tr-rearm-route-blocked")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .building("v4", "farm", 620, 620)
      .tower("v3", 3_500, 500, { id: "enemy-tower" })
      .unit("v3", "footman", 3_520, 260, { hp: 36 })
      .unit("neutral", "footman", 1_500, 500)
      .mercenaryCamp("far-camp", 2_600, 500, { hireKind: "contractArcher", cost: 145, stock: 2 });
    for (let index = 0; index < 6; index += 1) scene.worker("v4", 560 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v4!.gold = 1_000;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "mercenary" && entry.command.type === "move" && entry.command.x === 2_600 && entry.command.y === 500)).toBe(false);
  });

  it("keeps a worker on a controlled stocked mercenary camp instead of pulling it back to mining", () => {
    const game = sketchScene("v4-tr-keep-camp-worker")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500)
      .goldMine("main", 580, 500, 10_000)
      .worker("v4", 900, 900, { id: "camp-worker" })
      .mercenaryCamp("camp", 900, 900, { hireKind: "contractArcher", cost: 145, stock: 2 })
      .build()
      .createGame();
    game.players.v4!.gold = 500;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries).toContainEqual(expect.objectContaining({ scriptId: "mercenary", command: { type: "hire", campId: "camp" } }));
    expect(entries.some((entry) => entry.scriptId === "economy" && entry.command.type === "mine" && entry.command.unitIds.includes("camp-worker"))).toBe(false);
  });

  it("does not send a single rearmed mercenary into a tower closeout", () => {
    const game = sketchScene("v4-tr-no-single-merc-feed")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .unit("v4", "contractArcher", 2_800, 500, { id: "solo-archer" })
      .tower("v3", 3_500, 500, { id: "enemy-tower" })
      .unit("v3", "footman", 3_520, 260, { hp: 36 })
      .build()
      .createGame();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "attackWave")).toBe(false);
  });

  it("expands to a cleared second mine without ordinary combat production", () => {
    const game = sketchScene("v4-tr-expand-without-barracks")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .player("v3", { team: "south" })
      .townHall("v4", 500, 500)
      .worker("v4", 540, 520, { id: "builder" })
      .goldMine("main", 560, 500, 10_000)
      .goldMine("natural", 1_100, 760, 10_000)
      .goldMine("enemy-main", 1_700, 500, 10_000)
      .townHall("v3", 1_650, 500)
      .build()
      .createGame();
    game.players.v4!.gold = 360;

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams });

    expect(entries).toContainEqual(
      expect.objectContaining({
        scriptId: "expansion",
        command: expect.objectContaining({ type: "build", unitId: "builder", buildingKind: "townHall" }),
      }),
    );
  });

  it("expands to a farther cleared mine when the nearest open mine is guarded", () => {
    const game = sketchScene("v4-tr-cleared-expansion-fallback")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4", { team: "north" })
      .townHall("v4", 500, 500)
      .worker("v4", 540, 520, { id: "builder" })
      .goldMine("guarded-near", 1_100, 520, 10_000)
      .goldMine("cleared-far", 1_500, 520, 10_000)
      .unit("neutral", "stonebackBrute", 1_100, 520)
      .build()
      .createGame();
    game.players.v4!.gold = 1_000;

    const townHall = planPresetAiCommandEntries(snapshotGame(game), "v4", { version: "v4-tr", teams: game.teams })
      .map((entry) => entry.command)
      .find((command) => command.type === "build" && command.buildingKind === "townHall");

    expect(townHall).toMatchObject({ type: "build", unitId: "builder", buildingKind: "townHall" });
    if (!townHall || townHall.type !== "build") throw new Error("missing townHall command");
    expect(Math.hypot(townHall.x - 1_410, townHall.y - 590)).toBeLessThan(160);
    expect(Math.hypot(townHall.x - 1_010, townHall.y - 590)).toBeGreaterThan(220);
  });
});
