import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A story's state is rebuilt by replaying it (see story-director), which only works if a script's every step follows from
// the game and its inputs. So story code may not reach for the machine: no clock, no random source, no timers, no
// promises (their order belongs to the host's event loop, not the game's). Time is the game's (story/time), chance is
// the director's seeded source (World.roll / pick).
const FORBIDDEN: [RegExp, string][] = [
  [/\bMath\.random\b/, "Math.random: use world.roll() or world.pick()"],
  [/\bDate\b/, "Date: time in a story is the game's clock"],
  [/\bperformance\.now\b/, "performance.now: time in a story is the game's clock"],
  [/\bset(Timeout|Interval|Immediate)\b/, "timers: use wait()"],
  [/\basync\b|\bawait\b|\bPromise\b/, "promises: a script waits with yield*"],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("story code stays deterministic", () => {
  for (const file of [...sources("src/story"), ...sources("src/campaigns")]) {
    it(file, () => {
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      const found = FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, why]) => why);
      expect(found).toEqual([]);
    });
  }
});
