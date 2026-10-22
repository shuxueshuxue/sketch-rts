import { AiDeathLedger } from './death-ledger';
import type { AiThinkExecutor, AiThinkObservation } from './runtime';
import { compareAiPlanTraces, type AiPlanTrace } from './plan-trace';
import { diffAiPlan, type AiPlanPacket, type AiPlanRecording, type AiPlanDelta } from './plan-stream';
import type { Game } from '../shared/sim';
import type { PlayerId, Building } from '../shared/types';

/** Owned by the match, outside Game. Dormant instances retain no ledger, context, trace or entity index. */
export class AiPlanObserver {
  private ledger: AiDeathLedger | undefined;
  private listeners = new Set<(packet: AiPlanPacket) => void>();
  private previous: Map<PlayerId, AiPlanTrace> | undefined;
  private positions: Map<PlayerId,NonNullable<AiPlanDelta['positions']>> | undefined;
  private buildings: Building[] | undefined;
  private deathCount = 0;
  private session = 0;
  private subscriptionSequence = 0;
  private from = 0;
  private recordingFrom = 0;
  private recording?: AiPlanRecording;
  private game: Game | undefined;
  private lastTick=0;
  constructor(game: Game, private owners: PlayerId[], private executor: AiThinkExecutor | undefined = undefined) { this.game=game; }
  private get tick(){return this.game?.tick??this.lastTick;}
  private get world(){if(!this.game)throw new Error('AI plan observation is closed');return this.game;}

  readonly errors: string[] = [];
  private error(error:unknown) { this.errors.push(String(error)); console.error('AI plan observer failed',error); }
  get active() { return !!this.ledger; }
  subscribe(listener: (packet: AiPlanPacket) => void): () => void {
    if(!this.game)throw new Error('AI plan observation is closed');
    const session=++this.subscriptionSequence;
    // A reconnect gets the current baseline, never a guessed history of the time it missed.
    const from=this.active?Math.min(this.tick,...[...this.previous!.values()].map(t=>t.tick)):this.tick;
    const consumer=(packet:AiPlanPacket)=>{try{listener(packet.type==='coverage'?{...packet,session,from}
      :packet.type==='trace'?{...packet,session}:packet);}catch(error){this.listeners.delete(consumer);this.error(error);this.maybeStop();}};
    this.listeners.add(consumer);
    if (!this.active) this.start();
    else {
      consumer({type: 'coverage', session:this.session, from, to:null});
      for (const trace of this.previous!.values()) consumer(this.baseline(trace));
    }
    return () => { consumer({type:'coverage',session:this.session,from,to:this.tick}); this.listeners.delete(consumer); this.maybeStop(); };
  }
  record(enabled: boolean): void {
    if (enabled === this.isRecording) return;
    if(enabled&&!this.game)throw new Error('AI plan observation is closed');
    if (enabled) {
      this.recordingEnabled = true;this.recordingFrom = this.tick;
      this.recording = { packets: [], throughTick: this.tick };
      if (!this.active) this.start();
      else {
        this.recording.packets.push({type: 'coverage', session: this.session, from: this.tick, to: null});
        for (const trace of this.previous!.values()) this.recording.packets.push(this.baseline(trace));
      }
    } else { this.maybeStop(true); }
  }
  recordingData(): AiPlanRecording | undefined { return this.recording && structuredClone(this.recording); }
  private emit(packet: AiPlanPacket) {
    if (this.isRecording) this.recording!.packets.push(packet);
    for (const listener of this.listeners) { try { listener(packet); } catch(error) { this.error(error); } }
  }
  private baseline(trace:AiPlanTrace):AiPlanDelta{return {...diffAiPlan(undefined,trace,this.session),positions:this.positions?.get(trace.owner)??[]};}
  private start() {
    this.session++; this.from = this.tick; this.previous = new Map(); this.positions = new Map(); this.deathCount = 0;
    this.buildings = [...this.world.buildings];
    this.ledger = new AiDeathLedger(this.world, {owners: this.owners});
    this.executor?.observe?.(observation => this.think(observation));
    this.emit({type:'coverage', session:this.session, from:this.from, to:null});
  }
  private think({trace, context}: AiThinkObservation) {
    if (!this.ledger) return;
    this.ledger.recordThinkContext(context);
    const previous = this.previous!.get(trace.owner);
    const current = {...trace, previousTick: previous?.tick ?? null, changes: compareAiPlanTraces(previous, trace)};
    const allocated = new Set(trace.nodes.flatMap(n => n.resources.unitIds));
    for (const assignment of trace.strategy?.allocation?.assignments ?? []) allocated.add(assignment.unitId);
    const positions=context.units.filter(u=>allocated.has(u.id)).map(({id,x,y})=>({id,x,y}));
    this.positions!.set(trace.owner,positions);
    this.emit({...diffAiPlan(previous,current,this.session),positions});
    this.previous!.set(trace.owner, current);
  }
  /** Called after native simulation steps, only while subscribed or recording. */
  step() {
    if (!this.ledger) return;
    try { this.observeStep(); } catch(error) { this.error(error); this.stop(); }
  }
  private observeStep() {
    if (!this.ledger) return;
    const deaths = this.ledger.recordsFrom(this.deathCount);
    this.deathCount += deaths.length;
    const live = new Set(this.world.buildings.map(b => b.id));
    const buildings = this.buildings!.filter(b => b.hp <= 0 && !live.has(b.id)).map(b =>
      ({id:b.id, owner:b.owner, kind:b.kind, tick:this.tick, x:b.x, y:b.y}));
    this.buildings = [...this.world.buildings];
    if (deaths.length || buildings.length) this.emit({type:'events',tick:this.tick,deaths,buildings});
    if (this.isRecording) this.recording!.throughTick = this.tick;
  }
  private maybeStop(stopRecording = false) {
    if (stopRecording && this.recording) {
      this.recording.packets.push({type:'coverage', session:this.session, from:this.recordingFrom, to:this.tick});
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
    this.emit({type:'coverage',session:this.session,from:this.from,to:this.tick});
    this.executor?.observe?.(); this.ledger.dispose(); this.ledger = undefined;
    this.previous = undefined; this.positions=undefined; this.buildings = undefined;
  }
  dispose() { this.listeners.clear(); this.recordingEnabled = false; this.stop(); this.lastTick=this.tick; this.game=undefined; this.executor=undefined; }
}
