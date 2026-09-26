import { describe, expect, it } from "vitest";
import { checksumGame } from "../../shared/sim/checksum";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import { loadCampaign, startCampaign } from "../../story/campaign";
import { ASHEN_MARCH } from ".";

const MINUTE = 60 * SIM_TICKS_PER_SECOND;

function playThrough(limit = 70 * MINUTE) {
  const run = startCampaign(ASHEN_MARCH);
  while (!run.director.finished && run.director.tick < limit) run.director.advance();
  return run;
}

describe("the Ashen March", () => {
  it("is played through to its ending by its pilot, in more than forty minutes", () => {
    const { director } = playThrough();
    expect(director.finished).toBe(true);
    expect(director.tick).toBeGreaterThan(40 * MINUTE);
    const vars = director.vars;
    expect(vars.choices).toEqual({ tracks: "follow", ig: "spare", bao: "truth", pass: "stand", vashka: "spare" });
    expect(vars.beaconLit).toBe(true);
    expect(vars.igFate).toBe("joined");
    expect(vars.duFell).toBe(false);
    expect(vars.heroes["ashen/lynn"]!.level).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it("plays the same, tick for tick, every time", () => {
    const first = playThrough(25 * MINUTE);
    const second = playThrough(25 * MINUTE);
    expect(checksumGame(second.director.game)).toBe(checksumGame(first.director.game));
  }, 60_000);

  it("loads a save made anywhere in the campaign to the very same game", () => {
    const run = startCampaign(ASHEN_MARCH);
    for (const minute of [2, 7, 13, 21, 29, 36]) {
      while (run.director.tick < minute * MINUTE + 137) run.director.advance();
      const save = JSON.parse(JSON.stringify(run.director.save()));
      const loaded = loadCampaign(ASHEN_MARCH, save);
      expect(loaded.director.tick).toBe(run.director.tick);
      expect(checksumGame(loaded.director.game)).toBe(checksumGame(run.director.game));
      expect(loaded.director.vars).toEqual(run.director.vars);
    }
  }, 120_000);
});
