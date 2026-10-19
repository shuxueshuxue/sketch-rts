import { expect, it } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import { MAP_POOL } from '../../shared/map-pool';
import { createAiGameCommandPlanner } from '../game-runner';
import { auditNavalPool, createNavalRoomInput, type NavalRoomMatch } from './naval-room';
import { navalObservedPlanner } from './naval-room-worker';
import type { AiPolicyMemory } from '../memory';

it('selects remote-resource/enemy maps by terrain and fills every real room seat', () => {
  const selected = auditNavalPool().filter(map => map.selected).map(map => map.mapId);
  expect(selected).toEqual(['sapphireArchipelago', 'brokenSea', 'templeSpring', 'elderwood', 'ringwater', 'gullIsland', 'twoShores']);
  const input = createNavalRoomInput({ subjects: ['v9_archer'], rival: 'v9', maps: selected });
  expect(input.evaluations[0]!.matches).toHaveLength(selected.length * 4);
  for (const raw of input.evaluations[0]!.matches) {
    const match = raw as NavalRoomMatch;
    const map = MAP_POOL.find(map => map.id === match.mapId)!;
    expect(Object.keys(match.agents)).toHaveLength(map.players);
    expect(match.options!.players).toEqual(Object.keys(match.agents));
    const ours = Object.values(match.agents).filter(agent => agent.version === 'v9_archer');
    expect(ours).toHaveLength(map.players / 2);
    expect(Object.values(match.agents).filter(agent => agent.version === 'v9')).toHaveLength(map.players / 2);
    expect(match.options!.layout).toBeUndefined(); // Keep the pool map's own seed and geometry.
  }
});

it.each(['v9_archer', 'v9_summoner', 'v9_knight', 'v8', 'v9'] as const)('the observer executes the stock %s planner without changing its commands', version => {
  const stock = createAiGameCommandPlanner();
  const memories: Record<string, AiPolicyMemory> = {};
  const observed = navalObservedPlanner(memories);
  const game = createGame('gullIsland', { aiPlayers: [] });
  const copy = createGame('gullIsland', { aiPlayers: [] });
  const context = { owner: 'player', agent: { controller: 'external-agent' as const, team: 'a', race: 'grove' as const, version }, source: 'external-agent' as const, plannerOrigin: 'local-command-planner' as const, teams: { player: 'a', enemy: 'b' } };
  for (const tick of [0, 15, 30, 6000]) {
    game.tick = tick; copy.tick = tick;
    expect(observed({ ...context, game, snapshot: snapshotGame(game) })).toEqual(stock({ ...context, game: copy, snapshot: snapshotGame(copy) }));
  }
  expect(memories.player).toBeDefined();
});
