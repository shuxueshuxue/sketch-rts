import { BUILDING_DEFS, RACE_DEFS, UPGRADE_DEFS, maxUpgradeLevel } from "../shared/catalog";
import type { Building, PlayerState, UpgradeKind } from "../shared/types";

export type ResearchCommandButton = {
  label: string;
  icon: string;
  hotkey: string;
  upgradeKind: UpgradeKind;
  buildingId: string;
};

export type ResearchProgressButton = ResearchCommandButton & {
  targetLevel: number;
  remaining: number;
  duration: number;
  progress: number;
  status: "researching" | "queued";
};

export const RESEARCH_COMMANDS = [
  { upgradeKind: "weaponTraining", label: "Weapon Training", icon: "⚔", hotkey: "w" },
  { upgradeKind: "reinforcedPlating", label: "Reinforced Plating", icon: "▣", hotkey: "p" },
  { upgradeKind: "buildingDurability", label: "Building Durability", icon: "▥", hotkey: "d" },
] satisfies Omit<ResearchCommandButton, "buildingId">[];

export function researchCommandButtonsForSelection(buildings: Building[], player: PlayerState | undefined): ResearchCommandButton[] {
  if (!player) return [];
  const raceUpgrades = RACE_DEFS[player.race].upgrades;
  return RESEARCH_COMMANDS.flatMap((command) => {
    if (!raceUpgrades.includes(command.upgradeKind)) return [];
    if ((player.upgrades[command.upgradeKind] ?? 0) >= maxUpgradeLevel(command.upgradeKind)) return [];
    const building = buildings.find((candidate) => canResearchAtBuilding(candidate, command.upgradeKind));
    return building ? [{ ...command, buildingId: building.id }] : [];
  });
}

export function researchProgressButtonsForSelection(buildings: Building[], player: PlayerState | undefined): ResearchProgressButton[] {
  if (!player) return [];
  const raceUpgrades = RACE_DEFS[player.race].upgrades;
  return buildings.flatMap((building) =>
    building.researchQueue.flatMap((job, index) => {
      if (!raceUpgrades.includes(job.upgradeKind)) return [];
      const command = RESEARCH_COMMANDS.find((candidate) => candidate.upgradeKind === job.upgradeKind);
      const duration = UPGRADE_DEFS[job.upgradeKind].levels[job.targetLevel - 1]?.researchTime ?? job.remaining;
      if (!command || duration <= 0) return [];
      return [{
        ...command,
        buildingId: building.id,
        targetLevel: job.targetLevel,
        remaining: job.remaining,
        duration,
        progress: Math.max(0, Math.min(1, 1 - job.remaining / duration)),
        status: index === 0 ? "researching" : "queued",
      }];
    }),
  );
}

function canResearchAtBuilding(building: Building, upgradeKind: UpgradeKind) {
  return (
    building.complete &&
    building.researchQueue.every((job) => job.upgradeKind !== upgradeKind) &&
    UPGRADE_DEFS[upgradeKind].buildingKind === building.kind &&
    BUILDING_DEFS[building.kind].researches.includes(upgradeKind)
  );
}
