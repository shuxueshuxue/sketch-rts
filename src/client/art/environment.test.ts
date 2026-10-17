import { describe, expect, it } from "vitest";
import { mineStage } from "./environment";

describe("a gold mine's stage (see @@@mine-stages)", () => {
  it("reads only what is left against what it started with", () => {
    const at = (amount: number) => mineStage({ amount, startAmount: 1000 });
    expect([1000, 501, 500, 101, 100, 1, 0].map(at)).toEqual(["rich", "rich", "worked", "worked", "failing", "failing", "collapsed"]);
    // A small seeded mine reads by its own start, not by a map's usual size.
    expect(mineStage({ amount: 30, startAmount: 40 })).toBe("rich");
  });
});
