// Fingerprints standard matches, to show an engine change moved none of them. It plays the V7 gauntlet's matches (V7
// against pairs of V3, V5 and V6, both races, on generated ladder maps) exactly as the benchmark does, and prints one
// line per match: the winner, the last tick, and the game's canonical checksum every 1000 ticks and at the end. Run it
// on two trees with the same arguments: identical output means every one of those games went the same, tick for tick.
//
//   npx tsx scripts/standard-match-fingerprint.ts --seed <seed> --map-count <n> [--shard <i>/<n>]
import { parseArgs } from "node:util";
import { createAiV7GauntletBenchmarkInput } from "../src/ai/benchmark/v7-gauntlet";
import { runBenchmarkMatch, type BenchmarkTracker } from "../src/sdk/benchmark/core";
import { checksumGame } from "../src/shared/sim/checksum";

const { values } = parseArgs({ options: { seed: { type: "string" }, "map-count": { type: "string" }, shard: { type: "string" } } });
const seed = values.seed ?? "story-invariance";
const mapCount = Number(values["map-count"] ?? 8);
const [shardIndex, shardCount] = (values.shard ?? "0/1").split("/").map(Number) as [number, number];

const fingerprint: BenchmarkTracker<never, string[], string[]> = {
  id: "fingerprint",
  create: () => [],
  afterStep(state, { game }) {
    if (game.tick % 1000 === 0) state.push(`${game.tick}:${checksumGame(game)}`);
  },
  finish(state, { game }) {
    state.push(`end:${game.tick}:${checksumGame(game)}`);
    return state;
  },
};

const { input } = createAiV7GauntletBenchmarkInput({ seed, mapCount });
const matches = input.evaluations.flatMap((evaluation) => evaluation.matches).filter((_, index) => index % shardCount === shardIndex);
for (const match of matches) {
  const report = runBenchmarkMatch(match, [fingerprint as never]);
  console.log(JSON.stringify({ match: match.name, winner: report.result.winner, tick: report.result.tick, timeout: report.result.timeout, fingerprint: report.result.trackers.fingerprint }));
}
