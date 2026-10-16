import { createAiPolicyMemory, type AiPolicyMemory, type PresetAiPolicyOptions } from "../policy";
import { planAiCommandFrameFromSnapshot } from "../runtime";
import { checkCommandLegality } from "../../shared/sim/command-validation";
import type { GameMap, GameSnapshot, PlayerId } from "../../shared/types";
import type { AiThinkMessage, AiThinkReply } from "./protocol";

type Session = {
  // One map object for the whole match: the terrain's caches and the AI's building overlay stay with it (see
  // @@@think-thread). Each think refreshes its changing fields (the wind) in place.
  map: GameMap;
  policyMode?: PresetAiPolicyOptions["policyMode"];
  memories: Partial<Record<PlayerId, AiPolicyMemory>>;
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
        const { commands } = planAiCommandFrameFromSnapshot(snapshot, requests, { ...(snapshot.teams ? { teams: snapshot.teams } : {}), ...(session.policyMode ? { policyMode: session.policyMode } : {}) });
        const envelopes = commands.map((entry) => ({ playerId: entry.playerId, command: entry.command }));
        // A command that is illegal in the world it was planned from is an AI fault, as on the match's thread.
        for (const entry of envelopes) {
          const legality = checkCommandLegality(snapshot, entry.playerId, entry.command);
          if (legality && !legality.transient) throw new Error(`AI think rejected ${entry.playerId} ${entry.command.type}: ${legality.message}`);
        }
        session.send({ session: message.session, deliveryTick: message.deliveryTick, commands: envelopes, thinkMs: performance.now() - started });
      } catch (error) {
        session.send({ session: message.session, deliveryTick: message.deliveryTick, error: error instanceof Error ? error.stack ?? error.message : String(error) });
      }
    },
    close(message: Extract<AiThinkMessage, { type: "close" }>) {
      sessions.delete(message.session);
    },
  };
}
