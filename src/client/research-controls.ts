import { BUILDING_DEFS, MAX_UPGRADE_LEVEL, RACE_DEFS, UPGRADE_DEFS } from "../shared/catalog";
import type { Building, PlayerState, UpgradeKind } from "../shared/types";

export type ResearchCommandButton = {
  label: string;
  icon: string;
  hotkey: string;
  upgradeKind: UpgradeKind;
  buildingId: string;
};

export const RESEARCH_COMMANDS = [
  { upgradeKind: "weaponTraining", label: "Weapon Training", icon: "⚔", hotkey: "w" },
  { upgradeKind: "reinforcedPlating", label: "Reinforced Plating", icon: "▣", hotkey: "p" },
] satisfies Omit<ResearchCommandButton, "buildingId">[];

export function researchCommandButtonsForSelection(buildings: Building[], player: PlayerState | undefined): ResearchCommandButton[] {
  if (!player) return [];
  const raceUpgrades = RACE_DEFS[player.race].upgrades;
  return RESEARCH_COMMANDS.flatMap((command) => {
    if (!raceUpgrades.includes(command.upgradeKind)) return [];
    if ((player.upgrades[command.upgradeKind] ?? 0) >= MAX_UPGRADE_LEVEL) return [];
    const building = buildings.find((candidate) => canResearchAtBuilding(candidate, command.upgradeKind));
    return building ? [{ ...command, buildingId: building.id }] : [];
  });
}

function canResearchAtBuilding(building: Building, upgradeKind: UpgradeKind) {
  return (
    building.complete &&
    building.researchQueue.every((job) => job.upgradeKind !== upgradeKind) &&
    UPGRADE_DEFS[upgradeKind].buildingKind === building.kind &&
    BUILDING_DEFS[building.kind].researches.includes(upgradeKind)
  );
}
