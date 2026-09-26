import { sketchScene } from "../../sdk/scene";
import type { UnitKind } from "../../shared/types";
import { block } from "../formation";
import { defineRecordingScene, timedCommands, unitIdsOf } from "../scene";

const MID_Y = 2048;
const CAVALRY: UnitKind[] = ["raider", "knight"];

// The lines lock together first; a scripted cue then sends horsemen waiting off the flank into the Ember archers,
// each rider at an archer of its own (an attack-move would let them peel off into the nearest melee instead).
export const cavalryFlank = defineRecordingScene({
  name: "cavalry-flank",
  description: "Infantry lines engage; at 3 s Grove raiders and knights waiting off the flank ride into the Ember archers.",
  createGame: () => {
    const scene = sketchScene("cavalry-flank")
      .map("bareDuel")
      .replaceDefaults()
      .player("north", { team: "north", race: "grove" })
      .player("south", { team: "south", race: "ember" })
      .landmark("flank-road", "road", 2050, 2330, 1200, -0.12)
      .landmark("flank-ridge", "ridge", 2150, 1720, 300);
    const northAdvance = { type: "attackMove", x: 2600, y: MID_Y } as const;
    const southAdvance = { type: "attackMove", x: 1500, y: MID_Y } as const;
    block(scene, "north", "footman", 8, { x: 1850, y: MID_Y, facing: "east", ranks: 2, order: northAdvance });
    block(scene, "north", "archer", 4, { x: 1740, y: MID_Y, facing: "east", spacingY: 70, order: northAdvance });
    block(scene, "north", "raider", 6, { x: 2280, y: 2470, facing: "east", ranks: 2, spacingY: 46 });
    block(scene, "north", "knight", 2, { x: 2200, y: 2470, facing: "east", spacingY: 60 });
    block(scene, "south", "emberRavager", 10, { x: 2250, y: MID_Y, facing: "west", ranks: 2, order: southAdvance });
    block(scene, "south", "sparkArcher", 6, { x: 2420, y: MID_Y, facing: "west", spacingY: 60, order: southAdvance });
    return scene.build().createGame();
  },
  commands: timedCommands([
    {
      at: 3,
      commands: (game) => {
        const archers = unitIdsOf(game, "south", ["sparkArcher"]);
        return unitIdsOf(game, "north", CAVALRY).map((rider, index) => ({
          playerId: "north",
          command: { type: "attack", unitIds: [rider], targetId: archers[index % archers.length]! },
        }));
      },
    },
  ]),
  defaults: { seconds: 14, camera: { type: "follow", zoom: 0.85 } },
});
