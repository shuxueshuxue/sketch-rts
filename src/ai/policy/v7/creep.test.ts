import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../../shared/sim";
import type { GameCommand, GameSnapshot, UnitKind } from "../../../shared/types";
import { sketchScene } from "../../../sdk/scene";
import { createAiPolicyMemory } from "../../memory";
import { readV6Intel } from "../v6/intel";
import { chooseV7Camp, continueV7Creep, neutralCamps, routeClear, stagingPoint, startV7Creep, type Camp } from "./creep";

const V7 = { version: "v2", requestedVersion: "v7" } as const;

type Creep = { kind: UnitKind; x: number; y: number };

function scene(name: string, footmen: { x: number; y: number; hp?: number }[], creeps: Creep[], soldier: UnitKind = "footman") {
  let built = sketchScene(name).map("openClaims").replaceDefaults().player("v7", { team: "north", race: soldier === "footman" ? "grove" : "ember" }).player("rival", { team: "south", race: "grove" }).townHall("v7", 400, 1_000).townHall("rival", 3_600, 3_600);
  footmen.forEach((unit, index) => (built = built.unit("v7", soldier, unit.x, unit.y, { id: `footman-${index}`, ...(unit.hp !== undefined ? { hp: unit.hp } : {}) })));
  creeps.forEach((creep, index) => (built = built.unit("neutral", creep.kind, creep.x, creep.y, { id: `creep-${index}` })));
  const game = built.build().createGame();
  const memory = createAiPolicyMemory();
  const options = { ...V7, teams: game.teams, memory };
  return { game, memory, options, snapshot: () => snapshotGame(game) };
}

function intelOf(snapshot: GameSnapshot, options: { teams: Record<string, string>; memory: ReturnType<typeof createAiPolicyMemory> }) {
  return readV6Intel(snapshot, "v7", { ...V7, ...options });
}

function front(snapshot: GameSnapshot) {
  return snapshot.units.filter((unit) => unit.owner === "v7" && unit.kind !== "worker");
}

function of<T extends GameCommand["type"]>(commands: GameCommand[], type: T) {
  return commands.filter((command): command is Extract<GameCommand, { type: T }> => command.type === type);
}

const SMALL_CAMP: Creep[] = [
  { kind: "thornSlinger", x: 1_500, y: 1_000 },
  { kind: "barkMender", x: 1_560, y: 1_040 },
];

