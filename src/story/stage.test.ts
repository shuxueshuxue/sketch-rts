import { describe, expect, it } from "vitest";
import { createGame } from "../shared/sim";
import { Director } from "./director";
import { race, spawn, type Operation } from "./kernel";
import { wait } from "./ops";
import { seconds } from "./time";
import { World } from "./world";

function run(story: (director: Director<unknown>, world: World) => Operation<void>, ticks: number) {
  const game = createGame("bareDuel", { players: ["a"], aiPlayers: [], scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true } });
  const director = new Director<unknown>({ id: "stage", game, player: "a", vars: {}, story: (self) => story(self, new World(self.game, self.stage, {}, () => self.random())) });
  director.begin();
  const views = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    director.advance();
    views.push(director.stage.view());
  }
  return views;
}

describe("stage", () => {
  it("queues one speaker's lines, but lets two speakers talk at once", () => {
    const views = run((_, world) =>
      (function* () {
        const a = world.spawn("footman", "a", { x: 100, y: 100 });
        const b = world.spawn("footman", "a", { x: 300, y: 100 });
        world.stage.bark(a, "first");
        world.stage.bark(a, "second");
        world.stage.bark(b, "other");
        yield* wait(seconds(20));
      })(),
    seconds(12));
    const shown = (index: number) => views[index]!.lines.map((line) => line.text).sort();
    expect(shown(1)).toEqual(["first", "other"]);
    const later = views.findIndex((view) => view.lines.some((line) => line.text === "second"));
    expect(later).toBeGreaterThan(seconds(2));
    expect(views[later]!.lines.some((line) => line.text === "first")).toBe(false);
  });

  it("takes a line away when the scene that said it is halted", () => {
    const views = run((_, world) =>
      (function* () {
        const a = world.spawn("footman", "a", { x: 100, y: 100 });
        yield* race({ talk: () => world.stage.say(a, "a very long line that would take a while to read out loud"), cut: () => wait(seconds(1)) });
        yield* wait(seconds(10));
      })(),
    seconds(3));
    expect(views[seconds(0.5)]!.lines).toHaveLength(1);
    expect(views[seconds(2)]!.lines).toHaveLength(0);
  });

  it("skips what a fallen speaker had left to say", () => {
    const views = run((_, world) =>
      (function* () {
        const a = world.spawn("footman", "a", { x: 100, y: 100 });
        yield* spawn(function* () {
          yield* world.stage.say(a, "one");
          yield* world.stage.say(a, "two");
        });
        yield* wait(seconds(1));
        world.remove(a);
        yield* wait(seconds(10));
      })(),
    seconds(8));
    expect(views.every((view) => view.lines.every((line) => line.text !== "two"))).toBe(true);
  });

  it("keeps a marker for exactly as long as the task that set it", () => {
    const views = run((_, world) =>
      (function* () {
        yield* race({
          marked: function* () {
            yield* world.stage.marker("quest", { x: 10, y: 10 });
            yield* wait(seconds(100));
          },
          done: () => wait(seconds(2)),
        });
        yield* wait(seconds(10));
      })(),
    seconds(4));
    expect(views[seconds(1)]!.markers).toHaveLength(1);
    expect(views[seconds(3)]!.markers).toHaveLength(0);
  });
});
