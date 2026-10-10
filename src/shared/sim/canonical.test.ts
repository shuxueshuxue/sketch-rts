import { describe, expect, it } from "vitest";
import { createGame, type Game } from "../sim";
import { canonicalGameState, checksumGame, CHECKSUM_VERSION } from "./checksum";

type Canonical = { match: Record<string, number>; units: { id: string }[]; runtime: { activePlayers: string[] } };

describe("canonical game state", () => {
  it("orders keys, ids and plain lists by code unit", () => {
    const state = canonicalGameState({
      tick: 0,
      match: { buildingsDestroyed: 1, buildProgress: 2 },
      map: {},
      players: {},
      units: [{ id: "unit-b" }, { id: "Unit-a" }, { id: "unit-a" }],
      buildings: [],
      resources: [],
      mercenaryCamps: [],
      items: [],
      projectiles: [],
      effects: [],
      nextId: 0,
      activePlayers: ["p2", "P1", "p1"],
      teams: {},
    } as unknown as Game) as Canonical;
    // An en-US collation would give buildingsDestroyed first and Unit-a after unit-a; code units put capitals first.
    expect(Object.keys(state.match)).toEqual(["buildProgress", "buildingsDestroyed"]);
    expect(state.units.map((unit) => unit.id)).toEqual(["Unit-a", "unit-a", "unit-b"]);
    expect(state.runtime.activePlayers).toEqual(["P1", "p1", "p2"]);
  });

  it("hashes without the machine's collation", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const collate = String.prototype.localeCompare;
    String.prototype.localeCompare = () => {
      throw new Error("checksumGame used localeCompare");
    };
    try {
      expect(() => checksumGame(game)).not.toThrow();
    } finally {
      String.prototype.localeCompare = collate;
    }
  });

  it("gives the recorded checksums for fresh games, on any machine and in any locale", () => {
    // Version 17 also records incremental ship plans; fresh games have none.
    // Fresh-game goldens also include the closer 216-unit initial mine layout.
    expect(CHECKSUM_VERSION).toBe(17);
    // Repeat creation to catch accidental dependence on a process-global random stream.
    for (let repeat = 0; repeat < 2; repeat += 1) {
      expect(checksumGame(createGame("bareDuel", { aiPlayers: [] }))).toBe("7b190f8a");
      const ladder = createGame("ladder", { players: ["v8", "p1", "p2"], teams: { v8: "a", p1: "b", p2: "b" }, races: { v8: "ember", p1: "grove", p2: "ember" }, layout: { seed: "canonical" } });
      // The seeded map carries an environment recipe and habitat-scored scenery.
      expect(checksumGame(ladder)).toBe("b8523a14");
    }
  });
});
