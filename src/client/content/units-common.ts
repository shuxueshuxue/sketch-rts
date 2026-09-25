import type { TrainableUnitKind } from "../../shared/types";
import { INK, LINEN, arm, belt, ellipse, head, legs, line, polygon, torso } from "../art/kit";
import type { TrainedUnitCard } from "./cards";

// Units every race trains.
export const COMMON_UNITS = {
  worker: {
    name: { en: "Worker", zh: "农民" },
    description: { en: "Worker. Gathers gold, builds structures, repairs the economy, and can defend itself only in a pinch.", zh: "农民。采集金矿、建造建筑、修理经济体系，紧急时也能勉强自卫。" },
    command: { icon: "⌘", hotkey: "w" },
    glyph: { silhouette: "worker-apron", marks: ["pick", "satchel", "coinSlash"] },
    art: { tier: "civilian", bearing: "foot", faction: "grove" },
    paint(b, team) {
      legs(b);
      torso(b, "#b7a176");
      polygon(b, [[-5, -6], [4, -6], [6, 8], [-7, 8]], LINEN, INK, 0.8);
      belt(b);
      ellipse(b, -12, 5, 4, 5, "#92764d", INK); line(b, [[-5, -9], [-12, 1]], "#856b46", 1.6);
      line(b, [[9, 10], [21, -20]], "#78684d", 2.6);
      line(b, [[11, -20], [21, -23], [28, -17]], "#a8b7ab", 3);
      arm(b, [6, -6], [13, 1], "#b7a176");
      head(b);
      ellipse(b, -1, -19, 11, 2.6, "#d9c07a", INK);
      polygon(b, [[-7, -19], [-5, -25], [3, -25.5], [5, -19]], "#d9c07a");
      line(b, [[-6.5, -20.5], [4.8, -20.5]], team, 2);
    },
  },
} satisfies Partial<Record<TrainableUnitKind, TrainedUnitCard>>;
