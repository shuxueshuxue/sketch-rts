import { articulated } from "../art/pose";
import type { TrainableUnitKind } from "../../shared/types";
import { type Brush, GOLD, INK, LINEN, WOOD, arm, belt, ellipse, head, legs, line, polygon, torso } from "../art/kit";
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
      articulated(b, "weapon", () => {
        line(b, [[9, 10], [21, -20]], "#78684d", 2.6);
        line(b, [[11, -20], [21, -23], [28, -17]], "#a8b7ab", 3);
        arm(b, [6, -6], [13, 1], "#b7a176");
      });
      head(b);
      ellipse(b, -1, -19, 11, 2.6, "#d9c07a", INK);
      polygon(b, [[-7, -19], [-5, -25], [3, -25.5], [5, -19]], "#d9c07a");
      line(b, [[-6.5, -20.5], [4.8, -20.5]], team, 2);
    },
  },
  // Both races' ships (see @@@ships): a hull on the water, the owner's colour on the sail.
  transport: {
    name: { en: "Transport", zh: "运输船" },
    description: { en: "Ship. Carries 8 supply of land units across the water and sets them ashore; those aboard go down with it. No weapon.", zh: "船。载 8 人口的陆军过水上岸；船沉了，船上的单位一起死。没有武器。" },
    command: { icon: "⛴", hotkey: "t" },
    glyph: { silhouette: "transport-hull", marks: ["mast", "cargo", "flag"] },
    art: { tier: "advanced", bearing: "vessel", faction: "grove" },
    paint(b, team) {
      hull(b, 30, 12);
      for (const x of [-14, -3, 8]) polygon(b, [[x, -2], [x + 9, -2], [x + 9, 6], [x, 6]], "#b9925e", INK, 0.8);
      line(b, [[-1, 6], [-1, -34]], WOOD, 2.2);
      polygon(b, [[-1, -32], [17, -24], [-1, -14]], team);
    },
  },
  warship: {
    name: { en: "Warship", zh: "战船" },
    description: { en: "Ship. Shoots ships and anything on the shore within its range, about an archer's. A tower outranges it.", zh: "船。攻击射程内的船和岸上目标，射程与弓手相当；防御塔比它打得远。" },
    command: { icon: "⚔", hotkey: "w" },
    glyph: { silhouette: "warship-hull", marks: ["mast", "cannon", "flag"] },
    art: { tier: "elite", bearing: "vessel", faction: "grove" },
    paint(b, team) {
      hull(b, 28, 10);
      line(b, [[14, 0], [27, -4]], "#4c4f4a", 3.4);
      ellipse(b, 27, -4, 2, 2, "#2e302c");
      line(b, [[-4, 4], [-4, -38]], WOOD, 2.4);
      polygon(b, [[-4, -36], [-22, -24], [-4, -12]], team);
      polygon(b, [[-4, -36], [10, -28], [-4, -20]], LINEN);
      ellipse(b, -4, -40, 2, 2, GOLD, INK);
    },
  },
} satisfies Partial<Record<TrainableUnitKind, TrainedUnitCard>>;

// A ship's hull on the water, `half` long either way and `depth` deep, its keel at y=16.
function hull(b: Brush, half: number, depth: number) {
  ellipse(b, 0, 14, half + 6, 5, "#7fb3b866");
  polygon(b, [[-half, 16 - depth], [half + 6, 16 - depth - 4], [half - 4, 16], [-half + 6, 16]], "#8a6a43", INK, 1.2);
  line(b, [[-half + 2, 16 - depth + 3], [half + 2, 16 - depth - 1]], "#c9a66e", 1.4);
}
