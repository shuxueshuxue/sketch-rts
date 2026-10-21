import { expect, it } from 'vitest';
import { FactWorkQueue } from './fact-work';

function register(queue: FactWorkQueue, key: string, calls: string[], total = 4) {
  let remaining = total;
  queue.register({ key, tier: 'background-field', minimum: 1, run: allowance => {
    calls.push(key); const work = Math.min(remaining, allowance, 2); remaining -= work;
    return { work, done: !remaining };
  } });
}
it('finishes a field before sharing the remaining allowance with another equal-priority field', () => {
  const queue = new FactWorkQueue(0, 6), calls: string[] = [];
  register(queue, 'b', calls); register(queue, 'a', calls);
  expect(queue.flush().used).toBe(6); expect(calls).toEqual(['a', 'a', 'b']);
  expect(queue.flush().used).toBe(6);
});
it('prioritizes shared blockers, then known plan net value, then stable request identity', () => {
  const queue = new FactWorkQueue(0, 16), calls: string[] = [];
  queue.withConsumer('one', 50, () => register(queue, 'a-cheaper', calls));
  queue.withConsumer('one', 50, () => register(queue, 'z-shared', calls));
  queue.withConsumer('two', 1, () => queue.consume('z-shared'));
  queue.withConsumer('three', 100, () => register(queue, 'c-expensive', calls));
  queue.withConsumer('four', 100, () => register(queue, 'b-expensive', calls));
  queue.flush();
  expect(calls).toEqual(['z-shared', 'z-shared', 'b-expensive', 'b-expensive', 'c-expensive', 'c-expensive', 'a-cheaper', 'a-cheaper']);
});
it('suspends an unresolved dependency without spinning or suppressing other queued facts', () => {
  const queue = new FactWorkQueue(0, 4), calls: string[] = [];
  queue.register({ key: 'a-pending', tier: 'background-field', minimum: 1, run: () => ({ work: 0, done: false }) });
  register(queue, 'b-ready', calls); queue.flush();
  expect(calls).toEqual(['b-ready', 'b-ready']); expect(queue.receipt.used).toBe(4);
});
