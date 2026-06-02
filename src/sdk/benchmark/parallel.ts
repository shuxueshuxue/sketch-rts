import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import type { BenchmarkEvaluationReport, BenchmarkInput, BenchmarkMatchInput, BenchmarkMatchReport, BenchmarkReport } from "./core";
import type { SdkGameAgent } from "../game-runner";

export type BenchmarkParallelOptions = {
  workers?: number;
  workerModule: string;
};

type BenchmarkTask<TAgent extends SdkGameAgent> = {
  id: number;
  evaluationIndex: number;
  matchIndex: number;
  match: BenchmarkMatchInput<TAgent>;
};

export async function runBenchmarkParallel<TAgent extends SdkGameAgent = SdkGameAgent>(input: BenchmarkInput<TAgent>, options: BenchmarkParallelOptions): Promise<BenchmarkReport> {
  assertParallelSerializableInput(input);
  const tasks = input.evaluations.flatMap((evaluation, evaluationIndex) => evaluation.matches.map((match, matchIndex) => ({ id: 0, evaluationIndex, matchIndex, match })));
  tasks.forEach((task, id) => {
    task.id = id;
  });
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const results: BenchmarkMatchReport[] = [];
  const workerCount = benchmarkWorkerCount(options.workers, tasks.length);

  let cursor = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor]!;
        cursor += 1;
        results[task.id] = await runTaskInChild(task, options.workerModule);
      }
    }),
  );

  const evaluations = input.evaluations.map((evaluation, evaluationIndex): BenchmarkEvaluationReport => {
    const matches = tasks
      .filter((task) => task.evaluationIndex === evaluationIndex)
      .sort((a, b) => a.matchIndex - b.matchIndex)
      .map((task) => {
        const match = results[task.id];
        if (!match) throw new Error(`Benchmark parallel task ${task.id} did not produce a match report`);
        return match;
      });
    return {
      name: evaluation.name,
      ...(evaluation.tag ? { tag: evaluation.tag } : {}),
      startedAt,
      elapsedMs: matches.length === 0 ? 0 : Math.max(...matches.map((match) => match.elapsedMs)),
      cpuMs: roundMs(matches.reduce((total, match) => total + match.cpuMs, 0)),
      matchCount: matches.length,
      matches,
    };
  });

  return {
    name: input.name,
    startedAt,
    evaluationCount: evaluations.length,
    matchCount: tasks.length,
    elapsedMs: roundMs(performance.now() - started),
    cpuMs: roundMs(evaluations.reduce((total, evaluation) => total + evaluation.cpuMs, 0)),
    evaluations,
  };
}

function assertParallelSerializableInput<TAgent extends SdkGameAgent>(input: BenchmarkInput<TAgent>) {
  if (input.trackers?.length) throw new Error("Parallel benchmark input cannot include in-process tracker functions");
  for (const evaluation of input.evaluations) {
    for (const match of evaluation.matches) {
      if (match.commandPlanner) throw new Error(`Parallel benchmark match ${match.name} cannot include an in-process command planner`);
      if (match.game) throw new Error(`Parallel benchmark match ${match.name} cannot include a prebuilt game object`);
    }
  }
}

function benchmarkWorkerCount(requested: number | undefined, taskCount: number) {
  if (taskCount === 0) return 0;
  const count = requested ?? Math.max(1, availableParallelism() - 1);
  if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid benchmark worker count ${requested}`);
  return Math.min(count, taskCount);
}

async function runTaskInChild<TAgent extends SdkGameAgent>(task: BenchmarkTask<TAgent>, workerModule: string): Promise<BenchmarkMatchReport> {
  const childPath = fileURLToPath(new URL("./parallel-child.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", childPath, workerModule], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify({ id: task.id, match: task.match }));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  if (code !== 0) throw new Error(`Benchmark worker exited with ${code}: ${stderr.trim()}`);
  const line = stdout.trim();
  if (!line) throw new Error(`Benchmark worker produced no output for ${task.match.name}`);
  const response = JSON.parse(line) as { id: number; ok: boolean; match?: BenchmarkMatchReport; error?: string };
  if (response.id !== task.id) throw new Error(`Benchmark worker returned task ${response.id} for task ${task.id}`);
  if (!response.ok) throw new Error(response.error ?? `Benchmark worker failed task ${task.id}`);
  if (!response.match) throw new Error(`Benchmark worker task ${task.id} omitted match report`);
  return response.match;
}

function roundMs(value: number) {
  return Number(value.toFixed(3));
}
