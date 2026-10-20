import { applyAiPlanDelta } from '../plan-stream';
import type { AiPlanTrace } from '../plan-trace';
import { snapshotGame, type Game } from "../../shared/sim";
import type { CommandEnvelope } from "../../shared/net/types";
import { emptyAiThinkReport, type AiCommandFrameRequest, type AiRuntimeState, type AiThinkExecutor, type AiThinkObserver } from "../runtime";
import type { AiThinkMessage, AiThinkReply, AiThinkWireRequest } from "./protocol";
import type { PlayerId } from "../../shared/types";

// How a match reaches its thinking thread (see @@@think-thread).
export type AiThinkChannel = {
  send(message: AiThinkMessage): void;
  // The replies that have arrived, without waiting.
  drain(): AiThinkReply[];
  // Blocks until a reply may have arrived, where the platform lets this thread block (a Node worker thread does; a
  // browser page does not). Only a match stepped synchronously waits (see @@@planner-schedule).
  wait?(timeoutMs: number): void;
  close(): void;
};

const THINK_TIMEOUT_MS = 30_000;

/** Runs a match's thinks on another thread. A think that arrives by its delivery tick lands there, as the inline
 * executor's does; a later one lands on the first tick after it arrives, unless the match settles each tick. */
export function createAiThinkClientExecutor(runtime: AiRuntimeState, game: Game, channel: AiThinkChannel, session: string): AiThinkExecutor {
  if (runtime.scripts) throw new Error("AI scripts given as functions cannot think on another thread");
  channel.send({ type: "open", session, map: game.map, ...(runtime.policyMode ? { policyMode: runtime.policyMode } : {}) });
  // The owners of each think still running, by the tick its commands are due.
  let generation = 0;
  let previous: Map<PlayerId, AiPlanTrace> | undefined;
  let observer: AiThinkObserver | undefined;
  const running = new Map<number, Set<PlayerId>>();
  const arrived = new Map<number, CommandEnvelope[]>();
  const failed = new Map<number, string>();
  const collect = () => {
    for (const reply of channel.drain()) {
      if (reply.session !== session) continue;
      running.delete(reply.deliveryTick);
      if ("error" in reply) failed.set(reply.deliveryTick, reply.error);
      else {
        if (observer) for (const observation of reply.observations ?? []) {
          if (observation.delta.session !== generation) continue;
          const trace = applyAiPlanDelta(previous!.get(observation.delta.owner), observation.delta);
          if (trace) { previous!.set(trace.owner, trace); try { observer({trace, context:observation.context}); } catch(error) { console.error('AI plan consumer failed',error); } }
        }
        arrived.set(reply.deliveryTick, [...(arrived.get(reply.deliveryTick) ?? []), ...reply.commands]);
        report.thinks += 1;
        report.thinkMs += reply.thinkMs;
        report.slowestMs = Math.max(report.slowestMs, reply.thinkMs);
      }
    }
  };
  const due = (tick: number) => [...running.keys()].some((delivery) => delivery <= tick);
  let report = emptyAiThinkReport();
  return {
    observe(next) { observer = next; generation++; previous = next ? new Map() : undefined; },
    submit(current, job) {
      const snapshot = snapshotGame(current);
      const { terrain: _terrain, landmarks: _landmarks, ...map } = snapshot.map;
      channel.send({ type: "think", session, tick: job.tick, deliveryTick: job.deliveryTick, snapshot: { ...snapshot, map }, requests: job.requests.map(wireRequest), ...(observer ? { observe: generation } : {}) });
      running.set(job.deliveryTick, new Set(job.requests.map((request) => request.playerId)));
    },
    thinking(owner) {
      collect();
      // Asked only of a player due to think: one still thinking skips that turn (see @@@planner-schedule).
      const busy = [...running.values()].some((owners) => owners.has(owner));
      if (busy) report.skipped += 1;
      return busy;
    },
    take(tick, settle) {
      collect();
      const deadline = performance.now() + THINK_TIMEOUT_MS;
      while (settle && due(tick)) {
        if (!channel.wait) throw new Error(`AI think due on tick ${tick} has not arrived, and this thread cannot wait for it`);
        if (performance.now() > deadline) throw new Error(`AI think due on tick ${tick} took longer than ${THINK_TIMEOUT_MS} ms`);
        channel.wait(1_000);
        collect();
      }
      for (const [delivery, failure] of failed) if (delivery <= tick) { failed.delete(delivery); throw new Error(failure); }
      // Every think due by now that has arrived, a late one on this tick (see @@@planner-schedule).
      const commands: CommandEnvelope[] = [];
      for (const delivery of [...arrived.keys()].sort((a, b) => a - b)) {
        if (delivery > tick) break;
        commands.push(...arrived.get(delivery)!);
        arrived.delete(delivery);
        if (delivery < tick) { report.late += 1; report.lateTicks = Math.max(report.lateTicks, tick - delivery); }
      }
      return commands;
    },
    report() {
      collect();
      const taken = report;
      report = emptyAiThinkReport();
      return taken;
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
