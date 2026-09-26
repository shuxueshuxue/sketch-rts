import { EMBER, EMBER_GLOW, GOLD, INK, LEAF, MOSS, WOOD, darker, ellipse, leafMark, line, polygon, type Brush } from "../../client/art/kit";
import type { PropPainter } from "../../story/cast";

// The Ashen March's scenery: what the chapters set on the paper map around the fights. Drawn like the units, around the
// prop's foot, in the same ink; "burning" props get their flames from the story renderer, "ruined" ones are charred here.

const THATCH = "#c9ad6a";
const PLASTER = "#e2d6b0";
const CHAR = "#4a423c";

function hut(b: Brush, state: string | undefined) {
  const ruined = state === "ruined";
  ellipse(b, 4, 20, 36, 9, "#30483624");
  polygon(b, [[-24, -2], [8, 4], [8, 22], [-24, 16]], ruined ? "#8a8274" : PLASTER);
  polygon(b, [[8, 4], [26, -6], [26, 14], [8, 22]], ruined ? "#6f685c" : "#bdb08c");
  polygon(b, [[-12, 8], [-5, 9.5], [-5, 20], [-12, 18.5]], "#4b3d2c");
  polygon(b, [[14, 5], [19, 2], [19, 9], [14, 12]], ruined ? CHAR : "#f0c97e");
  if (ruined) {
    polygon(b, [[-28, -2], [-10, -20], [4, -12], [10, 4]], CHAR);
    line(b, [[-20, -8], [-6, -18], [6, -6]], "#2f2a26", 2);
    line(b, [[18, -4], [24, -12]], "#2f2a26", 2);
    return;
  }
  polygon(b, [[-30, -1], [-6, -28], [30, -10], [10, 6]], THATCH);
  polygon(b, [[10, 6], [30, -10], [32, -4]], darker(THATCH, 0.25));
  for (let i = 0; i < 5; i++) line(b, [[-24 + i * 7, -3 - i * 4.5], [8 + i * 4, 3 - i * 3]], "#a88f52", 0.8);
  line(b, [[-6, -28], [-4, -34]], WOOD, 1.6);
}

function boat(b: Brush) {
  ellipse(b, 0, 12, 34, 7, "#8ab0b433");
  polygon(b, [[-30, 2], [30, 2], [22, 12], [-22, 12]], "#8a6a45", INK, 1.3);
  line(b, [[-26, 5], [26, 5]], "#6b5234", 1);
  line(b, [[6, 2], [6, -30]], WOOD, 2);
  polygon(b, [[7, -28], [24, -12], [7, -8]], "#e6dcbc", INK, 1);
  line(b, [[-18, 2], [-30, -14]], WOOD, 1.6);
}

function dock(b: Brush) {
  polygon(b, [[-40, -4], [40, -12], [42, 2], [-38, 10]], "#9c8057", INK, 1.2);
  for (let i = 0; i < 8; i++) line(b, [[-36 + i * 10, -4 - i], [-34 + i * 10, 9 - i]], "#7a6343", 0.9);
  for (const x of [-34, -6, 22]) line(b, [[x, 8], [x, 18]], "#6b5234", 2.4);
}

function campfire(b: Brush, state: string | undefined) {
  ellipse(b, 0, 8, 18, 6, "#30483630");
  for (const [x, y] of [[-12, 6], [-6, 10], [2, 11], [10, 8], [12, 3], [-10, 2]]) ellipse(b, x!, y!, 3.2, 2.4, "#8f877a", INK);
  line(b, [[-9, 6], [8, -2]], "#6b5234", 3);
  line(b, [[-8, -2], [9, 6]], "#5f4a31", 3);
  if (state === "out") return;
  polygon(b, [[-7, 4], [-4, -10], [-1, -4], [1, -16], [4, -5], [7, 4]], EMBER, "#9c4a36", 1);
  polygon(b, [[-3, 4], [0, -8], [3, 4]], EMBER_GLOW, "transparent", 0);
}

