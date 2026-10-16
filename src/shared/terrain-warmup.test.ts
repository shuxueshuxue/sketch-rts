import { describe, expect, it } from "vitest";
import { createGame, stepGame, warmGameCaches } from "./sim";
import { checksumGame } from "./sim/checksum";
import { sameGround, shoreSpots, steerPoint, walkDestination } from "./terrain";
import { BUILDING_DEFS } from "./catalog";

describe("routing warmed before the first tick", () => {
  it("answers and steps exactly as a cold game on a six-player sea map", () => {
    const options = { players: ["player", "enemy", "enemy2", "player-4", "player-5", "player-6"] as const, aiPlayers: [] };
    const cold = createGame("sapphireArchipelago", { ...options, players: [...options.players] });
    const warm = createGame("sapphireArchipelago", { ...options, players: [...options.players] });
    warmGameCaches(warm);
    expect(warm.map.terrain).not.toBe(cold.map.terrain);
    const size = warm.map.width;
    for (let i = 0; i < 64; i++) {
      const a = { x: (i * 2654435761 % 1000) / 1000 * size, y: (i * 40503 % 1000) / 1000 * size };
      const b = { x: (i * 69069 % 1000) / 1000 * size, y: (i * 1103515245 % 1000) / 1000 * size };
      for (const mover of ["land", "sea"] as const) {
        expect(steerPoint(warm.map, a, b, mover)).toEqual(steerPoint(cold.map, a, b, mover));
        expect(walkDestination(warm.map, a, b, mover)).toEqual(walkDestination(cold.map, a, b, mover));
        expect(sameGround(warm.map, a, b, mover)).toBe(sameGround(cold.map, a, b, mover));
      }
    }
    expect(shoreSpots(warm.map, BUILDING_DEFS.shipyard.radius)).toEqual(shoreSpots(cold.map, BUILDING_DEFS.shipyard.radius));
    for (let tick = 0; tick < 60; tick++) { stepGame(warm); stepGame(cold); }
    expect(checksumGame(warm)).toBe(checksumGame(cold));
  });
});