describe("V7 creeping", () => {
  it("reads a spread camp as one camp, linked creep to creep, and a distant one apart", () => {
    const { snapshot } = scene("v7-creep-camps", [], [
      { kind: "stonebackBrute", x: 1_000, y: 2_000 },
      { kind: "thornSlinger", x: 1_250, y: 2_000 },
      { kind: "gladeWitch", x: 1_500, y: 2_000 },
      { kind: "thornSlinger", x: 2_400, y: 2_000 },
    ]);
    const camps = neutralCamps(snapshot()).sort((a, b) => b.creeps.length - a.creeps.length);
    expect(camps.map((camp) => camp.creeps.length)).toEqual([3, 1]);
    expect(camps[0]!.center.x).toBeCloseTo(1_250);
  });

  it("calls a route blocked when it passes near another camp's creep", () => {
    const { snapshot } = scene("v7-creep-route", [], [
      { kind: "thornSlinger", x: 2_000, y: 1_000 },
      { kind: "stonebackBrute", x: 1_300, y: 1_150 },
    ]);
    const camps = neutralCamps(snapshot());
    const target = camps.find((camp) => camp.center.x === 2_000)!;
    expect(routeClear({ x: 600, y: 1_000 }, { x: 1_700, y: 1_000 }, camps, target)).toBe(false);
    expect(routeClear({ x: 600, y: 600 }, { x: 1_700, y: 600 }, camps, target)).toBe(true);
  });

  it("gathers the group outside the camp first, and goes in only once it stands together", () => {
    const { snapshot, options, memory, game } = scene(
      "v7-creep-gather",
      [
        { x: 700, y: 1_000 },
        { x: 720, y: 1_030 },
        { x: 740, y: 970 },
        { x: 400, y: 1_300 },
      ],
      SMALL_CAMP,
    );
    const camps = neutralCamps(snapshot());
    const choice = chooseV7Camp(snapshot(), front(snapshot()), camps, camps, options);
    expect(choice?.camp.creeps).toHaveLength(2);
    startV7Creep(snapshot(), front(snapshot()), choice!, options);
    const staging = memory.v6!.creep!.staging;
    expect(Math.hypot(staging.x - choice!.camp.center.x, staging.y - choice!.camp.center.y)).toBeGreaterThan(200);
    const gathering = continueV7Creep(snapshot(), "v7", front(snapshot()), camps, intelOf(snapshot(), options), options)!;
    expect(memory.v6!.creep!.stage).toBe("gather");
    expect(of(gathering.commands, "attackMove")).toEqual([expect.objectContaining({ x: staging.x, y: staging.y })]);
    // Everyone at the staging point: in they go, together, at the camp.
    for (const unit of game.units.filter((candidate) => candidate.owner === "v7" && candidate.kind === "footman")) {
      unit.x = staging.x;
      unit.y = staging.y;
    }
    const going = continueV7Creep(snapshot(), "v7", front(snapshot()), camps, intelOf(snapshot(), options), options)!;
    expect(memory.v6!.creep!.stage).toBe("engage");
    expect(of(going.commands, "attackMove")).toEqual([expect.objectContaining({ unitIds: expect.arrayContaining(["footman-0", "footman-1", "footman-2", "footman-3"]) })]);
  });

  it("stays on the camp while its group is wounded, stepping the badly wounded back out", () => {
    const { snapshot, options, memory } = scene(
      "v7-creep-wounded",
      [
        { x: 1_450, y: 1_000, hp: 30 },
        { x: 1_440, y: 1_020 },
        { x: 1_430, y: 980 },
      ],
      SMALL_CAMP,
    );
    const camps = neutralCamps(snapshot());
    const camp: Camp = camps[0]!;
    memory.v6 = { creep: { center: camp.center, reach: camp.reach, staging: stagingPoint(camp, { x: 700, y: 1_000 }), stage: "engage", since: 0, group: ["footman-0", "footman-1", "footman-2"] } };
    const fight = continueV7Creep(snapshot(), "v7", front(snapshot()), camps, intelOf(snapshot(), options), options)!;
    expect(fight).toBeDefined();
    expect(of(fight.commands, "move")).toEqual([expect.objectContaining({ unitIds: ["footman-0"] })]);
  });

  it("gives a camp up once its group falls under half the camp, and leaves it alone for a while", () => {
    const { snapshot, options, memory } = scene("v7-creep-abort", [{ x: 1_450, y: 1_000, hp: 20 }], [
      { kind: "stonebackBrute", x: 1_500, y: 1_000 },
      { kind: "gladeWitch", x: 1_560, y: 1_040 },
      { kind: "thornSlinger", x: 1_520, y: 960 },
    ]);
    const camps = neutralCamps(snapshot());
    const camp = camps[0]!;
    memory.v6 = { creep: { center: camp.center, reach: camp.reach, staging: stagingPoint(camp, { x: 700, y: 1_000 }), stage: "engage", since: 0, group: ["footman-0"] } };
    expect(continueV7Creep(snapshot(), "v7", front(snapshot()), camps, intelOf(snapshot(), options), options)).toBeUndefined();
    expect(memory.v6!.creep).toBeUndefined();
    expect(memory.v6!.creepRetry).toBeDefined();
    expect(chooseV7Camp(snapshot(), front(snapshot()), camps, camps, options)).toBeUndefined();
  });

  it("takes no camp its group cannot beat, nor one whose route passes another camp", () => {
    const two = [
      { x: 700, y: 1_000 },
      { x: 720, y: 1_030 },
    ];
    const strong = scene("v7-creep-too-strong", two, [
      { kind: "stonebackBrute", x: 1_500, y: 1_000 },
      { kind: "stonebackBrute", x: 1_540, y: 1_040 },
      { kind: "gladeWitch", x: 1_560, y: 980 },
    ]);
    const strongCamps = neutralCamps(strong.snapshot());
    expect(chooseV7Camp(strong.snapshot(), front(strong.snapshot()), strongCamps, strongCamps, strong.options)).toBeUndefined();
    const blocked = scene("v7-creep-blocked", two, [...SMALL_CAMP, { kind: "stonebackBrute", x: 1_100, y: 1_020 }, { kind: "stonebackBrute", x: 1_120, y: 980 }, { kind: "gladeWitch", x: 1_080, y: 1_000 }]);
    const blockedCamps = neutralCamps(blocked.snapshot());
    const small = blockedCamps.filter((camp) => camp.creeps.length === 2);
    expect(chooseV7Camp(blocked.snapshot(), front(blocked.snapshot()), blockedCamps, small, blocked.options)).toBeUndefined();
  });

  it("weighs its group against a camp by what it fights with, not by what it cost", () => {
    const four = [
      { x: 700, y: 1_000 },
      { x: 720, y: 1_030 },
      { x: 740, y: 970 },
      { x: 700, y: 960 },
    ];
    // Rated 2.33: four footmen (4.0) take it with the margin, four ravagers (4.8 by price, 3.8 by health and damage) do not.
    const camp: Creep[] = [
      { kind: "stonebackBrute", x: 1_500, y: 1_000 },
      { kind: "thornSlinger", x: 1_540, y: 1_040 },
      { kind: "thornSlinger", x: 1_560, y: 980 },
      { kind: "wildling", x: 1_520, y: 960 },
    ];
    const footmen = scene("v7-creep-rating-footmen", four, camp);
    const footmenCamps = neutralCamps(footmen.snapshot());
    expect(chooseV7Camp(footmen.snapshot(), front(footmen.snapshot()), footmenCamps, footmenCamps, footmen.options)).toBeDefined();
    const ravagers = scene("v7-creep-rating-ravagers", four, camp, "emberRavager");
    const ravagerCamps = neutralCamps(ravagers.snapshot());
    expect(chooseV7Camp(ravagers.snapshot(), front(ravagers.snapshot()), ravagerCamps, ravagerCamps, ravagers.options)).toBeUndefined();
  });

  it("chooses no camp while the group is scattered: it assembles first", () => {
    const { snapshot, options } = scene("v7-creep-scattered", [{ x: 700, y: 1_000 }, { x: 720, y: 1_030 }, { x: 740, y: 970 }, { x: 700, y: 2_100 }], SMALL_CAMP);
    const camps = neutralCamps(snapshot());
    expect(chooseV7Camp(snapshot(), front(snapshot()), camps, camps, options)).toBeUndefined();
  });

  it("does not go in when the group reaches the staging point worn short of the force the camp calls for", () => {
    const { snapshot, options, memory } = scene("v7-creep-worn", [{ x: 1_000, y: 1_000, hp: 40 }, { x: 1_010, y: 1_020, hp: 40 }], [
      { kind: "stonebackBrute", x: 1_500, y: 1_000 },
      { kind: "thornSlinger", x: 1_540, y: 1_040 },
    ]);
    const camps = neutralCamps(snapshot());
    const camp = camps[0]!;
    memory.v6 = { creep: { center: camp.center, reach: camp.reach, staging: { x: 1_000, y: 1_010 }, stage: "gather", since: 0, group: ["footman-0", "footman-1"] } };
    expect(continueV7Creep(snapshot(), "v7", front(snapshot()), camps, intelOf(snapshot(), options), options)).toBeUndefined();
    expect(memory.v6!.plays?.["creep:worn"]).toBe(1);
  });

  it("gives the camp up when an enemy army stronger than half the group comes near it", () => {
    const built = scene("v7-creep-enemy", [{ x: 1_200, y: 1_000 }, { x: 1_210, y: 1_020 }, { x: 1_190, y: 980 }], SMALL_CAMP);
    for (let index = 0; index < 3; index += 1) built.game.spawnUnit("rival", "footman", 1_800 + index * 30, 1_000);
    const camps = neutralCamps(built.snapshot());
    const camp = camps[0]!;
    built.memory.v6 = { creep: { center: camp.center, reach: camp.reach, staging: stagingPoint(camp, { x: 700, y: 1_000 }), stage: "engage", since: 0, group: ["footman-0", "footman-1", "footman-2"] } };
    expect(continueV7Creep(built.snapshot(), "v7", front(built.snapshot()), camps, intelOf(built.snapshot(), built.options), built.options)).toBeUndefined();
    expect(built.memory.v6!.plays?.["creep:enemy"]).toBe(1);
  });

  it("finds a staging point around the camp when the one facing the group is crowded by a neighbour camp", () => {
    // The natural's guard to the south; a small camp to the west, near the straight approach.
    const { snapshot, options } = scene("v7-creep-neighbours", [{ x: 1_200, y: 1_000 }, { x: 1_220, y: 1_020 }, { x: 1_180, y: 990 }, { x: 1_210, y: 980 }], [
      { kind: "stonebackBrute", x: 1_240, y: 1_500 },
      { kind: "thornSlinger", x: 1_280, y: 1_530 },
      { kind: "gladeWitch", x: 1_200, y: 1_540 },
      { kind: "thornSlinger", x: 900, y: 1_280 },
      { kind: "barkMender", x: 860, y: 1_300 },
    ]);
    const camps = neutralCamps(snapshot());
    const guard = camps.find((camp) => camp.creeps.length === 3)!;
    expect(chooseV7Camp(snapshot(), front(snapshot()), camps, [guard], options, { x: 1_240, y: 1_560 })?.camp).toBe(guard);
  });
});
