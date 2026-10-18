import { ABILITY_KINDS, BUILDABLE_BUILDING_KINDS, BUILDING_DEFS, BUILDING_KINDS, RACE_DEFS, RACE_IDS, TRAINABLE_UNIT_KINDS, UNIT_DEFS, canResearchAt, canTrainAt } from "../shared/catalog";
import { aimingProfile } from "../shared/aiming";
import { SHIP_KINDS } from "../shared/ship-geometry";
import { SHOP_GOODS } from "../shared/shop";
import { isFortifiedTower } from "../shared/tower-garrison";
import type { AbilityKind, BuildingKind, RaceId, UnitKind } from "../shared/types";
import { VETERAN_ACTIVE_SKILL_IDS } from "../shared/veteran-skills";
import { ABILITY_CARDS } from "./content/abilities";
import { BUILDING_CARDS } from "./content/buildings";
import { TRAINED_UNIT_CARDS } from "./content/units";
import { RESEARCH_COMMANDS } from "./research-controls";

// @@@command-keys - Every command card button's key and the cards it can stand on, in one list
// (docs/engineering/hotkeys.zh.md). A key is the action's own letter and means the same on every card; bare letters
// belong to buttons alone, so no global action takes one. The card shows only what its entry allows, and the test
// walks every card: no two buttons on one card share a key, and every button has one or is listed in KEYLESS.

/** What the command card is showing: the focused group's own card, a site's, or an open sub-card. */
export type CommandCard =
  | { page: "unit"; kind: UnitKind; race: RaceId }
  | { page: "building"; kind: BuildingKind; race: RaceId }
  | { page: "shop" }
  | { page: "camp" }
  | { page: "palette"; palette: CommandPalette; race: RaceId };
export type CommandPalette = "build" | "stance" | "veteran" | "buy";

type Entry = { id: string; key: string; on: (card: CommandCard) => boolean };

/** Keys no button may take: they move the camera, recall groups, cycle the selection, or belong to chat and menu. */
export const GLOBAL_KEYS = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "1", "2", "3", "4", "5", "6", "7", "8", "9", "tab", "enter", "f10"]);

/** Buttons with no key, and why (docs/engineering/hotkeys.zh.md §3). */
export const KEYLESS: Record<string, string> = {
  veteranPassive: "a passive skill shows what the soldier learned; there is nothing to press",
};

const unitPage = (card: CommandCard): card is Extract<CommandCard, { page: "unit" }> => card.page === "unit";
const buildingPage = (card: CommandCard): card is Extract<CommandCard, { page: "building" }> => card.page === "building";
const palette = (name: CommandPalette) => (card: CommandCard) => card.page === "palette" && card.palette === name;
const naval = (kind: UnitKind) => SHIP_KINDS.includes(kind as never);
const veteranSkill = (ability: AbilityKind) => (VETERAN_ACTIVE_SKILL_IDS as readonly string[]).includes(ability);

