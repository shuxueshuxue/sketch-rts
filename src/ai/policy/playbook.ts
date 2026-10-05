import type { BuildingKind, RaceId, TrainableUnitKind } from "../../shared/types";

export type ProductionBuildingKind = Exclude<BuildingKind, "townHall" | "farm" | "defenseTower" | "moonWell" | "emberShrine">;

type AiPlaybook = {
  productionPlan: ProductionBuildingKind[];
  unitsByBuilding: Partial<Record<ProductionBuildingKind, TrainableUnitKind[]>>;
};

const GROVE_PLAYBOOK: AiPlaybook = {
  productionPlan: ["barracks", "archeryRange", "stables", "sanctum"],
  unitsByBuilding: {
    barracks: ["footman", "lancer"],
    archeryRange: ["archer"],
    stables: ["knight", "raider", "horseArcher"],
    sanctum: ["priest", "summoner", "witch"],
    workshop: ["golem"],
  },
};

const EMBER_PLAYBOOK: AiPlaybook = {
  productionPlan: ["emberForge", "cinderSpire", "emberForge", "cinderSpire"],
  unitsByBuilding: {
    emberForge: ["emberRavager", "cinderRunner", "ashWarden"],
    cinderSpire: ["sparkArcher", "emberAcolyte", "ashHexer", "pyreCaller"],
  },
};

export function aiPlaybook(race: RaceId = "grove") {
  return race === "ember" ? EMBER_PLAYBOOK : GROVE_PLAYBOOK;
}
