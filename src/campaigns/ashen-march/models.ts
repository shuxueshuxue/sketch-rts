import { ASH, BARK, BOOT, EMBER, EMBER_GLOW, GOLD, INK, LEAF, LEATHER, LEATHER_DARK, LINEN, MOSS, SKIN, STEEL, STEEL_DARK, WOOD, arm, belt, blade, bow, capeBehind, darker, ellipse, head, hemTrim, hood, kettleHelm, leafMark, legs, lighter, line, polygon, quiver, riderLeg, roundShield, spear, staff, torso, type Brush } from "../../client/art/kit";

// The Ashen March's own units, drawn with the game's kit on its humanoid rig (feet at y=16, head at (-1,-15), facing
// right) so they stand in the same sketched world as the catalog's. Beasts stand on four legs about the same ground
// line; the colossus and the elder are drawn at human scale and enlarged by their size (see story/cast).

const TEAL = "#2f7d6d";
const REED = "#b9a66a";
const OBSIDIAN = "#2e2a2c";
const MAGMA = "#e5652f";

// ---- The wardens.

export function paintLynn(b: Brush, team: string) {
  capeBehind(b, "#3f6a4f", GOLD);
  quiver(b, LEATHER);
  legs(b, "stride");
  torso(b, "#4c7a5a", 10, 1);
  polygon(b, [[-7, -8], [6, -8], [8, 4], [-8, 4]], LEATHER, INK, 0.9);
  line(b, [[-7, -8], [7, 3]], team, 2.2);
  belt(b, LEATHER_DARK, GOLD);
  blade(b, [-9, 6], [-12, 13], 2.2);
  arm(b, [6, -6], [12, -3], "#4c7a5a");
  head(b);
  // Hood thrown back, a braid, a warden's feather.
  polygon(b, [[-10, -9], [-10, -17], [-6, -22], [-3, -16], [-6, -9]], "#3f6a4f");
  line(b, [[-6, -22], [-2, -24.5], [4, -23], [6, -19]], "#6b4a2d", 2.6);
  line(b, [[-7, -14], [-11, -5], [-10, 1]], "#6b4a2d", 1.8);
  line(b, [[3, -24], [8, -31], [11, -33]], "#e8e0c0", 1.6);
  line(b, [[8, -31], [10, -29]], "#c96b3c", 1.2);
  bow(b, 16, -4, 19, "#5c4127", "#e4ebd6");
}

export function paintDu(b: Brush, team: string) {
  legs(b, "brace");
  torso(b, "#6b705f", 11, 3);
  // Mail and a tabard in the watch's colour.
  for (const y of [-6, -2, 2, 6]) line(b, [[-9, y], [9, y]], "#8a8f80", 0.8);
  polygon(b, [[-4, -9], [4, -9], [5, 11], [-5, 11]], team, INK, 1);
  leafMark(b, 0, 0, 3, "#e8e0b4");
  belt(b, LEATHER_DARK, GOLD);
  blade(b, [14, 2], [21, -22], 4.4, "#d0d8ca", "#eef1e6");
  arm(b, [7, -6], [14, 2], "#6b705f", SKIN, 4.6);
  head(b, "#d3b48c");
  // A grey beard, a broken nose, the old kettle helm.
  polygon(b, [[-4, -12], [5, -12], [4, -5], [0, -2], [-4, -6]], "#cfcbbf", INK, 0.9);
  line(b, [[-2, -11], [3, -10]], "#8f8a80", 0.8);
  kettleHelm(b);
  // The tower shield, battered.
  polygon(b, [[-20, -14], [-6, -16], [-5, 12], [-12, 17], [-20, 12]], "#7d6a4c", INK, 1.4);
  polygon(b, [[-18, -11], [-8, -13], [-7.5, 10], [-12, 14], [-18, 10]], "transparent", team, 1.4);
  line(b, [[-17, -2], [-9, -3]], "#5c4d38", 1);
  line(b, [[-14, 3], [-11, 8]], "#5c4d38", 1);
  ellipse(b, -12.5, -1, 2.4, 2.4, STEEL_DARK, INK);
}

