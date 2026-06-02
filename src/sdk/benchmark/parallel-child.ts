import { stdin, stdout } from "node:process";

type WorkerModule = {
  runBenchmarkParallelMatch?: (match: unknown) => unknown | Promise<unknown>;
};

const workerModuleUrl = process.argv[2];
if (!workerModuleUrl) throw new Error("benchmark parallel child requires a worker module URL");

const moduleExports = (await import(workerModuleUrl)) as WorkerModule;
if (typeof moduleExports.runBenchmarkParallelMatch !== "function") throw new Error(`Benchmark worker module ${workerModuleUrl} must export runBenchmarkParallelMatch`);

let input = "";
stdin.setEncoding("utf8");
for await (const chunk of stdin) input += chunk;

const task = JSON.parse(input) as { id: number; match: unknown };
try {
  const match = await moduleExports.runBenchmarkParallelMatch(task.match);
  stdout.write(`${JSON.stringify({ id: task.id, ok: true, match })}\n`);
} catch (error) {
  stdout.write(`${JSON.stringify({ id: task.id, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
}
