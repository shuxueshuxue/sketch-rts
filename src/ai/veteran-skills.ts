import type { GameCommand, GameSnapshot, PlayerId } from "../shared/types";
import { checkCommandLegality } from "../shared/sim/command-validation";
import { VETERAN_SKILLS, type VeteranSkillId } from "../shared/veteran-skills";

type LearnCommand = Extract<GameCommand, { type: "learnVeteranSkill" }>;

// Deterministic preferences keep support skills useful without wasting every veteran on the same aura.
// Equal scores retain the offer order; neither planning nor opening a panel rerolls the choices.
const PREFERENCE: Record<VeteranSkillId, number> = {
  veteranHealingWave: 100, veteranInnerFire: 90, veteranRenewal: 85,
  veteranPhalanx: 80, veteranCommand: 75, veteranVigilance: 70,
  veteranRally: 65, veteranMarch: 60, veteranSteadyAim: 55, veteranSiegeDrill: 55,
  veteranEndurance: 50, veteranResilience: 40, veteranMobility: 30,
};

export function planVeteranSkillCommands(snapshot: GameSnapshot, owner: PlayerId): LearnCommand[] {
  const commands: LearnCommand[] = [];
  const representedAuras = new Set(snapshot.units
    .filter(unit => unit.owner === owner && unit.hp > 0 && unit.veteranSkill && VETERAN_SKILLS[unit.veteranSkill].effect.type === "aura")
    .map(unit => unit.veteranSkill!));
  for (const unit of snapshot.units) {
    if (unit.owner !== owner || unit.hp <= 0 || unit.veteranSkill || !unit.veteranSkillChoices) continue;
    const choices = unit.veteranSkillChoices.map((skill, index) => ({
      skill, index, score: PREFERENCE[skill] - (representedAuras.has(skill) ? 45 : 0),
    })).sort((left, right) => right.score - left.score || left.index - right.index);
    for (const choice of choices) {
      const command: LearnCommand = { type: "learnVeteranSkill", unitId: unit.id, skill: choice.skill };
      if (checkCommandLegality(snapshot, owner, command)) continue;
      commands.push(command);
      if (VETERAN_SKILLS[choice.skill].effect.type === "aura") representedAuras.add(choice.skill);
      break;
    }
  }
  return commands;
}
