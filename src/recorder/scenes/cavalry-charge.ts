import { sketchScene } from "../../sdk/scene";
import { block } from "../formation";
import { defineRecordingScene } from "../scene";

const MID_Y = 2048;

// A Grove cavalry wing rides at an Ember infantry line. Nobody is told to charge: the riders only attack-move, and each
// one's charge goes off on its own (autocast) as an enemy comes inside 300-500; the two lines then fight it out.
export const cavalryCharge = defineRecordingScene({
  name: "cavalry-charge",
  description: "Grove raiders and knights attack-move into an Ember infantry line; their charges go off on their own, then the melee.",
  createGame: () => {
    const scene = sketchScene("cavalry-charge")
      .map("bareDuel")
      .replaceDefaults()
      .player("north", { team: "north", race: "grove" })
      .player("south", { team: "south", race: "ember" })
      .landmark("charge-road", "road", 1900, 2330, 1400, -0.06)
      .landmark("charge-ridge", "ridge", 1950, 1700, 320);
    const ride = { type: "attackMove", x: 2900, y: MID_Y } as const;
    const hold = { type: "attackMove", x: 1200, y: MID_Y } as const;
    block(scene, "north", "raider", 8, { x: 1420, y: MID_Y, facing: "east", ranks: 2, spacingY: 50, order: ride });
    block(scene, "north", "knight", 4, { x: 1330, y: MID_Y, facing: "east", spacingY: 70, order: ride });
    // Sized for a real fight: with eight ravagers the wing is cut down, with seven it wins with five riders left of twelve.
    block(scene, "south", "emberRavager", 7, { x: 2330, y: MID_Y, facing: "west", ranks: 2, order: hold });
    block(scene, "south", "cinderRunner", 3, { x: 2410, y: MID_Y, facing: "west", spacingY: 60, order: hold });
    block(scene, "south", "sparkArcher", 4, { x: 2500, y: MID_Y, facing: "west", spacingY: 64, order: hold });
    return scene.build().createGame();
  },
  defaults: { seconds: 20, camera: { type: "follow", zoom: 0.9 } },
});