const ENTRIES: Entry[] = [
  // Every unit card: the selection's own verbs.
  { id: "attackMove", key: "a", on: unitPage },
  { id: "unload", key: "d", on: unitPage },
  { id: "cabin", key: "e", on: unitPage },
  { id: "veteranLearn", key: "p", on: unitPage },
  { id: "veteranNext", key: "n", on: card => unitPage(card) || palette("veteran")(card) },
  { id: "stance", key: "z", on: unitPage },
  // A soldier learns one skill, so the focused unit has at most one veteran spell.
  { id: "veteranSkill", key: "v", on: unitPage },
  { id: "equipment", key: "i", on: card => unitPage(card) && !naval(card.kind) },
  { id: "hold", key: "i", on: card => unitPage(card) && naval(card.kind) },
  { id: "boarding", key: "g", on: card => unitPage(card) && naval(card.kind) },
  { id: "aim", key: "j", on: card => unitPage(card) && Boolean(aimingProfile(UNIT_DEFS[card.kind])) },
  { id: "build", key: "b", on: card => unitPage(card) && card.kind === "worker" },
  ...ABILITY_KINDS.filter(ability => !veteranSkill(ability)).map((ability): Entry => ({
    id: `cast:${ability}`, key: ABILITY_CARDS[ability].command.hotkey,
    on: card => unitPage(card) && (UNIT_DEFS[card.kind].abilities as readonly AbilityKind[]).includes(ability),
  })),
  // Sub-cards: an open one hides everything else.
  ...BUILDABLE_BUILDING_KINDS.map((kind): Entry => ({
    id: `build:${kind}`, key: BUILDING_CARDS[kind].command.hotkey,
    on: card => palette("build")(card) && card.page === "palette" && RACE_DEFS[card.race].buildableBuildings.includes(kind),
  })),
  { id: "stance:pursue", key: "z", on: palette("stance") },
  { id: "stance:brace", key: "j", on: palette("stance") },
  { id: "stance:shock", key: "x", on: palette("stance") },
  ...[0, 1, 2].map((index): Entry => ({ id: `veteranChoice:${index}`, key: "qwe"[index]!, on: palette("veteran") })),
  // A shipyard sells its guns from its own sub-card, in place order like a shop.
  ...(["shipCannon", "shipMortar", "flameProjector"] as const).map((kind, index): Entry => ({ id: `dock:${kind}`, key: "qwe"[index]!, on: palette("buy") })),
  { id: "back", key: "escape", on: card => card.page === "palette" },
  // Building cards.
  ...TRAINABLE_UNIT_KINDS.map((kind): Entry => ({
    id: `train:${kind}`, key: TRAINED_UNIT_CARDS[kind].command.hotkey,
    on: card => buildingPage(card) && canTrainAt(card.race, card.kind, kind),
  })),
  ...RESEARCH_COMMANDS.map((command): Entry => ({
    id: `research:${command.upgradeKind}`, key: command.hotkey,
    on: card => buildingPage(card) && RACE_DEFS[card.race].upgrades.includes(command.upgradeKind) && canResearchAt(card.race, card.kind, command.upgradeKind),
  })),
  ...BUILDING_KINDS.filter(kind => BUILDING_DEFS[kind].upgradeFrom).map((kind): Entry => ({
    id: `upgrade:${kind}`, key: BUILDING_CARDS[kind].command.hotkey,
    on: card => buildingPage(card) && BUILDING_DEFS[kind].upgradeFrom === card.kind,
  })),
  { id: "ungarrison", key: "u", on: card => buildingPage(card) && isFortifiedTower(card) },
  { id: "buy", key: "u", on: card => buildingPage(card) && card.kind === "shipyard" },
  // Sites: a row of goods goes by place.
  ...SHOP_GOODS.map((good, index): Entry => ({ id: `shop:${good.kind}`, key: "qwertyui"[index]!, on: card => card.page === "shop" })),
  { id: "recipient", key: "o", on: card => card.page === "shop" || palette("buy")(card) },
  { id: "hire", key: "m", on: card => card.page === "camp" },
];

const BY_ID = new Map(ENTRIES.map(entry => [entry.id, entry]));

export const COMMAND_KEYS: readonly Entry[] = ENTRIES;

/** The id a spell button is listed under: every veteran spell is the one "veteranSkill" button. */
export function castKeyId(ability: AbilityKind) {
  return veteranSkill(ability) ? "veteranSkill" : `cast:${ability}`;
}

/** A listed button's key; an id not in the list is a mistake and fails loudly. */
export function commandKey(id: string) {
  const entry = BY_ID.get(id);
  if (entry) return entry.key;
  if (id in KEYLESS) return "";
  throw new Error(`command button ${id} is not in COMMAND_KEYS`);
}

/** Whether a listed button may stand on this card; a keyless one goes by its own state alone. */
export function commandOnCard(id: string, card: CommandCard | undefined) {
  const entry = BY_ID.get(id);
  return !entry || Boolean(card && entry.on(card));
}

/**
 * The card the command dock shows. An open sub-card wins, then a selected site, then the focused group's own card:
 * with units and buildings selected together only the focused group's buttons show, so a building's keys never meet
 * the units' attack-move or unload.
 */
export function commandCardFor(state: { palette?: CommandPalette | undefined; shop?: boolean; camp?: boolean; focused?: { type: "unit"; kind: UnitKind } | { type: "building"; kind: BuildingKind } | undefined; race: RaceId }): CommandCard | undefined {
  if (state.palette) return { page: "palette", palette: state.palette, race: state.race };
  if (state.shop) return { page: "shop" };
  if (state.camp) return { page: "camp" };
  if (!state.focused) return undefined;
  return state.focused.type === "unit" ? { page: "unit", kind: state.focused.kind, race: state.race } : { page: "building", kind: state.focused.kind, race: state.race };
}

/** Every card the dock can show, for the test. */
export function allCommandCards(): CommandCard[] {
  return [
    { page: "shop" }, { page: "camp" },
    ...RACE_IDS.flatMap(race => [
      ...(Object.keys(UNIT_DEFS) as UnitKind[]).map((kind): CommandCard => ({ page: "unit", kind, race })),
      ...BUILDING_KINDS.map((kind): CommandCard => ({ page: "building", kind, race })),
      ...(["build", "stance", "veteran", "buy"] as const).map((palette): CommandCard => ({ page: "palette", palette, race })),
    ]),
  ];
}

/** The keys a card offers, by id. */
export function cardKeys(card: CommandCard) {
  return ENTRIES.filter(entry => entry.on(card)).map(entry => ({ id: entry.id, key: entry.key }));
}
