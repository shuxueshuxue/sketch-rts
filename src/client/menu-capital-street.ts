import type { Unit, UnitKind } from '../shared/types';
import type { PropPainter, UnitModel } from '../story/cast';
import { storyFigure } from './art/story-rig';
import { INK, darker, ellipse, line, polygon, type Brush } from './art/kit';
import type { FigurePresentation } from './art/rig';
import { cast, stage, terrainOf, type AuthoredMenuSceneRun } from './menu-scene-world';

// A small, authored street scene. Costumes and architecture belong to this
// presentation; its inhabitants do not enlist new match units or run city AI.
const PLASTER = '#d8c9a5';
const STONE = '#b5b39e';
const TIMBER = '#655543';
const SLATE = '#667e77';
const WARM_ROOF = '#92705a';
const PALE = '#e2d4b6';
const CIVILIAN = 'townsfolk';
const CROWN = 'lion';

type Point = { x: number; y: number };
type Stop = Point & { wait?: number };
type Leg = { from: Point; to: Point; begin: number; travel: number; end: number };
type Route = { id: string; phase: number; legs: Leg[]; length: number; face?: Point };

function slab(b: Brush, x: number, y: number, w: number, h: number, color = STONE) {
  polygon(b, [[x - w / 2, y], [x + w / 2, y - 2], [x + w / 2, y + h], [x - w / 2, y + h + 2]], color, '#797c6b', .65);
}

function barrel(b: Brush, x: number, y: number, scale = 1) {
  b.save(); b.translate(x, y); b.scale(scale, scale);
  polygon(b, [[-7, -13], [-9, -9], [-8, 3], [-6, 7], [6, 7], [8, 3], [9, -9], [7, -13]], '#947249', INK, .9);
  ellipse(b, 0, -12, 7, 2.8, '#b39668', '#5c503c');
  for (const x of [-4, 0, 4]) line(b, [[x, -9], [x * 1.2, 4]], '#695438', .65);
  for (const y of [-8, 2]) line(b, [[-8, y], [0, y + 1], [8, y]], '#626863', 1.4);
  b.restore();
}

function window(b: Brush, x: number, y: number, wide = false, lit = false) {
  const w = wide ? 12 : 7;
  polygon(b, [[x - w / 2, y], [x + w / 2, y - 1], [x + w / 2, y + 11], [x - w / 2, y + 12]], lit ? '#c8aa70' : '#45524b', TIMBER, 1);
  line(b, [[x, y], [x, y + 11]], '#b69e74', .7);
  line(b, [[x - w / 2, y + 6], [x + w / 2, y + 5]], '#b69e74', .7);
  line(b, [[x - w / 2 - 1, y + 13], [x + w / 2 + 1, y + 12]], STONE, 1.5);
}

function roof(b: Brush, color: string, x = 0, y = 0) {
  const p = (points: number[][]) => points.map(([px, py]) => [px! + x, py! + y]);
  polygon(b, p([[-55, -31], [-21, -61], [48, -49], [21, -22]]), color, INK, 1.1);
  polygon(b, p([[21, -22], [48, -49], [55, -42], [27, -17]]), darker(color, .2), INK, .9);
  for (let row = 1; row < 5; row++) {
    const t = row / 5;
    line(b, p([[-55 + 34 * t, -31 - 30 * t], [21 + 27 * t, -22 - 27 * t]]), '#b4ad91', .55);
    for (let col = 0; col < 7; col++) {
      const cx = -53 + col * 10.6 + row * 6.8;
      line(b, p([[cx, -31 - row * 6 + col * 1.25], [cx + 6.7, -37 - row * 6 + col * 1.25]]), darker(color, .27), .45);
    }
  }
  line(b, p([[-21, -61], [48, -49]]), '#beb59a', 1.1);
}

