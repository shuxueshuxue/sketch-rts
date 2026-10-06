import type { GameSnapshot } from "../shared/types";

export type HealthBarState = { hp: number; maxHp: number; selected?: boolean; hovered?: boolean; engaged?: boolean; constructing?: boolean; still?: boolean; shipHull?: boolean };

// Hull durability lives in the selection HUD; floating hull bars obscure decks and rigging.
export function shouldShowHealthBar(state: HealthBarState) {
  return !state.shipHull && !state.still && state.hp > 0 && state.maxHp > 0 && Boolean(
    state.selected || state.hovered || state.engaged || state.constructing || state.hp < state.maxHp,
  );
}

export function healthBarColor(hp: number, maxHp: number) {
  const ratio = hp / Math.max(1, maxHp);
  return ratio > 0.5 ? "#90b781" : ratio > 0.25 ? "#e5b45f" : "#dc735c";
}

export function engagedEntityIds(snapshot: Pick<GameSnapshot, "units" | "buildings" | "effects" | "projectiles">) {
  const ids = new Set<string>();
  const targets = new Map([...snapshot.units, ...snapshot.buildings].map(entity => [entity.id, entity]));
  for (const unit of snapshot.units) {
    const order = unit.order;
    if (order.type === "attack" || order.type === "charge" || (order.type === "attackMove" && order.targetId)) {
      const target = order.targetId ? targets.get(order.targetId) : undefined;
      if (!target || Math.hypot(unit.x - target.x, unit.y - target.y) > unit.attackRange + target.radius + 100) continue;
      ids.add(unit.id);
      ids.add(target.id);
    }
  }
  for (const projectile of snapshot.projectiles) { ids.add(projectile.attackerId); ids.add(projectile.targetId); }
  for (const effect of snapshot.effects) if (effect.type === "hit" && effect.unitId) ids.add(effect.unitId);
  return ids;
}
