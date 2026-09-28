import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAiV8GauntletBenchmarkInput, runAiV8GauntletBenchmarkDetailsParallel, runAiV8GauntletBenchmarkParallel, runAiV8GauntletBenchmarkSeedsParallel } from "../src/ai/benchmark/v8-gauntlet";
import { benchmarkFilterFromArgs, boolFlag, commonAiBenchmarkOptionsFromArgs, csvFlag, flag, printJson, requiredFlag, runAiBenchmarkCli } from "./benchmark-cli";

const args = process.argv.slice(2);

if (flag(args, "seeds")) {
  // Several seeds, one worker pool (see @@@gauntlet-seed-pool). Each seed's result goes to <out-dir>/<label>-<seed>.log as
  // the JSON a --seed run prints; the pool (wall, CPU, games) to <out-dir>/<label>-pool.json and stdout.
  if (flag(args, "seed")) throw new Error("Give either --seed or --seeds, not both");
  const seeds = csvFlag(args, "seeds");
  const outDir = requiredFlag(args, "out-dir");
  const label = requiredFlag(args, "label");
  const { results, pool } = await runAiV8GauntletBenchmarkSeedsParallel(commonAiBenchmarkOptionsFromArgs(args), seeds);
  mkdirSync(outDir, { recursive: true });
  seeds.forEach((seed, index) => writeFileSync(join(outDir, `${label}-${seed}.log`), `${JSON.stringify(results[index], null, 2)}\n`));
  writeFileSync(join(outDir, `${label}-pool.json`), `${JSON.stringify(pool, null, 2)}\n`);
  printJson(pool);
} else {
  await runAiBenchmarkCli({
    args,
    usage: `Usage:
  npm run benchmark:ai-v8-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50
  npm run benchmark:ai-v8-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --dry-run
  npm run benchmark:ai-v8-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50 --details --maps openClaims
  npm run benchmark:ai-v8-gauntlet -- --seeds v5-extra-1,v5-extra-2 --map-count 50 --workers 56 --out-dir logs/v8 --label e8x`,
    createInput: createAiV8GauntletBenchmarkInput,
    run: (options) => (boolFlag(args, "details") ? runAiV8GauntletBenchmarkDetailsParallel(options, benchmarkFilterFromArgs(args)) : runAiV8GauntletBenchmarkParallel(options)),
  });
}