export function paintTess(b: Brush, team: string) {
  // Herbs drying on her back, a basket at the hip.
  line(b, [[-9, -10], [-15, -2]], "#6f8a52", 2);
  for (const [x, y] of [[-14, -4], [-12, -7], [-16, -1]]) leafMark(b, x!, y!, 2.4, LEAF);
  torso(b, "#5d6e4c", 15, 3);
  polygon(b, [[-10, -9], [9, -9], [11, 0], [-12, 0]], "#8a7a55");
  for (let i = 0; i < 5; i++) line(b, [[-9 + i * 4.5, 0], [-9.5 + i * 4.5, 4]], "#6d5f40", 1.2);
  hemTrim(b, 15, 3, "#a9c27c");
  belt(b, LEATHER_DARK);
  ellipse(b, -11, 8, 5, 4, "#9c7f52", INK);
  line(b, [[-15, 6], [-7, 6]], "#6d5a3a", 1);
  // A crooked staff with a lantern of fireflies.
  line(b, [[17, 16], [16, -6], [18, -18], [15, -26]], "#5f4a31", 2.4);
  polygon(b, [[12, -30], [18, -30], [19, -22], [11, -22]], "#f6e7a4aa", INK, 1);
  for (const [x, y] of [[14, -27], [16.5, -24.5], [15, -25]]) ellipse(b, x!, y!, 0.9, 0.9, "#fff6b0");
  arm(b, [6, -6], [16, -3], "#5d6e4c");
  head(b, "#e0c9a4");
  // Wild hair and a small antler pin.
  polygon(b, [[-8, -12], [-9, -20], [-3, -24], [4, -23], [7, -18], [2, -20], [-4, -18], [-5, -11]], "#7b4b2e");
  line(b, [[-3, -23], [-7, -29], [-10, -30]], "#d9ccae", 1.4);
  line(b, [[-7, -29], [-6, -32]], "#d9ccae", 1.2);
}

export function paintIg(b: Brush, team: string) {
  for (const [y, x] of [[-2, -18], [5, -21]]) line(b, [[x!, y!], [x! + 6, y!]], "#9a948a", 1.1);
  legs(b, "stride", "#4a4038");
  torso(b, "#5a4c44", 8, 0, 2);
  // A scarf the colour of the pact he left, a burn down one arm.
  b.beginPath(); b.moveTo(-5, -11); b.bezierCurveTo(-12, -13, -17, -6, -24, -9); b.lineTo(-21, -4); b.bezierCurveTo(-14, -3, -10, -7, -3, -7); b.closePath();
  b.fillStyle = "#b8543a"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
  line(b, [[-7, -9], [7, -9]], "#b8543a", 3);
  belt(b, ASH);
  blade(b, [-10, 2], [-16, -4], 2.2);
  arm(b, [-5, -6], [-10, 2], "#5a4c44", "#b98c6a");
  blade(b, [14, 1], [21, -6], 2.2);
  arm(b, [7, -6], [14, 1], "#5a4c44");
  line(b, [[9, -4], [12, -1]], "#9c4a36", 1.2);
  head(b, "#c9a27c", 2);
  polygon(b, [[-6, -15], [-6, -21], [-1, -24], [6, -22], [7, -17], [2, -19], [-2, -18]], "#2f2724");
  line(b, [[0, -14], [3, -10]], "#9c4a36", 1.1);
  line(b, [[-1, -16], [5, -15.5]], team, 1.4);
}

export function paintWarden(b: Brush, team: string) {
  legs(b);
  // A reed cloak over quilting, a long spear for the fords.
  polygon(b, [[-9, -10], [6, -10], [10, 10], [-12, 10]], REED, INK, 1);
  for (const x of [-8, -4, 0, 4, 8]) line(b, [[x, -9], [x + (x < 0 ? -1.5 : 1.5), 10]], "#968651", 0.9);
  polygon(b, [[-5, -9], [4, -9], [5, 2], [-6, 2]], team, INK, 0.8);
  belt(b);
  spear(b, [12, 17], [16, -44], 8);
  arm(b, [6, -6], [14, -2], REED);
  head(b);
  kettleHelm(b);
  line(b, [[-7, -20], [-10, -24]], REED, 1.4);
}

// ---- Folk of the fen and of the ash.

