import type { GameCommand, Unit } from "../shared/types";
import type { VeteranSkillId } from "../shared/veteran-skills";

export function canLearnVeteranSkill(unit: Unit) {
  return unit.hp > 0 && unit.level >= 3 && !unit.veteranSkill && unit.veteranSkillChoices?.length === 3;
}

/** Match the existing selection groups, including campaign variants. Never jump to another troop type. */
export function veteranPeers(selected: readonly Unit[], focusedId: string | undefined): Unit[] {
  const focused = selected.find(unit => unit.id === focusedId);
  return focused ? selected.filter(unit => unit.kind === focused.kind && unit.variant === focused.variant) : [];
}

/** The plus stays reachable when the group's first soldier has already learned, or has not reached three stars. */
export function veteranStudent(selected: readonly Unit[], focusedId: string | undefined, pending: ReadonlySet<string> = new Set()): Unit | undefined {
  const peers = veteranPeers(selected, focusedId);
  return peers.find(unit => unit.id === focusedId && canLearnVeteranSkill(unit) && !pending.has(unit.id))
    ?? peers.find(unit => canLearnVeteranSkill(unit) && !pending.has(unit.id));
}

export function nextVeteranStudent(selected: readonly Unit[], focusedId: string | undefined, pending: ReadonlySet<string> = new Set()): Unit | undefined {
  const peers = veteranPeers(selected, focusedId);
  const at = peers.findIndex(unit => unit.id === focusedId);
  return [...peers.slice(at + 1), ...peers.slice(0, at)]
    .find(unit => canLearnVeteranSkill(unit) && !pending.has(unit.id));
}

/** Learning always addresses one identified soldier, never the entire selection. */
export function learnVeteranSkillCommand(unit: Unit | undefined, skill: VeteranSkillId): Extract<GameCommand, { type: "learnVeteranSkill" }> | undefined {
  if (!unit || !canLearnVeteranSkill(unit) || !unit.veteranSkillChoices?.includes(skill)) return undefined;
  return { type: "learnVeteranSkill", unitId: unit.id, skill };
}
