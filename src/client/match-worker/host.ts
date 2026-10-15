import { createAiRuntime, type AiThinkExecutorFactory } from "../../ai/runtime";
import { createAiThinkClientExecutor } from "../../ai/think-worker/client";
import type { AiThinkReply } from "../../ai/think-worker/protocol";
import type { ServerNetMessage } from "../../shared/net/types";
import { createGame } from "../../shared/sim";
import { SimulationEngine } from "../../shared/sim/engine";
import type { GameSnapshot, RoomState } from "../../shared/types";
import { LocalGameAdapter } from "../net/local-adapter";
import { LockstepClient } from "../net/lockstep-client";
import type { MatchThreadEvent, MatchThreadMessage, MatchThreadSnapshot } from "./protocol";

/** The match thread's side (see @@@match-thread): the same adapters a page would run, driven by the page's messages. */
export function createMatchThreadHost(post: (event: MatchThreadEvent) => void) {
  let now = 0;
  let local: LocalGameAdapter | undefined;
  let lockstep: LockstepClient | undefined;
  const netHandlers: ((message: ServerNetMessage) => void)[] = [];
  const report = (error: unknown) => post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  const publish = () => {
    if (local) post({ type: "snapshot", snapshot: withoutGround(local.currentSnapshot()) });
    else if (lockstep) post({ type: "snapshot", snapshot: withoutGround(lockstep.currentSnapshot()), pendingCasts: [...lockstep.pendingCasts()] });
  };
  return {
    handle(message: MatchThreadMessage) {
      try {
        if (message.type === "local") {
          now = message.now;
          const room = message.room;
          local = new LocalGameAdapter(createGame(message.mapId, message.options), message.playerId, {
            now: () => now,
            ...(message.tickMs === undefined ? {} : { tickMs: message.tickMs }),
            aiRuntime: createAiRuntime(message.aiPlayers, message.aiVersions ? { versions: message.aiVersions } : {}),
            ...(message.aiPort ? { aiThinkExecutor: portAiThinkExecutors(message.aiPort) } : {}),
            ...(room ? {
              room,
              // The room's lifecycle stays with the page; it gets the final world and finishes the room there.
              finishRoom: (snapshot) => { post({ type: "ended", snapshot: withoutGround(snapshot) }); return { ...room, status: "ended" } as RoomState; },
            } : {}),
          });
          return;
        }
        if (message.type === "lockstep") {
          lockstep = new LockstepClient({
            roomId: message.roomId,
            playerId: message.playerId,
            engine: new SimulationEngine(createGame(message.mapId, message.options)),
            transport: { send: (net) => post({ type: "net", message: net }), onMessage: (handler) => { netHandlers.push(handler); }, close() {} },
            onError: (error) => post({ type: "error", message: error }),
          });
          return;
        }
        if (message.type === "advance") {
          now = message.now;
          if (local?.updateToRenderTime() || lockstep?.updateToRenderTime()) publish();
          return;
        }
        if (message.type === "command") {
          try {
            if (local) local.sendCommand(message.command);
            else lockstep?.sendCommand(message.command);
          } catch (error) {
            post({ type: "rejected", message: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        if (message.type === "net") {
          for (const handler of netHandlers) handler(message.message);
          return;
        }
        if (message.type === "join") {
          lockstep?.join();
          return;
        }
        local?.close();
        lockstep?.close();
      } catch (error) {
        report(error);
      }
    },
  };
}

function withoutGround(snapshot: GameSnapshot): MatchThreadSnapshot {
  const { terrain: _terrain, landmarks: _landmarks, ...map } = snapshot.map;
  return { ...snapshot, map };
}

// The match's AI thinks on its own thread, reached through a port the page connected (see @@@think-thread).
function portAiThinkExecutors(port: MessagePort): AiThinkExecutorFactory {
  const inbox: AiThinkReply[] = [];
  port.onmessage = (event: MessageEvent<AiThinkReply>) => { inbox.push(event.data); };
  let nextSession = 0;
  return (runtime, game) => createAiThinkClientExecutor(runtime, game, {
    send: (message) => port.postMessage(message),
    drain: () => inbox.splice(0),
    close: () => port.close(),
  }, `match-${nextSession++}`);
}
