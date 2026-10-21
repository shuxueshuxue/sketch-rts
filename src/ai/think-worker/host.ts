import { diffAiPlan } from '../plan-stream';
import {buildAiPlanTrace,type AiPlanTrace} from '../plan-trace';
import {projectDeathThinkContext} from '../death-ledger-context';
import {DEFAULT_AI_PLANNER_VERSION} from '../planner-context';
import { createAiPolicyMemory, type AiPolicyMemory, type PresetAiPolicyOptions } from "../policy";
import { planAiCommandFrameFromSnapshot } from "../runtime";
import { checkCommandLegality } from "../../shared/sim/command-validation";
import { groundRegionIndex } from "../../shared/terrain";
import type { GameMap, GameSnapshot, PlayerId } from "../../shared/types";
import type { AiThinkMessage, AiThinkReply } from "./protocol";

type Session = {
  // One map object for the whole match: the terrain's caches and the AI's building overlay stay with it (see
  // @@@think-thread). Each think refreshes its changing fields (the wind) in place.
  map: GameMap;
  policyMode?: PresetAiPolicyOptions["policyMode"];
  strategyControl?: boolean;
  memories: Partial<Record<PlayerId, AiPolicyMemory>>;
  observed?: {generation: number; previous: Map<PlayerId, AiPlanTrace>};
  send: (reply: AiThinkReply) => void;
};

/** The thinking thread's side: plans each think exactly as createInlineAiThinkExecutor would on the match's thread. */
export function createAiThinkHost() {
  const sessions = new Map<string, Session>();
  return {
    open(message: Extract<AiThinkMessage, { type: "open" }>, send: (reply: AiThinkReply) => void) {
      // The worker receives its own cloned Terrain; the simulation thread's
      // warmup cannot populate this isolate's static map facts.
      groundRegionIndex(message.map);
      sessions.set(message.session, { map: message.map, ...(message.policyMode ? { policyMode: message.policyMode } : {}),
        ...(message.strategyControl !== undefined ? { strategyControl: message.strategyControl } : {}), memories: {}, send });
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
        const strategies = new Map<string, import('../strategy/bootstrap-control').BootstrapStrategyOutput>();
        const { commands } = planAiCommandFrameFromSnapshot(snapshot, requests, { ...(snapshot.teams ? { teams: snapshot.teams } : {}),
          ...(session.policyMode ? { policyMode: session.policyMode } : {}),
          ...(session.strategyControl !== undefined ? { strategyControl: session.strategyControl } : {}),
          ...(message.observe !== undefined ? { observeBootstrapPlan(context, _entries, actual) {
            if (actual) strategies.set(actual.decision.owner, actual);
          } } : {}),
        });
        const envelopes = commands.map((entry) => ({ playerId: entry.playerId, command: entry.command }));
        // A command that is illegal in the world it was planned from is an AI fault, as on the match's thread.
        for (const entry of envelopes) {
          const legality = checkCommandLegality(snapshot, entry.playerId, entry.command);
          if (legality && !legality.transient) throw new Error(`AI think rejected ${entry.playerId} ${entry.command.type}: ${legality.message}`);
        }
        session.send({ session: message.session, deliveryTick: message.deliveryTick, commands: envelopes, thinkMs: performance.now() - started });
        if (message.observe === undefined) delete session.observed;
        else if (session.observed?.generation !== message.observe) session.observed = {generation:message.observe,previous:new Map()};
        // Commands leave first. Diagnostics do not extend this think's command-delivery path.
        if(session.observed) try {
          const observations=requests.map(request=>{
            const base=buildAiPlanTrace(snapshot,request.playerId,request.memory,request.version??DEFAULT_AI_PLANNER_VERSION);
            const strategy=strategies.get(request.playerId);
            const trace={...(strategy?.project?{...base,strategy:strategy.project()}:base),
              ...(strategy?.goalPlanner?{goalPlanner:strategy.goalPlanner}:{})};
            const previous=session.observed!.previous.get(trace.owner);
            const result={delta:diffAiPlan(previous,trace,message.observe!),context:projectDeathThinkContext(snapshot,trace.owner,request.memory)};
            session.observed!.previous.set(trace.owner,trace);return result;
          });
          session.send({kind:'observation',session:message.session,deliveryTick:message.deliveryTick,observations});
        } catch(error) { console.error('AI plan projection failed',error); }
      } catch (error) {
        session.send({ session: message.session, deliveryTick: message.deliveryTick, error: error instanceof Error ? error.stack ?? error.message : String(error) });
      }
    },
    close(message: Extract<AiThinkMessage, { type: "close" }>) {
      sessions.delete(message.session);
    },
  };
}
