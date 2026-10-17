/** A summoned shade has a draped silhouette, not a human armature. The hood,
 * sleeves and dissolving hem each keep an authored contour through recovery. */
import type { Brush, XY } from './kit';
import { darker, lighter, line } from './kit';
import type { CreatureDrawing } from './creature-poses';
import type { CreatureLook } from './creature-painters';

type Contour = readonly (readonly number[])[];
const INK = '#48534c';
const LIGHT = '#e0dcc4';

function path(b: Brush, points: Contour) {
  b.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (!i) b.moveTo(p[0]!, p[1]!);
    else if (p.length === 6) b.bezierCurveTo(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!);
    else b.lineTo(p[0]!, p[1]!);
  }
}

function veil(b: Brush, points: Contour, color: string, alpha = 1, edge = true) {
  b.save();
  b.globalAlpha *= alpha;
  path(b, points); b.closePath(); b.fillStyle = color; b.fill();
  if (edge) { b.strokeStyle = INK; b.lineWidth = .55; b.stroke(); }
  b.restore();
}

function fold(b: Brush, points: Contour, color: string, width = .7) {
  path(b, points); b.strokeStyle = color; b.lineWidth = width; b.stroke();
}

/** A sleeve unfurls as one continuous sheet. Its empty cuff terminates at the
 * same socket used by the release effects, with no imposed elbow or wrist. */
function sleeve(b: Brush, root: XY, cuff: XY, sweep: number, color: string, far: boolean) {
  const [x, y] = root, [tx, ty] = cuff;
  veil(b, [[x - 3, y - 3], [x + 6, y - 7, tx - 6, ty - 4 - sweep, tx + 2, ty - 3],
    [tx + 4, ty], [tx - 2, ty + 6], [tx - 8, ty + 7],
    [tx - 7, ty + 1 + sweep, x + 2, y + 11, x - 4, y + 7]], color, far ? .58 : .93);
  fold(b, [[x, y - 2], [x + 7, y - 3, tx - 7, ty - 1 - sweep * .3, tx + 1, ty - 2]], lighter(color, .18));
  fold(b, [[x - 1, y + 4], [x + 4, y + 5, tx - 9, ty + 5 + sweep * .4, tx - 4, ty + 5]], darker(color, .25), .6);
  // The light seam describes the open cloth edge; it is neither a fist nor a
  // pair of eyes, and remains visible at the contact point in small sprites.
  fold(b, [[tx + 2, ty - 3], [tx - 2, ty - 1, tx, ty + 2, tx - 2, ty + 4]], LIGHT, .8);
}