export function paintVillager(b: Brush, team: string) {
  legs(b, "stride");
  torso(b, "#a58a5c", 10);
  polygon(b, [[-5, -6], [4, -6], [6, 8], [-7, 8]], LINEN, INK, 0.8);
  belt(b);
  // A bundle on the back and a pitchfork.
  ellipse(b, -12, -4, 6, 7, "#d9c9a0", INK);
  line(b, [[-16, -8], [-8, 0]], "#9c8458", 1.2);
  line(b, [[10, 14], [17, -22]], WOOD, 2.2);
  for (const dx of [-3, 0, 3]) line(b, [[16 + dx, -22], [16.5 + dx, -29]], STEEL_DARK, 1.3);
  arm(b, [6, -6], [13, 0], "#a58a5c");
  head(b);
  // A straw hat.
  ellipse(b, -1, -19, 12, 2.8, "#e2c77a", INK);
  polygon(b, [[-6, -19], [-4, -25], [3, -25.5], [5, -19]], "#e2c77a");
  line(b, [[-5.5, -20.5], [4.5, -20.5]], team, 1.6);
}

export function paintVillagerWoman(b: Brush, team: string) {
  torso(b, "#8f6f7a", 15, 3);
  polygon(b, [[-6, -6], [5, -6], [7, 13], [-8, 13]], "#e9dcc0", INK, 0.8);
  hemTrim(b, 15, 3, team);
  // A basket of reeds on the hip.
  ellipse(b, 11, 4, 6, 4.5, "#b99a62", INK);
  for (const dx of [-3, 0, 3]) line(b, [[11 + dx, 1], [12 + dx, -9]], REED, 1.4);
  arm(b, [6, -6], [9, 2], "#8f6f7a");
  head(b);
  polygon(b, [[-8, -11], [-8, -20], [-2, -24], [5, -22], [7, -16], [4, -19], [-3, -19], [-5, -10]], "#d8c9a8");
}

export function paintRefugee(b: Brush, team: string) {
  legs(b, "stride", "#4a433d");
  // Ash-grey rags, a hood, a walking stick.
  polygon(b, [[-9, -10], [7, -10], [11, 12], [-13, 12]], "#77706a", INK, 1);
  for (const x of [-9, -5, 3, 7]) line(b, [[x, 12], [x + 1, 7]], "#5f5953", 1);
  line(b, [[-2, -10], [-4, 12]], "#5f5953", 0.8);
  belt(b, "#4a433d");
  line(b, [[13, 16], [12, -14]], "#6a5540", 2);
  arm(b, [6, -6], [12, -6], "#77706a");
  head(b, "#c7a684");
  hood(b, "#5f5953");
  line(b, [[-3, -12], [5, -11]], team, 1.2);
}

export function paintAshe(b: Brush, team: string) {
  // Ig's little sister: small, a red scarf like his.
  b.save(); b.translate(0, 3); b.scale(0.85, 0.85);
  legs(b, "stride", "#4a433d");
  torso(b, "#8a7f73", 10, 1);
  line(b, [[-7, -9], [7, -9]], "#b8543a", 3.2);
  b.beginPath(); b.moveTo(-5, -10); b.bezierCurveTo(-11, -11, -14, -6, -19, -8); b.lineTo(-17, -4); b.bezierCurveTo(-12, -4, -9, -7, -3, -7); b.closePath();
  b.fillStyle = "#b8543a"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
  belt(b, "#4a433d");
  arm(b, [6, -6], [11, -1], "#8a7f73");
  head(b, "#c9a27c");
  polygon(b, [[-7, -13], [-7, -20], [-1, -23], [5, -21], [6, -16], [2, -18], [-3, -18]], "#2f2724");
  ellipse(b, 13, -2, 2.6, 2.6, EMBER_GLOW, "#9c4a36");
  b.restore();
}

// ---- Beasts.

function quadruped(b: Brush, coat: string, belly: string, options: { tail?: string; mane?: string; eyes?: string; long?: number } = {}) {
  const long = options.long ?? 1;
  line(b, [[-15 * long, 0], [-23 * long, -6]], options.tail ?? darker(coat, 0.2), 3.4);
  for (const x of [-11, -6, 8, 12]) {
    line(b, [[x * long, 4], [x * long - 1.5, 15]], darker(coat, 0.3), 3);
    ellipse(b, x * long - 2, 15.5, 2, 1.1, "#3f3a2c");
  }
  ellipse(b, -1, 1, 16 * long, 7.5, coat, INK);
  ellipse(b, -1, 4, 11 * long, 3.5, belly);
  // Head reaching forward, ears up.
  polygon(b, [[10 * long, -2], [14 * long, -10], [22 * long, -9], [26 * long, -4], [21 * long, 0], [13 * long, 3]], lighter(coat, 0.06), INK, 1.1);
  polygon(b, [[14 * long, -9], [15 * long, -15], [18 * long, -10]], darker(coat, 0.1), INK, 0.9);
  ellipse(b, 20 * long, -7, 1.3, 1.1, options.eyes ?? INK);
  polygon(b, [[24 * long, -3], [26 * long, -2], [24 * long, -1]], "#e9e2c9", "transparent", 0);
  if (options.mane) {
    for (let i = 0; i < 5; i++) {
      const x = (6 - i * 4) * long;
      polygon(b, [[x - 3, -5], [x + 1, -13 - (i % 2) * 3], [x + 3, -5]], options.mane, darker(options.mane, 0.3), 0.8);
    }
  }
}

