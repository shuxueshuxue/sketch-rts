import type { BuildingKind, RaceId, TrainableUnitKind } from "../../shared/types";
import type { PresetAiPolicyOptions } from "./types";
import { isV6Policy } from "./versions";

export type ProductionBuildingKind = Exclude<BuildingKind, "townHall" | "farm" | "defenseTower" | "moonWell" | "emberShrine">;

type AiPlaybook = {
  productionPlan: ProductionBuildingKind[];
  unitsByBuilding: Partial<Record<ProductionBuildingKind, TrainableUnitKind[]>>;
};

const GROVE_PLAYBOOK: AiPlaybook = {
  productionPlan: ["barracks", "archeryRange", "stables", "sanctum"],
  unitsByBuilding: {
    barracks: ["footman", "lancer", "groveWarden"],
    archeryRange: ["archer"],
    stables: ["knight", "raider"],
    sanctum: ["priest", "summoner", "witch"],
    workshop: ["golem"],
  },
};

const EMBER_PLAYBOOK: AiPlaybook = {
  productionPlan: ["emberForge", "cinderSpire", "emberForge", "cinderSpire"],
  unitsByBuilding: {
    emberForge: ["emberRavager", "cinderRunner"],
    cinderSpire: ["sparkArcher", "emberAcolyte", "ashHexer", "pyreCaller"],
  },
};

// @@@v6-summoner-core - V6 trains no shooters. Its army is summoners (Grove) or pyre callers (Ember) keeping their spirits
// up; replayed on V6's worst fights at equal gold, that army traded 2.6 to 1 where any melee army traded 0.2-0.35 and even
// the archers V6 may not train traded 0.9. Melee mixed in only diluted it, so the plan is the caster building alone.
const V6_GROVE_PLAYBOOK: AiPlaybook = {
  productionPlan: ["sanctum"],
  unitsByBuilding: { sanctum: ["summoner"] },
};

const V6_EMBER_PLAYBOOK: AiPlaybook = {
  productionPlan: ["cinderSpire"],
  unitsByBuilding: { cinderSpire: ["pyreCaller"] },
};

export function v6SummonerBuildingKind(race: RaceId) {
  return race === "ember" ? "cinderSpire" : "sanctum";
}

export function aiPlaybook(race: RaceId = "grove", options: PresetAiPolicyOptions = {}) {
  if (isV6Policy(options)) return race === "ember" ? V6_EMBER_PLAYBOOK : V6_GROVE_PLAYBOOK;
  return race === "ember" ? EMBER_PLAYBOOK : GROVE_PLAYBOOK;
}