// @@@spirit-team - A pale shade looked the same whoever summoned it. Its owner now burns through it: a glow of the
// team's colour round the mantle, a coloured core in its chest, the hood's hollow and its eye slit lit in that colour,
// and the trailing shroud tinted by it. The cloth itself stays pale, so it still reads as a spirit, not a soldier.
export function paintSpirit(b: Brush, look: CreatureLook, p: CreatureDrawing) {
  const c = look.color, team = look.team;
  const strike = Math.max(0, p.strike), cast = p.casting;
  const surge = strike * 3, sway = p.walk * 2.6 + p.motion.breathe * 1.4;
  const trail = -5 - Math.abs(p.walk) * 5 + sway;
  // A whole upper mass responds to the intention; the hem lags behind rather
  // than walking on nonexistent feet. Socket coordinates stay in card space.
  const chestX = p.dx * 3.5, chestY = p.dy * 3.5;
  const headX = chestX + strike * 1.1, headY = chestY - surge * .25;
  b.save(); b.translate(0, p.bob); b.lineCap = 'round'; b.lineJoin = 'round';

  // Thin loose shroud behind the shoulders and a receding lower cloud. The
  // dark core carries the outline; translucent edges keep the body airborne.
  veil(b, [[-9 + chestX, -31 + chestY], [-21, -25, -18, -13, -17 + sway, -4],
    [-15 + trail, 3, -23 + trail, 6, -24 + trail, 12],
    [-17 + trail, 8, -13 + trail, 14, -23 + trail, 18],
    [-7 + trail, 15, -6 + trail, 4, 2, -2], [5 + chestX, -22 + chestY]], darker(team, .1), .55, false);
  fold(b, [[-15, -16], [-22, -4, -12 + trail, 6, -22 + trail, 15]], '#879b8980', .8);

  const farCuff: XY = cast ? [p.release[0] - 7, p.release[1] + 4]
    : [-16 + sway - strike * 2, -6 - p.dy * 8 - surge];
  sleeve(b, [-8 + chestX, -25 + chestY], farCuff, cast * -3, darker(c, .24), true);

  // One pale mantle with a broad shoulder plane. Broken, tapering folds turn
  // into vapour; there is no pointed hat, circular face or skirt/leg joint.
  const body: Contour = [[-9 + chestX, -30 + chestY], [-3 + chestX, -33 + chestY], [8 + chestX, -28 + chestY],
    [13 + chestX, -23 + chestY, 11 + sway, -8, 10 + sway, -2],
    [8 + sway, 5, 1 + sway, 11, 6 + trail, 16], [0 + trail, 13],
    [-3 + trail, 8, -6 + trail, 12, -11 + trail, 17],
    [-9 + trail, 8, -15 + sway, 5, -12 + sway, -5], [-12 + chestX, -17 + chestY]];
  b.save(); path(b, body); b.closePath(); b.strokeStyle = team; b.globalAlpha *= .5; b.lineWidth = 4.5; b.stroke(); b.restore();
  veil(b, body, c, .88);
  b.save(); path(b, body); b.closePath(); b.clip();
  const core = b.createRadialGradient(chestX, -18 + chestY, 1, chestX, -18 + chestY, 15);
  core.addColorStop(0, team); core.addColorStop(1, /^#[0-9a-f]{6}$/i.test(team) ? `${team}00` : "transparent");
  b.globalAlpha *= .75; b.fillStyle = core; b.fillRect(-35, -40, 65, 60); b.globalAlpha /= .75;
  const wash = b.createLinearGradient(-13, -32, 14, 13);
  wash.addColorStop(0, '#ebe5c855'); wash.addColorStop(.4, '#dae0c900'); wash.addColorStop(1, '#36595366');
  b.fillStyle = wash; b.fillRect(-35, -34, 65, 54); b.restore();
  veil(b, [[3 + chestX, -28 + chestY], [11 + chestX, -23 + chestY],
    [8 + sway, -11, 8 + sway, 3, 0 + trail, 11], [2 + sway, -1],
    [3 + chestX, -17 + chestY]], darker(c, .2), .8, false);
  fold(b, [[-7 + chestX, -25 + chestY], [-11 + sway, -16, -2 + sway, -4, -8 + trail, 11]], '#e1dfc38c', 1);
  fold(b, [[-1 + chestX, -27 + chestY], [-4, -13, 4 + sway, -4, -2 + trail, 8]], '#687f705e', .7);
  fold(b, [[8 + chestX, -22 + chestY], [5 + sway, -12, 9 + sway, -5, 3 + trail, 11]], '#657d7066', .65);
  // Sparse fixed marks suggest fraying weave without generating new noise on
  // every animation sample or making the pale model muddy at game scale.
  b.beginPath();
  for (const [x, y] of [[-8, -21], [-6, -15], [-7, -7], [4, -18], [6, -11], [-2, 1]]) {
    b.moveTo(x! + chestX * .5, y! + chestY * .4); b.lineTo(x! + .7 + chestX * .5, y! + 2.3 + chestY * .4);
  }
  b.strokeStyle = '#586e6140'; b.lineWidth = .45; b.stroke();

  // An oblique, deep hood replaces the old oval head. A single subdued inner
  // slit and the forward opening define its facing without a cartoon face.
  const hx = headX, hy = headY;
  veil(b, [[hx - 9, hy - 29], [hx - 10, hy - 36, hx - 5, hy - 43, hx + 1, hy - 45],
    [hx + 8, hy - 42, hx + 11, hy - 35, hx + 9, hy - 28],
    [hx + 4, hy - 25], [hx - 3, hy - 27]], darker(c, .08), .97);
  veil(b, [[hx + 1, hy - 40], [hx + 6, hy - 38], [hx + 8, hy - 33],
    [hx + 6, hy - 27], [hx + 1, hy - 28], [hx - 1, hy - 33]], darker(team, .55), .92, false);
  veil(b, [[hx - 8, hy - 32], [hx - 7, hy - 39, hx - 4, hy - 42, hx + 1, hy - 44],
    [hx - 3, hy - 36, hx - 1, hy - 31, hx - 3, hy - 27]], lighter(c, .13), .9, false);
  fold(b, [[hx - 6, hy - 39], [hx - 2, hy - 44, hx + 4, hy - 42, hx + 7, hy - 37]], '#e4e0c799', .9);
  fold(b, [[hx + 1.5, hy - 34], [hx + 4.7, hy - 34.6], [hx + 6, hy - 34]], lighter(team, .45), 1.1);
  fold(b, [[hx + 8, hy - 34], [hx + 8, hy - 30], [hx + 5, hy - 27]], '#a9b8a490', .6);
  fold(b, [[hx - 6, hy - 28], [hx - 1, hy - 26], [hx + 5, hy - 26]], '#6e82718c', .75);

  const cuff: XY = [p.release[0], p.release[1]];
  const sweep = cast ? -4 * cast : strike * (p.variant === 1 ? 5 : p.variant === 2 ? -3 : 1);
  sleeve(b, [7 + chestX, -24 + chestY], cuff, sweep, lighter(c, .035), false);
  if (strike || cast) {
    b.save(); b.globalAlpha *= Math.max(strike, cast) * .6;
    // Short flecks follow the release plane. A long beam would imply a range
    // change; these belong to the cuff and recover on the existing hit clock.
    const ax = Math.cos(p.aim.angle), ay = Math.sin(p.aim.angle);
    line(b, [[cuff[0] - ax * 2, cuff[1] - ay * 2], [cuff[0] + ax * 3, cuff[1] + ay * 3]], LIGHT, .85);
    if (cast) fold(b, [[cuff[0] - 4, cuff[1] + 1],
      [cuff[0] - 2, cuff[1] - 5, cuff[0] + 4, cuff[1] - 5, cuff[0] + 5, cuff[1]]], '#dddcc1', .7);
    b.restore();
  }
  b.restore();
}

/** No fallen human or stone rubble: the same shroud collapses into a quiet
 * torn veil and loose spectral threads on the ground. */
export function paintSpiritRemains(b: Brush) {
  veil(b, [[-19, 1], [-14, -4, -5, -5, 3, -1], [12, -1, 18, 4, 24, 2],
    [17, 7], [9, 5], [4, 8], [-3, 5], [-12, 6], [-10, 2]], '#9ba58f', .28, false);
  fold(b, [[-16, 1], [-8, -4, -1, 3, 9, 3]], '#74857877', .7);
  fold(b, [[-7, 4], [2, -1, 7, 7, 18, 4]], '#bac1a45c', .8);
  fold(b, [[-22, 5], [-11, 2, -14, 8, -6, 7]], '#879b7466', .65);
  fold(b, [[10, -2], [18, -1, 20, 2, 26, 0]], '#b9bfa050', .6);
}