function cityHouse(b: Brush, state: string | undefined) {
  const merchant = state === 'shop';
  const plaster = state === 'ochre' ? '#c1ae86' : state === 'rose' ? '#c6ae9b' : PLASTER;
  ellipse(b, 6, 19, 49, 9, '#37453820');
  polygon(b, [[-43, -23], [21, -15], [21, 20], [-43, 12]], plaster, INK, 1.1);
  polygon(b, [[21, -15], [45, -36], [45, -1], [21, 20]], '#aea58a', INK, 1.1);
  for (const x of [-39, -13, 17]) line(b, [[x, -23 + (x + 43) * .125], [x, 12 + (x + 43) * .125]], TIMBER, 2);
  line(b, [[-42, -4], [21, 4]], TIMBER, 2);
  line(b, [[-40, -20], [-15, 0], [15, -15]], '#7f6b52', 1.3);
  for (const [x, y] of [[-29, -15], [4, -11]] as const) window(b, x, y, false, x > 0);
  polygon(b, [[-13, 4], [-3, 5], [-3, 17], [-13, 15.5]], '#394136', TIMBER, 1);
  line(b, [[-10, 6], [-10, 15]], '#9d8058', .6);
  slab(b, -8, 16, 18, 4);
  roof(b, state === 'rose' ? WARM_ROOF : SLATE);
  polygon(b, [[24, -47], [30, -45.5], [30, -57], [24, -58.5]], '#9b9783', INK, .8);
  line(b, [[23, -58], [31, -56.5]], '#d4c5a7', 1.8);
  if (merchant) {
    polygon(b, [[-45, -7], [-15, -3], [-8, 5], [-44, 0]], '#a88759', TIMBER, .8);
    for (let i = 0; i < 4; i++) polygon(b, [[-42 + i * 8, -6.6 + i], [-38 + i * 8, -6 + i], [-33 + i * 8, 3.6 + i], [-38 + i * 8, 3 + i]], '#d3c3a1', 'transparent', 0);
    line(b, [[-43, 0], [-43, 14]], TIMBER, 1.4);
    barrel(b, 32, 10, .8);
  }
}

function tavern(b: Brush) {
  ellipse(b, 8, 29, 50, 10, '#30483628');
  // High timber upper storey; a stone ground floor and deep, open street door.
  polygon(b, [[-46, -15], [16, -7], [16, 26], [-46, 18]], '#b6b099', INK, 1.1);
  polygon(b, [[16, -7], [43, -27], [43, 6], [16, 26]], '#8d9180', INK, 1.1);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
    const x = -44 + col * 10 + (row % 2 ? 4 : 0);
    if (x < 10) line(b, [[x, -9 + row * 8 + (x + 44) * .13], [x + 8, -8 + row * 8 + (x + 44) * .13]], '#d1c7ac', .6);
  }
  polygon(b, [[-48, -39], [17, -31], [17, -6], [-48, -14]], PALE, INK, 1);
  polygon(b, [[17, -31], [43, -50], [43, -26], [17, -6]], '#baa98b', INK, 1);
  for (const x of [-43, -13, 13]) line(b, [[x, -39 + (x + 48) * .12], [x, -14 + (x + 48) * .12]], TIMBER, 2.1);
  line(b, [[-48, -15], [17, -7]], TIMBER, 2.6);
  line(b, [[-44, -36], [-16, -13], [12, -32]], TIMBER, 1.5);
  window(b, -28, -33, true, true); window(b, 1, -29, true, true);
  window(b, 33, -37, false, true);
  polygon(b, [[-16, 0], [-2, 1], [-2, 24], [-16, 22]], '#303930', TIMBER, 1.4);
  line(b, [[-15, 1], [-14, 20]], '#bb9b67', 1.1);
  slab(b, -8, 24, 23, 4);
  window(b, -34, 1, true, true);
  roof(b, WARM_ROOF, 0, -1);
  // Sign is a carved tankard rather than text tied to one locale.
  line(b, [[26, -13], [52, -10]], TIMBER, 2);
  line(b, [[48, -10], [48, -4]], '#8c927e', 1);
  polygon(b, [[38, -4], [60, -1], [58, 16], [38, 13]], '#715e41', INK, .9);
  polygon(b, [[44, 0], [52, 1], [51, 10], [44, 9]], '#d9c192', '#b6a173', .6);
  line(b, [[52, 3], [55, 3.6], [54.5, 8], [51.8, 7.5]], '#d9c192', 1);
  line(b, [[43, 0], [53, 1]], '#eee3c7', 1.4);
  barrel(b, 22, 24, .9); barrel(b, 37, 17, .8);
}

