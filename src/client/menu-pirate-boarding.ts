import { localToWorld, shipProfile, SHIP_CAMERA } from '../shared/ship-geometry';
import { resolveVariant } from '../shared/catalog';
import { initializeShipEquipment, rebuildShipFittings } from '../shared/ship-equipment';
import { shipBoardingGoal } from '../shared/ship-gangway';
import { boardUnit, syncDecks } from '../shared/decks';
import { issuePlayerCommand } from '../shared/sim';
import type { Corpse, Unit } from '../shared/types';
import type { UnitModel, PropPainter } from '../story/cast';
import type { PropView } from '../story/stage';
import { storyFigure } from './art/story-rig';
import { ellipse, line, polygon, type Point } from './art/kit';
import { projectWorld } from './world-projection';
import { drawWarfareEffect } from './warfare-effects';
import { cast, seeded, stage, terrainOf, type MenuSceneRun } from './menu-scene-world';

const PIRATES = 'corsairs', GUARD = 'admiralty';
const CX = 2280, CY = 1430, HEADING = -1.42;
// How far astern of its berth the pirate hull opens, sailing up into it (see the opening below).
const ASTERN = 360;
const presentationHeight = (ship: Unit) => shipProfile(ship)!.deckHeight * Math.tan(SHIP_CAMERA.tilt);

/** Scene-local costume: shared authored body, contact poses and weapon sockets. */
function pirateModel(captain = false): UnitModel {
  const paint = storyFigure('footman', {
    appearance: { armor: false, elite: false }, shield: false, headwear: false,
    cloth: captain ? '#4a4a40' : '#83715d', weapon: 'sword',
    detail(b, _rig, part) {
      if (part === 'head') {
        if (captain) {
          polygon(b, [[-9,-37],[-5,-42],[0,-39],[6,-43],[9,-37],[3,-35],[-4,-35]], '#363b36', '#272e2a', .8);
          line(b, [[-7,-38],[-4,-40],[0,-38],[5,-40],[7,-38]], '#b29b65', .8);
          ellipse(b, 1, -37, 1, 1.4, '#d4c9a5');
        } else {
          polygon(b, [[-4,-38],[-2,-40],[2,-39],[5,-36],[2,-34],[-4,-35]], '#9b493a', '#493d30', .65);
          line(b, [[-4,-36],[-8,-33],[-7,-30]], '#9b493a', 2.2);
        }
        line(b, [[1,-34],[4,-34]], '#30342d', 1.3);
      } else if (part === 'body') {
        line(b, [[-6,-10],[6,-10]], '#984d3b', 3);
        line(b, [[-5,-24],[4,-11]], '#3f3e33', 2.1);
      }
    },
  }, captain ? 1.65 : 1.5);
  return { paint, remains: paint.remains, shadow: 'foot' };
}
function guardModel(): UnitModel {
  const paint = storyFigure('footman', { shield: false, weapon: 'sword', headwear: false,
    cloth: '#687e79', appearance: { armor: false, elite: false },
    detail(b, _rig, part) {
      if (part === 'head') {
        polygon(b, [[-7,-36],[-4,-41],[0,-38],[5,-41],[7,-36],[0,-35]], '#3e5553', '#283c35', .75);
        line(b, [[-5,-38],[0,-36],[5,-38]], '#c9ba89', .9);
      } else if (part === 'body') {
        line(b, [[-5,-23],[4,-11]], '#d0c8ab', 2.6);
        for (const y of [-22,-18,-14]) ellipse(b, 1, y, .65, .65, '#d8c8a0');
      }
    },
  }, 1.45);
  return { paint, remains: paint.remains, shadow: 'foot' };
}
const painters: Readonly<Record<string, PropPainter>> = {
  'boarding-pirate-flag': (b, state) => {
    if (state === 'hidden') return;
    polygon(b, [[0,-8],[52,-4],[48,21],[0,18]], '#343b35', '#252e29', 1);
    line(b, [[15,15],[34,0]], '#cfccb4', 2); line(b, [[15,0],[34,15]], '#cfccb4', 2);
    ellipse(b,25,3,6,6,'#d9d3b9'); polygon(b,[[21,6],[28,6],[27,10],[22,10]],'#d9d3b9','transparent',0);
    ellipse(b,23,2,1.1,1.2,'#343b35'); ellipse(b,28,2,1.1,1.2,'#343b35');
    line(b, [[0,-14],[0,26]], '#624f38', 2);
  },
};

