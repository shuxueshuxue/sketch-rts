import { defineCampaign } from "../../story/campaign";
import { CAST, GEAR } from "./cast";
import { ashwood } from "./chapters/ashwood";
import { grove } from "./chapters/grove";
import { outpost } from "./chapters/outpost";
import { pass } from "./chapters/pass";
import { prologue } from "./chapters/prologue";
import { reedholm } from "./chapters/reedholm";
import { respite } from "./chapters/respite";
import { densest, EMBER, HERO_IDS, onLevel, PLAYER, WILD, type Vars } from "./common";
import { pilot } from "./pilot";
import { ashenWorld } from "./places";
import { SCENERY } from "./scenery";

// @@@ashen-march - 《灰烬边境》 The Ashen March: a Grove campaign in six chapters and an interlude, written with the story toolkit (story/).
// A warden captain, an old sergeant, a fen herbalist and an Ember deserter cross the atlas from a border patrol to the
// Old Grove, through a burning village, a rebuilt outpost, a camp in the ash wood and a mountain pass. Five choices
// along the way change who stands at the end and how it ends.
export const ASHEN_MARCH = defineCampaign<Vars>({
  id: "ashen-march",
  title: { zh: "灰烬边境", en: "The Ashen March" },
  player: PLAYER,
  cast: CAST,
  scenery: SCENERY,
  gear: GEAR,
  vars: () => ({ heroes: {}, choices: {}, villagersSaved: 0, villagersLost: 0, asheSaved: false, refugeesThrough: 0, duFell: false }),
  world: ashenWorld,
  chapters: [prologue, reedholm, outpost, ashwood, respite, pass, grove],
  onLevel: (story, hero, level) => onLevel(story, hero.unitId, level),
  pilot,
  // The camera rests on the heart of the wardens' army (heroes count thrice), drawn part of the way toward the fight
  // around it, so the heroes and what they are fighting share the frame.
  focus: (snapshot) => {
    const own = snapshot.units.filter((unit) => unit.owner === PLAYER && unit.kind !== "worker");
    const weighted = own.flatMap((unit) => (Object.values(HERO_IDS).includes(unit.id) ? [unit, unit, unit] : [unit]));
    const heart = densest(weighted, 550);
    if (!heart) return undefined;
    const near = (unit: { x: number; y: number }, radius: number) => Math.hypot(unit.x - heart.x, unit.y - heart.y) < radius;
    const foes = snapshot.units.filter((unit) => (unit.owner === EMBER || unit.owner === WILD) && near(unit, 650));
    const friends = weighted.filter((unit) => near(unit, 550));
    const cx = friends.reduce((sum, unit) => sum + unit.x, 0) / friends.length;
    const cy = friends.reduce((sum, unit) => sum + unit.y, 0) / friends.length;
    if (foes.length === 0) return { x: cx, y: cy };
    const fx = foes.reduce((sum, unit) => sum + unit.x, 0) / foes.length;
    const fy = foes.reduce((sum, unit) => sum + unit.y, 0) / foes.length;
    return { x: cx + (fx - cx) * 0.4, y: cy + (fy - cy) * 0.4 };
  },
});
