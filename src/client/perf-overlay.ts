import type * as THREE from 'three';
import type { AiThinkReport } from '../ai/runtime';

/** `?perf=1`: a corner readout of how each frame spends its time, so a slow machine can show, in one screenshot, whether
 * the main thread (CPU) or the GPU/compositor is holding frames back. Otherwise `perf` stays undefined and every hook
 * below is a skipped optional call. Opening a room rewrites the query, so the tab remembers the choice across reloads
 * until `?perf=0`. */
export let perf: PerfOverlay | undefined;

export function startPerfOverlay() {
  const asked = new URLSearchParams(location.search).get('perf');
  let on = asked === '1';
  try {
    if (asked === '1') sessionStorage.setItem('perf', '1');
    else if (asked === '0') sessionStorage.removeItem('perf');
    else on = sessionStorage.getItem('perf') === '1';
  } catch {
    // Without storage the overlay lasts until the next reload.
  }
  if (on) perf ??= new PerfOverlay(document.body);
  return perf;
}

const LONG_MS = 50;
type CardCounts = { cards: number; pages: number; pixels: number; rasterizations: number; evictions: number; bodiless: number; rasterWorkWallMs: number; gpuTransferSubmissionWallMs: number; frameDemand: number; peakFrameDemand: number; secondDemand: number };
const SEGMENTS = ['sync', 'camera', '3d', 'ground', 'overlay', 'rest'] as const;
type Segment = (typeof SEGMENTS)[number];
type LongFrame = { start: number; end: number; js: number; cause?: 'CPU' | 'GPU' };
type Loaf = { start: number; end: number; script: number; layout: number; render: number };

/** A long gap between two animation frames is split by what the main thread did across it: when the game's frame work,
 * or the busy part of an overlapping long-animation-frame (its scripts, or its rendering steps, whichever is longer, since
 * the frame's own callbacks run inside rendering), fills over half the gap, the CPU held the frame; otherwise the main
 * thread was idle and waited on the GPU or compositor. */
export function longFrameCause(frame: LongFrame, loafs: readonly Loaf[]): 'CPU' | 'GPU' {
  let busy = frame.js;
  for (const loaf of loafs) if (loaf.start < frame.end && loaf.end > frame.start) busy = Math.max(busy, loaf.script, loaf.render);
  return busy > (frame.end - frame.start) / 2 ? 'CPU' : 'GPU';
}

// The overlay is on the page, which never loads the AI: only its report's type is shared.
const noThinking = (): AiThinkReport => ({ thinks: 0, thinkMs: 0, slowestMs: 0, late: 0, lateTicks: 0, skipped: 0 });

class Stat {
  count = 0; total = 0; max = 0;
  add(value: number) { this.count++; this.total += value; if (value > this.max) this.max = value; }
  text() { return this.count ? `${(this.total / this.count).toFixed(1)} / ${this.max.toFixed(1)}` : '–'; }
  reset() { this.count = this.total = this.max = 0; }
}

type Timer = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

export class PerfOverlay {
  private element = document.createElement('pre');
  private last: number | undefined;
  private frameStarted = 0;
  private lastFrameJs = 0;
  private lapAt = 0;
  private frameLaps = new Map<Segment, number>();
  private interval = new Stat();
  private frameJs = new Stat();
  private gpu = new Stat();
  private segments = new Map<Segment, Stat>(SEGMENTS.map(name => [name, new Stat()]));
  private windowStart = performance.now();
  private frames = 0;
  private longFrames: LongFrame[] = [];
  private longCounts = { CPU: 0, GPU: 0 };
  private loafs: Loaf[] = [];
  private loafCount = 0;
  private readonly loafSupported: boolean;
  private gl: WebGL2RenderingContext | undefined;
  private timer: Timer | null = null;
  private queries: WebGLQuery[] = [];
  private active: WebGLQuery | undefined;
  private renderer: THREE.WebGLRenderer | undefined;
  // The match's AI thread over this window (see AiThinkReport); undefined until a match with AI reports.
  private ai: AiThinkReport | undefined;
  // The troop cards' running counts (see PaintedCardBatches.stats), read once a window; the last window's, for its rates.
  private cardSource: (() => CardCounts) | undefined;
  private cardsBefore: CardCounts | undefined;

