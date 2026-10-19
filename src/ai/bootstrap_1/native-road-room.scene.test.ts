import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runGameLoop } from '../../sdk/game-runner';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import type { AiGameAgent } from '../game-runner';
import type { AiPolicyMemory } from '../memory';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { nativeLandRoad } from '../policy/land-road';
import { planBootstrapCommands } from './policy';

it('continues the actual room whose mercenary corner road froze its AI, through minute fifteen', () => {
  // Captured immediately before the native room's failing think at tick 15620.
  // Preserve the exact world, nextId, phases, all opposing seats and prior memory.
  const saved = JSON.parse(readFileSync(new URL('./fixtures/ringwater-nonfinite-road-13m01.json', import.meta.url), 'utf8')) as {
    snapshot: GameSnapshot; nextId: number; activePlayers: string[];
    versions: Record<string, BootstrapAiVersion>; memories: Record<string, AiPolicyMemory>; thinkInterval: number;
  };
  const game = createGame('bareDuel', { aiPlayers: [] });
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const snapshot = snapshotGame(game), unit = snapshot.units.find(unit => unit.id === 'unit-enemy2-mercenary-7807')!;
  expect(unit.speed).toBe(74);
  const road = nativeLandRoad(snapshot, unit, { x: 2295.5467650801706, y: 2186.266174599146 });
  expect(Number.isFinite(road!.ticks)).toBe(true);
  expect(road!.points).toContainEqual({ x: 2320, y: 2064 });
  expect(() => planBootstrapCommands(snapshot, 'enemy2', saved.versions.enemy2!,
    { memory: structuredClone(saved.memories.enemy2!), teams: game.teams })).not.toThrow();
  const agents: Record<string, AiGameAgent> = Object.fromEntries(Object.entries(saved.versions).map(([owner, version]) => [owner,
    { controller: 'external-agent', team: game.teams[owner] ?? owner, race: game.players[owner]!.race, version, policyVersion: version }]));
  runGameLoop({ name: 'actual-nonfinite-road-room', game, agents, maxTicks: 18000, thinkInterval: saved.thinkInterval,
    commandPlanner: navalObservedPlanner(structuredClone(saved.memories)) });
  expect(game.tick).toBe(18000);
});
