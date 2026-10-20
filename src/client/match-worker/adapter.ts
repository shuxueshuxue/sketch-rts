import type { DebugReplayTrace } from '../../shared/replay';
import type { AiPlanPacket } from '../../ai/plan-stream';
import { commandRejection } from "../../shared/sim/command-frame-runtime";
import { bindGangwayCrewRules } from "../../shared/ship-gangway";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import type { GameCommand, GameMap, GameSnapshot, PlayerId } from "../../shared/types";
import type { GameAdapter } from "../game-adapter";
import { perf } from "../perf-overlay";
import type { MatchThreadEvent, MatchThreadInit, MatchThreadMessage, MatchThreadSnapshot } from "./protocol";

export type MatchThreadPort = {
  postMessage(message: MatchThreadMessage, transfer?: Transferable[]): void;
  onmessage: ((event: { data: MatchThreadEvent }) => void) | null;
};

export type MatchThreadAdapterOptions = {
  playerId: PlayerId;
  // A local match checks each command against the latest snapshot as it is given, so a refusal is reported at once, as
  // the page-thread match did; a lockstep match leaves that to the room's server.
  checkCommands?: boolean;
  spectating?: boolean;
  now?: () => number;
  onEnded?: (snapshot: GameSnapshot) => void;
  onError?: (message: string) => void;
  onNet?: (message: ClientNetMessage) => void;
  onClose?: () => void;
};

type CastCommand = Extract<GameCommand, { type: "cast" }>;

/** The page's side of a match on its own thread (see @@@match-thread): draws what arrives, sends what is commanded. */
export class MatchThreadGameAdapter implements GameAdapter {
  private snapshot: GameSnapshot;
  private reported: GameSnapshot;
  replayRange?: {from:number;to:number};
  private replayRequests = new Map<number, {resolve: (trace:DebugReplayTrace)=>void;reject:(error:Error)=>void}>();
  private requestSequence = 0;
  private recorded = false;
  private replayTrace: DebugReplayTrace | undefined;
  private recordingRequests = new Map<number,{resolve:()=>void;reject:(error:Error)=>void}>();
  private casts: CastCommand[] = [];
  private closed = false;
  private planListener: ((packet: AiPlanPacket) => void) | undefined;
  // The page's own fixed ground, kept on every snapshot that arrives without it (see MatchThreadSnapshot).
  private readonly ground: Pick<GameMap, "terrain" | "landmarks">;

  constructor(private readonly port: MatchThreadPort, init: MatchThreadInit, initial: GameSnapshot, private readonly options: MatchThreadAdapterOptions, transfer: Transferable[] = []) {
    this.snapshot = this.reported = initial;
    if (init.type === 'replay') { this.replayTrace=init.trace; this.replayRange = {from:init.trace.initialSave.snapshot.tick,
      to:init.trace.throughTick ?? init.trace.checkpoints.at(-1)?.tick ?? initial.tick}; }
    this.ground = { landmarks: initial.map.landmarks, ...(initial.map.terrain ? { terrain: initial.map.terrain } : {}) };
    port.onmessage = ({ data }) => this.receive(data);
    port.postMessage(init, transfer);
  }

  seekReplay(tick: number) { if (this.replayRange) this.port.postMessage({type:'seekReplay',tick:Math.max(this.replayRange.from,Math.min(this.replayRange.to,Math.round(tick)))}); }
  hasRecording() { return this.recorded; }
  async startRecording() { await this.changeRecording(true);this.recorded=true; }
  async stopRecording() { await this.changeRecording(false); }
  private changeRecording(enabled:boolean):Promise<void>{
    if(this.closed)return Promise.reject(new Error('Match is closed'));
    if(this.replayTrace)return Promise.reject(new Error('A replay cannot record a live match'));
    return new Promise((resolve,reject)=>{const requestId=++this.requestSequence;this.recordingRequests.set(requestId,{resolve,reject});this.port.postMessage({type:'recordReplay',enabled,requestId});});
  }
  recordedReplay(): Promise<DebugReplayTrace> {
    if(this.replayTrace)return Promise.resolve(this.replayTrace);
    if(this.closed)return Promise.reject(new Error('Match is closed'));
    return new Promise((resolve,reject) => { const requestId = ++this.requestSequence;
      this.replayRequests.set(requestId,{resolve,reject}); this.port.postMessage({type:'readReplay',requestId}); });
  }
  subscribePlans(listener: (packet: AiPlanPacket) => void): () => void {
    this.planListener = listener;
    this.port.postMessage({type:'observePlans', enabled:true});
    return () => { this.planListener = undefined; this.port.postMessage({type:'observePlans',enabled:false}); };
  }

  sendCommand(command: GameCommand): void {
    if (this.closed) throw new Error("Local match is closed");
    if (this.options.spectating) throw new Error("Spectators cannot issue commands.");
    if (this.options.checkCommands) {
      const rejection = commandRejection(this.snapshot, { playerId: this.options.playerId, command }, "admission");
      if (rejection) throw new Error(`Local command rejected: ${rejection}`);
    }
    this.port.postMessage({ type: "command", command });
  }

  pendingCasts(): readonly CastCommand[] {
    return this.casts;
  }

  currentSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  // Tells the match what time it is; what it simulates arrives on a later frame.
  updateToRenderTime(): boolean {
    if (this.closed) return false;
    this.port.postMessage({ type: "advance", now: this.options.now?.() ?? performance.now() });
    const changed = this.snapshot !== this.reported;
    this.reported = this.snapshot;
    return changed;
  }

  // Lockstep: what the room's server sent, and the transport opening.
  forward(message: ServerNetMessage): void {
    if (!this.closed) this.port.postMessage({ type: "net", message });
  }

  join(): void {
    if (!this.closed) this.port.postMessage({ type: "join" });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for(const request of [...this.replayRequests.values(),...this.recordingRequests.values()])request.reject(new Error('Match is closed'));
    this.replayRequests.clear();this.recordingRequests.clear();
    this.port.postMessage({ type: "close" });
    this.options.onClose?.();
  }

  private receive(event: MatchThreadEvent): void {
    if (this.closed) return;
    if(event.type==='replayRecording'){const request=this.recordingRequests.get(event.requestId);this.recordingRequests.delete(event.requestId);if(event.error)request?.reject(new Error(event.error));else request?.resolve();return;}
    if (event.type === 'replayData') {
      const request = this.replayRequests.get(event.requestId); this.replayRequests.delete(event.requestId);
      if (event.trace) request?.resolve(event.trace); else request?.reject(new Error(event.error ?? 'Replay unavailable'));
      return;
    }
    if (event.type === 'aiPlans') { this.planListener?.(event.packet); return; }
    if (event.type === "snapshot") {
      this.snapshot = this.withGround(event.snapshot);
      this.casts = event.pendingCasts ?? [];
      if (event.ai) perf?.aiThinking(event.ai);
    } else if (event.type === "ended") {
      this.snapshot = this.withGround(event.snapshot);
      this.options.onEnded?.(this.snapshot);
    } else if (event.type === "net") {
      this.options.onNet?.(event.message);
    } else {
      this.options.onError?.(event.message);
    }
  }

  private withGround(snapshot: MatchThreadSnapshot): GameSnapshot {
    const whole: GameSnapshot = { ...snapshot, map: { ...snapshot.map, ...this.ground } };
    // A copy carries no WeakMap entries; bind its gangway crews' rules to it as snapshotGame does.
    bindGangwayCrewRules(whole.units, whole);
    return whole;
  }
}
