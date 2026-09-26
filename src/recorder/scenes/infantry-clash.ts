import { sketchScene } from "../../sdk/scene";
import { block } from "../formation";
import { defineRecordingScene } from "../scene";

const MID_Y = 2048;
const NORTH_TARGET = { type: "attackMove", x: 2600, y: MID_Y } as const;
const SOUTH_TARGET = { type: "attackMove", x: 1500, y: MID_Y } as const;

// Two infantry lines with archers and casters behind them march into each other: melee, arrows, spell orbs.
export const infantryClash = defineRecordingScene({
  name: "infantry-clash",
  description: "Grove footmen, archers and priests against Ember ravagers, spark archers and acolytes.",
  createGame: () => {
    const scene = sketchScene("infantry-clash")
      .map("bareDuel")
      .replaceDefaults()
      .player("north", { team: "north", race: "grove" })
      .player("south", { team: "south", race: "ember" })
      .landmark("clash-road", "road", 2050, 2110, 1100, 0.08)
      .landmark("clash-grove", "grove", 2080, 1690, 260)
      .landmark("clash-ruin", "ruin", 1880, 2400, 160);
    block(scene, "north", "footman", 10, { x: 1800, y: MID_Y, facing: "east", ranks: 2, order: NORTH_TARGET });
    block(scene, "north", "archer", 5, { x: 1690, y: MID_Y, facing: "east", spacingY: 64, order: NORTH_TARGET });
    block(scene, "north", "priest", 2, { x: 1630, y: MID_Y, facing: "east", spacingY: 120, order: NORTH_TARGET });
    block(scene, "south", "emberRavager", 10, { x: 2300, y: MID_Y, facing: "west", ranks: 2, order: SOUTH_TARGET });
    block(scene, "south", "sparkArcher", 5, { x: 2410, y: MID_Y, facing: "west", spacingY: 64, order: SOUTH_TARGET });
    block(scene, "south", "emberAcolyte", 2, { x: 2470, y: MID_Y, facing: "west", spacingY: 120, order: SOUTH_TARGET });
    return scene.build().createGame();
  },
  defaults: { seconds: 14, camera: { type: "follow" } },
});