function cart(b: Brush, state: string | undefined) {
  const burnt = state === "ruined";
  ellipse(b, 2, 14, 28, 6, "#30483628");
  polygon(b, [[-22, -6], [18, -10], [20, 6], [-20, 10]], burnt ? CHAR : "#9c7a4f", INK, 1.2);
  for (const x of [-12, 12]) {
    ellipse(b, x, 10, 7, 7, burnt ? "#3a3430" : "#7a6343", INK);
    line(b, [[x - 5, 10], [x + 5, 10]], "#4a3d2c", 1);
  }
  line(b, [[18, -2], [34, -6]], WOOD, 2.2);
  if (!burnt) {
    ellipse(b, -8, -12, 8, 5, "#d9c9a0", INK);
    ellipse(b, 5, -13, 7, 5, "#c7b688", INK);
  } else {
    line(b, [[-16, -8], [-10, -18]], "#2f2a26", 1.6);
    line(b, [[4, -10], [8, -20]], "#2f2a26", 1.6);
  }
}

function reeds(b: Brush) {
  for (let i = 0; i < 9; i++) {
    const x = -18 + i * 4.5;
    const top = -16 - ((i * 7) % 11);
    line(b, [[x, 10], [x + 2, top]], i % 2 ? "#9a9a5c" : "#b3a767", 1.4);
    if (i % 3 === 0) ellipse(b, x + 2, top - 2, 1.6, 4, "#7a5a36");
  }
}

function fence(b: Brush) {
  for (const x of [-30, -10, 10, 30]) line(b, [[x, 10], [x, -8]], "#7a6343", 2.4);
  line(b, [[-32, -4], [32, -8]], "#8f7652", 2);
  line(b, [[-32, 4], [32, 0]], "#8f7652", 2);
}

function watchtower(b: Brush, state: string | undefined) {
  ellipse(b, 2, 24, 26, 7, "#30483628");
  for (const [x1, x2] of [[-16, -10], [16, 10]]) line(b, [[x1!, 22], [x2!, -30]], "#6b5234", 3);
  line(b, [[-14, 6], [14, -6]], "#7a6343", 1.8);
  line(b, [[-14, -6], [14, 6]], "#7a6343", 1.8);
  polygon(b, [[-16, -30], [16, -30], [14, -42], [-14, -42]], "#9c8057", INK, 1.2);
  polygon(b, [[-20, -42], [0, -60], [20, -42]], state === "ruined" ? CHAR : "#4f6d5a", INK, 1.2);
  if (state !== "ruined") {
    line(b, [[0, -60], [0, -72]], WOOD, 1.6);
    polygon(b, [[0, -72], [14, -69], [0, -64]], "#2f7d6d", INK, 0.8);
  }
}

function tent(b: Brush, state: string | undefined) {
  ellipse(b, 2, 16, 30, 7, "#30483628");
  polygon(b, [[-26, 14], [0, -24], [26, 14]], state === "ruined" ? CHAR : "#8a3f2e", INK, 1.3);
  polygon(b, [[0, -24], [26, 14], [8, 14]], darker("#8a3f2e", 0.25), "transparent", 0);
  polygon(b, [[-6, 14], [0, 0], [6, 14]], "#2f2724");
  line(b, [[0, -24], [0, -32]], WOOD, 1.6);
  polygon(b, [[0, -32], [10, -30], [0, -27]], EMBER, INK, 0.7);
}

function banner(b: Brush, state: string | undefined) {
  const ember = state === "ember";
  line(b, [[0, 16], [0, -40]], WOOD, 2.2);
  polygon(b, [[0, -38], [18, -36], [16, -14], [9, -18], [0, -14]], ember ? "#8a2f22" : "#2f7d6d", INK, 1.1);
  if (ember) polygon(b, [[6, -32], [8, -24], [10, -28], [12, -20], [6, -20]], EMBER_GLOW, "transparent", 0);
  else leafMark(b, 8, -27, 5, "#e8e0b4");
}

function stone(b: Brush) {
  ellipse(b, 2, 14, 16, 5, "#30483628");
  polygon(b, [[-9, 14], [-8, -18], [0, -24], [8, -18], [9, 14]], "#b9b59c", INK, 1.2);
  line(b, [[-4, -10], [4, -10]], "#6f6b58", 1.2);
  line(b, [[0, -16], [0, 4]], "#6f6b58", 1.2);
  polygon(b, [[-9, 4], [-4, 6], [-8, 14]], MOSS, "transparent", 0);
}