export function paintFenWolf(b: Brush, team: string) {
  quadruped(b, "#8b8474", "#c9c1a8", { tail: "#6f6858" });
  line(b, [[-4, -6], [2, -6]], team, 1.2);
}

export function paintFenWolfAlpha(b: Brush, team: string) {
  quadruped(b, "#6f685c", "#b9b098", { tail: "#5a5448", long: 1.12 });
  // A scar across the blind eye, a ruff of grey.
  for (let i = 0; i < 4; i++) polygon(b, [[10 - i * 4, -6], [12 - i * 4, -12], [14 - i * 4, -6]], "#8b8474", INK, 0.7);
  line(b, [[20, -10], [24, -4]], "#8e2a1c", 1.4);
  line(b, [[-4, -6], [2, -6]], team, 1.2);
}

export function paintCinderHound(b: Brush, team: string) {
  quadruped(b, "#3c3431", "#5b4a41", { tail: EMBER, mane: EMBER, eyes: EMBER_GLOW, long: 1.05 });
  for (const [x, y] of [[-6, 2], [2, 3], [-12, 0]]) line(b, [[x!, y!], [x! + 3, y! - 3]], EMBER_GLOW, 1);
  line(b, [[-2, -7], [4, -7]], team, 1.2);
}

// ---- The Ember host.

export function paintAshRaider(b: Brush, team: string) {
  legs(b, "brace", ASH);
  // Ragged cloak, painted face, a torch and a hooked blade.
  polygon(b, [[-8, -10], [6, -10], [2, 4], [-7, 16], [-16, 12], [-12, -2]], darker(team, 0.35));
  torso(b, team, 9);
  line(b, [[-7, -8], [8, 5]], LEATHER_DARK, 2.4);
  belt(b, LEATHER_DARK);
  line(b, [[-10, 6], [-14, -18]], WOOD, 2.4);
  polygon(b, [[-17, -18], [-14, -30], [-11, -22], [-9, -27], [-9, -18]], EMBER, "#9c4a36", 1);
  polygon(b, [[-15, -18], [-13.5, -25], [-11.5, -18]], EMBER_GLOW, "transparent", 0);
  arm(b, [-5, -6], [-11, 5], team, SKIN, 4);
  b.beginPath(); b.moveTo(13, 1); b.lineTo(16, -12); b.quadraticCurveTo(25, -16, 22, -6); b.lineTo(17, -7); b.closePath();
  b.fillStyle = "#cfd6c8"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
  arm(b, [6, -7], [13, 1], team, SKIN, 4);
  head(b);
  line(b, [[-4, -16], [5, -14]], "#8e2a1c", 1.6);
  polygon(b, [[-7, -17], [-6, -22], [0, -24], [6, -21], [6, -17], [0, -19]], "#4a4038");
}

export function paintKharn(b: Brush, team: string) {
  legs(b, "brace", ASH);
  polygon(b, [[-14, -13], [12, -13], [15, -3], [-17, -3]], "#6d5d4f", INK, 1.2);
  torso(b, team, 11, 3);
  for (const x of [-6, -2, 2]) ellipse(b, x, -8, 1.5, 1.9, "#e4dcc0", INK);
  line(b, [[-9, -6], [9, 7]], LEATHER_DARK, 3);
  belt(b, LEATHER_DARK, EMBER_GLOW);
  // A great brand-axe, its edge glowing.
  line(b, [[12, 14], [18, -30]], WOOD, 3);
  b.beginPath(); b.moveTo(16, -28); b.quadraticCurveTo(34, -32, 31, -12); b.lineTo(17, -17); b.closePath();
  b.fillStyle = "#b7beb0"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1.2; b.stroke();
  line(b, [[20, -26], [30, -14]], EMBER_GLOW, 2);
  arm(b, [7, -8], [15, -6], team, SKIN, 5);
  arm(b, [-7, -8], [-13, 3], team, SKIN, 5);
  head(b);
  // The brand: an iron half-mask with a burning mark.
  polygon(b, [[-2, -21], [7, -19], [6, -11], [0, -9], [-2, -13]], "#5b5550", INK, 1);
  polygon(b, [[1, -17], [3, -21], [5, -17], [3, -14]], EMBER, "transparent", 0);
  polygon(b, [[-8, -18], [-9, -25], [-3, -27], [3, -26], [-1, -21]], "#3a3230");
}

