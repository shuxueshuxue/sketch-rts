import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame } from '../sim';
import { advanceCommandFrameTick } from './command-frame-runtime';
import { checksumGame } from './checksum';
import { runGameLoop } from '../../sdk/game-runner';
import type { GameCommand, GameSetupOptions, MapId, PlayerId } from '../types';

type Recording = {
  base: string; mapId: MapId; options: GameSetupOptions; automaticTicks: number;
  commands: { tick: number; owner: PlayerId; command: GameCommand }[];
  checksums: string[];
};

// Actual room-AI games captured on main a2cff607, including both autonomous combat and commanded movement.
// Replay the recorded commands, not today's planner, and compare every tick against the pre-change simulation.
it.each(['v9_archer', 'v9_summoner', 'v9_knight'])('preserves every tick of the main all-AI %s recording', subject => {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/guard-ai-${subject}.json`, import.meta.url), 'utf8')) as Recording;
  expect(fixture.base).toBe('a2cff607');
  expect(fixture.automaticTicks).toBeGreaterThan(0);
  expect(fixture.options.aiPlayers?.length).toBe(fixture.options.players?.length);
  const game = createGame(fixture.mapId, fixture.options);
  let index = 0;
  for (let tick = 0; tick < fixture.checksums.length; tick++) {
    expect(checksumGame(game), `${subject} tick ${tick}`).toBe(fixture.checksums[tick]);
    if (tick === fixture.checksums.length - 1) break;
    const commands = [];
    while (fixture.commands[index]?.tick === tick) {
      const entry = fixture.commands[index++]!;
      commands.push({ playerId: entry.owner, command: entry.command });
    }
    advanceCommandFrameTick(game, { roomId: 'proof', tick, sequence: tick, commands });
  }
  expect(index).toBe(fixture.commands.length);
  expect(game.units.some(unit => unit.guardPosition !== undefined)).toBe(false);
}, 30_000);

it('identifies both external SDK agents as AI seats before their first simulated tick', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/guard-ai-v9_archer.json', import.meta.url), 'utf8')) as Recording;
  const agents = Object.fromEntries(fixture.options.players!.map(owner => [owner, { controller: 'external-agent' as const,
    team: fixture.options.teams![owner]!, race: fixture.options.races![owner]! }]));
  const { game } = runGameLoop({ name: 'external-controller-identity', mapId: fixture.mapId,
    options: { ...fixture.options, aiPlayers: [] }, agents, maxTicks: 1, thinkInterval: 15 });
  expect(game.aiPlayers).toEqual(fixture.options.players);
  expect(checksumGame(game)).toBe(fixture.checksums[1]);
});
