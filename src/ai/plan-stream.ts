import type { AiPlanTrace, AiPlanNode } from './plan-trace';
import type { AiUnitDeathRecord } from './death-ledger-types';
import type { PlayerId } from '../shared/types';
import { applyPlanOutputDelta, diffPlanOutput, type PlanOutputDelta } from './plan-output-delta';
import type { StrategyPlanTrace } from './strategy/types';
import type { GoalPlannerOutput } from './strategy/goal-planner-types';

/** Output journal. Deltas are scoped to one owner and observation session, never to simulation state. */
export type AiPlanDelta = {
  type: 'trace'; session: number; owner: PlayerId; tick: number; baseTick: number | null;
  header: Partial<Omit<AiPlanTrace, 'nodes' | 'deathLedger'>> & Pick<AiPlanTrace,'tick'|'owner'>;
  upsert: AiPlanNode[]; remove: string[];
  removedHeader?: (keyof Omit<AiPlanTrace,'nodes'|'deathLedger'>)[];
  order?: string[];
  strategyDelta?: PlanOutputDelta;
  goalPlannerDelta?: PlanOutputDelta;
  positions?: {id:string;x:number;y:number}[];
};
export type AiPlanBuildingLoss = { id: string; owner: PlayerId; kind: string; tick: number; x: number; y: number };
export type AiPlanAudience = { kind: 'all' } | { kind: 'owner'; owner: PlayerId }
  | { kind: 'none'; reason?: 'after-match' };
export type AiPlanPacket = {type:'reset';tick:number} | AiPlanDelta
  | { type: 'events'; tick: number; deaths: AiUnitDeathRecord[]; buildings: AiPlanBuildingLoss[] }
  | { type: 'coverage'; session: number; from: number; to: number | null; availability?: 'after-match' };
export type AiPlanRecording = { packets: AiPlanPacket[]; throughTick: number };

export function diffAiPlan(previous: AiPlanTrace | undefined, trace: AiPlanTrace, session: number): AiPlanDelta {
  const before = new Map(previous?.nodes.map(n => [n.id, JSON.stringify(n)]));
  const ids = new Set(trace.nodes.map(n => n.id));
  const {nodes, deathLedger: _ledger, ...header} = trace;
  const removedHeader=previous?(Object.keys(previous) as (keyof AiPlanTrace)[]).filter(key=>key!=='nodes'&&key!=='deathLedger'&&!(key in header)) as NonNullable<AiPlanDelta['removedHeader']>:[];
  const patchStrategy = previous?.strategy && trace.strategy;
  const patchGoals = previous?.goalPlanner && trace.goalPlanner;
  const changedHeader = previous ? Object.fromEntries(Object.entries(header).filter(([key,value]) =>
    !(key === 'strategy' && patchStrategy)
    && !(key === 'goalPlanner' && patchGoals)
    && JSON.stringify(value) !== JSON.stringify(previous[key as keyof AiPlanTrace]))) : header;
  const strategyDelta = patchStrategy
    ? diffPlanOutput(previous.strategy, trace.strategy) : undefined;
  const goalPlannerDelta = patchGoals ? diffPlanOutput(previous.goalPlanner, trace.goalPlanner) : undefined;
  return { type: 'trace', session, owner: trace.owner, tick: trace.tick, baseTick: previous?.tick ?? null, header:{...changedHeader,tick:trace.tick,owner:trace.owner},
    ...(strategyDelta ? { strategyDelta } : {}),
    ...(goalPlannerDelta ? { goalPlannerDelta } : {}),
    ...(removedHeader.length?{removedHeader}:{}),
    ...(previous && JSON.stringify(previous.nodes.map(n=>n.id))!==JSON.stringify(nodes.map(n=>n.id)) ? {order:nodes.map(n=>n.id)} : {}),
    upsert: nodes.filter(n => before.get(n.id) !== JSON.stringify(n)), remove: [...before.keys()].filter(id => !ids.has(id)) };
}

/** A gap requires a new baseline. Never interpolate across unrecorded intervals. */
export function applyAiPlanDelta(previous: AiPlanTrace | undefined, delta: AiPlanDelta): AiPlanTrace | undefined {
  if (delta.baseTick !== null && (!previous || previous.tick !== delta.baseTick || previous.owner !== delta.owner)) return undefined;
  const nodes = new Map((delta.baseTick === null ? [] : previous!.nodes).map(n => [n.id, n]));
  for (const id of delta.remove) nodes.delete(id);
  for (const node of delta.upsert) nodes.set(node.id, node);
  const header = {...(delta.baseTick===null?{}:previous),...delta.header};
  for(const key of delta.removedHeader??[])delete (header as Record<string,unknown>)[key];
  if (delta.strategyDelta) {
    if (delta.baseTick === null || !previous?.strategy || delta.header.strategy
      || delta.removedHeader?.includes('strategy')) return undefined;
    const strategy = applyPlanOutputDelta(previous.strategy, delta.strategyDelta) as StrategyPlanTrace | undefined;
    if (!strategy || strategy.schemaVersion !== 1 || strategy.owner !== delta.owner || strategy.tick !== delta.tick) return undefined;
    header.strategy = strategy;
  }
  if (delta.goalPlannerDelta) {
    if (delta.baseTick === null || !previous?.goalPlanner || delta.header.goalPlanner
      || delta.removedHeader?.includes('goalPlanner')) return undefined;
    const goals = applyPlanOutputDelta(previous.goalPlanner, delta.goalPlannerDelta) as GoalPlannerOutput | undefined;
    if (!goals || goals.cache?.owner !== delta.owner || !Array.isArray(goals.plans)
      || goals.plans.some(plan => plan.goal.owner !== delta.owner)) return undefined;
    header.goalPlanner = goals;
  }
  if(header.schemaVersion!==1 || !header.roots || !header.bank || !header.changes || !header.limitations || !header.plannerVersion || !header.origin || header.previousTick===undefined)return undefined;
  return {...header, nodes:delta.order ? delta.order.flatMap(id=>nodes.has(id)?[nodes.get(id)!]:[]) : [...nodes.values()]} as AiPlanTrace;
}

export function filterAiPlanPacket(packet: AiPlanPacket, audience: AiPlanAudience): AiPlanPacket | undefined {
  if (audience.kind === 'none') return undefined;
  if (audience.kind === 'all' || packet.type === 'coverage' || packet.type === 'reset') return packet;
  const owner = audience.owner;
  if (packet.type === 'trace') return packet.owner === owner ? packet : undefined;
  const deaths = packet.deaths.filter(d => d.owner === owner), buildings = packet.buildings.filter(b => b.owner === owner);
  return deaths.length || buildings.length ? { ...packet, deaths, buildings } : undefined;
}