function cairn(b: Brush) {
  for (const [x, y, r] of [[-8, 8, 7], [7, 9, 6], [0, 2, 7], [-3, -6, 5], [3, -12, 4]]) ellipse(b, x!, y!, r!, r! * 0.75, "#a8a390", INK);
  line(b, [[3, -16], [3, -28]], WOOD, 1.6);
  line(b, [[-2, -24], [8, -24]], WOOD, 1.6);
}

function heartwood(b: Brush, state: string | undefined) {
  // The Old Grove's heart: a vast tree, its bark lit from within while the grove lives.
  const scorched = state === "scorched";
  ellipse(b, 0, 26, 50, 11, "#30483634");
  for (const [x1, x2] of [[-10, -26], [-4, -12], [6, 14], [10, 28]]) line(b, [[x1!, 12], [x2!, 26]], "#6b5a3e", 4);
  polygon(b, [[-14, 16], [-10, -30], [-4, -40], [6, -40], [11, -28], [14, 16]], "#7c6a48", INK, 1.4);
  for (const x of [-7, 0, 7]) line(b, [[x, -34], [x + (x < 0 ? -2 : 2), 14]], "#5f5034", 1.2);
  if (!scorched) ellipse(b, 0, -8, 4, 7, "#f4e7a0", "#b9a45a");
  for (const [x, y, r] of [[-26, -46, 18], [0, -58, 24], [24, -46, 18], [-12, -38, 14], [14, -36, 14], [0, -40, 16]]) ellipse(b, x!, y!, r!, r! * 0.78, scorched ? "#6f6a55" : (x! + y!) % 3 === 0 ? MOSS : "#6f8f5a", "#526951");
  if (!scorched) for (const [x, y] of [[-20, -50], [8, -64], [26, -44], [-4, -44], [16, -52]]) ellipse(b, x!, y!, 1.8, 1.8, "#f4f0b0");
}

function pyre(b: Brush, state: string | undefined) {
  // The Ember Pact's brazier: a dim coal while the Pyre fails, a blaze when it is lit again.
  ellipse(b, 0, 16, 26, 7, "#30483630");
  polygon(b, [[-18, 14], [-12, -4], [12, -4], [18, 14]], "#3a3538", INK, 1.3);
  polygon(b, [[-14, -4], [-16, -10], [16, -10], [14, -4]], "#4a4448", INK, 1.2);
  line(b, [[-12, 4], [12, 4]], GOLD, 1.2);
  if (state === "lit") {
    polygon(b, [[-13, -10], [-9, -30], [-4, -22], [0, -40], [4, -22], [9, -32], [13, -10]], EMBER, "#9c4a36", 1.2);
    polygon(b, [[-6, -10], [0, -28], [6, -10]], EMBER_GLOW, "transparent", 0);
  } else {
    ellipse(b, 0, -11, 11, 3, "#7a2a18");
    for (const x of [-6, 0, 5]) ellipse(b, x, -11, 2, 1.2, EMBER);
  }
}

function bridge(b: Brush, state: string | undefined) {
  if (state === "ruined") {
    polygon(b, [[-50, -8], [-18, -10], [-20, 6], [-50, 8]], CHAR, INK, 1.1);
    polygon(b, [[20, -12], [50, -14], [50, 2], [22, 4]], CHAR, INK, 1.1);
    return;
  }
  polygon(b, [[-50, -8], [50, -14], [50, 2], [-50, 8]], "#9c8057", INK, 1.2);
  for (let i = 0; i < 10; i++) line(b, [[-46 + i * 10, -8 - i * 0.6], [-46 + i * 10, 7 - i * 0.6]], "#7a6343", 0.9);
  line(b, [[-50, -12], [50, -18]], "#6b5234", 1.6);
  line(b, [[-50, 4], [50, -2]], "#6b5234", 1.6);
}

function tree(b: Brush) {
  ellipse(b, 3, 10, 16, 5, "#304f3b22");
  line(b, [[0, 10], [0, -8]], "#79744f", 3);
  polygon(b, [[-16, 0], [-8, -16], [-11, -16], [0, -40], [11, -16], [8, -16], [16, 0], [0, 4]], "#577762", "#526951", 1);
  polygon(b, [[0, -37], [0, 1], [-13, -2], [-6, -15], [-9, -16]], "#799573", "transparent", 0);
}

