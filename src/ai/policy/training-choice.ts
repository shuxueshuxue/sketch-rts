import { UNIT_DEFS } from "../../shared/catalog";
import type { Building, GameSnapshot, PlayerId, TrainableUnitKind } from "../../shared/types";
import { combatUnits, completeBuildings, units } from "./snapshot";
import { aiPlaybook } from "./playbook";
import { playerState } from "./world-model";
import type { PresetAiPolicyOptions } from "./types";

export function trainingChoice(snapshot: GameSnapshot, owner: PlayerId, building: Building, options: PresetAiPolicyOptions = {}): TrainableUnitKind | undefined {
  const race = playerState(snapshot, owner).race;
  if (building.kind === "emberForge") return emberForgeChoice(snapshot, owner);
  if (building.kind === "cinderSpire") return emberSpireChoice(snapshot, owner, options);
  if (building.kind === "barracks") return soldierChoice(snapshot, owner);
  if (building.kind === "archeryRange") return "archer";
  if (building.kind === "stables") {
    const knights = units(snapshot, owner).filter((unit) => unit.kind === "knight").length;
    const raiders = units(snapshot, owner).filter((unit) => unit.kind === "raider").length;
    const preferred = aiPlaybook(race).unitsByBuilding.stables?.[0] ?? "raider";
    if (preferred === "raider" && raiders < 3) return "raider";
    return knights < 2 && shouldTrainKnight(snapshot, owner, options) ? "knight" : "raider";
  }
  if (building.kind === "sanctum") {
    const priests = units(snapshot, owner).filter((unit) => unit.kind === "priest").length;
    const summoners = units(snapshot, owner).filter((unit) => unit.kind === "summoner").length;
    const witches = units(snapshot, owner).filter((unit) => unit.kind === "witch").length;
    const casterTarget = v2LateCasterTarget(snapshot, owner, options);
    if (shouldPrioritizeWoundedPriestTraining(snapshot, owner, options) && priests < casterTarget.priests) return "priest";
    if (priests < 1 && casterTarget.priests > 0) return "priest";
    if (summoners < 1 && casterTarget.summoners > 0) return "summoner";
    if (witches < 1 && casterTarget.witches > 0) return "witch";
    if (casterTarget.summoners > 1 && priests >= 1 && summoners >= 1 && witches >= 1) {
      if (summoners < casterTarget.summoners) return "summoner";
      if (witches < casterTarget.witches) return "witch";
      if (priests < casterTarget.priests) return "priest";
    }
    const sanctumUnits = aiPlaybook(race).unitsByBuilding.sanctum ?? ["priest", "summoner", "witch"];
    for (const kind of sanctumUnits) {
      if (kind === "priest" && priests < casterTarget.priests) return "priest";
      if (kind === "summoner" && summoners < casterTarget.summoners) return "summoner";
      if (kind === "witch" && witches < casterTarget.witches) return "witch";
    }
    return sanctumUnits[0] ?? "priest";
  }
  if (building.kind === "workshop") return "golem";
  return undefined;
}

function emberForgeChoice(snapshot: GameSnapshot, owner: PlayerId): TrainableUnitKind {
  const army = combatUnits(snapshot, owner);
  const ravagers = army.filter((unit) => unit.kind === "emberRavager").length;
  const runners = army.filter((unit) => unit.kind === "cinderRunner").length;
  if (ravagers < 2) return "emberRavager";
  if (runners < Math.max(1, Math.ceil(ravagers / 2))) return "cinderRunner";
  return ravagers <= runners ? "emberRavager" : "cinderRunner";
}

function emberSpireChoice(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): TrainableUnitKind {
  const army = combatUnits(snapshot, owner);
  const sparkArchers = army.filter((unit) => unit.kind === "sparkArcher").length;
  const acolytes = army.filter((unit) => unit.kind === "emberAcolyte").length;
  const hexers = army.filter((unit) => unit.kind === "ashHexer").length;
  const callers = army.filter((unit) => unit.kind === "pyreCaller").length;
  const supportTarget = options.version === "v2" && army.length >= 8 ? 2 : 1;
  if (sparkArchers < 1) return "sparkArcher";
  if (shouldPrioritizeWoundedPriestTraining(snapshot, owner, options) && acolytes < supportTarget) return "emberAcolyte";
  if (acolytes < 1) return "emberAcolyte";
  if (hexers < 1) return "ashHexer";
  if (callers < 1) return "pyreCaller";
  if (options.version === "v2" && callers < supportTarget) return "pyreCaller";
  if (options.version === "v2" && hexers < supportTarget) return "ashHexer";
  if (sparkArchers < army.length / 3) return "sparkArcher";
  return "emberAcolyte";
}

function shouldTrainKnight(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  const gold = playerState(snapshot, owner).gold;
  if (gold > 520) return true;
  if (options.version !== "v2") return false;
  return completeBuildings(snapshot, owner, "townHall").length >= 2 && combatUnits(snapshot, owner).length >= 10 && gold >= UNIT_DEFS.knight.cost;
}

export function shouldPrioritizeWoundedPriestTraining(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions = {}) {
  if (options.version !== "v2") return false;
  const healers = units(snapshot, owner).filter((unit) => unit.kind === "priest" || unit.kind === "emberAcolyte" || unit.kind === "fieldMedic").length;
  if (healers >= 2) return false;
  return combatUnits(snapshot, owner).filter((unit) => unit.kind !== "priest" && unit.kind !== "fieldMedic" && unit.hp < unit.maxHp * 0.62).length >= 3;
}

function v2LateCasterTarget(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions) {
  if (options.version !== "v2") return { priests: 1, summoners: 1, witches: 1 };
  const army = combatUnits(snapshot, owner);
  const gold = playerState(snapshot, owner).gold;
  if (army.length < 8 && gold < 480) return { priests: 1, summoners: 1, witches: 1 };
  return { priests: 2, summoners: 2, witches: 2 };
}

export function soldierChoice(snapshot: GameSnapshot, owner: PlayerId): TrainableUnitKind {
  if (playerState(snapshot, owner).race === "ember") return emberForgeChoice(snapshot, owner);
  const army = combatUnits(snapshot, owner);
  const footmen = army.filter((unit) => unit.kind === "footman").length;
  const lancers = army.filter((unit) => unit.kind === "lancer").length;
  if (footmen < 2) return "footman";
  if (lancers < Math.ceil(footmen / 2)) return "lancer";
  return "footman";
}