function stall(b: Brush, state: string | undefined) {
  ellipse(b, 4, 20, 38, 7, '#30483622');
  for (const x of [-32, 32]) line(b, [[x, 17], [x, -31]], TIMBER, 1.8);
  polygon(b, [[-37, -32], [31, -38], [40, -18], [-34, -12]], state === 'cloth' ? '#6b7e84' : '#778a60', INK, 1);
  for (let i = 0; i < 5; i++) polygon(b, [[-35 + i * 14, -32 - i * 1.2], [-28 + i * 14, -32.6 - i * 1.2], [-24 + i * 14, -13 - i * 1.2], [-31 + i * 14, -12.5 - i * 1.2]], '#d1c4a4', 'transparent', 0);
  polygon(b, [[-34, -12], [40, -18], [39, -11], [-33, -5]], state === 'cloth' ? '#506674' : '#647b52', INK, .7);
  polygon(b, [[-29, 1], [28, -4], [28, 14], [-29, 19]], '#9d815a', INK, 1);
  polygon(b, [[-31, 0], [30, -6], [30, 1], [-31, 7]], '#b19b75', INK, .8);
  if (state === 'cloth') {
    for (const [x, c] of [[-19, '#aa826f'], [-4, '#c3b18e'], [12, '#6e8a84']] as const) {
      polygon(b, [[x - 6, -3], [x + 7, -4], [x + 7, 8], [x - 6, 9]], c, '#4f5a4c', .55);
      line(b, [[x - 4, -1], [x + 5, -2]], '#d6c7a5', .6);
    }
  } else {
    for (let basket = 0; basket < 3; basket++) {
      const x = -19 + basket * 18;
      polygon(b, [[x - 8, -2], [x + 8, -3], [x + 6, 5], [x - 6, 6]], '#7c6344', INK, .6);
      for (let i = 0; i < 5; i++) ellipse(b, x - 5 + i % 3 * 4, -4 - Math.floor(i / 3) * 3, 2.5, 2.3, basket === 0 ? '#a6634c' : basket === 1 ? '#bdad65' : '#6d8656', '#5c6850');
    }
  }
  barrel(b, 37, 13, .65);
}

function table(b: Brush, state: string | undefined) {
  ellipse(b, 0, 19, 28, 5, '#30483620');
  for (const x of [-15, 15]) line(b, [[x, 0], [x, 19]], TIMBER, 2);
  polygon(b, [[-23, -3], [17, -9], [25, 1], [-17, 8]], '#a08257', INK, 1.1);
  for (let i = 0; i < 4; i++) line(b, [[-20 + i * 10, -3 - i * 1.5], [-15 + i * 10, 6 - i * 1.5]], '#6b593f', .65);
  if (state === 'wares') {
    for (const [x, y, color] of [[-9, -5, '#a28e6c'], [3, -5, '#5e7672'], [13, -4, '#b09f77']] as const) {
      ellipse(b, x, y, 4, 2, color, INK);
      polygon(b, [[x - 3, y], [x + 3, y], [x + 2, y - 8], [x - 2, y - 8]], color, INK, .6);
    }
  } else {
    for (const x of [-10, 10]) {
      polygon(b, [[x - 3, -6], [x + 3, -7], [x + 3, 0], [x - 3, 1]], '#c5b58d', INK, .6);
      line(b, [[x + 3, -5], [x + 5, -5], [x + 5, -1], [x + 3, -1]], '#d7c8a9', .7);
    }
    ellipse(b, 0, -2, 5, 2.7, '#d6c29c', INK);
    polygon(b, [[-3, -3], [2, -5], [4, -2], [0, -1]], '#ad8452', INK, .55);
  }
}

function bench(b: Brush) {
  for (const x of [-20, 20]) line(b, [[x, 0], [x, 14]], TIMBER, 2.2);
  polygon(b, [[-28, -2], [21, -8], [26, -1], [-23, 5]], '#99815c', INK, .9);
  line(b, [[-26, -12], [21, -18]], '#8c7351', 3.5);
  for (const x of [-22, 18]) line(b, [[x, -15], [x, 3]], TIMBER, 1.7);
}