export function paintPyremancer(b: Brush, team: string) {
  for (const a of [0.6, 2.2, 3.9, 5.3]) ellipse(b, Math.cos(a) * 17, 6 + Math.sin(a) * 5, 1.8, 1.8, EMBER_GLOW);
  torso(b, "#57302a", 15, 3);
  polygon(b, [[-9, -9], [8, -9], [10, 0], [-10, 0]], team);
  hemTrim(b, 15, 3, EMBER);
  belt(b, "#3a2320", GOLD);
  // A staff crowned with a caged flame.
  staff(b, 17, -26, 16, "#3f2f28");
  polygon(b, [[13, -34], [21, -34], [22, -26], [12, -26]], "transparent", GOLD, 1.3);
  polygon(b, [[14, -26], [16, -36], [18, -31], [20, -38], [21, -26]], EMBER, "#9c4a36", 1);
  polygon(b, [[16, -26], [17.5, -32], [19, -26]], EMBER_GLOW, "transparent", 0);
  arm(b, [6, -6], [16, -2], "#57302a");
  head(b, "#b98c6a");
  hood(b, "#3a2320");
  for (const [x, y] of [[0, -18], [3, -18]]) ellipse(b, x!, y!, 1, 1, EMBER_GLOW);
}

export function paintOru(b: Brush, team: string) {
  paintPyremancer(b, team);
  // Oru wears a mantle of ash-feathers and a crown of cinders.
  for (let i = 0; i < 6; i++) polygon(b, [[-12 + i * 4, -10], [-10 + i * 4, -3], [-8 + i * 4, -10]], "#4a4440", INK, 0.7);
  for (const x of [-5, -1, 3]) polygon(b, [[x - 1.5, -24], [x, -30], [x + 1.5, -24]], EMBER, "#9c4a36", 0.8);
}

export function paintObsidianGuard(b: Brush, team: string) {
  legs(b, "brace", OBSIDIAN);
  torso(b, "#3b3638", 10, 2);
  for (const [x, y] of [[-6, -6], [2, -4], [-3, 3], [5, 4]]) polygon(b, [[x!, y!], [x! + 3, y! - 3], [x! + 5, y!], [x! + 2, y! + 3]], "#57505a", "transparent", 0);
  line(b, [[-8, -8], [8, 8]], team, 2.2);
  belt(b, OBSIDIAN, EMBER_GLOW);
  spear(b, [14, 16], [18, -40], 9, "#3f2f28");
  arm(b, [6, -6], [15, -4], "#3b3638", "#6d6068");
  head(b, "#6d6068");
  polygon(b, [[-8, -10], [-8, -22], [-1, -27], [7, -22], [7, -10], [3, -16], [-4, -16]], "#2a2628", INK, 1.2);
  line(b, [[0, -17], [6, -17]], EMBER_GLOW, 1.6);
  // The obsidian tower shield.
  polygon(b, [[-21, -18], [-6, -20], [-5, 14], [-20, 16]], "#262224", INK, 1.5);
  polygon(b, [[-19, -15], [-8, -16], [-7, 11], [-18, 13]], "transparent", "#5f5860", 1);
  line(b, [[-17, -8], [-10, 2], [-15, 8]], MAGMA, 1.4);
}

