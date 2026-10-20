import { AiDeathLedger } from './death-ledger';
import type { AiThinkExecutor, AiThinkObservation } from './runtime';
import { compareAiPlanTraces, type AiPlanTrace } from './plan-trace';
import { diffAiPlan, type AiPlanPacket, type AiPlanRecording } from './plan-stream';
import type { Game } from '../shared/sim';
import type { PlayerId, Building } from '../shared/types';

/** Owned by the match, outside Game. Dormant instances retain no ledger, context, trace or entity index. */
export class AiPlanObserver {
  private ledger: AiDeathLedger | undefined;
  private listeners = new Set<(packet: AiPlanPacket) => void>();
  private previous: Map<PlayerId, AiPlanTrace> | undefined;
  private buildings: Building[] | undefined;
  private deathCount = 0;
  private session = 0;
  private from = 0;
  private recordingFrom = 0;
  private recording?: AiPlanRecording;
  constructor(private game: Game, private owners: PlayerId[], private executor?: AiThinkExecutor) {}

  get active() { return !!this.ledger; }
  subscribe(listener: (packet: AiPlanPacket) => void): () => void {
    this.listeners.add(listener);
    if (!this.active) this.start();
    else {
      listener({type: 'coverage', session: this.session, from: this.from, to: null});
      for (const trace of this.previous!.values()) listener(diffAiPlan(undefined, trace, this.session));
    }
    return () => { listener({type:'coverage',session:this.session,from:this.from,to:this.game.tick}); this.listeners.delete(listener); this.maybeStop(); };
  }
  record(enabled: boolean): void {
    if (enabled === this.isRecording) return;
    if (enabled) {
      this.recordingEnabled = true;this.recordingFrom = this.game.tick;
      this.recording = { packets: [], throughTick: this.game.tick };
      if (!this.active) this.start();
      else {
        this.recording.packets.push({type: 'coverage', session: this.session, from: this.game.tick, to: null});
        for (const trace of this.previous!.values()) this.recording.packets.push(diffAiPlan(undefined, trace, this.session));
      }
    } else { this.maybeStop(true); }
  }
  recordingData(): AiPlanRecording | undefined { return this.recording && structuredClone(this.recording); }
  private emit(packet: AiPlanPacket) {
    if (this.isRecording) this.recording!.packets.push(packet);
    for (const listener of this.listeners) listener(packet);
  }
  private start() {
    this.session++; this.from = this.game.tick; this.previous = new Map(); this.deathCount = 0;
    this.buildings = [...this.game.buildings];
    this.ledger = new AiDeathLedger(this.game, {owners: this.owners});
    this.executor?.observe?.(observation => this.think(observation));
    this.emit({type:'coverage', session:this.session, from:this.from, to:null});
  }
  private think({trace, context}: AiThinkObservation) {
    if (!this.ledger) return;
    this.ledger.recordThinkContext(context);
    const previous = this.previous!.get(trace.owner);
    const current = {...trace, previousTick: previous?.tick ?? null, changes: compareAiPlanTraces(previous, trace)};
    const allocated = new Set(trace.nodes.flatMap(n => n.resources.unitIds));
    this.emit({...diffAiPlan(previous,current,this.session),positions:context.units.filter(u=>allocated.has(u.id)).map(({id,x,y})=>({id,x,y}))});
    this.previous!.set(trace.owner, current);
  }
  /** Called after native simulation steps, only while subscribed or recording. */
  step() {
    if (!this.ledger) return;
    const deaths = this.ledger.recordsFrom(this.deathCount);
    this.deathCount += deaths.length;
    const live = new Set(this.game.buildings.map(b => b.id));
    const buildings = this.buildings!.filter(b => b.hp <= 0 && !live.has(b.id)).map(b =>
      ({id:b.id, owner:b.owner, kind:b.kind, tick:this.game.tick, x:b.x, y:b.y}));
    this.buildings = [...this.game.buildings];
    if (deaths.length || buildings.length) this.emit({type:'events',tick:this.game.tick,deaths,buildings});
    if (this.isRecording) this.recording!.throughTick = this.game.tick;
  }
  private maybeStop(stopRecording = false) {
    if (stopRecording && this.recording) {
      this.recording.packets.push({type:'coverage', session:this.session, from:this.recordingFrom, to:this.game.tick});
      // Keep the journal for replay; recording state is separate from retained output.
      this.recordingEnabled = false;
    }
    if (this.listeners.size || this.isRecording) return;
    this.stop();
  }
  private recordingEnabled = false;
  private get isRecording() { return !!this.recording && this.recordingEnabled; }
  private stop() {
    if (!this.ledger) return;
    this.emit({type:'coverage',session:this.session,from:this.from,to:this.game.tick});
    this.executor?.observe?.(); this.ledger.dispose(); this.ledger = undefined;
    this.previous = undefined; this.buildings = undefined;
  }
  dispose() { this.listeners.clear(); this.recordingEnabled = false; this.stop(); }
}
