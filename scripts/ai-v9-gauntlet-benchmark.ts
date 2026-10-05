import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAiV9GauntletBenchmarkInput, runAiV9GauntletBenchmarkDetailsParallel, runAiV9GauntletBenchmarkParallel, runAiV9GauntletBenchmarkSeedsParallel } from "../src/ai/benchmark/v9-gauntlet";
import type { OpponentVersion } from "../src/ai/benchmark/subject-gauntlet";
import { benchmarkFilterFromArgs, boolFlag, commonAiBenchmarkOptionsFromArgs, csvFlag, flag, printJson, requiredFlag, requiredNumberFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);
// --nudges K [--nudge-at S]: play every game K times, each replay nudged once from game second S (see @@@gauntlet-nudge).
const options = () => ({
  ...commonAiBenchmarkOptionsFromArgs(args),
  ...(flag(args, "nudges") ? { nudges: requiredNumberFlag(args, "nudges") } : {}),
  ...(flag(args, "nudge-at") ? { nudgeAt: requiredNumberFlag(args, "nudge-at") } : {}),
  // --rivals v8 | v5,v7 | ...: another group than V5, V7 and V8 together (see v9Gauntlet).
  ...(flag(args, "rivals") ? { rivals: rivals(csvFlag(args, "rivals")) } : {}),
});

function rivals(names: string[]): OpponentVersion[] {
  const known: OpponentVersion[] = ["v3", "v5", "v6", "v7", "v8"];
  for (const name of names) if (!known.includes(name as OpponentVersion)) throw new Error(`Unknown rival ${name}`);
  return names as OpponentVersion[];
}

if (flag(args, "seeds")) {
  // Several seeds, one worker pool (see @@@gauntlet-seed-pool). Each seed's result goes to <out-dir>/<label>-<seed>.log as
  // the JSON a --seed run prints; the pool (wall, CPU, games) to <out-dir>/<label>-pool.json and stdout.
  if (flag(args, "seed")) throw new Error("Give either --seed or --seeds, not both");
  const seeds = csvFlag(args, "seeds");
  const outDir = requiredFlag(args, "out-dir");
  const label = requiredFlag(args, "label");
  const { results, pool } = await runAiV9GauntletBenchmarkSeedsParallel(options(), seeds);
  mkdirSync(outDir, { recursive: true });
  seeds.forEach((seed, index) => writeFileSync(join(outDir, `${label}-${seed}.log`), `${JSON.stringify(results[index], null, 2)}\n`));
  writeFileSync(join(outDir, `${label}-pool.json`), `${JSON.stringify(pool, null, 2)}\n`);
  printJson(pool);
} else {
  await runAiBenchmarkCli({
    args,
    usage: `Usage:
  npm run benchmark:ai-v9-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50
  npm run benchmark:ai-v9-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --dry-run
  npm run benchmark:ai-v9-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --details --maps openClaims
  npm run benchmark:ai-v9-gauntlet -- --seeds v5-extra-1,v5-extra-2 --map-count 50 --workers 56 --out-dir logs/v9 --label e9x
  npm run benchmark:ai-v9-gauntlet -- --seed v5-extra-1 --map-count 50 --nudges 4 --nudge-at 60`,
    optionsFromArgs: options,
    createInput: createAiV9GauntletBenchmarkInput,
    run: (options) => (boolFlag(args, "details") ? runAiV9GauntletBenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV9GauntletBenchmarkParallel(options)),
  });
}