  constructor(parent: HTMLElement) {
    this.element.className = 'perf-overlay';
    Object.assign(this.element.style, {
      position: 'fixed', left: '4px', top: '4px', zIndex: '2147483647', margin: '0', padding: '6px 8px',
      font: '10.5px/1.2 ui-monospace, Menlo, monospace', color: '#e8f0e0', background: 'rgba(16,20,18,.82)',
      pointerEvents: 'none', whiteSpace: 'pre', borderRadius: '4px',
    });
    parent.append(this.element);
    this.loafSupported = PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame') ?? false;
    if (this.loafSupported) new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceEntry[] & { renderStart: number; styleAndLayoutStart: number; scripts: { duration: number }[] }[]) {
        const end = entry.startTime + entry.duration;
        this.loafCount++;
        this.loafs.push({
          start: entry.startTime, end,
          script: entry.scripts.reduce((sum, script) => sum + script.duration, 0),
          layout: entry.styleAndLayoutStart ? end - entry.styleAndLayoutStart : 0,
          render: entry.renderStart ? end - entry.renderStart : 0,
        });
      }
      if (this.loafs.length > 40) this.loafs.splice(0, this.loafs.length - 40);
    }).observe({ type: 'long-animation-frame', buffered: false });
    document.addEventListener('visibilitychange', () => { this.last = undefined; });
  }

  /** The 3D renderer whose GPU time and linked programs the readout reports. */
  attach(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as Timer | null;
    this.queries = []; this.active = undefined;
  }

  /** The troop cards the readout reports: how many are held, and how many were painted and dropped each second. */
  watchCards(source: () => CardCounts) { this.cardSource = source; this.cardsBefore = undefined; }

  /** Called first in each animation frame with the browser's own rAF timestamp. */
  frameStart(timestamp: number) {
    const now = performance.now();
    if (this.last !== undefined && !document.hidden) {
      const gap = timestamp - this.last;
      this.interval.add(gap);
      if (gap > LONG_MS) {
        this.longFrames.push({ start: this.last, end: timestamp, js: this.lastFrameJs });
      }
    }
    this.last = timestamp;
    this.frames++;
    this.frameStarted = this.lapAt = now;
    this.frameLaps.clear();
    this.pollGpu();
    if (now - this.windowStart >= 1000) this.refresh(now);
  }

  /** Main-thread time since the previous lap of this frame, charged to `segment`. */
  lap(segment: Segment) {
    const now = performance.now();
    this.frameLaps.set(segment, (this.frameLaps.get(segment) ?? 0) + now - this.lapAt);
    this.lapAt = now;
  }

  frameEnd() {
    this.lap('rest');
    for (const [name, value] of this.frameLaps) this.segments.get(name)!.add(value);
    this.lastFrameJs = performance.now() - this.frameStarted;
    this.frameJs.add(this.lastFrameJs);
  }

  /** What the match's AI thread did since its last report: a match waits for no think, so a slow AI shows here as late
   * landings and skipped turns, not as frame gaps. */
  aiThinking(report: AiThinkReport) {
    const ai = this.ai ??= noThinking();
    ai.thinks += report.thinks; ai.thinkMs += report.thinkMs; ai.slowestMs = Math.max(ai.slowestMs, report.slowestMs);
    ai.late += report.late; ai.lateTicks = Math.max(ai.lateTicks, report.lateTicks); ai.skipped += report.skipped;
  }

  gpuBegin() {
    const gl = this.gl, timer = this.timer;
    if (!gl || !timer || this.active || this.queries.length > 8) return;
    const query = gl.createQuery();
    if (!query) return;
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  gpuEnd() {
    if (!this.gl || !this.timer || !this.active) return;
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.queries.push(this.active);
    this.active = undefined;
  }

  private pollGpu() {
    const gl = this.gl, timer = this.timer;
    if (!gl || !timer) return;
    while (this.queries.length) {
      const query = this.queries[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) this.gpu.add(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
      this.queries.shift();
    }
  }

  private refresh(now: number) {
    // A long-animation-frame entry is reported after its frame; classify long frames once the report has had time to land.
    for (const frame of this.longFrames) if (!frame.cause && now - frame.end > 250) {
      frame.cause = longFrameCause(frame, this.loafs);
      this.longCounts[frame.cause]++;
    }
    if (this.longFrames.length > 6) this.longFrames.splice(0, this.longFrames.length - 6);
    const seconds = (now - this.windowStart) / 1000;
    const programs = this.renderer?.info.programs?.length;
    // Short, tight lines keep the readout clear of the status line centred at the top and of the chat below it (34vh).
    const lines = [
      `fps ${(this.frames / seconds).toFixed(1)}  gap avg/max ${this.interval.text()} ms`,
      `view ${innerWidth}×${innerHeight} @${devicePixelRatio}x${programs === undefined ? '' : `  programs ${programs}`}`,
      `frame JS ${this.frameJs.text()} ms`,
      ...SEGMENTS.map(name => `  ${name.padEnd(8)}${this.segments.get(name)!.text()}`),
      `GPU 3D ${!this.renderer ? 'no 3D renderer' : this.timer ? `${this.gpu.text()} ms` : 'unsupported'}`,
      ...this.cardLines(seconds),
      ...(this.ai ? [`AI think ${this.ai.thinks ? (this.ai.thinkMs / this.ai.thinks).toFixed(0) : '–'} / ${this.ai.slowestMs.toFixed(0)} ms  late ${this.ai.late}${this.ai.late ? ` (≤${this.ai.lateTicks}t)` : ''}  skip ${this.ai.skipped}`] : []),
      `>${LONG_MS}ms gaps: CPU ${this.longCounts.CPU}  GPU/comp ${this.longCounts.GPU}`,
      `  recent ${this.longFrames.map(frame => `${Math.round(frame.end - frame.start)}${frame.cause ? frame.cause[0] : '?'}`).join(' ') || '–'}`,
      this.loafSupported ? `long-animation-frame ${this.loafCount}` : 'long-animation-frame unsupported',
      ...this.loafs.slice(-3).map(loaf => `  ${Math.round(loaf.end - loaf.start)} ms: js ${Math.round(loaf.script)} render ${Math.round(loaf.render)} layout ${Math.round(loaf.layout)}`),
    ];
    this.element.textContent = lines.join('\n');
    this.cardsBefore = this.cardSource?.();
    this.windowStart = now; this.frames = 0;
    this.interval.reset(); this.frameJs.reset(); this.gpu.reset();
    if (this.ai) this.ai = noThinking();
    for (const stat of this.segments.values()) stat.reset();
  }

  private cardLines(seconds: number) {
    const now = this.cardSource?.(), before = this.cardsBefore;
    if (!now) return [];
    const rate = (key: 'rasterizations' | 'evictions' | 'bodiless' | 'rasterWorkWallMs' | 'gpuTransferSubmissionWallMs') => before ? ((now[key] - before[key]) / seconds).toFixed(key.endsWith('Ms') ? 1 : 0) : '–';
    return [`troop cards ${now.cards} in ${now.pages} pages (${(now.pixels / 1048576).toFixed(1)}M px)  frame needs ${now.frameDemand} (peak ${now.peakFrameDemand}), 60 frames ${now.secondDemand}`,
      `  painted ${rate('rasterizations')}/s (${rate('rasterWorkWallMs')} ms/s, upload ${rate('gpuTransferSubmissionWallMs')} ms/s)  dropped ${rate('evictions')}/s  no body ${rate('bodiless')}/s`];
  }
}
