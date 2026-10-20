import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { UNIT_DEFS } from '../catalog';
import { SHIP_WEAPONS } from '../ship-equipment';
import { createGame, type Game } from '../sim';
import { advanceCommandFrameTick } from './command-frame-runtime';
import { checksumGameForVersion } from './checksum';
import { runGameLoop } from '../../sdk/game-runner';
import type { GameCommand, GameSetupOptions, MapId, PlayerId } from '../types';

type Recording = {
  base: string; mapId: MapId; options: GameSetupOptions; automaticTicks: number;
  commands: { tick: number; owner: PlayerId; command: GameCommand }[];
  checksums: string[];
};

// Isolate the guard-station rule: the later range-buffer combat rule intentionally changes AI combat too.
// Its public zero-buffer setting and the pre-target-lock checksum representation retain this independent guard proof.
const definitions = [...Object.values(UNIT_DEFS), ...Object.values(SHIP_WEAPONS)];
const buffers = definitions.map(rules => rules.aimRangeBuffer);
beforeAll(() => { for (const rules of definitions) rules.aimRangeBuffer = 0; });
afterAll(() => definitions.forEach((rules, index) => {
  if (buffers[index] === undefined) delete rules.aimRangeBuffer;
  else rules.aimRangeBuffer = buffers[index];
}));

// Rules 9 deliberately adds receipts for previously silent refusals and waits. Strip only that presentation state
// when checking this older guard proof: entity positions, orders, resources, old effects and ids must still match.
function guardProofChecksum(game: Game) {
  const effects = game.effects.filter(effect => !effect.id.startsWith('refused-') && !effect.id.startsWith('waiting-'))
    .map(effect => {
      const { commandType, feedbackStatus, refusal, ...prior } = effect;
      return prior;
    });
  return checksumGameForVersion({ ...game, effects }, 21);
}

// Actual room-AI commands captured on main a2cff607; no current planner replaces the recording.
it.each(['v9_archer', 'v9_summoner', 'v9_knight'])('preserves the guard-only all-AI %s recording with the later aiming buffer disabled', subject => {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/guard-ai-${subject}.json`, import.meta.url), 'utf8')) as Recording;
  expect(fixture.base).toBe('a2cff607');
  expect(fixture.automaticTicks).toBeGreaterThan(0);
  expect(fixture.options.aiPlayers?.length).toBe(fixture.options.players?.length);
  const game = createGame(fixture.mapId, fixture.options);
  let index = 0;
  for (let tick = 0; tick < fixture.checksums.length; tick++) {
    expect(guardProofChecksum(game), `${subject} tick ${tick}`).toBe(fixture.checksums[tick]);
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
  expect(guardProofChecksum(game)).toBe(fixture.checksums[1]);
});