function paving(b: Brush, state: string | undefined) {
  // Square tiles sort before its tables. Keep their picture at the same world
  // position, but anchor it toward the top of the atlas instead of over furniture.
  b.save();
  if (state === 'square') b.translate(0, 39);
  polygon(b, [[-62, -22], [62, -22], [62, 22], [-62, 22]], '#b6b5a0', 'transparent', 0);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 10; col++) {
    const x = -61 + col * 13 + (row % 2 ? 6 : 0);
    if (x > 59) continue;
    const w = Math.min(11.5, 62 - x);
    const y = -21 + row * 8.6;
    const color = (row * 7 + col * 3) % 4 === 0 ? '#c5c3ae' : (row + col) % 3 === 0 ? '#a8ac99' : '#b8b9a4';
    polygon(b, [[x + .3, y + .8], [x + w, y + .4], [x + w - .5, y + 7.2], [x, y + 7.5]], color, '#858d7b', .35);
  }
  line(b, [[-62, -22], [62, -22]], '#d5ceb6', 1.8);
  line(b, [[-62, 22], [62, 22]], '#89937d', 1.1);
  b.restore();
}

function planter(b: Brush, state: string | undefined) {
  polygon(b, [[-28, -5], [21, -11], [27, -4], [-21, 2]], '#73765c', INK, .7);
  polygon(b, [[-28, -5], [-21, 2], [-21, 11], [-28, 4]], '#a99e80', INK, .7);
  polygon(b, [[-21, 2], [27, -4], [27, 5], [-21, 11]], '#bcb196', INK, .8);
  for (let i = 0; i < 8; i++) {
    const x = -22 + i * 6;
    const y = -4 - i * .5;
    line(b, [[x, y], [x + 2, y - 8]], '#637449', 1);
    ellipse(b, x - 2, y - 5, 3, 2, '#738758');
    ellipse(b, x + 3, y - 8, 3, 2, '#8e9a6a');
    if (i % 2 === 0) ellipse(b, x + 2, y - 10, 2.5, 2, state === 'rose' ? '#ad7f72' : '#c7b974');
  }
}

function lamp(b: Brush) {
  ellipse(b, 3, 17, 8, 3, '#30483622');
  slab(b, 0, 14, 11, 3);
  line(b, [[0, 15], [0, -40], [11, -40]], TIMBER, 2);
  line(b, [[9, -40], [9, -34]], '#666c5d', .8);
  polygon(b, [[4, -34], [13, -34], [15, -20], [4, -20]], '#9b9676', INK, .8);
  polygon(b, [[6, -32], [11, -32], [12, -23], [6, -23]], '#d5bb83', '#737662', .5);
  line(b, [[4, -20], [15, -20]], '#666c5d', 1);
}

function drain(b: Brush) {
  slab(b, 0, -4, 37, 8, '#8e9685');
  for (let i = 0; i < 7; i++) line(b, [[-15 + i * 5, -2], [-15 + i * 5, 4]], '#4e5d52', 1.2);
}

function bundles(b: Brush, state: string | undefined) {
  ellipse(b, 2, 15, 23, 5, '#30483620');
  if (state === 'sacks') {
    for (const [x, y] of [[-11, 8], [10, 5], [0, -3]] as const) {
      polygon(b, [[x - 8, y + 5], [x - 10, y - 6], [x - 5, y - 14], [x + 3, y - 15], [x + 8, y - 9], [x + 7, y + 5]], '#b5a37a', INK, .8);
      line(b, [[x - 4, y - 11], [x + 4, y - 12]], TIMBER, .9);
      line(b, [[x + 3, y - 8], [x + 5, y + 2]], '#93815e', .65);
    }
  } else {
    for (const [x, y] of [[-10, 8], [11, 4], [0, -9]] as const) {
      polygon(b, [[x - 9, y - 9], [x + 9, y - 11], [x + 9, y + 5], [x - 9, y + 7]], '#9d8059', INK, .8);
      line(b, [[x - 8, y - 8], [x + 8, y + 4]], '#6a5840', .8);
      line(b, [[x + 8, y - 10], [x - 8, y + 6]], '#6a5840', .8);
    }
  }
}

const PAINTERS: Readonly<Record<string, PropPainter>> = {
  'capital-house': cityHouse,
  'capital-tavern': tavern,
  'capital-market': stall,
  'capital-table': table,
  'capital-bench': bench,
  'capital-paving': paving,
  'capital-planter': planter,
  'capital-lamp': lamp,
  'capital-drain': drain,
  'capital-bundles': bundles,
  'capital-barrels': b => { barrel(b, -9, 3); barrel(b, 11, 0); },
};

