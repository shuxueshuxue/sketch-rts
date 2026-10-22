/** One logical-work ledger for an entire controlled think. Queries register
 * continuations; they never borrow a second allowance when another phase asks
 * for the same fact. Publication is visible on the following think. */
import { withFactNavigation, withNavigationPhase } from '../../shared/navigation-audit';
export const STRATEGY_FACT_WORK_PER_THINK = 6144;
export const CRITICAL_FACT_CANDIDATES = 4;
export type FactWorkTier = 'critical-route' | 'existing-field' | 'background-field';
export type FactWorkReceipt = { tick: number; thinkSequence?: number; limit: number; used: number;
  services: { key: string; tier: FactWorkTier; work: number }[] };
type Task = { key: string; reportKey?: string; goal?: { x: number; y: number }; tier: FactWorkTier; minimum: number;
  kind?: 'fact' | 'search' | 'timing';
  run: (allowance: number) => { work: number; done: boolean } };
type Consumers = Map<string, number | null>;
type RegisteredTask = Task & { consumers: Consumers };
const tiers: Record<FactWorkTier, number> = { 'critical-route': 0, 'existing-field': 1, 'background-field': 2 };
let current: FactWorkQueue | undefined;
export function currentFactWork() { return current; }
export class FactWorkQueue {
  readonly receipt: FactWorkReceipt;
  private readonly tasks = new Map<string, RegisteredTask>();
  private consumers: Consumers = new Map();
  private readonly requestedConsumers = new Map<string, Consumers>();
  private readonly completed = new Set<string>();
  private readonly criticalPoints = new Set<string>();
  private readonly frozen: boolean;
  constructor(tick: number, limit = STRATEGY_FACT_WORK_PER_THINK, previous?: FactWorkReceipt, thinkSequence?: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid fact work allowance');
    if (thinkSequence !== undefined && (!Number.isSafeInteger(thinkSequence) || thinkSequence < 1)) throw new Error('Invalid think sequence');
    this.frozen = thinkSequence === undefined ? previous?.tick === tick : previous?.thinkSequence === thinkSequence;
    this.receipt = this.frozen ? structuredClone(previous!) : { tick, ...(thinkSequence === undefined ? {} : { thinkSequence }), limit, used: 0, services: [] };
  }
  /** Search identifies the plans blocked by facts it asks for. Net value may
   * be unknown; it is never replaced by the undiscounted goal reward. */
  withConsumer<T>(planId: string, netValueGold: number | null, run: () => T): T {
    const previous = this.consumers;
    this.consumers = new Map(previous); this.consumers.set(planId, netValueGold);
    try { return run(); } finally { this.consumers = previous; }
  }
  consumerPlanIds() { return [...this.consumers.keys()].sort(); }
  consume(key: string) {
    let consumers = this.requestedConsumers.get(key);
    if (!consumers) this.requestedConsumers.set(key, consumers = new Map());
    for (const [id, value] of this.consumers) consumers.set(id, value);
    const task = this.tasks.get(key);
    if (task) for (const [id, value] of consumers) task.consumers.set(id, value);
  }
  register(task: Task) {
    this.consume(task.key);
    const old = this.tasks.get(task.key), consumers = new Map(this.requestedConsumers.get(task.key));
    if (!old || tiers[task.tier] < tiers[old.tier]) this.tasks.set(task.key, { ...task, consumers });
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
    // Finish the highest-priority fact before moving to the next. A pending
    // dependency which cannot advance yields to other tasks in this flush.
    const suspended = new Set<string>();
    const priority = (task: RegisteredTask) => {
      const consumers = task.kind === 'search' ? [] : [...task.consumers.values()];
      return { count: task.kind === 'timing' ? -1 : consumers.length, value: consumers.reduce<number>((sum, value) => sum + (value ?? 0), 0) };
    };
    for (;;) {
      const tasks = [...this.tasks.values()].filter(task => !this.completed.has(task.key) && !suspended.has(task.key)
        && task.minimum <= this.receipt.limit - this.receipt.used)
        .sort((a, b) => {
          const first = priority(a), second = priority(b);
          return second.count - first.count || second.value - first.value
            || (first.count ? 0 : tiers[a.tier] - tiers[b.tier])
            || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
        });
      const task = tasks[0]; if (!task) break;
      const available = this.receipt.limit - this.receipt.used;
      const previous = this.consumers; this.consumers = task.consumers;
      let result: { work: number; done: boolean };
      try {
        result = withNavigationPhase('strategy-planning', () => withFactNavigation({ kind: 'fact-work', throughWork: available },
          () => task.run(available)));
      } finally { this.consumers = previous; }
      if (!Number.isSafeInteger(result.work) || result.work < 0 || result.work > available)
        throw new Error(`Fact work exceeded its allowance: ${task.key}`);
      this.receipt.used += result.work;
      if (result.work) {
        const key = task.reportKey ?? task.key, previous = this.receipt.services.at(-1);
        if (previous?.key === key && previous.tier === task.tier) previous.work += result.work;
        else this.receipt.services.push({ key, tier: task.tier, work: result.work });
      }
      if (result.done) this.completed.add(task.key);
      else if (!result.work) suspended.add(task.key);
    }
    return this.receipt;
  }
}
export function withFactWork<T>(queue: FactWorkQueue, run: () => T): T {
  const previous = current; current = queue;
  try { return run(); } finally { current = previous; }
}

/** Tick is physical time; publication follows the owner-think boundary. Old
 * receipts without a sequence remain usable by stateless diagnostic callers. */
export function factPublicationPending(readyTick: number, readyThink: number | undefined, tick: number, queue = currentFactWork()) {
  const sequence = queue?.receipt.thinkSequence;
  return sequence === undefined ? readyTick >= tick : readyThink !== undefined && readyThink >= sequence;
}
