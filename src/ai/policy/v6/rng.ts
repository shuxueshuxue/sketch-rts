import type { GameSnapshot, PlayerId } from "../../../shared/types";

// @@@v6-game-rng - V6 draws its personality and strategy with a generator seeded from the game itself (map, seat, start
// position), so a replay makes the same choices while different games make different ones. Nothing here reads the clock.

export type Rng = { next: () => number; pick: <T>(weighted: readonly (readonly [T, number])[]) => T };

export function gameRng(snapshot: GameSnapshot, owner: PlayerId, salt: string): Rng {
  const hall = snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall");
  let state = hash(`${salt}|${snapshot.map.id}|${owner}|${Math.round(hall?.x ?? 0)}|${Math.round(hall?.y ?? 0)}`) || 1;
  const next = () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  return {
    next,
    pick: (weighted) => {
      const total = weighted.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
      let roll = next() * total;
      for (const [value, weight] of weighted) {
        roll -= Math.max(0, weight);
        if (roll < 0) return value;
      }
      return weighted[weighted.length - 1]![0];
    },
  };
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