export function paintVashka(b: Brush, team: string) {
  // The Unquenched: a burning cape, a spear of red iron, a crown that is only fire.
  b.beginPath(); b.moveTo(-6, -11); b.bezierCurveTo(-16, -6, -20, 6, -24, 17); b.lineTo(-10, 16); b.bezierCurveTo(-8, 6, -4, -2, 4, -10); b.closePath();
  b.fillStyle = "#7a2418"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1.2; b.stroke();
  for (const x of [-22, -17, -12]) polygon(b, [[x - 2, 17], [x, 11], [x + 2, 17]], EMBER, "transparent", 0);
  legs(b, "stride", "#2f2724");
  torso(b, "#3a3230", 10, 1, 1);
  polygon(b, [[-8, -9], [8, -9], [9, -2], [-9, -2]], team, INK, 1);
  line(b, [[-5, -5], [-1, 2], [-4, 8]], EMBER_GLOW, 1.4);
  belt(b, "#2a2220", GOLD);
  spear(b, [-8, 16], [26, -34], 11, "#5a2a22");
  polygon(b, [[20, -28], [24, -38], [28, -30]], EMBER_GLOW, "transparent", 0);
  arm(b, [6, -6], [12, -9], "#3a3230", "#a8765a", 4.4);
  head(b, "#a8765a");
  line(b, [[-2, -16], [5, -15]], EMBER, 1.4);
  for (const [x, h] of [[-6, 7], [-2, 10], [2, 8], [5, 6]]) {
    polygon(b, [[x! - 2.5, -21], [x!, -21 - h!], [x! + 2.5, -21]], EMBER, "#9c4a36", 0.8);
    polygon(b, [[x! - 1, -21], [x!, -21 - h! * 0.55], [x! + 1, -21]], EMBER_GLOW, "transparent", 0);
  }
}

export function paintColossus(b: Brush, team: string) {
  // A construct of stacked obsidian round a molten heart, drawn at a man's height and enlarged by its size.
  for (const x of [-9, 7]) {
    polygon(b, [[x - 4, 4], [x + 4, 4], [x + 5, 16], [x - 5, 16]], OBSIDIAN, INK, 1.1);
    line(b, [[x - 3, 10], [x + 2, 12]], MAGMA, 1);
  }
  polygon(b, [[-15, -14], [13, -16], [17, 4], [-17, 6]], "#353033", INK, 1.3);
  polygon(b, [[-11, -10], [-3, -12], [-4, -3], [-12, -1]], "#45404a", "transparent", 0);
  ellipse(b, 1, -4, 6.5, 6, MAGMA, "#7a2a18");
  ellipse(b, 1, -4, 3.4, 3.2, EMBER_GLOW);
  for (const [x1, y1, x2, y2] of [[1, -10, 5, -15], [-5, -2, -12, 2], [7, 0, 14, 3], [0, 2, -2, 6]]) line(b, [[x1!, y1!], [x2!, y2!]], MAGMA, 1.4);
  // Arms like broken pillars.
  polygon(b, [[13, -14], [21, -12], [23, 6], [16, 8]], "#2f2b2e", INK, 1.2);
  polygon(b, [[-15, -12], [-22, -9], [-24, 8], [-17, 9]], "#2f2b2e", INK, 1.2);
  polygon(b, [[16, 6], [25, 5], [26, 12], [17, 13]], "#3a3538", INK, 1.1);
  line(b, [[18, -6], [21, 2]], MAGMA, 1.1);
  // A head of one stone, eyes of fire, horns of slag.
  polygon(b, [[-6, -16], [6, -17], [7, -25], [-6, -25]], "#3a3538", INK, 1.2);
  for (const x of [-2.5, 3]) ellipse(b, x, -21, 1.4, 1, EMBER_GLOW);
  polygon(b, [[-6, -24], [-12, -31], [-7, -27]], OBSIDIAN, INK, 1);
  polygon(b, [[7, -24], [13, -31], [8, -27]], OBSIDIAN, INK, 1);
  for (const [x, y] of [[-10, -20], [12, -22], [4, -30]]) ellipse(b, x!, y!, 1.2, 1.2, "#f4c86e99");
  line(b, [[-2, 8], [0, 16]], team, 1.2);
}

export function paintColossusBroken(b: Brush, team: string) {
  paintColossus(b, team);
  // The seal broken: the molten heart laid open and the plates split.
  for (const [x1, y1, x2, y2] of [[-14, -12, -4, 2], [12, -14, 4, 0], [-10, 4, 10, 4], [-4, -16, 6, -8]]) line(b, [[x1!, y1!], [x2!, y2!]], EMBER_GLOW, 2);
  ellipse(b, 1, -4, 8, 7.5, "#f4c86e88");
}

// ---- The grove.