function deadTree(b: Brush) {
  ellipse(b, 3, 12, 14, 4, "#30483622");
  line(b, [[0, 12], [0, -26]], "#4f4640", 3);
  line(b, [[0, -10], [-12, -20], [-16, -30]], "#4f4640", 2.2);
  line(b, [[0, -16], [10, -26], [12, -34]], "#4f4640", 2);
  line(b, [[-12, -20], [-18, -18]], "#4f4640", 1.4);
}

function ashPile(b: Brush) {
  ellipse(b, 0, 6, 22, 7, "#5f5953");
  ellipse(b, -4, 3, 12, 4, "#77706a");
  for (const [x, y] of [[-8, 4], [4, 6], [10, 2]]) ellipse(b, x!, y!, 1.3, 1, EMBER);
}

function crate(b: Brush) {
  polygon(b, [[-10, -8], [8, -10], [10, 10], [-9, 12]], "#a08158", INK, 1.2);
  line(b, [[-10, -8], [10, 10]], "#7a6343", 1);
  line(b, [[8, -10], [-9, 12]], "#7a6343", 1);
}

function well(b: Brush) {
  ellipse(b, 0, 10, 18, 7, "#8f877a", INK);
  ellipse(b, 0, 8, 12, 4.5, "#3f4b4a");
  for (const x of [-12, 12]) line(b, [[x, 8], [x, -20]], WOOD, 2.2);
  polygon(b, [[-16, -20], [0, -30], [16, -20]], "#9c7a4f", INK, 1.1);
  line(b, [[0, -18], [0, -4]], "#6b5234", 1);
}

function grave(b: Brush) {
  ellipse(b, 0, 12, 14, 5, "#6f6a5566");
  line(b, [[0, 10], [0, -18]], WOOD, 2.4);
  line(b, [[-8, -10], [8, -10]], WOOD, 2.4);
  leafMark(b, 6, 8, 3, LEAF);
}

function target(b: Brush) {
  // An archery butt: a straw boss on two legs, a painted face.
  line(b, [[-8, 16], [-4, -4]], WOOD, 2);
  line(b, [[8, 16], [4, -4]], WOOD, 2);
  ellipse(b, 0, -14, 13, 14, "#d9c07a", INK);
  ellipse(b, 0, -14, 9, 9.5, "#f2ead0", "#9c7f52");
  ellipse(b, 0, -14, 5, 5.2, "#b8543a", "#8e2a1c");
  ellipse(b, 0, -14, 1.6, 1.6, "#f4c86e");
}

function beacon(b: Brush, state: string | undefined) {
  // A stone beacon-tower on a hill: dark until someone lights it.
  ellipse(b, 2, 18, 24, 7, "#30483628");
  polygon(b, [[-14, 16], [-10, -18], [10, -18], [14, 16]], "#9a9480", INK, 1.3);
  for (const y of [-8, 2, 10]) line(b, [[-12, y], [12, y]], "#7a7462", 0.9);
  polygon(b, [[-14, -18], [-16, -24], [16, -24], [14, -18]], "#7a7462", INK, 1.1);
  if (state !== "lit") return;
  polygon(b, [[-12, -24], [-8, -42], [-3, -32], [1, -52], [5, -33], [9, -44], [12, -24]], EMBER, "#9c4a36", 1.1);
  polygon(b, [[-5, -24], [0, -40], [5, -24]], EMBER_GLOW, "transparent", 0);
  for (const [x, y, r] of [[-4, -60, 7], [4, -72, 9], [-2, -86, 11]]) ellipse(b, x!, y!, r!, r! * 0.8, "#6a645e44");
}

export const SCENERY: Record<string, PropPainter> = {
  target: (b) => target(b),
  beacon,
  hut,
  boat: (b) => boat(b),
  dock: (b) => dock(b),
  campfire,
  cart,
  reeds: (b) => reeds(b),
  fence: (b) => fence(b),
  watchtower,
  tent,
  banner,
  stone: (b) => stone(b),
  cairn: (b) => cairn(b),
  heartwood,
  pyre,
  bridge,
  tree: (b) => tree(b),
  deadTree: (b) => deadTree(b),
  ashPile: (b) => ashPile(b),
  crate: (b) => crate(b),
  well: (b) => well(b),
  grave: (b) => grave(b),
};
