import type { AiPlanTrace, AiPlanNode } from './plan-trace';
import type { AiUnitDeathRecord } from './death-ledger-types';
import type { PlayerId } from '../shared/types';

/** Output journal. Deltas are scoped to one owner and observation session, never to simulation state. */
export type AiPlanDelta = {
  type: 'trace'; session: number; owner: PlayerId; tick: number; baseTick: number | null;
  header: Omit<AiPlanTrace, 'nodes' | 'deathLedger'>;
  upsert: AiPlanNode[]; remove: string[];
  positions?: {id:string;x:number;y:number}[];
};
export type AiPlanBuildingLoss = { id: string; owner: PlayerId; kind: string; tick: number; x: number; y: number };
export type AiPlanPacket = {type:'reset';tick:number} | AiPlanDelta
  | { type: 'events'; tick: number; deaths: AiUnitDeathRecord[]; buildings: AiPlanBuildingLoss[] }
  | { type: 'coverage'; session: number; from: number; to: number | null };
export type AiPlanRecording = { packets: AiPlanPacket[]; throughTick: number };

export function diffAiPlan(previous: AiPlanTrace | undefined, trace: AiPlanTrace, session: number): AiPlanDelta {
  const before = new Map(previous?.nodes.map(n => [n.id, JSON.stringify(n)]));
  const ids = new Set(trace.nodes.map(n => n.id));
  const {nodes, deathLedger: _ledger, ...header} = trace;
  return { type: 'trace', session, owner: trace.owner, tick: trace.tick, baseTick: previous?.tick ?? null, header,
    upsert: nodes.filter(n => before.get(n.id) !== JSON.stringify(n)), remove: [...before.keys()].filter(id => !ids.has(id)) };
}

/** A gap requires a new baseline. Never interpolate across unrecorded intervals. */
export function applyAiPlanDelta(previous: AiPlanTrace | undefined, delta: AiPlanDelta): AiPlanTrace | undefined {
  if (delta.baseTick !== null && (!previous || previous.tick !== delta.baseTick || previous.owner !== delta.owner)) return undefined;
  const nodes = new Map((delta.baseTick === null ? [] : previous!.nodes).map(n => [n.id, n]));
  for (const id of delta.remove) nodes.delete(id);
  for (const node of delta.upsert) nodes.set(node.id, node);
  return { ...delta.header, nodes: [...nodes.values()] };
}

export function filterAiPlanPacket(packet: AiPlanPacket, owner?: PlayerId): AiPlanPacket | undefined {
  if (!owner || packet.type === 'coverage' || packet.type === 'reset') return packet;
  if (packet.type === 'trace') return packet.owner === owner ? packet : undefined;
  const deaths = packet.deaths.filter(d => d.owner === owner), buildings = packet.buildings.filter(b => b.owner === owner);
  return deaths.length || buildings.length ? { ...packet, deaths, buildings } : undefined;
}
