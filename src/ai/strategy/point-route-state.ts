import { deflateSync, inflateSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { ShipRouteSearchState } from '../../shared/ship-navigation';

export type StoredShipRouteSearchState = ShipRouteSearchState | Readonly<{
  encoding: 'native-graph-deflate-v1'; data: string;
}>;

type Header = { state: ShipRouteSearchState; count: number; values: number[] };
const zigzag = (value: number) => value >= 0 ? value * 2 : -value * 2 - 1;
const unzigzag = (value: number) => value % 2 ? -(value + 1) / 2 : value / 2;

/** Only the strategy continuation is encoded. Native search receives the
 * original graph values, including frontier order and every pose/float. Node
 * rows are a lookup map: canonical ID order compresses their sparse IDs and
 * parent edges without changing the separately retained native heap order.
 * Costs use an exact parent delta only when addition recovers the original
 * double; otherwise the original absolute double is retained. The
 * same resident byte limit applies to this carrier; an oversized search still
 * reports its explicit memory pressure rather than dropping graph records. */
export function storeShipRouteSearchState(state: ShipRouteSearchState): StoredShipRouteSearchState {
  const json = JSON.stringify(state);
  if (json.length < 1024 || state.phase === 'done') return state;
  const nodes = [...(state.nodes ?? [])].sort((a, b) => a.id - b.id), lookup = new Map(nodes.map(node => [node.id, node]));
  const values: number[] = [], indices = new Map<number, number>(), columns: number[][] = [[], [], []];
  let previous = 0;
  for (const node of nodes) {
    const base = lookup.get(node.parent)?.cost ?? 0, delta = node.cost - base;
    const absolute = base + delta !== node.cost, value = absolute ? node.cost : delta;
    let index = indices.get(value);
    if (index === undefined) { index = values.length; indices.set(value, index); values.push(value); }
    columns[0]!.push(node.id - previous);
    columns[1]!.push(node.parent < 0 ? 0 : zigzag(node.parent - node.id) + 1);
    columns[2]!.push(index * 2 + Number(absolute)); previous = node.id;
  }
  const { nodes: _nodes, ...rest } = state;
  const header: Header = { state: rest, count: nodes.length, values };
  const data: number[] = [];
  const put = (number: number) => {
    do { const byte = number % 128; number = Math.floor(number / 128); data.push(byte | (number ? 128 : 0)); } while (number);
  };
  const metadata = new TextEncoder().encode(JSON.stringify(header));
  put(metadata.length); for (const byte of metadata) data.push(byte);
  for (const column of columns) for (const number of column) put(number);
  const compressed = deflateSync(Uint8Array.from(data), { level: 9 });
  let binary = '';
  for (const byte of compressed) binary += String.fromCharCode(byte);
  const packed = { encoding: 'native-graph-deflate-v1' as const, data: btoa(binary) };
  return JSON.stringify(packed).length < json.length ? packed : state;
}

export function restoreShipRouteSearchState(state: StoredShipRouteSearchState): ShipRouteSearchState {
  if (!('encoding' in state)) return state;
  const bytes = Uint8Array.from(atob(state.data), character => character.charCodeAt(0));
  const data = inflateSync(bytes); let at = 0;
  const take = () => {
    let value = 0, weight = 1, byte: number;
    do {
      if (at >= data.length || weight > Number.MAX_SAFE_INTEGER / 128) throw Error('Invalid native route continuation');
      byte = data[at++]!; value += (byte & 127) * weight; weight *= 128;
    } while (byte & 128);
    return value;
  };
  const length = take();
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(at, at + length))) as Header;
  at += length;
  const nodes: NonNullable<ShipRouteSearchState['nodes']> = [];
  let id = 0;
  for (let index = 0; index < header.count; index++) { id += take(); nodes.push({ id, parent: -1, cost: 0 }); }
  for (const node of nodes) { const edge = take(); node.parent = edge ? node.id + unzigzag(edge - 1) : -1; }
  const codes = new Map<number, number>(nodes.map(node => [node.id, take()]));
  const lookup = new Map(nodes.map(node => [node.id, node])), resolved = new Set<number>();
  for (const node of nodes) {
    const path: typeof nodes = []; let current = node;
    while (!resolved.has(current.id)) {
      path.push(current);
      if (path.length > nodes.length) throw Error('Cyclic native route continuation');
      const code = codes.get(current.id)!;
      if (current.parent < 0 || code % 2) break;
      const parent = lookup.get(current.parent);
      if (!parent) throw Error('Missing native route parent');
      current = parent;
    }
    for (const row of path.reverse()) {
      const code = codes.get(row.id)!, value = header.values[Math.floor(code / 2)];
      if (value === undefined) throw Error('Missing native route cost');
      row.cost = (code % 2 ? 0 : lookup.get(row.parent)?.cost ?? 0) + value; resolved.add(row.id);
    }
  }
  if (at !== data.length) throw Error('Trailing native route continuation');
  return { ...header.state, ...(nodes.length ? { nodes } : {}) };
}
