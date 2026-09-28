// @@@sim-perf-fixed-set - The proof that a speed-up changes nothing: a fixed set of V8 gauntlet games (several seeds and
// maps, both of V8's races) played single-process, each printed with its CPU seconds and a fingerprint of the whole game.
// The fingerprint is a digest of the full game state (every unit, building, projectile... at full float precision, keys
// sorted, array order kept) every 30 game seconds and at the end, plus a digest of the benchmark report (winner, end
// tick, every tracker's result). An optimization is behaviour-preserving on the set when every game's fingerprint is
// byte-identical before and after it; the CPU column is what it bought.
//
// Usage: npx tsx scripts/sim-perf-fixed-set.ts [--mode bench|loop] [--shard i/n] [--games 0,3,7] [--list]
//   bench (default) plays each game the way the gauntlet benchmark's workers do (runBenchmarkMatch with the workers'
//   trackers); loop plays it the way the .playtest probes do (runAiGameLoop with an afterStep hook reading `after`).
// One JSON line per game, then a summary line: games, CPU-s total and per game, and one digest over all fingerprints.
import { createHash } from "node:crypto";
import { createArmyBalanceStatsTracker } from "../src/ai/benchmark/army-balance-stats";
import { createAiCommandStatsTracker } from "../src/ai/benchmark/command-stats";
import { createExpansionClaimTimelineTracker } from "../src/ai/benchmark/expansion-claim-timeline";
import { createUnitRosterStatsTracker } from "../src/ai/benchmark/unit-roster-stats";
import { createV6DoctrineTracker, createV7DoctrineTracker, createV8DoctrineTracker } from "../src/ai/benchmark/v6-doctrine-stats";
import { createAiV8GauntletBenchmarkInput } from "../src/ai/benchmark/v8-gauntlet";
import { createWoundedMoonWellStatsTracker } from "../src/ai/benchmark/wounded-moonwell-stats";
import { createAiGameCommandPlanner, runAiGameLoop, type AiGameAgent } from "../src/ai/game-runner";
import { runBenchmarkMatch, type BenchmarkMatchInput, type BenchmarkTracker } from "../src/sdk/benchmark/core";
import type { Game } from "../src/shared/sim";
import type { GameSnapshot } from "../src/shared/types";

// Five seeds x four games: each seed's first map in both races, plus two maps further down the list (one per race), and
// the game the first profile was taken on (duskGrove v8 ember, v5-extra-3, 18:40).
const SEEDS = ["v5-extra-1", "v5-extra-3", "v5-hybrid-50-holdout-a", "v5-hybrid-50-2026-06-12", "v5-extra-7"];
const INDICES = [0, 1, 33, 66];
const EXTRA_NAMES: Record<string, string[]> = { "v5-extra-3": ["duskGrove v8 ember"] };
const DIGEST_EVERY = 600;

type FixedGame = { seed: string; match: BenchmarkMatchInput<AiGameAgent> };

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const mode = flag("mode") ?? "bench";
const [shard, shards] = (flag("shard") ?? "0/1").split("/").map(Number) as [number, number];

const games: FixedGame[] = SEEDS.flatMap((seed) => {
  const matches = createAiV8GauntletBenchmarkInput({ seed, mapCount: 50 }).input.evaluations[0]!.matches;
  const picked = INDICES.map((index) => matches[index]!);
  for (const name of EXTRA_NAMES[seed] ?? []) if (!picked.some((match) => match.name === name)) picked.push(matches.find((match) => match.name === name)!);
  return picked.map((match) => ({ seed, match }));
});
const wanted = flag("games")?.split(",").map(Number);
const chosen = games.map((game, index) => ({ ...game, index })).filter(({ index }) => (wanted ? wanted.includes(index) : index % shards === shard));

if (args.includes("--list")) {
  for (const { index, seed, match } of chosen) console.log(`${index} ${seed} ${match.name}`);
  process.exit(0);
}

