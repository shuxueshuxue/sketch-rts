import type { BuildingKind, TrainableUnitKind } from "../../shared/types";

export type ProductionBuildingKind = Exclude<BuildingKind, "townHall" | "farm" | "defenseTower" | "moonWell">;

type AiPlaybook = {
  productionPlan: ProductionBuildingKind[];
  barracksUnits: TrainableUnitKind[];
  stablesUnits: TrainableUnitKind[];
  sanctumUnits: TrainableUnitKind[];
};

const AI_PLAYBOOK: AiPlaybook = {
  productionPlan: ["barracks", "archeryRange", "stables", "sanctum"],
  barracksUnits: ["footman", "lancer"],
  stablesUnits: ["knight", "raider"],
  sanctumUnits: ["priest", "summoner", "witch"],
};

export function aiPlaybook() {
  return AI_PLAYBOOK;
}
