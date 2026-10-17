import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { roomGauntlet } from "../src/ai/benchmark/room-gauntlet";
import { runSubjectGauntletSeedsParallel, type OpponentVersion } from "../src/ai/benchmark/subject-gauntlet";
import { ROOM_AI_RACES } from "../src/shared/rooms";
import type { RoomAiVersion } from "../src/shared/types";
import { commonAiBenchmarkOptionsFromArgs, csvFlag, flag, printJson, requiredFlag } from "./benchmark-cli";

// The room AIs' bench (see @@@room-gauntlet). Each subject and seed's result goes to <out-dir>/<label>-<subject>-<seed>.log;
// the totals (wins of games per subject) to stdout.
//   npx tsx scripts/ai-room-gauntlet-benchmark.ts --subjects v9_archer,v9_knight,v9_summoner --rivals v8 \
//     --seeds v5-final-1,v5-final-2 --map-count 50 --workers 96 --out-dir logs/room --label main
const args = process.argv.slice(2);
const subjects = (flag(args, "subjects") ? csvFlag(args, "subjects") : Object.keys(ROOM_AI_RACES)) as RoomAiVersion[];
for (const subject of subjects) if (!(subject in ROOM_AI_RACES)) throw new Error(`Unknown room AI ${subject}`);
const rivals = csvFlag(args, "rivals") as OpponentVersion[];
const seeds = csvFlag(args, "seeds");
const outDir = requiredFlag(args, "out-dir"), label = requiredFlag(args, "label");
mkdirSync(outDir, { recursive: true });
const totals: Record<string, { wins: number; games: number }> = {};
for (const subject of subjects) {
  const { results } = await runSubjectGauntletSeedsParallel(roomGauntlet(subject, rivals), commonAiBenchmarkOptionsFromArgs(args), seeds);
  seeds.forEach((seed, index) => writeFileSync(join(outDir, `${label}-${subject}-${seed}.log`), `${JSON.stringify(results[index], null, 2)}\n`));
  totals[subject] = { wins: results.reduce((sum, result) => sum + result.wins, 0), games: results.reduce((sum, result) => sum + result.rawMatches, 0) };
}
printJson({ label, rivals, seeds, totals });
