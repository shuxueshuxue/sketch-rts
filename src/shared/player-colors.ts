import type { Owner, PlayerId } from './types';

/** Match colors are allocated to seats, never hashed from their names. */
export const PLAYER_COLORS = [
  '#477b91', '#a85644', '#5d8b4c', '#7f3a70', '#b97927', '#2f766f',
  '#c56a32', '#409ba9', '#b7638f', '#899c43', '#625eaa', '#c4ab43',
  '#45a57d', '#a084ba', '#cf6a69', '#8d5a46', '#4365b0', '#ab4f9b',
  '#71a6b8', '#b7a476', '#56846f', '#9b6c59', '#6e769b', '#9a9e69',
] as const;
export const NEUTRAL_COLOR = '#704a33';
const DEFAULT_COLORS: Readonly<Record<string, string>> = {
  player: PLAYER_COLORS[0], enemy: PLAYER_COLORS[1], enemy2: PLAYER_COLORS[2],
  fleet: '#799199', crown: '#a45c4b',
};
export function validPlayerColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** Existing valid unique choices win in roster order. Invalid or conflicting
 * choices receive the next free color; colors repeat only after the palette
 * is exhausted. Keep the returned table in match state and saved snapshots. */
export function assignPlayerColors(ids: readonly PlayerId[], saved: Readonly<Record<string, string | undefined>> = {}): Record<PlayerId, string> {
  const roster = [...new Set(ids)], assigned: Record<PlayerId, string> = Object.create(null), used = new Set<string>();
  const assign = (id: PlayerId, color: string) => { assigned[id] = color; used.add(color); };
  for (const id of roster) {
    const color = saved[id];
    if (validPlayerColor(color) && !used.has(color.toLowerCase())) assign(id, color.toLowerCase());
  }
  // Familiar seats keep their identity even when custom seats come first.
  for (const id of roster) {
    const preferred = Object.hasOwn(DEFAULT_COLORS, id) ? DEFAULT_COLORS[id] : undefined;
    if (!assigned[id] && preferred && !used.has(preferred)) assign(id, preferred);
  }
  let reused = 0;
  for (const id of roster) if (!assigned[id]) assign(id, PLAYER_COLORS.find(color => !used.has(color)) ?? PLAYER_COLORS[reused++ % PLAYER_COLORS.length]!);
  return assigned;
}

type ColorSnapshot = { players: Readonly<Record<string, { color?: string }>> };
const fallbackTables = new WeakMap<ColorSnapshot['players'], Record<PlayerId, string>>();
/** Old snapshots receive the same deterministic roster allocation. Portraits
 * without a match keep conventional campaign/default-seat colors. */
export function playerColor(owner: Owner | undefined, snapshot?: ColorSnapshot): string {
  if (!owner || owner === 'neutral') return NEUTRAL_COLOR;
  if (snapshot && Object.hasOwn(snapshot.players, owner)) {
    let table = fallbackTables.get(snapshot.players);
    if (!table) {
      table = assignPlayerColors(Object.keys(snapshot.players), Object.fromEntries(Object.entries(snapshot.players).map(([id, player]) => [id, player.color])));
      fallbackTables.set(snapshot.players, table);
    }
    return table[owner]!;
  }
  return (Object.hasOwn(DEFAULT_COLORS, owner) ? DEFAULT_COLORS[owner] : undefined) ?? PLAYER_COLORS[0];
}