function citizen(cloth: string, style: 'merchant' | 'porter' | 'woman' | 'citizen' | 'innkeeper'): UnitModel {
  const presentation: FigurePresentation = {
    weapon: 'none', shield: false, headwear: false, cloth,
    appearance: { armor: false, mounted: false, elite: false, role: style === 'woman' ? 'priest' : 'worker' },
    detail(b, rig, layer) {
      if (layer === 'body') {
        if (style === 'innkeeper' || style === 'porter') {
          polygon(b, [[-3, -24], [3, -24], [5, -3], [-4, -2]], '#c6ba97', INK, .65);
          line(b, [[-3, -11], [4, -11]], '#846f4d', 1);
        }
        if (style === 'merchant') {
          polygon(b, [[-8, -25], [-5, -27], [-3, -22], [-5, -4], [-8, -5]], '#bba47a', INK, .6);
          polygon(b, [[4, -26], [7, -25], [7, -8], [3, -8]], '#bba47a', INK, .6);
          polygon(b, [[-9, -9], [-4, -10], [-3, -3], [-8, -2]], '#705540', INK, .65);
        }
      }
      if (layer === 'head') {
        if (style === 'woman') {
          polygon(b, [[-4, -35], [-3, -39], [2, -39], [4, -36], [1, -37], [-1, -36], [-2, -28], [-4, -29]], '#675246', INK, .6);
          line(b, [[-2, -28], [-3, -21]], '#b49b70', 1.2);
        } else if (style === 'innkeeper') {
          polygon(b, [[-4, -36], [-4, -42], [1, -44], [5, -40], [4, -35]], PALE, INK, .65);
        } else {
          polygon(b, [[-4, -36], [-3, -40], [2, -41], [5, -36], [2, -35]], style === 'merchant' ? '#72594a' : '#85765a', INK, .75);
          line(b, [[-5, -35], [5, -36]], '#af9b70', 1.1);
        }
      }
      if (layer === 'equipment' && style === 'porter') {
        const [x, y] = rig.wrist;
        polygon(b, [[x - 7, y - 3], [x + 8, y - 5], [x + 8, y + 8], [x - 7, y + 10]], '#a28c64', INK, .8);
        line(b, [[x - 6, y - 2], [x + 7, y + 7]], '#6a5940', .7);
        line(b, [[x + 7, y - 4], [x - 6, y + 9]], '#6a5940', .7);
      }
      if (layer === 'equipment' && style === 'innkeeper') {
        const [x, y] = rig.wrist;
        polygon(b, [[x - 6, y], [x + 11, y - 2], [x + 13, y + 1], [x - 5, y + 3]], '#907451', INK, .65);
        for (const offset of [-2, 6]) {
          polygon(b, [[x + offset - 2, y - 6], [x + offset + 2, y - 6.5], [x + offset + 2, y], [x + offset - 2, y + .5]], '#c4b286', INK, .55);
          line(b, [[x + offset + 2, y - 5], [x + offset + 3.8, y - 5], [x + offset + 3.8, y - 1], [x + offset + 2, y - 1]], '#d6c4a0', .65);
        }
      }
    },
  };
  const paint = storyFigure('worker', presentation, style === 'merchant' ? 1.03 : .95);
  return { paint, remains: paint.remains, shadow: 'foot' };
}

const MODELS: Readonly<Record<string, UnitModel>> = {
  'capital/merchant': citizen('#78634f', 'merchant'),
  'capital/cloth-seller': citizen('#637f7c', 'merchant'),
  'capital/porter': citizen('#8d7b5c', 'porter'),
  'capital/citizen': citizen('#827754', 'citizen'),
  'capital/blue-citizen': citizen('#657981', 'citizen'),
  'capital/woman': citizen('#9b7968', 'woman'),
  'capital/green-woman': citizen('#7d8762', 'woman'),
  'capital/innkeeper': citizen('#845f46', 'innkeeper'),
};

function loop(stops: readonly Stop[], speed: number): Pick<Route, 'legs' | 'length'> {
  const legs: Leg[] = [];
  let begin = 0;
  for (let i = 0; i < stops.length; i++) {
    const from = stops[i]!;
    const to = stops[(i + 1) % stops.length]!;
    const travel = Math.hypot(to.x - from.x, to.y - from.y) / speed;
    const end = begin + travel + (to.wait ?? 0);
    legs.push({ from, to, begin, travel, end });
    begin = end;
  }
  return { legs, length: begin };
}

