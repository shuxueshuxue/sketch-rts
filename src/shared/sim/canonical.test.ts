import { describe, expect, it } from "vitest";
import { createGame, type Game } from "../sim";
import { canonicalGameState, checksumGame } from "./checksum";

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
    // Recorded on mac1 (node 26, arm64) under en-US, lt-LT and et-EE, and checked on the A100 (node 22, x64). The rich map
    // is laid out with det-math.
    expect(checksumGame(createGame("bareDuel", { aiPlayers: [] }))).toBe("329c28e2");
    const rich = createGame("emberFen", { players: ["v8", "p1", "p2"], teams: { v8: "a", p1: "b", p2: "b" }, races: { v8: "ember", p1: "grove", p2: "ember" } });
    expect(checksumGame(rich)).toBe("c73b6fae");
  });
});
