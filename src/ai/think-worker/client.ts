import { snapshotGame, type Game } from "../../shared/sim";
import type { CommandEnvelope } from "../../shared/net/types";
import type { AiCommandFrameRequest, AiRuntimeState, AiThinkExecutor } from "../runtime";
import type { AiThinkMessage, AiThinkReply, AiThinkWireRequest } from "./protocol";

// How a match reaches its thinking thread (see @@@think-thread).
export type AiThinkChannel = {
  send(message: AiThinkMessage): void;
  // The replies that have arrived, without waiting.
  drain(): AiThinkReply[];
  // Blocks until a reply may have arrived, where the platform lets this thread block (a Node worker thread does; a
  // browser page does not, and its match ticks only when ready()).
  wait?(timeoutMs: number): void;
  close(): void;
};

const THINK_TIMEOUT_MS = 30_000;

/** Runs a match's thinks on another thread; their commands land on the same ticks as the inline executor's. */
export function createAiThinkClientExecutor(runtime: AiRuntimeState, game: Game, channel: AiThinkChannel, session: string): AiThinkExecutor {
  if (runtime.scripts) throw new Error("AI scripts given as functions cannot think on another thread");
  channel.send({ type: "open", session, map: game.map, ...(runtime.policyMode ? { policyMode: runtime.policyMode } : {}) });
  const running = new Set<number>();
  const arrived = new Map<number, CommandEnvelope[]>();
  const failed = new Map<number, string>();
  const collect = () => {
    for (const reply of channel.drain()) {
      if (reply.session !== session) continue;
      running.delete(reply.deliveryTick);
      if ("error" in reply) failed.set(reply.deliveryTick, reply.error);
      else if (reply.commands.length > 0) arrived.set(reply.deliveryTick, [...(arrived.get(reply.deliveryTick) ?? []), ...reply.commands]);
    }
  };
  const due = (tick: number) => [...running].some((delivery) => delivery <= tick);
  return {
    submit(current, job) {
      const snapshot = snapshotGame(current);
      const { terrain: _terrain, landmarks: _landmarks, ...map } = snapshot.map;
      channel.send({ type: "think", session, tick: job.tick, deliveryTick: job.deliveryTick, snapshot: { ...snapshot, map }, requests: job.requests.map(wireRequest) });
      running.add(job.deliveryTick);
    },
    ready(tick) {
      collect();
      return !due(tick);
    },
    take(tick) {
      collect();
      const deadline = performance.now() + THINK_TIMEOUT_MS;
      while (due(tick)) {
        if (!channel.wait) throw new Error(`AI think due on tick ${tick} has not arrived; tick the match only when it is ready`);
        if (performance.now() > deadline) throw new Error(`AI think due on tick ${tick} took longer than ${THINK_TIMEOUT_MS} ms`);
        channel.wait(1_000);
        collect();
      }
      const failure = failed.get(tick);
      if (failure !== undefined) throw new Error(failure);
      const commands = arrived.get(tick) ?? [];
      arrived.delete(tick);
      return commands;
    },
    close() {
      channel.send({ type: "close", session });
      channel.close();
    },
  };
}

function wireRequest(request: AiCommandFrameRequest & { scriptIds?: string[] }): AiThinkWireRequest {
  if (request.scripts) throw new Error(`AI scripts given as functions cannot think on another thread (${request.playerId})`);
  return {
    playerId: request.playerId,
    ...(request.version ? { version: request.version } : {}),
    ...(request.scriptIds ? { scriptIds: request.scriptIds } : {}),
    ...(request.disabledBehaviors ? { disabledBehaviors: request.disabledBehaviors } : {}),
  };
}