function poseOnRoute(unit: Unit, route: Route, second: number) {
  if (!route.length) return;
  const age = ((second + route.phase) % route.length + route.length) % route.length;
  const leg = route.legs.find(candidate => age < candidate.end) ?? route.legs[route.legs.length - 1]!;
  const t = leg.travel ? Math.min(1, (age - leg.begin) / leg.travel) : 1;
  unit.x = leg.from.x + (leg.to.x - leg.from.x) * t;
  unit.y = leg.from.y + (leg.to.y - leg.from.y) * t;
  if (t < 1) unit.order = { type: 'move', x: leg.to.x, y: leg.to.y, avoidCombat: true };
  else unit.order = { type: 'idle' };
}

// The camera's tour through the city (see @@@capital-tour), its focus points in world units. The menu covers the left of
// a wide screen, so there the focus sits at seven tenths across and the street is seen east of it.
const DESKTOP_TOUR: readonly Point[] = [{ x: 1230, y: 1150 }, { x: 1420, y: 1000 }, { x: 1760, y: 960 }, { x: 2010, y: 1200 }];
const COMPACT_TOUR: readonly Point[] = [{ x: 1230, y: 1120 }, { x: 1420, y: 980 }, { x: 1760, y: 940 }, { x: 2010, y: 1170 }];
const MOBILE_TOUR: readonly Point[] = [{ x: 1150, y: 1110 }, { x: 1400, y: 1000 }, { x: 1720, y: 930 }, { x: 2060, y: 1200 }];

/** The point a share `progress` (0..1) of the way along a path, by length. */
function alongPath(path: readonly Point[], progress: number): Point {
  const lengths = path.slice(1).map((point, index) => Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y));
  let left = progress * lengths.reduce((total, length) => total + length, 0);
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (left <= length || index === lengths.length - 1) {
      const share = length ? Math.min(1, left / length) : 0, from = path[index]!, to = path[index + 1]!;
      return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
    }
    left -= length;
  }
  return path[0]!;
}

/** City daily life is a fixed cast of 24, a static street and a slow camera.
 * All route updates are bounded linear arithmetic, independent of map size. */
