import { diffAiPlan } from '../plan-stream';
import type { AiPlanTrace } from '../plan-trace';
import { createAiPolicyMemory, type AiPolicyMemory, type PresetAiPolicyOptions } from "../policy";
import { planAiCommandFrameFromSnapshot, type AiThinkObservation } from "../runtime";
import { checkCommandLegality } from "../../shared/sim/command-validation";
import type { GameMap, GameSnapshot, PlayerId } from "../../shared/types";
import type { AiThinkMessage, AiThinkReply } from "./protocol";

type Session = {
  // One map object for the whole match: the terrain's caches and the AI's building overlay stay with it (see
  // @@@think-thread). Each think refreshes its changing fields (the wind) in place.
  map: GameMap;
  policyMode?: PresetAiPolicyOptions["policyMode"];
  memories: Partial<Record<PlayerId, AiPolicyMemory>>;
  observed?: {generation: number; previous: Map<PlayerId, AiPlanTrace>};
  send: (reply: AiThinkReply) => void;
};

/** The thinking thread's side: plans each think exactly as createInlineAiThinkExecutor would on the match's thread. */
export function createAiThinkHost() {
  const sessions = new Map<string, Session>();
  return {
    open(message: Extract<AiThinkMessage, { type: "open" }>, send: (reply: AiThinkReply) => void) {
      sessions.set(message.session, { map: message.map, ...(message.policyMode ? { policyMode: message.policyMode } : {}), memories: {}, send });
    },
    think(message: Extract<AiThinkMessage, { type: "think" }>) {
      const session = sessions.get(message.session);
      if (!session) return;
      const started = performance.now();
      try {
        const map = session.map as Record<string, unknown>;
        for (const key of Object.keys(map)) if (key !== "terrain" && key !== "landmarks") delete map[key];
        Object.assign(map, message.snapshot.map);
        const snapshot: GameSnapshot = { ...message.snapshot, map: session.map };
        const requests = message.requests.map((request) => ({ ...request, memory: session.memories[request.playerId] ??= createAiPolicyMemory() }));
        if (message.observe === undefined) delete session.observed;
        else if (session.observed?.generation !== message.observe) session.observed = {generation:message.observe,previous:new Map()};
        const observations: NonNullable<Extract<AiThinkReply, {commands: unknown}>['observations']> | undefined = session.observed ? [] : undefined;
        const { commands } = planAiCommandFrameFromSnapshot(snapshot, requests, { ...(snapshot.teams ? { teams: snapshot.teams } : {}), ...(session.policyMode ? { policyMode: session.policyMode } : {}), ...(observations ? { observer: ({trace, context}: AiThinkObservation) => {
          const previous = session.observed!.previous.get(trace.owner);
          observations.push({delta:diffAiPlan(previous,trace,message.observe!),context});
          session.observed!.previous.set(trace.owner,trace);
        } } : {}) });
        const envelopes = commands.map((entry) => ({ playerId: entry.playerId, command: entry.command }));
        // A command that is illegal in the world it was planned from is an AI fault, as on the match's thread.
        for (const entry of envelopes) {
          const legality = checkCommandLegality(snapshot, entry.playerId, entry.command);
          if (legality && !legality.transient) throw new Error(`AI think rejected ${entry.playerId} ${entry.command.type}: ${legality.message}`);
        }
        session.send({ session: message.session, deliveryTick: message.deliveryTick, commands: envelopes, thinkMs: performance.now() - started, ...(observations ? { observations } : {}) });
      } catch (error) {
        session.send({ session: message.session, deliveryTick: message.deliveryTick, error: error instanceof Error ? error.stack ?? error.message : String(error) });
      }
    },
    close(message: Extract<AiThinkMessage, { type: "close" }>) {
      sessions.delete(message.session);
    },
  };
}
