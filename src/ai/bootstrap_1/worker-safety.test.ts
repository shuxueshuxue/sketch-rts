import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { runAiGameLoop } from '../game-runner';
import { bootstrapScripts } from './policy';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { createAiPolicyMemory } from '../memory';

// Unedited real match: seed defense-observe-20261019, ladder-03 v9_knight ember vs v9.
// Captured on 1bf481b0 at tick 39120 (32:36), immediately after the mine's tower fell.
const saved: { snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory> } =
  JSON.parse(readFileSync(new URL('./fixtures/defense-worker-32m36.json', import.meta.url), 'utf8'));
const workers = ['unit-v9_knight-worker-3', 'unit-v9_knight-worker-1023', 'unit-v9_knight-worker-1032',
  'unit-v9_knight-worker-1370', 'unit-v9_knight-worker-1381', 'unit-v9_knight-worker-1462'];

function replay(safety: boolean) {
  const snapshot = structuredClone(saved.snapshot);
  const game = createGame(snapshot.map.id, { players: saved.activePlayers, teams: snapshot.teams as Record<string, string> });
  restoreSnapshotIntoGame(game, snapshot, saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  const escaped = new Set<string>();
  let damage = 0;
  game.observer = { hit(_source, target, taken) { if (workers.includes(target.id)) damage += taken; } };
  const result = runAiGameLoop({ name: 'workers-after-real-tower-loss', game, maxTicks: 41000, thinkInterval: 15,
    agents: {
      p1: { controller: 'external-agent', team: 'rivals', race: 'grove', version: 'v9' },
      v9_knight: { controller: 'external-agent', team: 'v9_knight-side', race: 'ember', version: 'v9_knight' },
    }, commandPlanner: ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot,
      { playerId: owner, source, version: agent.version,
        ...(!safety && owner === 'v9_knight' ? { scripts: bootstrapScripts('v9_knight').filter(script => script.id !== 'miningJobSafety') } : {}) },
      { teams, memoryProvider }),
  }, { onCommand({ owner, scriptId, command }) {
    if (owner === 'v9_knight' && scriptId === 'miningJobSafety' && command.type === 'move') {
      for (const id of command.unitIds) if (workers.includes(id)) escaped.add(id);
    }
  } });
  return { result, escaped, damage };
}

it('evacuates all six idle workers after the real 32:36 tower loss before the ballista kills them', () => {
  const before = replay(false), after = replay(true);
  expect(before.result.snapshot.units.filter(unit => workers.includes(unit.id))).toHaveLength(0);
  expect(after.escaped.size).toBe(6);
  expect(after.result.snapshot.units.filter(unit => workers.includes(unit.id))).toHaveLength(6);
  expect(after.damage).toBe(0);
  for (const worker of after.result.snapshot.units.filter(unit => workers.includes(unit.id))) {
    expect(Math.hypot(worker.x - 4016, worker.y - 4944)).toBeGreaterThan(650);
  }
}, 30000);

it('continues mining at a safe hall and returns only after the original mining lane clears', () => {
  // Same real terrain and firing lane; keep gold in both mines to exercise work after evacuation.
  const snapshot = structuredClone(saved.snapshot), game = createGame(snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, snapshot, saved.nextId);
  const worker = game.units.find(unit => unit.id === workers[1])!;
  game.resources.find(mine => mine.id === 'gold-gen-4')!.amount = 5000;
  game.resources.find(mine => mine.id === 'gold-gen-2')!.amount = 5000;
  worker.order = { type: 'mine', resourceId: 'gold-gen-4', phase: 'gather', timer: 1 };
  issuePlayerCommand(game, 'p1', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.kind === 'ballista').map(unit => unit.id) });
  const memory = createAiPolicyMemory();
  let workedElsewhere = false, returned = false;
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'v9_knight', version: 'v9_knight', memory,
        scripts: bootstrapScripts('v9_knight').filter(script => script.id === 'miningJobSafety') }, { teams: game.teams }));
    if (worker.order.type === 'mine' && worker.order.resourceId === 'gold-gen-2' && worker.order.phase === 'gather') {
      workedElsewhere = true;
      game.units = game.units.filter(unit => unit.kind !== 'ballista');
    }
    if (workedElsewhere && worker.order.type === 'mine' && worker.order.resourceId === 'gold-gen-4') {
      returned = true;
      break;
    }
    stepGame(game);
  }
  expect(game.units).toContain(worker);
  expect(workedElsewhere).toBe(true);
  expect(returned).toBe(true);
}, 15000);
