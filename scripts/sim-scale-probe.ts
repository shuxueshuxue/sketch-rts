// @@@sim-scale-probe - How the engine's and the AIs' cost per tick grows with the number of live units: the claim that the
// sim stays fast with big armies. Plays fixed-set games (sim-perf-games), and with --extra N gives every player N more army
// units at tick 0 (its race's line units, in a grid between its town hall and the map centre) so the same AIs fight with
// armies far past what a gauntlet game reaches. Every step is bucketed by the live units on the board: engine wall time per
// step and per unit, and each AI version's wall ms per think. A cost that grows faster than the unit count shows as a rising
// us/unit column. Each game also prints its final checksum, so two trees can be checked against each other on the same run.
//
// Usage: npx tsx scripts/sim-scale-probe.ts [--games 0,11] [--extra 500] [--max-ticks 3000] [--band 20] [--json out.json]
//        npx tsx scripts/sim-scale-probe.ts --report [--band 100] a.json b.json...   (merge saved buckets into one table)
// Without --extra a game runs to its own end; with it, to --max-ticks (default 3000). Run one process per game for timings
// that do not share a JIT, then --report their --json files together.
import { readFileSync, writeFileSync } from "node:fs";
import { createAiGameCommandPlanner, runAiGameLoop, type AiGameAgent } from "../src/ai/game-runner";
import type { SdkGameCommandPlanner } from "../src/sdk/game-runner";
import type { Game } from "../src/shared/sim";
import { checksumGame } from "../src/shared/sim/checksum";
import type { UnitKind } from "../src/shared/types";
import { fixedSetGames } from "./sim-perf-games";

type Bucket = { steps: number; units: number; stepMs: number; planMs: Record<string, number>; plans: Record<string, number> };

const LINE_UNITS: Record<string, UnitKind[]> = {
  grove: ["footman", "archer", "lancer", "ashWarden", "knight", "priest"],
  ember: ["emberRavager", "cinderRunner", "sparkArcher", "ashChieftain", "cinderRevenant", "emberAcolyte"],
};

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const band = Number(flag("band") ?? 20);

if (args.includes("--report")) {
  const files = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--band");
  printTable(files.map((file) => JSON.parse(readFileSync(file, "utf8")) as Record<string, Bucket>));
} else {
  const extra = Number(flag("extra") ?? 0);
  const maxTicks = flag("max-ticks") ? Number(flag("max-ticks")) : extra > 0 ? 3000 : undefined;
  const games = fixedSetGames();
  const indices = flag("games")?.split(",").map(Number) ?? games.map((_, index) => index);
  const buckets: Record<string, Bucket> = {};
  for (const index of indices) {
    const result = playGame(games[index]!.match, extra, maxTicks, buckets);
    console.log(JSON.stringify({ index, name: games[index]!.match.name, extra, ...result }));
  }
  const out = flag("json");
  if (out) writeFileSync(out, JSON.stringify(buckets));
  printTable([buckets]);
}

function playGame(match: { agents: Record<string, AiGameAgent>; maxTicks: number }, extra: number, maxTicks: number | undefined, buckets: Record<string, Bucket>) {
  const bucketOf = (units: number) => (buckets[Math.floor(units / 10) * 10] ??= { steps: 0, units: 0, stepMs: 0, planMs: {}, plans: {} });
  const planner = createAiGameCommandPlanner();
  const timed: SdkGameCommandPlanner<AiGameAgent> = (context) => {
    const started = performance.now();
    const commands = planner(context);
    const bucket = bucketOf(context.game.units.length);
    const version = (context.agent.versionLabel ?? context.agent.version).split(" ")[0]!;
    bucket.planMs[version] = (bucket.planMs[version] ?? 0) + performance.now() - started;
    bucket.plans[version] = (bucket.plans[version] ?? 0) + 1;
    return commands;
  };
  let stepStarted = 0;
  const started = performance.now();
  const loop = runAiGameLoop({ ...match, maxTicks: maxTicks ?? match.maxTicks, commandPlanner: timed } as never, {
    beforeLoop({ game }: { game: Game }) {
      for (const [owner, agent] of Object.entries(match.agents)) addArmy(game, owner, agent.race ?? "grove", extra);
    },
    beforeStep() {
      stepStarted = performance.now();
    },
    onStep({ game }: { game: Game }) {
      const bucket = bucketOf(game.units.length);
      bucket.steps += 1;
      bucket.units += game.units.length;
      bucket.stepMs += performance.now() - stepStarted;
    },
  } as never);
  const game = loop.game;
  return { tick: game.tick, units: game.units.length, winner: game.match.winner ?? null, checksum: checksumGame(game), wallS: Number(((performance.now() - started) / 1000).toFixed(2)) };
}

function addArmy(game: Game, owner: string, race: string, count: number) {
  if (count === 0) return;
  const hall = game.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
  const toward = { x: game.map.width / 2 - hall.x, y: game.map.height / 2 - hall.y };
  const length = Math.hypot(toward.x, toward.y) || 1;
  const [fx, fy] = [toward.x / length, toward.y / length];
  const kinds = LINE_UNITS[race]!;
  const columns = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns) - columns / 2;
    const column = (i % columns) - columns / 2;
    const x = hall.x + fx * 420 + (fx * row - fy * column) * 44;
    const y = hall.y + fy * 420 + (fy * row + fx * column) * 44;
    game.spawnUnit(owner as never, kinds[i % kinds.length]!, Math.max(20, Math.min(game.map.width - 20, x)), Math.max(20, Math.min(game.map.height - 20, y)));
  }
}

function printTable(sources: Record<string, Bucket>[]) {
  const merged = new Map<number, Bucket>();
  for (const source of sources) {
    for (const [key, bucket] of Object.entries(source)) {
      const low = Math.floor(Number(key) / band) * band;
      const into = merged.get(low) ?? { steps: 0, units: 0, stepMs: 0, planMs: {}, plans: {} };
      into.steps += bucket.steps;
      into.units += bucket.units;
      into.stepMs += bucket.stepMs;
      for (const [version, ms] of Object.entries(bucket.planMs)) into.planMs[version] = (into.planMs[version] ?? 0) + ms;
      for (const [version, count] of Object.entries(bucket.plans)) into.plans[version] = (into.plans[version] ?? 0) + count;
      merged.set(low, into);
    }
  }
  const versions = [...new Set([...merged.values()].flatMap((bucket) => Object.keys(bucket.plans)))].sort();
  console.log(["units".padStart(9), "steps".padStart(7), "us/step".padStart(8), "us/unit".padStart(8), " ms/think", ...versions.map((version) => version.padStart(6))].join(" "));
  for (const [low, bucket] of [...merged].sort((a, b) => a[0] - b[0])) {
    if (bucket.steps < 100) continue;
    const perStep = (bucket.stepMs * 1000) / bucket.steps;
    const think = versions.map((version) => (bucket.plans[version] ? (bucket.planMs[version]! / bucket.plans[version]!).toFixed(2) : "-").padStart(6));
    console.log([`${low}-${low + band - 1}`.padStart(9), String(bucket.steps).padStart(7), perStep.toFixed(1).padStart(8), (perStep / (bucket.units / bucket.steps)).toFixed(3).padStart(8), "         ", ...think].join(" "));
  }
}