export function paintElder(b: Brush, team: string) {
  // A walking tree: roots for feet, a trunk with a face, a crown of leaves, branch arms.
  for (const [x1, x2] of [[-6, -12], [-2, -3], [4, 8], [7, 13]]) line(b, [[x1!, 8], [x2!, 16]], BARK, 3.2);
  polygon(b, [[-9, 10], [-8, -14], [-3, -20], [5, -20], [9, -12], [8, 10]], "#7c6a48", INK, 1.3);
  for (const x of [-5, 0, 4]) line(b, [[x, -16], [x + (x < 0 ? -1 : 1), 9]], "#5f5034", 1);
  ellipse(b, -2, -8, 1.6, 1.2, "#e8d98a");
  ellipse(b, 3, -8, 1.6, 1.2, "#e8d98a");
  line(b, [[-2, -3], [3, -3]], "#4a3f2a", 1.4);
  polygon(b, [[-3, -2], [2, -2], [1, 6], [-1, 8], [-3, 5]], "#a9b58a", INK, 0.7);
  line(b, [[8, -10], [15, -18], [18, -26]], BARK, 3);
  line(b, [[15, -18], [21, -17]], BARK, 2);
  line(b, [[-8, -10], [-15, -15], [-17, -24]], BARK, 3);
  for (const [x, y, s] of [[18, -28, 4], [22, -18, 3], [-18, -26, 4], [-14, -16, 3]]) leafMark(b, x!, y!, s!, LEAF);
  for (const [x, y, r] of [[-8, -26, 9], [2, -30, 11], [10, -24, 8], [-2, -22, 8]]) ellipse(b, x!, y!, r!, r! * 0.8, x! % 2 === 0 ? "#6f8f5a" : MOSS, "#526951");
  for (const [x, y] of [[-6, -30], [4, -33], [9, -26]]) ellipse(b, x!, y!, 1.3, 1.3, "#e6f0a8");
  line(b, [[-3, -12], [-3, -12]], team, 1);
}

export function paintTreant(b: Brush, team: string) {
  for (const [x1, x2] of [[-5, -9], [4, 8]]) line(b, [[x1!, 6], [x2!, 16]], BARK, 3.4);
  polygon(b, [[-9, 8], [-8, -12], [-2, -17], [5, -16], [9, -10], [8, 8]], "#86734c", INK, 1.2);
  line(b, [[-3, -12], [-4, 6]], "#5f5034", 1);
  line(b, [[3, -12], [4, 6]], "#5f5034", 1);
  ellipse(b, 0, -9, 1.5, 1.1, "#e8d98a");
  ellipse(b, 5, -9, 1.5, 1.1, "#e8d98a");
  line(b, [[8, -8], [16, -3], [19, 5]], BARK, 3.4);
  ellipse(b, 20, 7, 3.4, 3, "#6f5f40", INK);
  line(b, [[-8, -8], [-14, -14]], BARK, 2.8);
  for (const [x, y, r] of [[-6, -19, 7], [3, -22, 8], [-12, -16, 4]]) ellipse(b, x!, y!, r!, r! * 0.8, MOSS, "#526951");
  leafMark(b, -14, -18, 3, LEAF);
  line(b, [[-8, 2], [8, 2]], team, 1.4);
}

// A rider for the story's last charge, should it come to that.
export function paintGroveRider(b: Brush, team: string) {
  ellipse(b, 2, 17, 22, 5.5, "#30483630");
  b.save(); b.scale(0.92, 0.92);
  line(b, [[-17, 4], [-24, 11]], "#5f4a31", 3.2);
  for (const x of [-13, -6, 10, 16]) line(b, [[x, 9], [x - 2, 19]], "#6f5a3e", 2.8);
  polygon(b, [[-18, 2], [7, -3], [19, 2], [15, 12], [-13, 12]], "#8b6f4e");
  polygon(b, [[8, 0], [8, -13], [14, -19], [24, -11], [22, -6], [16, -7], [19, 5]], "#9a7c59");
  b.restore();
  b.translate(-2, -9);
  riderLeg(b, BOOT);
  torso(b, team, 6);
  arm(b, [5, -6], [12, 0], team);
  head(b);
  kettleHelm(b);
  roundShield(b, -10, -1, 6, "#9c8058", team);
}

export const MODEL_PALETTE = { TEAL, REED, OBSIDIAN, MAGMA, MOSS, STEEL };
