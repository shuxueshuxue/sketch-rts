/** One logical-work ledger for an entire controlled think. Queries register
 * continuations; they never borrow a second allowance when another phase asks
 * for the same fact. Publication is visible on the following think. */
import { withFactNavigation, withNavigationPhase } from '../../shared/navigation-audit';
export const STRATEGY_FACT_WORK_PER_THINK = 6144;
export const CRITICAL_FACT_CANDIDATES = 4;
export type FactWorkTier = 'critical-route' | 'existing-field' | 'background-field';
export type FactWorkReceipt = { tick: number; limit: number; used: number;
  services: { key: string; tier: FactWorkTier; work: number }[] };
type Task = { key: string; reportKey?: string; goal?: { x: number; y: number }; tier: FactWorkTier; minimum: number;
  run: (allowance: number) => { work: number; done: boolean } };
const tiers: Record<FactWorkTier, number> = { 'critical-route': 0, 'existing-field': 1, 'background-field': 2 };
let current: FactWorkQueue | undefined;
export function currentFactWork() { return current; }
export class FactWorkQueue {
  readonly receipt: FactWorkReceipt;
  private readonly tasks = new Map<string, Task>();
  private readonly completed = new Set<string>();
  private readonly criticalPoints = new Set<string>();
  private readonly frozen: boolean;
  constructor(tick: number, limit = STRATEGY_FACT_WORK_PER_THINK, previous?: FactWorkReceipt) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid fact work allowance');
    this.frozen = previous?.tick === tick;
    this.receipt = this.frozen ? structuredClone(previous!) : { tick, limit, used: 0, services: [] };
  }
  register(task: Task) {
    const old = this.tasks.get(task.key);
    if (!old || tiers[task.tier] < tiers[old.tier]) this.tasks.set(task.key, task);
  }
  /** Existing assignments and a bounded candidate prefix promote already
   * requested physical facts. Promotion neither creates queries nor runs AI. */
  promote(keys: readonly string[]) {
    for (const key of keys) {
      const task = this.tasks.get(key);
      if (task) task.tier = 'critical-route';
    }
  }
  prioritizePoints(points: readonly { x: number; y: number }[]) {
    for (const point of points) this.criticalPoints.add(`${point.x}:${point.y}`);
    for (const task of this.tasks.values()) if (task.goal && this.isCritical(task.goal)) task.tier = 'critical-route';
  }
  isCritical(point: { x: number; y: number }) { return this.criticalPoints.has(`${point.x}:${point.y}`); }
  flush() {
    if (this.frozen) return this.receipt;
    // Stable round-robin inside a tier; an unfinished route cannot consume the
    // whole allowance before its equally important peers get one slice.
    for (;;) {
      let progressed = false;
      const tasks = [...this.tasks.values()].filter(task => !this.completed.has(task.key)
        && task.minimum <= this.receipt.limit - this.receipt.used)
        .sort((a, b) => tiers[a.tier] - tiers[b.tier] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      if (!tasks.length) break;
      const tier = tasks[0]!.tier;
      for (const task of tasks.filter(task => task.tier === tier)) {
        const available = this.receipt.limit - this.receipt.used;
        if (available < task.minimum) continue;
        const result = withNavigationPhase('strategy-planning', () => withFactNavigation({ kind: 'fact-work', throughWork: available },
          () => task.run(available)));
        if (!Number.isSafeInteger(result.work) || result.work < 0 || result.work > available)
          throw new Error(`Fact work exceeded its allowance: ${task.key}`);
        this.receipt.used += result.work;
        if (result.work) this.receipt.services.push({ key: task.reportKey ?? task.key, tier: task.tier, work: result.work });
        if (result.done) this.completed.add(task.key);
        progressed ||= result.work > 0 || result.done;
      }
      if (!progressed) break;
    }
    return this.receipt;
  }
}
export function withFactWork<T>(queue: FactWorkQueue, run: () => T): T {
  const previous = current; current = queue;
  try { return run(); } finally { current = previous; }
}
