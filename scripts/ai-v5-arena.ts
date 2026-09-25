// Fight arena: capture real 1v2 fights, then replay them in isolation.
//   capture: tsx scripts/ai-v5-arena.ts capture --seed <seed> [--subject v5|v6] [--names "a|b"] [--shard i --shards n] > scenarios.jsonl
//            (v5: its 1v2 benchmark against V3 and V4-TR; v6: the V6 gauntlet against V3 and V5)
//   run:     tsx scripts/ai-v5-arena.ts run --scenarios scenarios.jsonl [--shard i --shards n] > results.jsonl
import { readFileSync } from "node:fs";
import { createAiV5VsHybridBenchmarkInput } from "../src/ai/benchmark/control";
import { arenaMatch, arenaSubject, captureArenaScenario, scoreArena, type ArenaScenario } from "../src/ai/benchmark/v5-arena";
import { createAiV6GauntletBenchmarkInput } from "../src/ai/benchmark/v6-gauntlet";
import { runAiGameLoop } from "../src/ai/game-runner";
import { DEFAULT_AI_THINK_INTERVAL } from "../src/ai/runtime";
import { UNIT_DEFS } from "../src/shared/catalog";
import type { GameSnapshot } from "../src/shared/types";

const SNAPSHOT_EVERY_TICKS = 5 * 20;
const WINDOW_SECONDS = 30;
const LEAD_SECONDS = 10;

const [mode, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : undefined;
};
const shard = Number(flag("shard") ?? 0);
const shards = Number(flag("shards") ?? 1);

if (mode === "capture") capture(flag("seed") ?? "v5-hybrid-50-2026-06-12");
else if (mode === "run") run(flag("scenarios") ?? "");
else if (mode === "trace") trace(flag("scenarios") ?? "", flag("id") ?? "");
else throw new Error("usage: ai-v5-arena.ts capture|run|trace ...");

function capture(seed: string) {
  const subject = flag("subject") ?? "v5";
  if (subject !== "v5" && subject !== "v6") throw new Error(`Unknown arena subject ${subject}`);
  const { input } = subject === "v6" ? createAiV6GauntletBenchmarkInput({ seed, mapCount: 50 }) : createAiV5VsHybridBenchmarkInput({ seed, mapCount: 50 });
  const names = flag("names")?.split("|");
  const matches = input.evaluations
    .flatMap((evaluation) => evaluation.matches)
    .filter((match) => !names || names.includes(match.name))
    .filter((_, index) => index % shards === shard);
  for (const match of matches) {
    const subjectOwner = Object.entries(match.agents).find(([, agent]) => agent.version === subject)![0];
    const snapshots = new Map<number, GameSnapshot>();
    const losses: { second: number; value: number }[] = [];
    const loop = runAiGameLoop(match as never, {
      afterStep({ before, after }) {
        if (after.tick % SNAPSHOT_EVERY_TICKS === 0) snapshots.set(after.tick / 20, JSON.parse(JSON.stringify(after)) as GameSnapshot);
        const alive = new Set(after.units.map((unit) => unit.id));
        for (const unit of before.units) if (unit.owner === subjectOwner && unit.kind !== "worker" && !alive.has(unit.id)) losses.push({ second: after.tick / 20, value: UNIT_DEFS[unit.kind].cost || 100 });
      },
    });
    let best = { second: -1, value: 0 };
    for (let second = 0; second < loop.game.tick / 20; second += 5) {
      const value = losses.filter((loss) => loss.second >= second && loss.second < second + WINDOW_SECONDS).reduce((total, loss) => total + loss.value, 0);
      if (value > best.value) best = { second, value };
    }
    if (best.second < 0) continue;
    const at = Math.max(5, Math.floor((best.second - LEAD_SECONDS) / 5) * 5);
    const snapshot = snapshots.get(at);
    if (!snapshot) continue;
    const winner = loop.game.match.winner as string | null;
    const scenario = captureArenaScenario({
      id: `${seed}|${match.name}|${at}`,
      subject: subjectOwner,
      source: { seed, match: match.name, second: at, outcome: winner === subjectOwner ? "win" : "loss" },
      match: match as never,
      snapshot,
    });
    console.log(JSON.stringify(scenario));
  }
}

function run(path: string) {
  const scenarios = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ArenaScenario).filter((_, index) => index % shards === shard);
  for (const scenario of scenarios) {
    const loop = runAiGameLoop(arenaMatch(scenario, { thinkInterval: DEFAULT_AI_THINK_INTERVAL }) as never, {});
    console.log(JSON.stringify(scoreArena(scenario, loop.snapshot)));
  }
}

// Watch one arena fight: army groups every five seconds and V5's non-economy orders in between.
function trace(path: string, id: string) {
  const scenario = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ArenaScenario).find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`No arena scenario ${id}`);
  const subjectOwner = arenaSubject(scenario);
  const orders: string[] = [];
  runAiGameLoop(arenaMatch(scenario, { thinkInterval: DEFAULT_AI_THINK_INTERVAL }) as never, {
    afterCommand({ tick, owner, command, scriptId }) {
      if (owner !== subjectOwner || !("unitIds" in command)) return;
      const target = "x" in command ? `${Math.round(command.x)},${Math.round(command.y)}` : "targetId" in command ? String(command.targetId) : "";
      orders.push(`${(tick / 20).toFixed(1)} ${scriptId} ${command.type} n${command.unitIds.length} ${target}`);
    },
    afterStep({ after }) {
      if (after.tick % 100 !== 0) return;
      console.log(`t=${after.tick / 20}`);
      for (const owner of Object.keys(scenario.agents)) {
        const groups = new Map<string, string[]>();
        for (const unit of after.units.filter((candidate) => candidate.owner === owner)) {
          const key = `${Math.round(unit.x / 400) * 400},${Math.round(unit.y / 400) * 400}`;
          groups.set(key, [...(groups.get(key) ?? []), `${unit.kind.slice(0, 6)}${Math.round(unit.hp)}${unit.order.type[0]}`]);
        }
        const towers = after.buildings.filter((building) => building.owner === owner && building.kind === "defenseTower").map((building) => `${Math.round(building.x)},${Math.round(building.y)}:${Math.round(building.hp)}`);
        console.log(`  ${owner} towers[${towers.join(" ")}] ${[...groups].map(([key, members]) => `@${key}: ${members.join(" ")}`).join(" | ")}`);
      }
      for (const line of orders.splice(0)) console.log(`    > ${line}`);
    },
  });
}
