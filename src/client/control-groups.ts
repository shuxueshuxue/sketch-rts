export type ControlGroups = Record<number, string[]>;

export function replaceControlGroup(groups: ControlGroups, slot: number, selectedIds: Set<string>) {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  groups[slot] = ids;
}

export function recallControlGroup(groups: ControlGroups, slot: number, liveIds: Set<string>) {
  return (groups[slot] ?? []).filter((id) => liveIds.has(id));
}

export function pruneControlGroups(groups: ControlGroups, liveIds: Set<string>) {
  for (const key of Object.keys(groups)) {
    const slot = Number(key);
    groups[slot] = recallControlGroup(groups, slot, liveIds);
    if (groups[slot].length === 0) delete groups[slot];
  }
}
