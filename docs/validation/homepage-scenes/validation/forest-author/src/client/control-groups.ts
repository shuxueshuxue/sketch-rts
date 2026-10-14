export type ControlGroups = Record<number, string[]>;
export type ControlGroupRecallTap = { slot: number; at: number };
export type ControlGroupEntityPosition = { id: string; x: number; y: number };

export const CONTROL_GROUP_DOUBLE_TAP_MS = 450;

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

export function controlGroupRecallTap(
  previous: ControlGroupRecallTap | undefined,
  slot: number,
  now: number,
  thresholdMs = CONTROL_GROUP_DOUBLE_TAP_MS,
) {
  return {
    shouldCenterCamera: previous?.slot === slot && now - previous.at <= thresholdMs,
    nextTap: { slot, at: now },
  };
}

export function controlGroupCenter(ids: string[], entities: Iterable<ControlGroupEntityPosition>) {
  const wanted = new Set(ids);
  let x = 0;
  let y = 0;
  let count = 0;
  for (const entity of entities) {
    if (!wanted.has(entity.id)) continue;
    x += entity.x;
    y += entity.y;
    count += 1;
  }
  if (count === 0) return undefined;
  return { x: x / count, y: y / count };
}