type DeckProp = { view: PropView; shipId: string; at: Point; mast?: boolean; shows?: (ship: Unit) => boolean };

/** Pirates board an admiralty ship of the line (see @@@menu-battles). Only the opening is authored: the pirate hull
 * astern of its berth and closing under sail, both with their own guns, the crews on deck, the pirate helm ordered to
 * grapple and board. The match simulation fights the rest: the broadsides as it comes up, the bridge, the melee on deck
 * and the prize. */
export function createPirateBoarding(seed = 1): MenuSceneRun {
  const random = seeded(seed);
  const pieces = cast();
  const game = stage(4300, 2900, terrainOf(4300, 2900, () => '~'), [[PIRATES,'grove'],[GUARD,'grove']], pieces);
  // A wind on the beam: both hulls sail at their best, so the chase is short enough for the home screen.
  game.map.wind = { direction: HEADING + Math.PI / 2, speed: 36 };
  game.players[PIRATES]!.color = '#856144'; game.players[GUARD]!.color = '#4f8581';
  // Hulls come in as the game launches them, under sail and ready to steer.
  const a = game.spawnUnit(PIRATES, 'shipOfTheLine', CX, CY), b = game.spawnUnit(GUARD, 'shipOfTheLine', CX, CY);
  // Drawn up side by side, a hull's width apart; the boarders are then laid alongside, below.
  const normal = { x: -Math.sin(HEADING), y: Math.cos(HEADING) }, half = shipProfile(a)!.beam;
  a.x = CX + normal.x * half; a.y = CY + normal.y * half;
  b.x = CX - normal.x * half; b.y = CY - normal.y * half;
  for (const ship of [a, b]) { ship.sailing!.heading = HEADING; delete ship.fittings; ship.order = { type: 'hold', x: ship.x, y: ship.y }; }
  game.items = [];
  // Each hull carries a ship of the line's own four guns, and both broadsides answer as the pirates come up.
  initializeShipEquipment(game);
  for (const ship of [a, b]) rebuildShipFittings(game, ship);
  const models = new Map<string, UnitModel>([
    ['menu/pirate', pirateModel()], ['menu/pirate-captain', pirateModel(true)], ['menu/marine', guardModel()],
  ]);
  game.variants = Object.fromEntries([...models.keys()].map(id => [id, resolveVariant({base:'footman'})]));
  const crew = (ship: Unit, variant: string, count: number) => Array.from({ length: count }, (_, i) => {
    const unit = game.spawnUnit(ship.owner, 'footman', ship.x, ship.y);
    unit.variant = variant === 'menu/pirate' && i === 0 ? 'menu/pirate-captain' : variant;
    if (!boardUnit(ship, unit, game.units)) throw new Error(`No deck room for ${variant} on ${ship.id}`);
    return unit;
  });
  // Four a side, one more boarder some visits: a fight on deck costs the simulation far more than one on land, and the
  // home screen keeps it small.
  crew(a, 'menu/pirate', 4 + Math.floor(random() * 2));
  crew(b, 'menu/marine', 4);
  syncDecks(game.units);
  for (const unit of game.units) if (unit.deck) unit.order = { type: 'hold', x: unit.x, y: unit.y };
  // The scene opens with the pirates in the admiralty ship's wake, on the line of the berth the simulation itself would
  // choose and already on its heading: the helm sails straight up into it, trading broadsides as the guns come to bear,
  // and the bridge goes out once it lies alongside.
  const berth = shipBoardingGoal(game.map, game.units, a, b);
  if (!berth) throw new Error('The pirates have no berth alongside the admiralty ship');
  Object.assign(a, { x: berth.x - Math.cos(berth.heading) * ASTERN, y: berth.y - Math.sin(berth.heading) * ASTERN }); a.sailing!.heading = berth.heading;
  // The camera frames the two hulls where they lie: across both beams and along both lengths, as the gap closes.
  const length = shipProfile(a)!.length, beam = shipProfile(a)!.beam, axis = { x: Math.cos(HEADING), y: Math.sin(HEADING) };
  const spread = (ships: readonly Unit[]) => {
    const [p, q] = ships; if (!p || !q) return { across: beam, along: length };
    const dx = p.x - q.x, dy = p.y - q.y, along = Math.abs(dx * axis.x + dy * axis.y);
    return { across: Math.abs(dx * axis.y - dy * axis.x) + beam, along: along + length };
  };
  // The opening orders. The pirate helm grapples and boards; once the bridge is out it sends its own crew across.
  issuePlayerCommand(game, PIRATES, { type: 'boardShip', unitIds: [a.id], targetId: b.id });
  // The marines hold their posts (set with the crews above) and meet the boarders where they come aboard. Sent to the
  // rail instead, they cut at the pirate hull alongside, and a hull's damage takes the bridge down before it is out.
  const deckProps: DeckProp[] = [];
  const prop = (kind: string, ship: Unit, at: Point, mast = false, shows?: DeckProp['shows']) => {
    deckProps.push({ view: pieces.prop(kind, 0, 0, 1), shipId: ship.id, at, mast, ...(shows ? { shows } : {}) });
  };
  prop('boarding-pirate-flag', a, { x: -30, y: 0 }, true);
  // The prize: the black flag goes up over a taken ship.
  prop('boarding-pirate-flag', b, { x: -30, y: 0 }, true, ship => ship.owner === PIRATES);
  // Each one's remains are prepared before the scene starts; who falls is the fight's to decide.
  const warmCorpses: Corpse[] = [...models.keys()].map((variant, i) => ({ id: `menu-remains-${variant}`, unitId: `menu-remains-${i}`,
    kind: 'footman', variant, owner: variant === 'menu/marine' ? GUARD : PIRATES,
    x: 0, y: 0, radius: 15, diedAtTick: 0, deck: { shipId: (variant === 'menu/marine' ? b : a).id, x: 0, y: 0 } }));
  let held: { x: number; y: number; zoom: number } | undefined;
  return {
    game, props: [], battle: { scene: 'fleet', seed }, warmCorpses,
    focus: { x: CX, y: CY - 150 }, zoom: .7, models: variant => models.get(variant), painters,
    frameAt(_second, width, height, snapshot) {
      const ships = snapshot.units.filter(unit => unit.kind === 'shipOfTheLine');
      const x = ships.reduce((sum, ship) => sum + ship.x, 0) / Math.max(1, ships.length), y = ships.reduce((sum, ship) => sum + ship.y, 0) / Math.max(1, ships.length);
      // The camera eases in once the bridge is across and the fight is on the quarry's deck.
      const boarding = ships.some(ship => ship.sailing?.gangway?.phase === 'ready');
      const { across, along } = spread(ships), narrow = width < 700;
      const fit = narrow ? Math.min(width * .78 / across, height * .34 / along) : Math.min(width * .37 / across, height * .58 / along);
      const target = { x, y: y - length * .2, zoom: fit * (1 + (boarding ? .12 : 0)) };
      held = held ? { x: held.x + (target.x - held.x) * .05, y: held.y + (target.y - held.y) * .05, zoom: held.zoom + (target.zoom - held.zoom) * .03 } : target;
      return narrow ? { focus: held, zoom: held.zoom, anchorX: .5, anchorY: .31 } : { focus: held, zoom: held.zoom, anchorX: .74, anchorY: .51 };
    },
    foreground(ctx, view, _second, snapshot) {
      const ships = new Map(snapshot.units.map(unit => [unit.id, unit]));
      for (const entry of deckProps) {
        const ship = ships.get(entry.shipId);
        if (!ship || entry.shows && !entry.shows(ship)) continue;
        const world = localToWorld(ship, entry.at);
        const at = projectWorld(view, { x: world.x, y: world.y - presentationHeight(ship) - (entry.mast ? shipProfile(ship)!.mastHeight * Math.tan(SHIP_CAMERA.tilt) : 0) });
        ctx.save(); ctx.translate(at.x, at.y); ctx.scale(view.zoom ?? 1, view.zoom ?? 1);
        painters[entry.view.kind]?.(ctx, entry.view.state); ctx.restore();
      }
      // The game's cannon ink, drawn over the deck and rig so a broadside reads instead of hiding under the sails.
      for (const effect of snapshot.effects) if (['muzzleFlash', 'siegeBolt', 'siegeImpact'].includes(effect.type))
        drawWarfareEffect(ctx, effect, point => projectWorld(view, point), () => true);
    },
    embers: [], glows: [], air: { dusk: .12, mist: '103, 127, 124', mistAlpha: .13, rays: '212, 193, 145', rayAngle: -.16, motes: 'glints' },
  };
}
