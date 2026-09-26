import { resolveVariant, type UnitVariantDef, type UnitVariantStats } from "../shared/catalog";
import type { Game } from "../shared/sim";
import type { Text } from "./stage";

// @@@story-cast - A campaign's own units, each one value: its rules (a variant of a catalog unit, see unit-variants), its
// name, and its model. A model is a program, not a picture: a function that paints the unit around its feet with the
// same drawing kit the game's own units use (client/art/kit), so a campaign's beasts and heroes sit in the same sketched
// world. The renderer caches what it paints per team colour, as it does for every unit.

export type UnitPainter = (brush: CanvasRenderingContext2D, team: string) => void;

export type UnitModel = {
  paint: UnitPainter;
  // The shadow under it: a walker's, a rider's, a beast's, or a giant's.
  shadow?: "foot" | "mounted" | "beast" | "huge" | "none";
};

// How a hero grows (see rpg): the experience each level needs and what every level past the first adds.
export type HeroGrowth = {
  thresholds: readonly number[];
  perLevel: UnitVariantStats;
};

export type CastMember = {
  id: string;
  name: Text;
  rules: UnitVariantDef;
  model: UnitModel;
  // A named character's colour on its bubbles and nameplate.
  color?: string;
  hero?: HeroGrowth;
};

export function defineUnit<const M extends CastMember>(member: M): M {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(member.id)) throw new Error(`A campaign unit id is "<campaign>/<unit>", got "${member.id}"`);
  if (member.hero && !member.rules.heroic) throw new Error(`${member.id} grows as a hero, so its rules must be heroic`);
  return member;
}

export type CastBook = Readonly<Record<string, CastMember>>;

// A piece of scenery's painter (see stage props): drawn around its foot like a unit, once per state.
export type PropPainter = (brush: CanvasRenderingContext2D, state: string | undefined) => void;

// Registers the cast's variants in a game: from here on the game can field them.
export function enlist(game: Game, cast: CastBook) {
  game.variants ??= {};
  for (const member of Object.values(cast)) {
    if (game.variants[member.id]) continue;
    game.variants[member.id] = resolveVariant(member.rules);
  }
}

export function modelBook(cast: CastBook): (variant: string) => UnitModel | undefined {
  const byId = new Map(Object.values(cast).map((member) => [member.id, member.model]));
  return (variant) => byId.get(variant);
}
