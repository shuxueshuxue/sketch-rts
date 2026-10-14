import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { runProbe } from "./six-player-tick-probe";

const root = "/workspace/six-player-structural-observer-tool";
const source = "/workspace/sketch-rts-six-player-perf";
const observedDir = join(root, "captures", "observed31");
const plainDir = join(root, "captures", "plain31");
const defaultDir = join(root, "captures", "default31");
const observed = await runProbe({ source, ticks: 31, out: observedDir, focusTicks: [0, 15, 30], focusRadius: 0,
  observeGc: true, observeRuntimeUsage: true });
const plain = await runProbe({ source, ticks: 31, out: plainDir, plain: true });
const normal = await runProbe({ source, ticks: 31, out: defaultDir });
const commandBytes = async (directory: string) => gunzipSync(await readFile(join(directory, "command-frames.jsonl.gz")));
const observedBytes = await commandBytes(observedDir);
assert.deepEqual(observedBytes, await commandBytes(plainDir));
assert.deepEqual(observedBytes, await commandBytes(defaultDir));
assert.equal(observed.commandLogSha256, plain.commandLogSha256);
assert.equal(observed.commandLogSha256, normal.commandLogSha256);
assert.equal(observed.finalChecksum, plain.finalChecksum);
assert.equal(observed.finalChecksum, normal.finalChecksum);
assert.equal(observed.finalChecksum, "b8473a1c");
const diagnostics = JSON.parse(gunzipSync(await readFile(join(observedDir, "focused-diagnostics.json.gz"))).toString()) as {
  runtimeUsageCapabilities: Record<string, boolean>;
  runtimeUsage: { tick: number; before: { before: { performanceMs: number }; after: { performanceMs: number }; observerOverheadMs: number };
    after: { before: { performanceMs: number }; after: { performanceMs: number }; observerOverheadMs: number };
    mainThreadCpuMs: number | null; processCpuMs: number; resourceDeltas: Record<string, number> }[];
  clocks: { tick: number; startedMs: number; endedMs: number }[];
};
assert.deepEqual(diagnostics.runtimeUsage.map(entry => entry.tick), [0, 15, 30]);
assert.equal(diagnostics.runtimeUsageCapabilities.threadCpuUsage, true);
for (const sample of diagnostics.runtimeUsage) {
  const anchor = diagnostics.clocks.find(clock => clock.tick === sample.tick)!;
  assert.ok(sample.before.before.performanceMs <= sample.before.after.performanceMs);
  assert.ok(sample.before.after.performanceMs <= anchor.startedMs);
  assert.ok(anchor.endedMs <= sample.after.before.performanceMs);
  assert.ok(sample.after.before.performanceMs <= sample.after.after.performanceMs);
  assert.ok(sample.before.observerOverheadMs >= 0 && sample.after.observerOverheadMs >= 0);
  assert.ok(sample.mainThreadCpuMs !== null && sample.mainThreadCpuMs >= 0);
  assert.ok(sample.processCpuMs >= 0);
  assert.ok(Object.values(sample.resourceDeltas).every(value => Number.isSafeInteger(value) && value >= 0));
}
await assert.rejects(() => runProbe({ source, ticks: 1, out: join(root, "rejected-no-focus"), observeRuntimeUsage: true }),
  /requires --focus-ticks/);
const result = { complete: true, ticks: 31, checksum: observed.finalChecksum, commandLogSha256: observed.commandLogSha256,
  commandLogBytes: observedBytes.length, byteEquality: { observedVsPlain: true, observedVsDefault: true },
  selectedTicks: diagnostics.runtimeUsage.map(sample => sample.tick), observerCapabilities: diagnostics.runtimeUsageCapabilities,
  sourceSha256: createHash("sha256").update(await readFile(join(root, "six-player-tick-probe.ts"))).digest("hex"),
  helperSha256: createHash("sha256").update(await readFile(join(root, "six-player-focused-instrumentation.ts"))).digest("hex") };
await writeFile(join(root, "contract-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
