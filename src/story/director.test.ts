import { describe, expect, it } from "vitest";
import { createGame } from "../shared/sim";
import { CHECKSUM_VERSION, checksumGame } from "../shared/sim/checksum";
import { defineUnit, enlist } from "./cast";
import { Director, type PlayerControls } from "./director";
import { race, spawn, type Operation } from "./kernel";
import { on, signal, subscribe, until, wait } from "./ops";
import { seconds } from "./time";
import { World } from "./world";

const ranger = defineUnit({ id: "test/ranger", name: "Ranger", color: "#2f7d6d", rules: { base: "archer", hp: 600, attackDamage: 30 }, model: { paint: () => undefined } });
const brute = defineUnit({ id: "test/brute", name: "Brute", rules: { base: "footman", hp: 40, attackDamage: 4, speed: 2 }, model: { paint: () => undefined } });

type Vars = { log: string[]; picked?: string };

function field() {
  const game = createGame("bareDuel", {
    players: ["heroes", "raiders"],
    aiPlayers: [],
    teams: { heroes: "a", raiders: "b" },
    races: { heroes: "grove", raiders: "ember" },
    scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true },
  });
  enlist(game, { ranger, brute });
  return game;
}

// A short story with a fight, a line, a choice and a checkpoint, and a pilot that answers the choice and gives orders.
function tale(director: Director<Vars>, resumeAt: string | undefined): Operation<void> {
  return (function* (): Operation<void> {
    const world = new World(director.game, director.stage, { ranger, brute }, () => director.random());
    if (resumeAt !== "second") {
      const hero = world.spawn(ranger, "heroes", { x: 1000, y: 1000 }, { id: "hero" });
      director.vars.log.push(`start ${director.tick}`);
      yield* director.stage.say(hero, "Let us begin.");
      director.vars.log.push(`spoke ${director.tick}`);
      const deaths = yield* subscribe("died");
      world.spawnGroup(brute, "raiders", { x: 1500, y: 1000 }, 3);
      yield* until(() => world.units({ owner: "raiders" }).length === 0);
      director.vars.log.push(`cleared ${director.tick} ${deaths.drain().length}`);
      const picked = yield* director.stage.choose("Which way?", [{ id: "left", text: "Left" }, { id: "right", text: "Right" }], { id: "way" });
      director.vars.picked = picked;
      yield* director.checkpoint("second");
    }
    director.vars.log.push(`second ${director.tick}`);
    const hero = world.unit("hero")!;
    world.spawnGroup(brute, "raiders", { x: hero.x + 500, y: hero.y }, 2);
    const outcome = yield* race({ won: () => until(() => world.units({ owner: "raiders" }).length === 0), late: () => wait(seconds(120)) });
    director.vars.log.push(`${outcome.kind} ${director.tick}`);
    yield* wait(seconds(3));
  })();
}

function* pilot(controls: PlayerControls): Operation<void> {
  yield* spawn(function* answer() {
    for (;;) {
      yield* wait(seconds(0.5));
      const choice = controls.stage.openChoice;
      if (choice && !choice.picked && controls.game.tick > choice.opened + seconds(2)) controls.answer(choice.id, "right");
    }
  });
  for (;;) {
    yield* wait(seconds(1));
    const foe = controls.game.units.find((unit) => unit.owner === "raiders");
    if (foe) controls.command({ type: "attack", unitIds: ["hero"], targetId: foe.id });
  }
}

// Advances until the condition holds; a story that never gets there fails the test instead of hanging it.
function advanceUntil(director: Director<Vars>, done: () => boolean, limit = 20 * 600) {
  for (let tick = 0; !done(); tick += 1) {
    if (tick > limit) throw new Error(`Not there after ${limit} ticks: ${director.vars.log.join(" | ")}`);
    director.advance();
  }
}

function play(limit = 20 * 400) {
  const director = new Director<Vars>({ id: "tale", game: field(), player: "heroes", vars: { log: [] }, story: tale, pilot, seed: 7 });
  director.begin();
  while (!director.finished && director.tick < limit) director.advance();
  return director;
}

