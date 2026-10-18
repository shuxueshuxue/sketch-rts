#!/usr/bin/env node
// frame-cpu.mjs TRACE.json — the per-frame CPU a Chrome trace shows for the game (docs/engineering/performance.zh.md):
// the renderer's main thread and the GPU process's main thread, in thread CPU time (each task's tdur), frame by frame.
// A frame is the span from one BeginMainFrame of the page's renderer to the next. Prints the median, p95 and worst
// frame, each split into its renderer and GPU-process CPU, and the wall-clock frame interval for reference only.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/frame-cpu.mjs TRACE.json"); process.exit(2); }
const raw = JSON.parse(readFileSync(file, "utf8"));
const events = Array.isArray(raw) ? raw : raw.traceEvents;
const threads = new Map(), processes = new Map();
for (const e of events) {
  if (e.ph !== "M") continue;
  if (e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
  if (e.name === "process_name") processes.set(e.pid, e.args.name);
}
const tasks = (thread, process) => events.filter((e) => e.ph === "X" && e.name === "ThreadControllerImpl::RunTask" && threads.get(`${e.pid}:${e.tid}`) === thread
  && (!process || (processes.get(e.pid) ?? "").startsWith(process)) && e.tdur !== undefined);
const frames = events.filter((e) => e.ph === "X" && e.name === "ProxyMain::BeginMainFrame").sort((a, b) => a.ts - b.ts);
// The page's renderer is the one that begins main frames; a trace may hold other renderers (extensions, other tabs).
const pageRenderer = frames.length ? frames[0].pid : undefined;
if (!pageRenderer) throw new Error("the trace has no ProxyMain::BeginMainFrame: record the devtools.timeline and cc categories");
const page = frames.filter((e) => e.pid === pageRenderer);
const renderer = tasks("CrRendererMain").filter((e) => e.pid === pageRenderer), gpu = tasks("CrGpuMain");
if (!gpu.length) throw new Error("the trace has no CrGpuMain tasks: record the toplevel and gpu categories");

// Each task is charged to the frame its start falls in.
const perFrame = page.slice(0, -1).map((frame, i) => ({ start: frame.ts, end: page[i + 1].ts, renderer: 0, gpu: 0 }));
const charge = (list, field) => {
  let i = 0;
  for (const task of [...list].sort((a, b) => a.ts - b.ts)) {
    while (i < perFrame.length && perFrame[i].end <= task.ts) i++;
    if (i < perFrame.length && task.ts >= perFrame[i].start) perFrame[i][field] += task.tdur / 1000;
  }
};
charge(renderer, "renderer"); charge(gpu, "gpu");
if (!perFrame.length) throw new Error("the trace holds fewer than two frames");
const total = (frame) => frame.renderer + frame.gpu;
const sorted = [...perFrame].sort((a, b) => total(a) - total(b));
const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const show = (frame) => ({ cpuMs: +total(frame).toFixed(1), rendererMs: +frame.renderer.toFixed(1), gpuProcessMs: +frame.gpu.toFixed(1), intervalMs: +((frame.end - frame.start) / 1000).toFixed(1) });
console.log(JSON.stringify({ frames: perFrame.length, p50: show(at(0.5)), p95: show(at(0.95)), worst: show(sorted.at(-1)) }, null, 1));
