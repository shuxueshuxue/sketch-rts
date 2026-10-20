import { replaySnapshotToTick, type DebugReplayTrace } from '../../shared/replay';
import { createAiRuntime, type AiThinkExecutor, type AiThinkExecutorFactory } from "../../ai/runtime";
import { createAiThinkClientExecutor } from "../../ai/think-worker/client";
import type { AiThinkReply } from "../../ai/think-worker/protocol";
import type { ServerNetMessage } from "../../shared/net/types";
import { createGame, warmGameCaches, type Game } from "../../shared/sim";
import { SimulationEngine } from "../../shared/sim/engine";
import type { GameSetupOptions, GameSnapshot, MapId, RoomState } from "../../shared/types";
import { MENU_BATTLES } from "../menu-battles";
import { LocalGameAdapter } from "../net/local-adapter";
import { LockstepClient } from "../net/lockstep-client";
import type { MatchThreadEvent, MatchThreadMessage, MatchThreadSnapshot } from "./protocol";

/** The match thread's side (see @@@match-thread): the same adapters a page would run, driven by the page's messages. */
export function createMatchThreadHost(post: (event: MatchThreadEvent) => void) {
  let now = 0;
  let replay: DebugReplayTrace | undefined;
  let stopPlans: (() => void) | undefined;
  let local: LocalGameAdapter | undefined;
  let lockstep: LockstepClient | undefined;
  const netHandlers: ((message: ServerNetMessage) => void)[] = [];
  // The executor the local match thinks through on the AI thread, whose report goes with each snapshot.
  let thinking: AiThinkExecutor | undefined;
  const report = (error: unknown) => post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  const publish = () => {
    const ai = thinking?.report?.();
    if (local) post({ type: "snapshot", snapshot: withoutGround(local.currentSnapshot()), ...(ai ? { ai } : {}) });
    else if (lockstep) post({ type: "snapshot", snapshot: withoutGround(lockstep.currentSnapshot()), pendingCasts: [...lockstep.pendingCasts()] });
  };
  const step = () => !!(local?.updateToRenderTime() || lockstep?.updateToRenderTime());
  // An update stops on a page's frame budget with ticks possibly still due. Here a tick holds no frame, so the match
  // goes on after the messages already waiting (commands, server frames) instead of at the page's next frame: a slow
  // frame no longer slows the game. The page still gets one snapshot per frame, and one when such a run ends.
  let stepped = false, continuing = false, closed = false;
  const carryOn = () => {
    if (continuing) return;
    continuing = true;
    setTimeout(() => {
      continuing = false;
      if (closed) return;
      try {
        if (step()) { stepped = true; carryOn(); }
        else if (stepped) { stepped = false; publish(); }
      } catch (error) {
        report(error);
      }
    }, 0);
  };
  return {
    handle(message: MatchThreadMessage) {
      try {
        if (message.type === 'replay') { replay = message.trace; return; }
        if (message.type === 'seekReplay') {
          if (replay) post({type:'snapshot',snapshot:withoutGround(replaySnapshotToTick(replay,message.tick))});
          return;
        }
        if (message.type === 'observePlans') {
          stopPlans?.(); stopPlans = undefined;
          if (message.enabled) {
            if (local) stopPlans = local.subscribePlans(packet => post({type:'aiPlans',packet}));
            else if (replay) for (const packet of replay.aiPlans?.packets ?? []) post({type:'aiPlans',packet});
          }
          return;
        }
        if (message.type === 'recordReplay') {
          const operation=local ? (message.enabled?local.startRecording():local.stopRecording()) : Promise.reject(new Error('No local match to record'));
          void operation.then(()=>post({type:'replayRecording',requestId:message.requestId}),error=>post({type:'replayRecording',requestId:message.requestId,error:String(error)}));return;
        }
        if (message.type === 'readReplay') {
          const operation=local?local.recordedReplay():replay?Promise.resolve(replay):Promise.reject(new Error('No debug recording'));
          void operation.then(trace => post({type:'replayData',requestId:message.requestId,trace}),error =>
            post({type:'replayData',requestId:message.requestId,error:String(error)}));
          return;
        }
        if (message.type === "local") {
          now = message.now;
          const room = message.room;
          local = new LocalGameAdapter(warmedGame(message.mapId, message.options), message.playerId, {
            now: () => now,
            ...(message.tickMs === undefined ? {} : { tickMs: message.tickMs }),
            aiRuntime: createAiRuntime(message.aiPlayers, message.aiVersions ? { versions: message.aiVersions } : {}),
            ...(message.aiPort ? { aiThinkExecutor: (runtime, game) => (thinking = portAiThinkExecutors(message.aiPort!)(runtime, game)) } : {}),
            ...(room ? {
              room,
              // The room's lifecycle stays with the page; it gets the final world and finishes the room there.
              finishRoom: (snapshot) => { post({ type: "ended", snapshot: withoutGround(snapshot) }); return { ...room, status: "ended" } as RoomState; },
            } : {}),
          });
          return;
        }
        if (message.type === "scene") {
          now = message.now;
          const game = MENU_BATTLES[message.scene](message.seed);
          warmGameCaches(game);
          local = new LocalGameAdapter(game, game.activePlayers[0]!, { now: () => now });
          return;
        }
        if (message.type === "lockstep") {
          lockstep = new LockstepClient({
            roomId: message.roomId,
            playerId: message.playerId,
            engine: new SimulationEngine(warmedGame(message.mapId, message.options)),
            transport: { send: (net) => post({ type: "net", message: net }), onMessage: (handler) => { netHandlers.push(handler); }, close() {} },
            onError: (error) => post({ type: "error", message: error }),
          });
          return;
        }
        if (message.type === "advance") {
          now = message.now;
          const advanced = step();
          if (advanced || stepped) { stepped = false; publish(); }
          if (advanced) carryOn();
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
          // @@@restore-redraws - A checkpoint replaces the world without a tick: the page gets it on its next frame. A
          // snapshot went out only after a tick, so in a paused room (after a reset, or on joining one) none followed and
          // the page kept drawing the world it had before.
          if (message.message.type === "checkpoint") stepped = true;
          return;
        }
        if (message.type === "join") {
          lockstep?.join();
          return;
        }
        closed = true;
        stopPlans?.();
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

// The match's derived navigation is built before its first tick, off the clock.
function warmedGame(mapId: MapId, options: GameSetupOptions): Game {
  const game = createGame(mapId, options);
  warmGameCaches(game);
  return game;
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
