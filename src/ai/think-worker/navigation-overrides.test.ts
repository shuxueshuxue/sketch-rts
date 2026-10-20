import { expect, it } from 'vitest';
import { createGame } from '../../shared/sim';
import { CommandFrameRuntime } from '../../shared/sim/command-frame-runtime';
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from '../runtime';
import { createAiThinkClientExecutor } from './client';
import type { AiThinkMessage, AiThinkReply } from './protocol';

it('forwards accepted outside orders once through the shared runtime and copied think request, including identical rescue orders', () => {
  const game = createGame('bareDuel', { aiPlayers: ['player'] });
  const ai = createAiRuntime(['player'], { version: 'v9_archer' });
  const worker = game.units.find(unit => unit.owner === 'player' && unit.kind === 'worker')!;
  const command = { type: 'move' as const, unitIds: [worker.id], x: worker.x + 20, y: worker.y, avoidCombat: true };
  worker.order = { type: 'move', x: command.x, y: command.y, avoidCombat: true };
  const messages: AiThinkMessage[] = [];
  const replies: AiThinkReply[] = [];
  const executor = createAiThinkClientExecutor(ai, game, {
    send(message) {
      messages.push(structuredClone(message));
      if (message.type === 'think') replies.push({ session: message.session, deliveryTick: message.deliveryTick, commands: [], thinkMs: 0 });
    }, drain: () => replies.splice(0), close() {},
  }, 'outside-orders');
  const planner = createPresetAiRuntimeFramePlanner(game, ai, { executor });
  const runtime = new CommandFrameRuntime({ game, roomId: 'outside-orders', rejectionLabel: 'test', aiPlanner: planner });
  runtime.tick([{ playerId: 'player', command }]);
  const request = messages.find(message => message.type === 'think');
  expect(request?.type === 'think' && request.requests[0]?.overridingCommands).toEqual([command]);
  expect(messages.filter(message => message.type === 'think')).toHaveLength(1);
  for (let index = 0; index < 15; index++) runtime.tick();
  const thinks = messages.filter(message => message.type === 'think');
  expect(thinks).toHaveLength(2);
  expect(thinks[1]?.requests[0]?.overridingCommands).toBeUndefined();
});