// Canonical text of a value: keys sorted, undefined dropped, arrays in their own order, numbers at full precision.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value instanceof Map || value instanceof Set) throw new Error("fingerprint: unexpected Map/Set in game state");
  const keys = Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function stateOf(game: Game) {
  return {
    tick: game.tick,
    match: game.match,
    teams: game.teams,
    players: game.players,
    units: game.units,
    buildings: game.buildings,
    resources: game.resources,
    mercenaryCamps: game.mercenaryCamps,
    items: game.items,
    projectiles: game.projectiles,
    effects: game.effects,
    variants: game.variants,
    nextId: game.nextId,
    activePlayers: game.activePlayers,
  };
}

const sha = (text: string) => createHash("sha1").update(text).digest("hex");

type Chain = { hash: string; cpuUs: number };

function fold(chain: Chain, game: Game) {
  const started = process.cpuUsage();
  chain.hash = sha(chain.hash + sha(canonical(stateOf(game))));
  const used = process.cpuUsage(started);
  chain.cpuUs += used.user + used.system;
}

function workerTrackers(): BenchmarkTracker<AiGameAgent>[] {
  // The same trackers, in the same order, as the gauntlet's parallel worker (src/ai/benchmark/parallel-worker.ts).
  return [
    createAiCommandStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createWoundedMoonWellStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createArmyBalanceStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createExpansionClaimTimelineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createUnitRosterStatsTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createV6DoctrineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createV7DoctrineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
    createV8DoctrineTracker() as unknown as BenchmarkTracker<AiGameAgent>,
  ];
}

function playBench(match: BenchmarkMatchInput<AiGameAgent>, chain: Chain) {
  const fingerprint: BenchmarkTracker<AiGameAgent, null, null> = {
    id: "fingerprint",
    afterStep: (_state, { game }) => {
      if (game.tick % DIGEST_EVERY === 0) fold(chain, game);
    },
    finish: (_state, { game }) => {
      fold(chain, game);
      return null;
    },
  };
  const report = runBenchmarkMatch({ ...match, commandPlanner: createAiGameCommandPlanner() }, [...workerTrackers(), fingerprint as unknown as BenchmarkTracker<AiGameAgent>]);
  return { cpuMs: report.cpuMs, elapsedMs: report.elapsedMs, winner: report.result.winner, tick: report.result.tick, report: sha(canonical(report.result)) };
}

function playLoop(match: BenchmarkMatchInput<AiGameAgent>, chain: Chain) {
  // As the .playtest probes read a game: count each side's units every 10 s from the `after` snapshot.
  const counts: number[][] = [];
  const loop = runAiGameLoop({ ...match, commandPlanner: createAiGameCommandPlanner() } as never, {
    afterStep({ game, after }: { game: Game; after: GameSnapshot }) {
      if (after.tick % 200 === 0) counts.push(Object.keys(match.agents).map((owner) => after.units.filter((unit) => unit.owner === owner).length));
      if (game.tick % DIGEST_EVERY === 0) fold(chain, game);
    },
  });
  fold(chain, loop.game);
  return { cpuMs: loop.cpuMs, elapsedMs: loop.elapsedMs, winner: loop.game.match.winner, tick: loop.game.tick, report: sha(canonical({ counts, snapshot: loop.snapshot })) };
}

let cpuTotal = 0;
const digests: string[] = [];
for (const { index, seed, match } of chosen) {
  const chain: Chain = { hash: "", cpuUs: 0 };
  const played = mode === "loop" ? playLoop(match, chain) : playBench(match, chain);
  // The run's own CPU without the fingerprint's digests, which are this harness's cost, not the game's.
  const cpuS = (played.cpuMs - chain.cpuUs / 1000) / 1000;
  cpuTotal += cpuS;
  const fingerprint = sha(`${played.winner}|${played.tick}|${chain.hash}|${played.report}`).slice(0, 16);
  digests.push(`${index}:${fingerprint}`);
  console.log(JSON.stringify({ index, seed, name: match.name, mode, winner: played.winner, endTick: played.tick, cpuS: Number(cpuS.toFixed(3)), wallS: Number((played.elapsedMs / 1000).toFixed(3)), fingerprint }));
}
console.log(JSON.stringify({ summary: true, mode, games: chosen.length, cpuS: Number(cpuTotal.toFixed(3)), cpuSPerGame: Number((cpuTotal / Math.max(1, chosen.length)).toFixed(3)), digest: sha(digests.join(",")).slice(0, 16) }));