describe("director", () => {
  it("runs a story to its end on the game's clock", () => {
    const director = play();
    expect(director.finished).toBe(true);
    expect(director.vars.picked).toBe("right");
    const [start, spoke, cleared, second, won] = director.vars.log;
    expect(start).toBe("start 0");
    // The line is read before the story goes on; the fight is over before the choice.
    expect(Number(spoke!.split(" ")[1])).toBeGreaterThan(seconds(2));
    expect(cleared).toMatch(/^cleared \d+ 3$/);
    expect(second).toMatch(/^second \d+$/);
    expect(won).toMatch(/^won \d+$/);
  });

  it("plays the same way every time", () => {
    const a = play();
    const b = play();
    expect(a.vars.log).toEqual(b.vars.log);
    expect(checksumGame(a.game)).toBe(checksumGame(b.game));
  });

  it("saves as a checkpoint plus inputs, and loads by replaying them to the same game", () => {
    const director = new Director<Vars>({ id: "tale", game: field(), player: "heroes", vars: { log: [] }, story: tale, pilot, seed: 7 });
    director.begin();
    // Past the checkpoint and into the second fight.
    advanceUntil(director, () => director.vars.log.some((entry) => entry.startsWith("second")));
    for (let tick = 0; tick < seconds(4); tick += 1) director.advance();
    const save = director.save();
    expect(save.checkpoint.label).toBe("second");
    expect(save.inputs.length).toBeGreaterThan(0);
    const loaded = Director.load<Vars>({ id: "tale", player: "heroes", story: tale }, JSON.parse(JSON.stringify(save)));
    expect(loaded.tick).toBe(director.tick);
    expect(checksumGame(loaded.game)).toBe(checksumGame(director.game));
    expect(loaded.vars.picked).toBe("right");
  });

  it("refuses a save that does not replay to the game it was made from", () => {
    const director = new Director<Vars>({ id: "tale", game: field(), player: "heroes", vars: { log: [] }, story: tale, pilot, seed: 7 });
    director.begin();
    advanceUntil(director, () => director.vars.log.some((entry) => entry.startsWith("second")));
    for (let tick = 0; tick < seconds(4); tick += 1) director.advance();
    const save = director.save();
    const tampered = { ...save, inputs: save.inputs.slice(1) };
    expect(() => Director.load<Vars>({ id: "tale", player: "heroes", story: tale }, tampered)).toThrow(/does not replay/);
  });

  it("refuses a save hashed by another checksum version, and says so", () => {
    const director = new Director<Vars>({ id: "tale", game: field(), player: "heroes", vars: { log: [] }, story: tale, pilot, seed: 7 });
    director.begin();
    advanceUntil(director, () => director.vars.log.some((entry) => entry.startsWith("second")));
    const save = director.save();
    expect(save.checksumVersion).toBe(CHECKSUM_VERSION);
    const olderGame = { ...director.game };delete olderGame.corpses;
    const versionTwo = { ...save, checksumVersion: 2, checksum: checksumGame(olderGame) };
    expect(Director.load<Vars>({ id: "tale", player: "heroes", story: tale }, versionTwo).tick).toBe(director.tick);
    // A save from before checksum versions (version 1) carries none.
    const { checksumVersion: _version, ...older } = save;
    expect(() => Director.load<Vars>({ id: "tale", player: "heroes", story: tale }, older)).toThrow(`checksum version 1; this build checks version ${CHECKSUM_VERSION}`);
  });

  it("offers every event to a waiting script in turn, so a loop on `on` misses none", () => {
    const game = field();
    const seen: string[] = [];
    const director = new Director({
      id: "events",
      game,
      player: "heroes",
      vars: {},
      story: () =>
        (function* () {
          yield* spawn(function* listen() {
            for (;;) seen.push((yield* on("signal")).name);
          });
          yield* wait(seconds(1));
          yield* signal("one");
          yield* signal("two");
          yield* signal("three");
          yield* wait(seconds(1));
        })(),
    });
    director.begin();
    for (let tick = 0; !director.finished && tick < seconds(10); tick += 1) director.advance();
    expect(seen).toEqual(["one", "two", "three"]);
  });

  it("throws a script's error out of the director instead of losing it", () => {
    const director = new Director({
      id: "broken",
      game: field(),
      player: "heroes",
      vars: {},
      story: () =>
        (function* () {
          yield* wait(seconds(1));
          throw new Error("the bridge was never built");
        })(),
    });
    director.begin();
    expect(() => {
      for (let tick = 0; tick < seconds(2); tick += 1) director.advance();
    }).toThrow("the bridge was never built");
  });
});
