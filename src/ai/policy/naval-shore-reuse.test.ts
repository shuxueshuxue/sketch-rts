import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createAiPolicyMemory } from '../memory';
import { navalWant } from './naval';
import { reuseNavalShore, withNavalShoreReuse } from './naval-shore-reuse';

it('reuses failed water answers across budget views and isolates owner, world, guns, teams and nested thinks', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../bootstrap_1/fixtures/templeSpring-multiple-targets-900.json', import.meta.url), 'utf8')).snapshot as GameSnapshot;
  const options = { memory: createAiPolicyMemory(), teams: { enemy: 'a' } };
  const water = { x: 592, y: 6480 };
  let calls = 0;
  const find = () => { calls++; return undefined; };
  const query = (view = snapshot, owner = 'enemy', context = options, guns = true) =>
    reuseNavalShore(view, owner, context, water, guns, find);
  withNavalShoreReuse(() => {
    query(); query({ ...snapshot, players: { ...snapshot.players } });
    expect(calls).toBe(1);
    withNavalShoreReuse(() => query());
    expect(calls).toBe(2);
    query(); expect(calls).toBe(2);
    query(snapshot, 'enemy2');
    query(snapshot, 'enemy', { ...options, teams: { enemy: 'b' } });
    query(snapshot, 'enemy', options, false);
    query({ ...snapshot, buildings: [...snapshot.buildings] });
    expect(calls).toBe(6);
  });
  withNavalShoreReuse(() => query());
  expect(calls).toBe(7);
  expect(() => withNavalShoreReuse(() => { query(); throw new Error('scene interruption'); })).toThrow('scene interruption');
  query(); expect(calls).toBe(9);
});

it('keeps the complete wants, commands and memory identical on the real multi-bay frame', () => {
  const saved = JSON.parse(readFileSync(new URL('../bootstrap_1/fixtures/templeSpring-multiple-targets-900.json', import.meta.url), 'utf8')) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const run = () => {
    const memory = structuredClone(saved.memories.enemy!), context = { memory, teams: saved.snapshot.teams! };
    const results = Array.from({ length: 3 }, () => {
      const want = navalWant(saved.snapshot, 'enemy', context);
      return want && { id: want.id, cost: want.cost, expedition: want.expedition, command: want.issue(new Set()) };
    });
    return JSON.stringify({ results, memory });
  };
  expect(withNavalShoreReuse(run)).toBe(run());
});
