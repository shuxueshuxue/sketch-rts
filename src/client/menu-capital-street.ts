import type { Unit, UnitKind } from '../shared/types';
import type { PropPainter, UnitModel } from '../story/cast';
import { storyFigure } from './art/story-rig';
import { INK, line, polygon, type Brush } from './art/kit';
import type { FigurePresentation } from './art/rig';
import { cast, stage, terrainOf, type AuthoredMenuSceneRun } from './menu-scene-world';
import { paintBuildingModel } from './art/building-models';
import { CAPITAL_MODELS } from './art/model-manifest';

// A small, authored street scene. Costumes and architecture belong to this
// presentation; its inhabitants do not enlist new match units or run city AI.
const STONE = '#b5b39e';
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

function paving(b: Brush, _state: string | undefined) {
  // A ground mark (docs/art/prop-painting.zh.md §7): flat, centred on its point, quiet. Stone courses are suggested by a
  // few low-contrast joints, so the street reads as one surface and the people and houses on it stay the subject.
  polygon(b, [[-62, -22], [62, -22], [62, 22], [-62, 22]], '#bdb9a2', 'transparent', 0);
  for (let row = 1; row < 5; row++) line(b, [[-62, -22 + row * 8.8], [62, -22 + row * 8.8]], '#a9a68f66', .45);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
    const x = -55 + col * 22 + (row % 2 ? 11 : 0), y = -22 + row * 8.8;
    if (x < 60) line(b, [[x, y + .6], [x, y + 8.2]], '#a9a68f55', .4);
    if (x < 44 && (row * 5 + col * 3) % 7 === 0) polygon(b, [[x + 2, y + 1.2], [x + 18, y + 1.2], [x + 18, y + 7.6], [x + 2, y + 7.6]], '#c7c3ab55', 'transparent', 0);
  }
  line(b, [[-62, -22], [62, -22]], '#cfc8b0', 1.2);
  line(b, [[-62, 22], [62, 22]], '#9c9a84', .9);
}

function drain(b: Brush) {
  slab(b, 0, -4, 37, 8, '#8e9685');
  for (let i = 0; i < 7; i++) line(b, [[-15 + i * 5, -2], [-15 + i * 5, 4]], '#4e5d52', 1.2);
}

// Without the 3D layer, a capital model is painted from the same construction, ground centre on the prop's point, at 0.4 of its
// size so it fits its atlas cell (the tavern's chimney stands 134), and drawn back up to its world size (see PropPainter.paintScale).
function modelPainter(kind: typeof CAPITAL_MODELS[number]): PropPainter {
  return Object.assign((b: Brush) => { b.save(); b.scale(.4, .4); b.translate(0, -19); paintBuildingModel(b, kind, '#a79b7f'); b.restore(); }, { paintScale: .4 });
}

const PAINTERS: Readonly<Record<string, PropPainter>> = {
  'capital-paving': paving,
  'capital-drain': drain,
  ...Object.fromEntries(CAPITAL_MODELS.map(kind => [kind, modelPainter(kind)])),
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
  // The tavern square's tiles: a ground mark under whatever stands on them (see @@@prop-stands).
  for (let i = 0; i < 5; i++) p.prop('capital-paving', 1180 + i * 220, 1320, 1.8, 'square');

  const houses: [number, number, number, string][] = [
    [820, 916, 1.75, 'ochre'], [1040, 929, 1.85, 'shop'], [1275, 929, 1.75, 'rose'],
    [1510, 876, 1.85, 'shop'], [1910, 899, 1.9, 'ochre'], [2140, 924, 1.8, 'rose'],
    [970, 1452, 1.7, 'rose'], [1210, 1473, 1.9, 'ochre'], [2090, 1469, 1.8, 'shop'],
  ];
  // Houses, the tavern and the street furniture stand as models built like the game's buildings (see @@@capital-models),
  // sized in world units against a person.
  const houseModel = { ochre: 'capital-house-slate', rose: 'capital-house-copper', shop: 'capital-house-shop' } as const;
  for (const [x, y, , state] of houses) p.prop(houseModel[state as keyof typeof houseModel], x, y, 1.25);
  p.prop('capital-tavern', 1740, 973, 1.15);
  p.prop('capital-stall-produce', 1160, 1015, 1);
  p.prop('capital-stall-cloth', 1370, 1012, 1);
  for (const x of [1940, 1640, 1780]) p.prop('capital-table', x, 1310, 1);
  for (const x of [1640, 1780]) p.prop('capital-bench', x, 1352, 1);
  p.prop('capital-barrels', 1850, 1028, 1);
  p.prop('capital-sacks', 1090, 1050, 1);
  p.prop('capital-crates', 1420, 1045, 1);
  p.prop('capital-sacks', 1920, 1355, 1);
  for (const [x, y] of [[900, 1027], [1455, 1033], [2000, 1031], [1550, 1360], [2020, 1350]] as const) p.prop('capital-lamp', x, y, 1);
  for (const [x, y] of [[970, 989], [1460, 993], [1980, 985], [1530, 1475], [1885, 1475]] as const) p.prop('capital-planter', x, y, 1);
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
