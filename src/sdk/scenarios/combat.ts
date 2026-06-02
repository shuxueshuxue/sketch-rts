import { sketchScene } from "../scene";
import type { GameSetupOptions, ItemKind, MapId, PlayerId, UnitKind } from "../../shared/types";

export type CombatScenarioLabel = "15v20" | "10v12";

export type CombatScenarioRecipe = {
  name: string;
  slug: string;
  units: UnitKind[];
  itemLoadout: [ItemKind, number][];
  v1ItemLoadout: [ItemKind, number][];
  columns: number;
  xSpacing: number;
  ySpacing: number;
  yOffset: number;
  xp?: (index: number) => number;
};

export type CombatScenarioSetup = {
  mapId: MapId;
  options: GameSetupOptions;
  recipe: CombatScenarioRecipe;
  v2Count: number;
  v1Count: number;
};

export const COMBAT_SCENARIO_RECIPES: CombatScenarioRecipe[] = [
  {
    name: "early mixed",
    slug: "early-mixed",
    units: ["footman", "footman", "lancer", "archer", "raider", "archer"],
    itemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 2],
      ["lightningRod", 4],
      ["breachCharge", 5],
    ],
    v1ItemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 2],
      ["lightningRod", 4],
      ["breachCharge", 5],
    ],
    columns: 5,
    xSpacing: 38,
    ySpacing: 46,
    yOffset: 0,
  },
  {
    name: "ranged casters",
    slug: "ranged-casters",
    units: ["archer", "contractArcher", "priest", "summoner", "witch", "archer", "fieldMedic", "lancer"],
    itemLoadout: [
      ["stormStaff", 1],
      ["guardianScroll", 2],
      ["lightningRod", 4],
      ["experienceBook", 5],
    ],
    v1ItemLoadout: [
      ["stormStaff", 1],
      ["guardianScroll", 2],
      ["lightningRod", 4],
    ],
    columns: 4,
    xSpacing: 34,
    ySpacing: 58,
    yOffset: -70,
  },
  {
    name: "high-star heavy",
    slug: "high-star-heavy",
    units: ["knight", "golem", "groveWarden", "summoner", "witch", "priest", "raider", "archer", "lancer", "footman"],
    itemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 3],
      ["stormStaff", 4],
      ["lightningRod", 7],
      ["experienceBook", 8],
    ],
    v1ItemLoadout: [
      ["flameCloak", 0],
      ["guardianScroll", 3],
      ["stormStaff", 4],
      ["lightningRod", 7],
    ],
    columns: 6,
    xSpacing: 42,
    ySpacing: 42,
    yOffset: 64,
    xp: (index) => (index % 5 === 0 ? 260 : index % 3 === 0 ? 130 : index % 2 === 0 ? 60 : 0),
  },
  {
    name: "frontline healers",
    slug: "frontline-healers",
    units: ["footman", "footman", "lancer", "fieldMedic", "priest", "archer", "mercenary", "raider"],
    itemLoadout: [
      ["guardianScroll", 0],
      ["flameCloak", 1],
      ["stormStaff", 4],
      ["lightningRod", 5],
    ],
    v1ItemLoadout: [
      ["guardianScroll", 0],
      ["flameCloak", 1],
      ["stormStaff", 4],
    ],
    columns: 4,
    xSpacing: 48,
    ySpacing: 50,
    yOffset: 36,
    xp: (index) => (index % 4 === 0 ? 80 : 0),
  },
  {
    name: "ranged spread",
    slug: "ranged-spread",
    units: ["archer", "archer", "contractArcher", "witch", "summoner", "fieldMedic", "lancer", "footman"],
    itemLoadout: [
      ["stormStaff", 0],
      ["lightningRod", 2],
      ["guardianScroll", 5],
      ["experienceBook", 6],
    ],
    v1ItemLoadout: [
      ["stormStaff", 0],
      ["lightningRod", 2],
      ["guardianScroll", 5],
    ],
    columns: 5,
    xSpacing: 30,
    ySpacing: 70,
    yOffset: -104,
    xp: (index) => (index % 6 === 0 ? 140 : 0),
  },
];

export function createCombatScenarioSetup(input: { label: CombatScenarioLabel; recipeSlug?: string; v2Owner?: PlayerId; v1Owner?: PlayerId }): CombatScenarioSetup {
  const recipe = combatScenarioRecipe(input.recipeSlug ?? "early-mixed");
  const { v2Count, v1Count } = combatScenarioCounts(input.label);
  const v2Owner = input.v2Owner ?? "v2";
  const v1Owner = input.v1Owner ?? "v1a";
  const scene = sketchScene(`playtest-${input.label}-${recipe.slug}-combat`)
    .map("combatArena")
    .replaceDefaults()
    .player(v2Owner, { team: "north", race: "grove" })
    .player(v1Owner, { team: "south", race: "grove" })
    .townHall(v2Owner, 150, 800, { id: "combat-v2-anchor" })
    .townHall(v1Owner, 1450, 800, { id: "combat-v1-anchor" });
  addCombatArmy(scene, v2Owner, recipe, v2Count, 520, 800, 1);
  addCombatArmy(scene, v1Owner, recipe, v1Count, 1080, 800, -1);
  addCombatItems(scene, v2Owner, v2Count, recipe.itemLoadout);
  addCombatItems(scene, v1Owner, v1Count, recipe.v1ItemLoadout);
  return { mapId: "combatArena", options: scene.toGameSetup(), recipe, v2Count, v1Count };
}

export function combatScenarioRecipe(slug: string) {
  const recipe = COMBAT_SCENARIO_RECIPES.find((candidate) => candidate.slug === slug);
  if (!recipe) throw new Error(`Unknown combat scenario recipe ${slug}`);
  return recipe;
}

function combatScenarioCounts(label: CombatScenarioLabel) {
  if (label === "15v20") return { v2Count: 15, v1Count: 20 };
  if (label === "10v12") return { v2Count: 10, v1Count: 12 };
  return assertNever(label);
}

function addCombatArmy(scene: ReturnType<typeof sketchScene>, owner: PlayerId, recipe: CombatScenarioRecipe, count: number, centerX: number, centerY: number, direction: 1 | -1) {
  for (let index = 0; index < count; index += 1) {
    const column = index % recipe.columns;
    const row = Math.floor(index / recipe.columns);
    scene.unit(owner, combatUnitKind(recipe, index), centerX - direction * row * recipe.xSpacing, centerY + recipe.yOffset + (column - (recipe.columns - 1) / 2) * recipe.ySpacing, { id: combatUnitId(owner, index), ...(recipe.xp ? { xp: recipe.xp(index) } : {}) });
  }
}

function combatUnitKind(recipe: CombatScenarioRecipe, index: number): UnitKind {
  return recipe.units[index % recipe.units.length]!;
}

function addCombatItems(scene: ReturnType<typeof sketchScene>, owner: PlayerId, unitCount: number, loadout: [ItemKind, number][]) {
  for (const [kind, carrierIndex] of loadout) {
    if (carrierIndex >= unitCount) continue;
    scene.item(`combat-${owner}-${kind}-${carrierIndex}`, kind, 0, 0, { carrierId: combatUnitId(owner, carrierIndex) });
  }
}

function combatUnitId(owner: PlayerId, index: number) {
  return `combat-${owner}-unit-${index + 1}`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled combat scenario label ${JSON.stringify(value)}`);
}
