import { CAPITAL_MODELS } from "./art/model-manifest";

// @@@prop-stands - Every kind of prop declares how it meets the ground (docs/art/render-contract.zh.md, rule 1): it
// stands (it hides what stands behind it and is hidden by what stands before, by its foot; see @@@standing-field) or it
// lies flat (a ground mark under everything that stands). A prop's foot is the point its scene sets it at.
export type PropStand = "standing" | "ground";

export const PROP_STANDS: Readonly<Record<string, PropStand>> = {
  // The shared scenery (art/scenery.ts) and the menu's own (menu-scenes.ts).
  target: "standing", beacon: "standing", hut: "standing", boat: "standing", dock: "ground", campfire: "standing",
  cart: "standing", reeds: "standing", fence: "standing", watchtower: "standing", tent: "standing", banner: "standing",
  stone: "standing", cairn: "standing", pyre: "standing", bridge: "ground", tree: "standing", deadTree: "standing",
  ashPile: "ground", crate: "standing", well: "standing", grave: "standing", statue: "standing", runestone: "standing",
  citadel: "standing",
  // The Ashen March's (campaigns/ashen-march/scenery.ts).
  heartwood: "standing",
  // The capital street's (menu-capital-street.ts): its houses and furniture are models (see @@@capital-models); its
  // paving and drains lie in the street.
  ...Object.fromEntries(CAPITAL_MODELS.map(kind => [kind, "standing" as const])),
  "capital-paving": "ground", "capital-drain": "ground",
};

/** How a prop kind meets the ground; a kind that never declared it is an error, not a guess. */
export function propStand(kind: string): PropStand {
  const stand = PROP_STANDS[kind];
  if (!stand) throw new Error(`Prop kind "${kind}" declares neither standing nor ground (see @@@prop-stands)`);
  return stand;
}