export function createCapitalStreet(): AuthoredMenuSceneRun {
  const p = cast();
  const width = 2800, height = 1900;
  const terrain = terrainOf(width, height, (x, y) => {
    if (x < 560 || x > 2280 || y < 540 || y > 1560) return 'T';
    if (y > 1480 && x > 1900) return ',';
    return '.';
  });
  // Continuous street surface, separate footpaths and a small tavern square.
  for (let i = 0; i < 7; i++) {
    p.prop('capital-paving', 780 + i * 285, 1110, 2.3);
    p.prop('capital-paving', 780 + i * 285, 1232, 2.3);
  }
  for (let i = 0; i < 5; i++) p.prop('capital-paving', 1180 + i * 220, 1250, 1.8, 'square');

  const houses: [number, number, number, string][] = [
    [820, 916, 1.75, 'ochre'], [1040, 929, 1.85, 'shop'], [1275, 929, 1.75, 'rose'],
    [1510, 876, 1.85, 'shop'], [1910, 899, 1.9, 'ochre'], [2140, 924, 1.8, 'rose'],
    [970, 1452, 1.7, 'rose'], [1210, 1473, 1.9, 'ochre'], [2090, 1469, 1.8, 'shop'],
  ];
  for (const [x, y, scale, state] of houses) p.prop('capital-house', x, y, scale, state);
  p.prop('capital-tavern', 1740, 973, 2.2);
  p.prop('capital-market', 1160, 1015, 1.25, 'produce');
  p.prop('capital-market', 1370, 1012, 1.25, 'cloth');
  p.prop('capital-table', 1940, 1310, 1.1, 'wares');
  p.prop('capital-table', 1640, 1313, 1.1);
  p.prop('capital-table', 1780, 1310, 1.1);
  p.prop('capital-bench', 1640, 1354, 1.05);
  p.prop('capital-bench', 1780, 1352, 1.05);
  p.prop('capital-barrels', 1850, 1028, 1.25);
  p.prop('capital-bundles', 1090, 1050, 1, 'sacks');
  p.prop('capital-bundles', 1420, 1045, 1, 'crates');
  p.prop('capital-bundles', 1920, 1355, 1, 'sacks');
  for (const [x, y] of [[900, 1027], [1455, 1033], [2000, 1031], [1550, 1360], [2020, 1350]] as const) p.prop('capital-lamp', x, y, 1.15);
  for (const [x, y, color] of [[970, 989, 'rose'], [1460, 993, 'gold'], [1980, 985, 'rose'], [1530, 1475, 'gold'], [1885, 1475, 'rose']] as const) p.prop('capital-planter', x, y, 1.1, color);
  for (const x of [1035, 1520, 1970]) p.prop('capital-drain', x, 1168, 1.1);
  p.prop('cart', 2140, 1250, 1.3);
  p.prop('well', 1490, 1267, 1.05);
  p.prop('tree', 760, 1033, 1.9);
  p.prop('tree', 2240, 1335, 2);
  p.prop('tree', 1455, 1480, 1.7);
  p.prop('tree', 1880, 1495, 1.7);

  // The city rises behind the shops rather than occupying the street's centre.
  const hall = p.building(CROWN, 'townHall', 1700, 698);
  p.building(CROWN, 'defenseTower', 2010, 737);
  p.building(CROWN, 'barracks', 1110, 721);
  p.prop('banner', 1580, 783, 1.2);
  p.prop('banner', 1830, 774, 1.2);

  const routes: Route[] = [];
  const appearances = new Map<string, string>();
  const actor = (kind: UnitKind, x: number, y: number, variant?: string, stops?: Stop[], speed = 26, phase = 0, face?: Point) => {
    const id = p.unit(variant ? CIVILIAN : CROWN, kind, x, y);
    if (variant) appearances.set(id, variant);
    routes.push({ id, phase, ...(stops ? loop(stops, speed) : { legs: [], length: 0 }), ...(face ? { face } : {}) });
    return id;
  };
  // Shopkeepers face customers; customers arrive, linger, then continue along
  // the clear middle of the street. Every moving route avoids the furniture.
  actor('worker', 1160, 1029, 'capital/merchant', undefined, 26, 0, { x: 1180, y: 1090 });
  actor('worker', 1369, 1026, 'capital/cloth-seller', undefined, 26, 0, { x: 1394, y: 1085 });
  actor('worker', 1910, 1305, 'capital/merchant', undefined, 26, 0, { x: 1870, y: 1310 });
  actor('worker', 1187, 1084, 'capital/green-woman', [
    { x: 1187, y: 1084, wait: 5 }, { x: 1240, y: 1110 }, { x: 1490, y: 1110, wait: 2 },
    { x: 1490, y: 1147 }, { x: 1200, y: 1147 }, { x: 1187, y: 1084, wait: 5 },
  ], 25, 4);
  actor('worker', 1393, 1085, 'capital/blue-citizen', [
    { x: 1393, y: 1085, wait: 6 }, { x: 1435, y: 1125 }, { x: 1840, y: 1125, wait: 3 },
    { x: 1840, y: 1170 }, { x: 1410, y: 1170 }, { x: 1393, y: 1085, wait: 6 },
  ], 27, 6);
  actor('worker', 1020, 1189, 'capital/porter', [
    { x: 1020, y: 1189, wait: 2 }, { x: 1920, y: 1189, wait: 3 },
  ], 28, 11);
  actor('worker', 1980, 1218, 'capital/porter', [
    { x: 1980, y: 1218, wait: 3 }, { x: 1270, y: 1218, wait: 3 },
  ], 25, 7);
  actor('worker', 1722, 1045, 'capital/innkeeper', [
    { x: 1722, y: 1045, wait: 4 }, { x: 1722, y: 1262 }, { x: 1748, y: 1300, wait: 5 },
    { x: 1722, y: 1262 }, { x: 1722, y: 1045, wait: 4 },
  ], 26, 3);
  actor('worker', 1814, 1053, 'capital/citizen', [
    { x: 1814, y: 1053, wait: 6 }, { x: 1840, y: 1090 }, { x: 2000, y: 1090, wait: 2 },
    { x: 2000, y: 1158 }, { x: 1814, y: 1158 }, { x: 1814, y: 1053, wait: 5 },
  ], 24, 2);
  actor('worker', 1595, 1345, 'capital/blue-citizen', undefined, 26, 0, { x: 1666, y: 1340 });
  actor('worker', 1664, 1340, 'capital/citizen', undefined, 26, 0, { x: 1595, y: 1345 });
  actor('worker', 1748, 1338, 'capital/green-woman', undefined, 26, 0, { x: 1811, y: 1336 });
  actor('worker', 1811, 1336, 'capital/merchant', undefined, 26, 0, { x: 1748, y: 1338 });
  actor('worker', 1847, 1305, 'capital/woman', [
    { x: 1847, y: 1305, wait: 8 }, { x: 1847, y: 1260 }, { x: 2050, y: 1260, wait: 3 },
    { x: 2050, y: 1290 }, { x: 1872, y: 1290 }, { x: 1847, y: 1305, wait: 8 },
  ], 23, 9);
  actor('worker', 1500, 1380, 'capital/woman', [
    { x: 1500, y: 1380, wait: 2 }, { x: 1980, y: 1380, wait: 3 },
  ], 22, 3);
  actor('worker', 1940, 1420, 'capital/citizen', [
    { x: 1940, y: 1420, wait: 3 }, { x: 1540, y: 1420, wait: 3 },
  ], 26, 13);
  // Two pairs use separate patrol lanes. They are not the whole city's crowd.
  for (let i = 0; i < 2; i++) actor('footman', 1150 + i * 31, 1152, undefined, [
    { x: 1150 + i * 31, y: 1152, wait: 3 }, { x: 2010 + i * 31, y: 1152, wait: 3 },
  ], 28, 17);
  for (let i = 0; i < 2; i++) actor('lancer', 1540 + i * 33, 1278, undefined, [
    { x: 1540 + i * 33, y: 1278, wait: 3 }, { x: 2080 + i * 33, y: 1278, wait: 3 },
  ], 27, 5);
  actor('lancer', 990, 1067);
  actor('lancer', 2150, 1074);
  actor('worker', 1570, 1028, 'capital/merchant', undefined, 26, 0, { x: 1605, y: 1063 });
  actor('worker', 1605, 1063, 'capital/woman', undefined, 26, 0, { x: 1570, y: 1028 });

  const game = stage(width, height, terrain, [[CROWN, 'grove'], [CIVILIAN, 'grove']], p);
  const units = new Map(game.units.map(unit => [unit.id, unit]));
  for (const [id, variant] of appearances) units.get(id)!.variant = variant;
  for (const route of routes) if (route.face) {
    const unit = units.get(route.id)!;
    unit.order = { type: 'hold', ...route.face };
    unit.aim = { ...route.face, anchorX: unit.x, anchorY: unit.y, tracking: false, updatedTick: 0 };
  }
  const scene: AuthoredMenuSceneRun = {
    game, props: p.props, presentation: true, stillSecond: 15,
    focus: { x: 1620, y: 1210 }, zoom: 1.15,
    length: 90,
    models: variant => MODELS[variant],
    buildingModels: { [hall]: 'citadel' },
    painters: PAINTERS,
    script(_game, second) {
      for (const route of routes) poseOnRoute(units.get(route.id)!, route, second);
    },
    frameAt(second, viewportWidth, viewportHeight) {
      // @@@capital-tour - The camera walks the whole city in one eased pass: the west market, up past the barracks and
      // the hall, and down to the tavern square at the east end. It used to drift 215 (50 on a phone) over 80 s and
      // showed one shopfront; the street runs from 760 to 2240.
      const t = Math.max(0, Math.min(1, (second - 2) / 80));
      const mobile = viewportWidth < 700;
      const compact = viewportHeight < 760;
      const at = alongPath(mobile ? MOBILE_TOUR : compact ? COMPACT_TOUR : DESKTOP_TOUR, t * t * (3 - 2 * t));
      return mobile ? {
        focus: at,
        zoom: .93 * Math.max(.87, Math.min(1.08, viewportHeight / 844)), anchorX: .52, anchorY: .4,
      } : {
        focus: at,
        zoom: (compact ? 1.08 : 1.15) * Math.max(.88, Math.min(1.28, viewportHeight / 900)), anchorX: .7, anchorY: .5,
      };
    },
    embers: [], glows: [],
    air: { dusk: .14, mist: '216, 204, 163', mistAlpha: .025, rays: '247, 222, 167', rayAngle: -.35, motes: 'glints' },
  };
  scene.script(game, 0);
  return scene;
}
