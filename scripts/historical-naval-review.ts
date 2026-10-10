import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { UNIT_DEFS } from '../src/shared/catalog';
import { boardUnit, deckPlacement, deckPointFits, syncDecks } from '../src/shared/decks';
import { seedHash } from '../src/shared/environment/noise';
import { shipBodyClearAtPose, shipCollisionImpactCount } from '../src/shared/ship-collisions';
import { installedWeapons, rebuildShipFittings, shipGunCanAim } from '../src/shared/ship-equipment';
import { hullContact, hullGap, shipPassengers, shipProfile } from '../src/shared/ship-geometry';
import { shipMotionLimits } from '../src/shared/ship-handling';
import { shipCabinCapacity } from '../src/shared/ship-cabin-quota';
import { cabinExitPoint, isCabinProtected, isInCabin } from '../src/shared/ship-cabin';
import { GANGWAY_SETUP_TICKS, gangwaySurface } from '../src/shared/ship-gangway';
import { headingDifference, hullFits, hullPassageClear, type ShipPose } from '../src/shared/ship-navigation';
import { coursePerformance } from '../src/shared/ship-wind';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../src/shared/sim';
import { CHECKSUM_VERSION, checksumGame } from '../src/shared/sim/checksum';
import { seconds, SIM_TICKS_PER_SECOND } from '../src/shared/time';
import type { GameCommand, GameSnapshot, PlayerId, Unit, UnitKind } from '../src/shared/types';

type Game = ReturnType<typeof createGame>;
type Point = { x: number; y: number };
export const historicalNavalSources = [
  { id: 'dana-1847', documentaryId: 'S01', title: 'R. H. Dana, The Seaman’s Friend, fifth edition (1847)',
    url: 'https://www.gutenberg.org/files/40958/40958-h/40958-h.htm', locator: 'pp. 68–77, Tacking; Missing Stays; Wearing',
    excerpt: 'Moving the rudder from a right line has the effect of deadening the ship’s way.',
    fact: 'Headway matters to the rudder. Tacking puts the bow through the wind; wearing turns away through a longer arc. Backed sails can also turn a slow vessel.' },
  { id: 'mahan-1890', documentaryId: 'S04', title: 'A. T. Mahan, The Influence of Sea Power upon History (1890)',
    url: 'https://www.gutenberg.org/files/13529/13529-h/13529-h.htm', locator: 'Introduction, pp. 5–7',
    excerpt: 'the power of giving or refusing battle at will',
    fact: 'The weather gage offers tactical initiative, but bearing down can sacrifice broadside fire and expose the approaching vessel to raking. It does not guarantee victory.' },
  { id: 'collingwood-1805', documentaryId: 'S05', title: 'Collingwood’s Trafalgar dispatch, 22 October 1805',
    url: 'https://naval-history.net/WW0LG-Trafalgar.htm', locator: 'London Gazette 15858, 6 November 1805; On Monday / Action began',
    excerpt: 'Wind about West, and very light',
    fact: 'The British bore up in two columns against the northward-headed enemy line. Close action followed the passage through that line.' },
  { id: 'rmg-howe-1794', documentaryId: 'S06', title: 'Royal Museums Greenwich, Queen Charlotte breaking the line, PAD8695',
    url: 'https://www.rmg.co.uk/collections/objects/rmgc-object-112846', locator: 'Collection description, Glorious First of June',
    excerpt: 'tacked round to engage them with her starboard broadside',
    fact: 'The description distinguishes crossing the line, changing tack, and bringing the starboard broadside to bear; its interpretation says “appears”, and the sketch is not a measured track.' },
  { id: 'virginia-capes-1781', documentaryId: 'S08', title: 'Richmond Weed, The Battle of the Virginia Capes, Proceedings (1940)',
    url: 'https://www.usni.org/magazines/proceedings/1940/april/battle-virginia-capes-1781', locator: 'Discussion of the NNE wind and diverging lines',
    excerpt: 'The vans of the two fleets were closer than their rears.',
    fact: 'The two fleets’ forward divisions were closer than their rear divisions. Rear ships maintaining station could be beyond useful gun range.' },
  { id: 'constitution-1812', documentaryId: 'S10', title: 'USS Constitution Museum, Escaping a British Squadron, 17–19 July 1812',
    url: 'https://ussconstitutionmuseum.org/major-events/escaping-a-british-squadron/', locator: 'Calm, towing / kedging, and the later squall',
    excerpt: 'the wind soon died away',
    fact: 'Calm impeded the chase; boats and anchors supplied movement, and later weather and sail handling affected the escape.' },
  { id: 'shannon-1813', documentaryId: 'S11', title: 'US Navy historical image NH 42907: Shannon and Chesapeake, 1 June 1813',
    url: 'https://www.ibiblio.org/hyperwar/OnlineLibrary/photos/images/h42000/h42907l.htm', locator: 'Historical picture caption and description',
    excerpt: 'Captain Broke ordered the ships to be lashed together',
    fact: 'Close parallel firing preceded entanglement and securing the ships, then boarding across their contact. The caption’s claim about an unattended helm is conjecture.' },
  { id: 'ordnance-1866', documentaryId: 'S12', title: 'US Navy Ordnance Instructions, fourth edition (1866)',
    url: 'https://www.gutenberg.org/files/19058/19058-h/19058-h.htm#Page_A_92', locator: 'Part I, pp. 18–27 and 92–96; articles 87–113, 335–344 and 359–363',
    excerpt: 'PREPARE TO BOARD!',
    fact: 'Preparation, grapnels, designated passages, an explicit assault order and resistance are distinct. Defenders can deny a foothold. This later manual includes steam-era equipment and supplies no universal bridge dimensions or deployment time.' },
  { id: 'broke-1813', documentaryId: 'S13', title: 'Broke’s official report, 6 June 1813, London Gazette 16750',
    url: 'https://www.thegazette.co.uk/London/issue/16750/page/1329/data.pdf', locator: '10 July 1813, printed pp. 1329–1330; original page scans',
    excerpt: 'gave orders to prepare for boarding',
    fact: 'Rigging entanglement preceded the ordered assault; resistance continued from the decks, tops and below before quarter and prize management. The letter does not itself say that the ships were lashed together.' },
  { id: 'bainbridge-java-1812', documentaryId: 'S14', title: 'Bainbridge’s Java engagement journal, USS Constitution Museum 2361.1',
    url: 'https://ussconstitutionmuseum.org/wp-content/uploads/2018/09/2361-1-transcript.pdf', locator: 'Five-page transcript of the secretarial official copy; PDF pp. 2–4',
    excerpt: 'Our wheel was shot entirely away',
    fact: 'Wheel, rudder-chain and rigging damage did not instantly stop all maneuver. Apparent surrender was checked, and a boat and officer took possession. Emergency steering and independent damage systems remain outside this harness.' },
  { id: 'morris-philadelphia-1804', documentaryId: 'S15', title: 'Charles Morris’s autobiography, Proceedings, April 1880',
    url: 'https://www.usni.org/magazines/proceedings/1880/april/autobiography-commodore-charles-morris-u-s-n', locator: 'Philadelphia operation: rope approach, securing the ketch, chain plates and forward hatchways',
    excerpt: 'secure the ketch to the ship',
    fact: 'Boats connected ropes, crews hauled the vessels together, and an assigned party secured the source craft. Climbing and internal hatch routes were physical passages. This participant memoir was published posthumously, decades after the action.' },
  { id: 'hamilton-hermione-1799', documentaryId: 'S16', title: 'Hamilton’s Hermione report, 1 November 1799, London Gazette 15223',
    url: 'https://www.thegazette.co.uk/London/issue/15223/page/61/data.pdf', locator: 'Printed pp. 61–62; original issue headed 18–21 January 1800, Admiralty item dated 21 January',
    excerpt: 'the Main-Deck held out much longer',
    fact: 'Forecastle, quarter-deck, main-deck and lower resistance were distinct; cutting cables, making sail and towing occurred during the struggle. It gives no standardized locked-door breach time or durability.' },
] as const;

type SourceId = typeof historicalNavalSources[number]['id'];
type Action = { id: string; when: { kind: 'tick'; tick: number } | { kind: 'arrival'; shipId: string; point: Point } | { kind: 'defeated'; unitId: string };
  command?: { owner: PlayerId; value: GameCommand }; wind?: { direction: number; speed: number } };
type Fixture = { game: Game; ships: Unit[]; actions: Action[]; groups: Record<string, string[]>; goals: Record<string, Point>;
  lineX?: number; initialForwardArc?: boolean; focusId?: string; targetId?: string };
export type HistoricalScenario = { id: string; title: string; duration: number; sources: SourceId[]; scope: string; limits: string[];
  setup(seed: string): Fixture; evaluate(result: HistoricalResult): Criterion[] };
type Criterion = { id: string; basis: 'mechanism' | 'engine invariant'; statement: string; sources: SourceId[]; passed: boolean; actual: unknown };
type ShipMetrics = { id: string; kind: UnitKind; initialOwner: string; owner: string; maxHp: number; hp: number; origin: Point; travel: number;
  yawDegrees: number; maxYawRate: number; maxStationDrift: number; shots: number; shotsByMount: Record<string, number>; firstShot: number | null;
  damageDealt: number; damageTaken: number; firstHit: number | null; captureAt: number | null; tackPositiveTravel: number; tackNegativeTravel: number;
  noGoTravel: number; auxiliaryTravel: number; maxSailSpeed: number; maxCalmSailTargetSpeed: number; maxNoGoSailTargetSpeed: number; calmTicks: number; noGoTicks: number;
  finalGoalGap: number | null; modes: string[] };
type PoseFrame = { second: number; wind: GameSnapshot['map']['wind']; ships: { id: string; x: number; y: number; heading: number; speed: number;
  hp: number; owner: string; mode: string; order: string }[];
  crew: { id: string; x: number; y: number; hp: number; owner: string; deckShipId: string | null; cabin: boolean; order: string }[] };
export type ReviewCheckpoint = { tick: number; nextId: number; snapshot: GameSnapshot; completedActions: string[] };
export type HistoricalResult = { id: string; title: string; seed: string; duration: number; scope: string; sourceIds: SourceId[]; limits: string[];
  groups: Record<string, string[]>; goals: Record<string, Point>; lineX: number | null; initialForwardArc: boolean | null;
  initial: { id: string; kind: UnitKind; owner: string; x: number; y: number; heading: number; maxHp: number; hull: Point[];
    definitionCost: number; cabinCapacity: number; loadCapacity: number; installedWeapons: string[] }[];
  quality: { coastViolations: number; bodyViolations: number; discontinuousSteps: number; yawLimitViolations: number; maxHullOverlap: number;
    impactCount: number; contactEpisodes: number; captures: number; sunk: string[]; normalHp: boolean; ships: ShipMetrics[];
    normalCrewHp: boolean; gangwayWalkingViolations: number; prematureCaptures: number;
    bridgeBreakRetreatViolations: number; bridgeBreakRetreats: { second: number; crewId: string; sourceId: string; targetId: string; receiverId: string | null;
      distance: number; bodyFits: boolean; ownerUnchanged: boolean; hp: number; maxHp: number }[];
    crewCrossings: { second: number; crewId: string; from: string; to: string; hullGap: number; relativeSpeed: number }[] };
  timing: { count: number; meanMs: number; p95Ms: number; maxMs: number }; frames: PoseFrame[];
  events: { second: number; type: string; shipId?: string; targetId?: string; damage?: number; actionId?: string;
    mountId?: string; pose?: ShipPose; crewId?: string; phase?: string; hullGap?: number; readyAtTick?: number; width?: number;
    originalDefendersAlive?: number; owner?: string; t?: number; protected?: boolean; sourceEndpoint?: Point; targetEndpoint?: Point;
    motion?: { from: Point; to: Point; distance: number; allowance: number; wasOnGangway: boolean; onGangway: boolean } }[];
  checkpoints: ReviewCheckpoint[]; checksum: string; replay: { matched: boolean; checksum: string; checkpointTick: number } | null; criteria: Criterion[] };

const GLOBAL_LIMITS = [
  'Mechanism slices, not reconstructions of fleet numbers, historical winners, ship ratings, crew numbers or historical durations.',
  'Distances and speeds remain game units. No game unit is equated to a metre, knot or historical nautical mile.',
  'The engine uses a uniform wind field, simplified sail trim and 20% maneuvering assistance. Gangways are an RTS abstraction; manual backed-sail, kedging, towing, historically calibrated grappling lines, surrender and morale are not modeled.',
  'Health, fitting durability, cabin capacity and costs come from current game definitions. Ordinary damage and deaths remain enabled.',
];
function sea(seed: string, direction = Math.PI / 2, speed = 80) {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], teams: { player: 'blue', enemy: 'red' } });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = [];
  game.obstacles = []; game.effects = []; game.projectiles = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 6144, height: 6144, wind: { direction, speed }, terrain: { cell: 32, cols: 192, rows: 192, cells: '~'.repeat(192 * 192) } };
  // Small repeatable layout perturbations do not prescribe a combat winner.
  const hash = seedHash(seed), offset = { x: (hash % 17) - 8, y: (Math.floor(hash / 17) % 17) - 8 };
  return { game, offset };
}
function boat(game: Game, kind: UnitKind, at: Point, owner: PlayerId = 'player', heading = 0) {
  const unit = game.spawnUnit(owner, kind, at.x, at.y); unit.sailing!.heading = heading; return unit;
}
const shifted = (point: Point, offset: Point) => ({ x: point.x + offset.x, y: point.y + offset.y });
const command = (id: string, value: GameCommand, owner: PlayerId = 'player', tick = 0): Action => ({ id, when: { kind: 'tick', tick }, command: { owner, value } });
const hold = (ship: Unit) => ({ type: 'holdPosition' as const, unitIds: [ship.id] });
const move = (ship: Unit, point: Point, avoidCombat = true) => ({ type: 'move' as const, unitIds: [ship.id], ...point, avoidCombat });
function criterion(id: string, statement: string, passed: boolean, actual: unknown, sources: SourceId[]): Criterion {
  return { id, basis: 'mechanism', statement, passed, actual, sources };
}
const metricsFor = (result: HistoricalResult, group: string) => result.quality.ships.filter(ship => result.groups[group]?.includes(ship.id));

export const historicalNavalScenarios: HistoricalScenario[] = [
  { id: 'chesapeake-diverging-line', title: 'Virginia Capes: line station and the out-of-range rear', duration: 32,
    sources: ['virginia-capes-1781', 'mahan-1890'], scope: 'Four normal-HP broadside hulls isolate forward and rear range while holding station.',
    limits: ['The drawn separation is an engineering range fixture, not a scale plan of the 1781 battle.'], setup(seed) {
      const { game, offset } = sea(seed, Math.PI * 5 / 8), ships: Unit[] = [], groups: Record<string, string[]> = { van: [], rear: [] };
      for (const [role, x, gap] of [['van', 3300, 340], ['rear', 1500, 950]] as const) {
        const a = boat(game, 'shipOfTheLine', shifted({ x, y: 2500 }, offset));
        const b = boat(game, 'shipOfTheLine', shifted({ x, y: 2500 + gap }, offset), 'enemy');
        ships.push(a, b); groups[role]!.push(a.id, b.id);
      }
      return { game, ships, groups, goals: {}, actions: ships.map(ship => command(`hold-${ship.id}`, hold(ship), ship.owner as PlayerId)) };
    }, evaluate(result) {
      const van = metricsFor(result, 'van'), rear = metricsFor(result, 'rear');
      return [criterion('van-exchanges-broadsides', 'Forward ships can exchange damaging broadside fire.', van.every(ship => ship.shots > 0 && ship.damageTaken > 0), van, ['virginia-capes-1781']),
        criterion('rear-range-is-real', 'Rear ships beyond physical gun range do not damage one another.', rear.every(ship => ship.shots === 0 && ship.damageTaken === 0), rear, ['virginia-capes-1781']),
        criterion('hold-keeps-station', 'Gunnery does not translate a commanded holding station.', result.quality.ships.every(ship => ship.maxStationDrift < 1e-6), result.quality.ships.map(ship => ({ id: ship.id, drift: ship.maxStationDrift })), ['mahan-1890'])];
    } },
  { id: 'trafalgar-two-columns', title: 'Trafalgar: two columns approach a northward line', duration: 110,
    sources: ['collingwood-1805', 'mahan-1890'], scope: 'Four normal-HP attackers in two columns traverse a three-hull defended line.',
    limits: ['Light wind is represented by 20 versus the game reference of 80; these values are not knots.', 'Four versus three is a bounded mechanism slice; casualty balance is not a prediction of Trafalgar.'], setup(seed) {
      const { game, offset } = sea(seed, 0, 20), attackers: Unit[] = [], defenders: Unit[] = [], goals: Record<string, Point> = {};
      for (const y of [2800, 3500]) for (const x of [2400, 1900]) attackers.push(boat(game, 'shipOfTheLine', shifted({ x, y }, offset)));
      for (const y of [2450, 3150, 3850]) defenders.push(boat(game, 'shipOfTheLine', shifted({ x: 4000, y }, offset), 'enemy', -Math.PI / 2));
      const actions = defenders.map(ship => command(`hold-${ship.id}`, hold(ship), 'enemy'));
      for (const ship of attackers) { const goal = { x: 5200 + offset.x, y: ship.y }; goals[ship.id] = goal; actions.push(command(`column-${ship.id}`, move(ship, goal, false))); }
      const lead = attackers[0]!, forward = { x: lead.x + 1000, y: lead.y };
      const initialForwardArc = installedWeapons(game, lead).some(item => shipGunCanAim(lead, item, forward));
      return { game, ships: [...attackers, ...defenders], actions, goals, groups: { attackers: attackers.map(ship => ship.id), defenders: defenders.map(ship => ship.id) }, lineX: 4000 + offset.x, initialForwardArc };
    }, evaluate(result) {
      const attackers = metricsFor(result, 'attackers');
      const crossed = result.frames.flatMap(frame => frame.ships).filter(ship => result.groups.attackers!.includes(ship.id) && ship.x > result.lineX! + 200);
      const postCrossShots = result.events.filter(event => event.type === 'shot' && event.shipId && result.groups.attackers!.includes(event.shipId)
        && event.pose && event.pose.x > result.lineX! && (event.mountId?.startsWith('port') || event.mountId?.startsWith('starboard')));
      return [criterion('broadside-not-forward-battery', 'A line ship’s side battery cannot fire as a full bow battery during the initial approach.', result.initialForwardArc === false, result.initialForwardArc, ['mahan-1890']),
        criterion('two-column-passage', 'At least one ordinary-HP attacker passes the line through continuous water motion.', crossed.length > 0, { distinctCrossers: [...new Set(crossed.map(ship => ship.id))], sunk: result.quality.sunk }, ['collingwood-1805']),
        criterion('close-action', 'Passing the line brings actual side guns into close action, with damage and ordinary casualties allowed.', postCrossShots.length > 0 && result.quality.ships.some(ship => ship.damageTaken > 0), { postCrossSideShots: postCrossShots.length, shots: attackers.reduce((sum, ship) => sum + ship.shots, 0), damage: result.quality.ships.reduce((sum, ship) => sum + ship.damageTaken, 0) }, ['collingwood-1805']),
        { id: 'each-column-support', basis: 'engine invariant', statement: 'Every attacking ship participates before the final fifteen seconds; one lead ship cannot conceal an inactive rear.', sources: [],
          passed: attackers.every(ship => ship.shots > 0 && ship.firstShot !== null && ship.firstShot <= result.duration - 15),
          actual: attackers.map(ship => ({ id: ship.id, shots: ship.shots, firstShot: ship.firstShot })) }];
    } },
  { id: 'howe-cross-change-tack', title: 'First of June: cross the line, change tack, bring starboard guns to bear', duration: 140,
    sources: ['rmg-howe-1794', 'dana-1847'], scope: 'A normal-HP attacker crosses between two unarmed target hulls, changes tack, then receives an explicit firing order.',
    limits: ['Pair isolation: target batteries are omitted to measure the maneuver and firing side, while target HP and ordinary damage remain enabled.', 'The drawn wind and coordinates demonstrate the described sequence; they are not a reconstructed battle chart or manual sail-handling simulation.'], setup(seed) {
      const { game, offset } = sea(seed, Math.PI, 80), first = shifted({ x: 4000, y: 2250 }, offset), second = shifted({ x: 4050, y: 2250 + 50 * Math.sqrt(3) }, offset);
      const focus = boat(game, 'shipOfTheLine', shifted({ x: 3000, y: 2250 + 1000 * Math.sqrt(3) }, offset), 'player', -Math.PI / 3);
      const targets = [1700, 2900].map(y => boat(game, 'transport', shifted({ x: 3600, y }, offset), 'enemy', -Math.PI / 2));
      targets[0]!.y = 2250 + offset.y; targets[1]!.y = 3670 + offset.y;
      const actions: Action[] = targets.map(ship => command(`hold-${ship.id}`, hold(ship), 'enemy'));
      actions.push(command('cross-line', move(focus, first)));
      actions.push({ id: 'change-tack', when: { kind: 'arrival', shipId: focus.id, point: first }, command: { owner: 'player', value: move(focus, second) } });
      actions.push({ id: 'broadside-engagement', when: { kind: 'arrival', shipId: focus.id, point: second }, command: { owner: 'player', value: { type: 'attack', unitIds: [focus.id], targetId: targets[0]!.id } } });
      return { game, ships: [focus, ...targets], actions, groups: { focus: [focus.id], targets: targets.map(ship => ship.id) }, goals: { [focus.id]: second }, lineX: 3600 + offset.x, focusId: focus.id };
    }, evaluate(result) {
      const focus = metricsFor(result, 'focus')[0]!;
      const crossed = result.frames.some(frame => frame.ships.some(ship => ship.id === focus.id && ship.x > result.lineX! + 150));
      const changeAt = result.events.find(event => event.actionId === 'change-tack')?.second;
      const changed = changeAt !== undefined && result.frames.some(frame => frame.second > changeAt
        && frame.ships.some(ship => ship.id === focus.id && ship.heading > .3));
      const crossedBeforeChange = changeAt !== undefined && result.frames.some(frame => frame.second <= changeAt
        && frame.ships.some(ship => ship.id === focus.id && ship.x > result.lineX! + 150));
      const starboard = result.events.filter(event => event.type === 'shot' && event.shipId === focus.id
        && event.mountId?.startsWith('starboard') && changeAt !== undefined && event.second > changeAt).length;
      const postChangeHits = result.events.filter(event => event.type === 'hit' && event.shipId === focus.id && changeAt !== undefined && event.second > changeAt);
      return [criterion('cross-before-tack', 'The hull physically crosses before its heading passes through the wind onto the other tack.', crossed && crossedBeforeChange && changed, { crossedBeforeChange, changed, changeAt }, ['rmg-howe-1794']),
        criterion('starboard-engagement', 'After changing tack, actual starboard gun shots hit a reachable target.', starboard > 0 && postChangeHits.length > 0, { starboard, damage: postChangeHits.reduce((sum, hit) => sum + (hit.damage ?? 0), 0), modes: focus.modes }, ['rmg-howe-1794'])];
    } },
  { id: 'dana-upwind-headway', title: 'Dana: beating upwind from stopped and making-way initial poses', duration: 110,
    sources: ['dana-1847'], scope: 'Two separated ordinary-HP square-riggers sail upwind from a stopped pose and a pose already making way.',
    limits: ['Measurement isolation: no enemy guns or artificial HP are used. Initial headway is a fixture condition, not an external push applied during the run.', 'The engine’s narrower no-go sectors and maneuvering assistance are RTS approximations; this case does not certify historical square-rigger polars or manual wearing.'], setup(seed) {
      const { game, offset } = sea(seed, Math.PI), stopped = boat(game, 'warship', shifted({ x: 2100, y: 2100 }, offset));
      const moving = boat(game, 'warship', shifted({ x: 2100, y: 4500 }, offset), 'player', Math.PI / 2);
      moving.sailing!.speed = shipMotionLimits(moving).speed * .55; moving.sailing!.velocityY = moving.sailing!.speed;
      const ships = [stopped, moving], goals = Object.fromEntries(ships.map(ship => [ship.id, { x: ship.x + 650, y: ship.y }]));
      return { game, ships, goals, groups: { stopped: [stopped.id], makingWay: [moving.id] }, actions: ships.map(ship => command(`beat-${ship.id}`, move(ship, goals[ship.id]!))) };
    }, evaluate(result) {
      const ships = result.quality.ships;
      return [criterion('beats-on-both-tacks', 'An upwind voyage obtains headway on both sides rather than sailing straight at full sail power into the wind.', ships.every(ship => ship.tackPositiveTravel > 40 && ship.tackNegativeTravel > 40), ships.map(ship => ({ id: ship.id, portTravel: ship.tackNegativeTravel, starboardTravel: ship.tackPositiveTravel, auxiliaryTravel: ship.auxiliaryTravel })), ['dana-1847']),
        criterion('wind-eye-loses-sail-drive', 'Ordinary sail propulsion falls to zero in the wind eye; assistance is recorded separately.', ships.every(ship => ship.noGoTicks > 0 && ship.maxNoGoSailTargetSpeed === 0), ships.map(ship => ({ id: ship.id, maxNoGoSailTargetSpeed: ship.maxNoGoSailTargetSpeed, noGoTicks: ship.noGoTicks, noGoTravel: ship.noGoTravel, auxiliaryTravel: ship.auxiliaryTravel })), ['dana-1847']),
        criterion('upwind-arrival', 'Both helm orders finish at their physical destinations without sustained wind-eye oscillation.', ships.every(ship => ship.finalGoalGap !== null && ship.finalGoalGap < 1), ships.map(ship => ({ id: ship.id, gap: ship.finalGoalGap, yaw: ship.yawDegrees })), ['dana-1847'])];
    } },
  { id: 'constitution-calm-chase', title: 'Constitution escape: calm then restored wind during a chase', duration: 80,
    sources: ['constitution-1812', 'mahan-1890'], scope: 'Two separated ordinary-HP hulls expose the sail-drive change while a pursuit remains active.',
    limits: ['The game has no boats, kedging anchors, jettisoned water or localized squall fronts. Its bounded maneuvering assistance is reported explicitly and is not relabeled as historical sail propulsion.', 'No requirement forces an escape or capture, because the generic ship definitions do not represent Constitution or her five pursuers.'], setup(seed) {
      const { game, offset } = sea(seed, Math.PI / 2, 0), focus = boat(game, 'warship', shifted({ x: 1600, y: 3600 }, offset));
      const target = boat(game, 'transport', shifted({ x: 2900, y: 3600 }, offset), 'enemy');
      const goal = { x: 5600 + offset.x, y: target.y };
      return { game, ships: [focus, target], groups: { pursuer: [focus.id], quarry: [target.id] }, goals: { [target.id]: goal }, focusId: focus.id, targetId: target.id,
        actions: [command('quarry-voyage', move(target, goal), 'enemy'), command('pursuit', { type: 'attack', unitIds: [focus.id], targetId: target.id }),
          { id: 'wind-restored', when: { kind: 'tick', tick: seconds(20) }, wind: { direction: Math.PI / 2, speed: 80 } }] };
    }, evaluate(result) {
      const quarry = result.groups.quarry![0]!, frames = result.frames.flatMap(frame => frame.ships.filter(ship => ship.id === quarry).map(ship => ({ second: frame.second, speed: ship.speed })));
      const calm = frames.filter(frame => frame.second >= 5 && frame.second < 20), windy = frames.filter(frame => frame.second > 30 && frame.second < 45);
      const mean = (samples: typeof frames) => samples.reduce((sum, value) => sum + value.speed, 0) / Math.max(1, samples.length);
      return [criterion('calm-constrains-drive', 'Restored wind produces materially more headway than the calm’s explicitly modeled assistance.', mean(windy) > mean(calm) * 1.5, { calmMean: mean(calm), restoredMean: mean(windy), outcome: result.quality.ships.map(ship => ({ id: ship.id, hp: ship.hp, owner: ship.owner })) }, ['constitution-1812']),
        criterion('no-self-powered-sail-in-calm', 'The ordinary sail target remains zero in calm even while the hull moves; auxiliary travel is reported separately.', result.quality.ships.every(ship => ship.calmTicks > 0 && ship.maxCalmSailTargetSpeed === 0), result.quality.ships.map(ship => ({ id: ship.id, calmTicks: ship.calmTicks, maxCalmSailTargetSpeed: ship.maxCalmSailTargetSpeed, auxiliaryTravel: ship.auxiliaryTravel })), ['constitution-1812']),
        criterion('record-weather-transition', 'The recorded chase includes the actual wind transition, with no forced historical winner.', result.events.some(event => event.actionId === 'wind-restored'), result.events.filter(event => event.type === 'wind'), ['constitution-1812'])];
    } },
  { id: 'shannon-boarding-control', title: 'Shannon and Chesapeake: supported contact, resistance and control transfer', duration: 45,
    sources: ['shannon-1813', 'broke-1813', 'ordnance-1866'], scope: 'One heavy and one light normal-HP hull isolate contested deck crossing and capture after defenders are defeated.',
    limits: ['The heavy/light hulls are capacity and geometry proxies; the historical ships were frigates, not these game ratings.', 'Pair isolation: the heavy hull’s guns are removed so that normal-HP infantry resistance and ownership transfer can be measured.', 'Capture is the game’s occupancy rule. Grappling ropes, officer casualties, morale and surrender are not modeled.'], setup(seed) {
      const { game, offset } = sea(seed), focus = boat(game, 'shipOfTheLine', shifted({ x: 2200, y: 2400 }, offset));
      const target = boat(game, 'transport', shifted({ x: 2200, y: 2850 }, offset), 'enemy');
      target.y = focus.y + (shipProfile(focus)!.beam + shipProfile(target)!.beam) / 2 + .05;
      game.items = game.items.filter(item => item.shipId !== focus.id); rebuildShipFittings(game, focus);
      const attackers = Array.from({ length: 2 }, () => game.spawnUnit('player', 'footman', focus.x, focus.y));
      const defender = game.spawnUnit('enemy', 'footman', target.x, target.y);
      for (const unit of attackers) if (!boardUnit(focus, unit, game.units)) throw new Error('Attacker does not fit the real deck');
      if (!boardUnit(target, defender, game.units)) throw new Error('Defender does not fit the real deck'); syncDecks(game.units);
      return { game, ships: [focus, target], groups: { attackers: attackers.map(unit => unit.id), defenders: [defender.id], focus: [focus.id], target: [target.id] }, goals: {}, focusId: focus.id, targetId: target.id,
        actions: [command('boarding-assault', { type: 'attack', unitIds: [focus.id, ...attackers.map(unit => unit.id)], targetId: target.id }),
          command('boarding-resistance', { type: 'attack', unitIds: [defender.id], targetId: attackers[0]!.id }, 'enemy'),
          { id: 'cross-and-occupy', when: { kind: 'defeated', unitId: defender.id }, command: { owner: 'player', value: { type: 'board', unitIds: attackers.map(unit => unit.id), transportId: target.id } } }] };
    }, evaluate(result) {
      const target = metricsFor(result, 'target')[0]!, combat = result.events.filter(event => event.type === 'hit');
      const defended = target.captureAt !== null && combat.some(event => result.groups.defenders!.includes(event.shipId ?? '')
        && result.groups.attackers!.includes(event.targetId ?? '') && event.second < target.captureAt!);
      return [criterion('defenders-resist', 'Normal-HP defenders inflict actual damage before control changes.', defended, { defended, combatHits: combat.length }, ['broke-1813', 'ordnance-1866']),
        criterion('supported-deck-crossing', 'Boarders physically enter the receiver over a touching seam with low relative motion.', result.quality.crewCrossings.some(crossing => crossing.to === target.id)
          && result.quality.crewCrossings.every(crossing => crossing.hullGap < .5 && crossing.relativeSpeed < 1), result.quality.crewCrossings, ['shannon-1813']),
        criterion('capture-does-not-sink', 'Successful boarding changes control while preserving a living captured hull.', target.owner === 'player' && target.hp > 0 && target.captureAt !== null, { owner: target.owner, hp: target.hp, maxHp: target.maxHp, captureAt: target.captureAt }, ['broke-1813'])];
    } },
  { id: 'hermione-gangway-hatch', title: 'Hermione-inspired: deployed passage, hatch resistance and contested control', duration: 75,
    sources: ['hamilton-hermione-1799', 'ordnance-1866'], scope: 'Two gunless normal-HP carrier hulls and ordinary-HP footmen isolate deployed passage walking and a sheltered original defender.',
    limits: ['Local mechanism slice: Hermione was attacked from boats. These two game hulls, five personnel and an RTS gangway do not recreate its boats, ratings or historical timing.',
      'Both hulls retain ordinary HP and cabin parts; their guns are removed to measure infantry resistance. The carrier passenger-output balance rule remains active.',
      'One defender enters the cabin through the ordinary command before the recorded battle. Cabin breach means the game loses shelter and tries the hatch route; this is not evidence that Hermione had a timed destructible locked door.',
      'No historical winner is prescribed. Control cannot transfer while a living original defender remains aboard, including in the cabin; surrender and prisoner management are not modeled.'], setup(seed) {
      const { game, offset } = sea(seed), focus = boat(game, 'carrier', shifted({ x: 2200, y: 2400 }, offset));
      const target = boat(game, 'carrier', shifted({ x: 2200, y: 3000 }, offset), 'enemy');
      game.items = game.items.filter(item => item.shipId !== focus.id && item.shipId !== target.id);
      for (const ship of [focus, target]) rebuildShipFittings(game, ship);
      const sheltered = game.spawnUnit('enemy', 'footman', target.x, target.y);
      if (!boardUnit(target, sheltered, game.units)) throw new Error('Sheltered defender does not fit the real deck');
      const door = cabinExitPoint(game, target, sheltered); if (!door) throw new Error('No usable real cabin hatch');
      sheltered.deck = { shipId: target.id, ...door }; syncDecks(game.units);
      issuePlayerCommand(game, 'enemy', { type: 'enterCabin', unitIds: [sheltered.id] });
      for (let tick = 0; tick < seconds(2) && !isInCabin(sheltered); tick++) stepGame(game);
      if (!isInCabin(sheltered) || !isCabinProtected(game, sheltered)) throw new Error('Defender did not enter the protected cabin');
      game.tick = 0;
      target.y = focus.y + (shipProfile(focus)!.beam + shipProfile(target)!.beam) / 2 + 12;
      const attackers = Array.from({ length: 3 }, () => game.spawnUnit('player', 'footman', focus.x, focus.y));
      const exposed = game.spawnUnit('enemy', 'footman', target.x, target.y);
      for (const unit of attackers) if (!boardUnit(focus, unit, game.units)) throw new Error('Assault crew does not fit the real deck');
      if (!boardUnit(target, exposed, game.units)) throw new Error('Exposed defender does not fit the real deck');
      const position = deckPlacement(target, exposed, game.units, { x: shipProfile(target)!.length / 4, y: -shipProfile(target)!.beam / 4 }, true);
      if (!position) throw new Error('Exposed defender has no body-clear deck station');
      exposed.deck = { shipId: target.id, ...position }; syncDecks(game.units);
      return { game, ships: [focus, target], groups: { attackers: attackers.map(unit => unit.id), defenders: [sheltered.id, exposed.id], sheltered: [sheltered.id], focus: [focus.id], target: [target.id] },
        goals: {}, focusId: focus.id, targetId: target.id, actions: [command('deploy-assault-passage', { type: 'boardShip', unitIds: [focus.id], targetId: target.id })] };
    }, evaluate(result) {
      const source = metricsFor(result, 'focus')[0]!, target = metricsFor(result, 'target')[0]!;
      const deploying = result.events.find(event => event.type === 'gangway-phase' && event.shipId === source.id && event.phase === 'deploying');
      const ready = result.events.find(event => event.type === 'gangway-phase' && event.shipId === source.id && event.phase === 'ready');
      const walked = result.events.filter(event => event.type === 'crew-on-gangway' && result.groups.attackers!.includes(event.crewId ?? ''));
      const crossed = result.quality.crewCrossings.filter(crossing => result.groups.attackers!.includes(crossing.crewId) && crossing.to === target.id);
      const contested = result.events.find(event => event.type === 'contested-deck' && event.shipId === target.id);
      const breach = result.events.find(event => event.type === 'cabin-unprotected' && event.crewId === result.groups.sheltered![0]);
      const damage = result.events.filter(event => event.type === 'hit' && result.groups.defenders!.includes(event.shipId ?? '') && result.groups.attackers!.includes(event.targetId ?? ''));
      return [criterion('deliberate-deployment', 'The real boardShip command deploys for three continuous game seconds across a measurable non-contact gap.',
        !!deploying && !!ready && deploying.hullGap! > 3 && ready.second >= deploying.second + GANGWAY_SETUP_TICKS / SIM_TICKS_PER_SECOND - 1e-6,
        { deploying, ready }, ['ordnance-1866']),
      criterion('actual-passage-walking', 'Living assault crew actually walk in the temporary passage before entering the receiver, with continuous crew motion.',
        !!ready && walked.length > 0 && crossed.length > 0 && result.quality.gangwayWalkingViolations === 0 && result.quality.bridgeBreakRetreatViolations === 0
          && crossed.every(crossing => crossing.hullGap > 3 && crossing.second >= ready.second),
        { walked, crossed, violations: result.quality.gangwayWalkingViolations, breakRetreats: result.quality.bridgeBreakRetreats,
          breakRetreatViolations: result.quality.bridgeBreakRetreatViolations }, ['ordnance-1866']),
      criterion('foothold-is-contested', 'An invaded outer deck remains under its original owner while living original defenders still resist.',
        !!contested && contested.originalDefendersAlive! > 0 && contested.owner === 'enemy' && damage.some(hit => hit.second >= contested.second && (target.captureAt === null || hit.second < target.captureAt)),
        { contested, defenderHits: damage }, ['hamilton-hermione-1799']),
      criterion('hatch-is-not-permanent-immunity', 'The originally sheltered live defender loses protection through the real breach/exit mechanism after invasion.',
        !!breach && !!contested && breach.second >= contested.second, { breach, contested }, ['hamilton-hermione-1799', 'ordnance-1866']),
      criterion('control-follows-resistance', 'Control never changes with a living original defender still aboard; deaths and a surviving hull are measured without prescribing a winner.',
        result.quality.prematureCaptures === 0 && result.quality.normalCrewHp && target.hp > 0,
        { captures: result.quality.captures, prematureCaptures: result.quality.prematureCaptures, target, normalCrewHp: result.quality.normalCrewHp }, ['hamilton-hermione-1799'])];
    } },
];

const pose = (ship: Unit): ShipPose => ({ x: ship.x, y: ship.y, heading: ship.sailing!.heading });
function applyActions(fixture: Fixture, completed: Set<string>, tick: number, onAction?: (action: Action) => void) {
  for (const action of fixture.actions) {
    if (completed.has(action.id)) continue;
    const when = action.when;
    const ready = when.kind === 'tick' ? tick >= when.tick : when.kind === 'defeated'
      ? !fixture.game.units.some(unit => unit.id === when.unitId && unit.hp > 0) : (() => {
      const unit = fixture.game.units.find(unit => unit.id === when.shipId);
      return unit && unit.hp > 0 && Math.hypot(unit.x - when.point.x, unit.y - when.point.y) < 1;
    })();
    if (!ready) continue;
    if (action.command) issuePlayerCommand(fixture.game, action.command.owner, action.command.value);
    if (action.wind) fixture.game.map.wind = { ...action.wind };
    completed.add(action.id); onAction?.(action);
  }
}
export function replayHistoricalCheckpoint(scene: HistoricalScenario, seed: string, checkpoint: ReviewCheckpoint, endTick: number) {
  const fixture = scene.setup(seed); restoreSnapshotIntoGame(fixture.game, checkpoint.snapshot, checkpoint.nextId);
  const completed = new Set(checkpoint.completedActions);
  while (fixture.game.tick < endTick) { applyActions(fixture, completed, fixture.game.tick); stepGame(fixture.game); }
  return checksumGame(fixture.game);
}

export function runHistoricalScenario(scene: HistoricalScenario, options: { seed?: string; duration?: number; replay?: boolean } = {}): HistoricalResult {
  const seed = options.seed ?? 'historical-review-v1', duration = options.duration ?? scene.duration, fixture = scene.setup(seed), { game, ships } = fixture;
  const completed = new Set<string>(), originOwners = new Map(ships.map(ship => [ship.id, ship.owner]));
  const metrics = new Map<string, ShipMetrics>(ships.map(ship => [ship.id, { id: ship.id, kind: ship.kind, initialOwner: ship.owner, owner: ship.owner, maxHp: ship.maxHp, hp: ship.hp,
    origin: { x: ship.x, y: ship.y }, travel: 0, yawDegrees: 0, maxYawRate: 0, maxStationDrift: 0, shots: 0, shotsByMount: {}, firstShot: null,
    damageDealt: 0, damageTaken: 0, firstHit: null, captureAt: null, tackPositiveTravel: 0, tackNegativeTravel: 0, noGoTravel: 0, auxiliaryTravel: 0,
    maxSailSpeed: 0, maxCalmSailTargetSpeed: 0, maxNoGoSailTargetSpeed: 0, calmTicks: 0, noGoTicks: 0, finalGoalGap: null, modes: [] } satisfies ShipMetrics]));
  const events: HistoricalResult['events'] = [], frames: PoseFrame[] = [], checkpoints: ReviewCheckpoint[] = [], timings: number[] = [];
  const originalCrew = game.units.filter(unit => unit.deck && !shipProfile(unit));
  const originalDefenders = new Map(ships.map(ship => [ship.id, shipPassengers(game.units, ship).filter(unit => unit.owner === ship.owner)]));
  const sheltered = originalCrew.filter(isInCabin), unprotected = new Set<string>(), invaded = new Set<string>(), walked = new Set<string>();
  const phases = new Map<string, string>();
  const quality = { coastViolations: 0, bodyViolations: 0, discontinuousSteps: 0, yawLimitViolations: 0, maxHullOverlap: 0, impactCount: 0, contactEpisodes: 0,
    normalCrewHp: originalCrew.every(unit => !unit.invulnerable && unit.hp === UNIT_DEFS[unit.kind].hp && unit.maxHp === UNIT_DEFS[unit.kind].hp),
    gangwayWalkingViolations: 0, prematureCaptures: 0,
    bridgeBreakRetreatViolations: 0, bridgeBreakRetreats: [] as HistoricalResult['quality']['bridgeBreakRetreats'],
    crewCrossings: [] as HistoricalResult['quality']['crewCrossings'] };
  const initial = ships.map(ship => ({ id: ship.id, kind: ship.kind, owner: ship.owner, x: ship.x, y: ship.y, heading: ship.sailing!.heading, maxHp: ship.maxHp,
    hull: shipProfile(ship)!.hull, definitionCost: UNIT_DEFS[ship.kind].cost, cabinCapacity: shipCabinCapacity(ship), loadCapacity: shipProfile(ship)!.loadCapacity,
    installedWeapons: installedWeapons(game, ship).map(item => item.kind) }));
  const normalHp = game.units.every(unit => !unit.invulnerable && unit.hp === unit.maxHp);
  for (const ship of ships) if (!hullFits(game.map, ship) || !shipBodyClearAtPose(game.map, ship, pose(ship), [...game.units, ...game.buildings, ...game.obstacles ?? []])) throw new Error(`${scene.id}: invalid initial hull ${ship.id}`);
  const frame = (): PoseFrame => ({ second: game.tick / SIM_TICKS_PER_SECOND, wind: game.map.wind && { ...game.map.wind },
    ships: ships.map(ship => ({ id: ship.id, x: ship.x, y: ship.y, heading: ship.sailing!.heading, speed: ship.sailing!.speed, hp: ship.hp, owner: ship.owner, mode: ship.sailing!.sail?.mode ?? 'idle', order: ship.order.type })),
    crew: game.units.filter(unit => !shipProfile(unit)).map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, owner: unit.owner, deckShipId: unit.deck?.shipId ?? null, cabin: Boolean(unit.cabin), order: unit.order.type })) });
  frames.push(frame()); checkpoints.push({ tick: 0, nextId: game.nextId, snapshot: snapshotGame(game), completedActions: [] });
  game.observer = { hit(attacker, target, damage) {
    events.push({ second: game.tick / SIM_TICKS_PER_SECOND, type: 'hit', shipId: attacker.id, targetId: target.id, damage });
    const source = metrics.get(attacker.id), victim = metrics.get(target.id);
    if (source) source.damageDealt += damage;
    if (victim) { victim.damageTaken += damage; victim.firstHit ??= game.tick / SIM_TICKS_PER_SECOND; }
  } };
  let touching = new Set<string>();
  for (let tick = 0; tick < seconds(duration); tick++) {
    applyActions(fixture, completed, tick, action => events.push({ second: tick / SIM_TICKS_PER_SECOND, type: action.wind ? 'wind' : 'command', actionId: action.id }));
    const before = new Map(ships.map(ship => [ship.id, { pose: pose(ship), hp: ship.hp, limit: shipMotionLimits(ship).turnRate }]));
    const crewDecks = new Map(game.units.filter(unit => unit.deck).map(unit => [unit.id, unit.deck!.shipId]));
    const crewBefore = new Map(originalCrew.map(unit => [unit.id, { x: unit.x, y: unit.y, gangway: unit.gangway && { ...unit.gangway },
      owner: unit.owner, push: Math.hypot(unit.pushX ?? 0, unit.pushY ?? 0) }]));
    const guns = new Map(ships.flatMap(ship => installedWeapons(game, ship).map(item => [item.id, item.cooldownRemaining] as const)));
    const start = performance.now(); stepGame(game); timings.push(performance.now() - start);
    quality.impactCount += shipCollisionImpactCount(game.units);
    for (const crew of game.units) {
      const previous = crewBefore.get(crew.id);
      if (previous && (previous.gangway || crew.gangway) && crew.hp > 0) {
        const allowance = (crew.speed + Math.max(previous.push, Math.hypot(crew.pushX ?? 0, crew.pushY ?? 0))) / SIM_TICKS_PER_SECOND;
        const distance = Math.hypot(crew.x - previous.x, crew.y - previous.y);
        const a = previous.gangway && ships.find(ship => ship.id === previous.gangway!.sourceId), b = previous.gangway && ships.find(ship => ship.id === previous.gangway!.targetId);
        const retreat = previous.gangway && !crew.gangway && (!a || !b || gangwaySurface(a, b)?.phase !== 'ready');
        if (retreat) {
          const receiver = ships.find(ship => ship.id === crew.deck?.shipId), crossing = previous.gangway!;
          const bodyFits = !!receiver && receiver.hp > 0 && [crossing.sourceId, crossing.targetId].includes(receiver.id)
            && !!crew.deck && deckPointFits(receiver, crew, crew.deck, game.units, true);
          const ownerUnchanged = previous.owner === crew.owner;
          quality.bridgeBreakRetreats.push({ second: game.tick / SIM_TICKS_PER_SECOND, crewId: crew.id, sourceId: crossing.sourceId, targetId: crossing.targetId,
            receiverId: receiver?.id ?? null, distance, bodyFits, ownerUnchanged, hp: crew.hp, maxHp: crew.maxHp });
          if (!bodyFits || !ownerUnchanged || crew.invulnerable || crew.hp > crew.maxHp + 1e-6) quality.bridgeBreakRetreatViolations++;
        } else if (distance > allowance + 1e-5) {
          quality.gangwayWalkingViolations++;
          events.push({ second: game.tick / SIM_TICKS_PER_SECOND, type: 'crew-motion-violation', crewId: crew.id,
            motion: { from: { x: previous.x, y: previous.y }, to: { x: crew.x, y: crew.y }, distance, allowance,
              wasOnGangway: Boolean(previous.gangway), onGangway: Boolean(crew.gangway) } });
        }
      }
      if (crew.gangway && !walked.has(crew.id)) {
        walked.add(crew.id);
        events.push({ second: game.tick / SIM_TICKS_PER_SECOND, type: 'crew-on-gangway', crewId: crew.id, shipId: crew.gangway.sourceId,
          targetId: crew.gangway.targetId, t: crew.gangway.t });
      }
      const from = crewDecks.get(crew.id), to = crew.deck?.shipId;
      if (!from || !to || from === to) continue;
      const a = ships.find(ship => ship.id === from), b = ships.find(ship => ship.id === to);
      if (a && b) quality.crewCrossings.push({ second: game.tick / SIM_TICKS_PER_SECOND, crewId: crew.id, from, to, hullGap: hullGap(a, b),
        relativeSpeed: Math.hypot((a.sailing!.velocityX ?? 0) - (b.sailing!.velocityX ?? 0), (a.sailing!.velocityY ?? 0) - (b.sailing!.velocityY ?? 0)) });
    }
    const nextTouching = new Set<string>();
    for (const ship of ships) {
      const previous = before.get(ship.id)!, state: ShipMetrics = metrics.get(ship.id)!, motion = ship.sailing!, distance = Math.hypot(ship.x - previous.pose.x, ship.y - previous.pose.y);
      const gangway = motion.gangway, phase = gangway?.phase ?? 'absent';
      if (phase !== (phases.get(ship.id) ?? 'absent')) {
        phases.set(ship.id, phase);
        const target = gangway && ships.find(other => other.id === gangway.targetId);
        const surface = target && gangwaySurface(ship, target);
        events.push({ second: game.tick / SIM_TICKS_PER_SECOND, type: 'gangway-phase', shipId: ship.id, phase,
          ...(target && gangway ? { targetId: target.id, hullGap: hullGap(ship, target), readyAtTick: gangway.readyAtTick } : {}),
          ...(surface ? { width: surface.width, sourceEndpoint: surface.source, targetEndpoint: surface.target } : {}) });
      }
      const defenders = originalDefenders.get(ship.id)!.filter(unit => unit.hp > 0 && unit.deck?.shipId === ship.id), originOwner = originOwners.get(ship.id)!;
      if (ship.owner !== originOwner && defenders.length > 0) quality.prematureCaptures++;
      if (!invaded.has(ship.id) && shipPassengers(game.units, ship).some(crew => crew.hp > 0 && !isInCabin(crew) && crew.owner !== originOwner)) {
        invaded.add(ship.id);
        events.push({ second: game.tick / SIM_TICKS_PER_SECOND, type: 'contested-deck', shipId: ship.id, owner: ship.owner, originalDefendersAlive: defenders.length });
      }
      const yaw = Math.abs(headingDifference(previous.pose.heading, motion.heading)), rate = yaw * SIM_TICKS_PER_SECOND;
      state.travel += distance; state.yawDegrees += yaw * 180 / Math.PI; state.maxYawRate = Math.max(state.maxYawRate, rate);
      state.maxStationDrift = Math.max(state.maxStationDrift, Math.hypot(ship.x - state.origin.x, ship.y - state.origin.y));
      state.hp = ship.hp; state.owner = ship.owner;
      if (ship.owner !== originOwners.get(ship.id) && state.captureAt === null) {
        state.captureAt = game.tick / SIM_TICKS_PER_SECOND;
        events.push({ second: state.captureAt, type: 'control-transfer', shipId: ship.id, owner: ship.owner, originalDefendersAlive: defenders.length });
      }
      const mode = motion.sail?.mode ?? 'idle'; if (!state.modes.includes(mode)) state.modes.push(mode);
      const performance = coursePerformance(ship, game.map);
      if (performance.calm) { state.calmTicks++; state.maxCalmSailTargetSpeed = Math.max(state.maxCalmSailTargetSpeed, performance.targetSpeed); }
      if (performance.noGo) { state.noGoTicks++; state.maxNoGoSailTargetSpeed = Math.max(state.maxNoGoSailTargetSpeed, performance.targetSpeed); }
      if (mode === 'tacking') { if (headingDifference(0, motion.heading) > .3) state.tackPositiveTravel += distance; if (headingDifference(0, motion.heading) < -.3) state.tackNegativeTravel += distance; }
      if (performance.noGo) state.noGoTravel += distance;
      if (mode === 'maneuver' || mode === 'calm-assist') state.auxiliaryTravel += distance;
      else state.maxSailSpeed = Math.max(state.maxSailSpeed, distance * SIM_TICKS_PER_SECOND);
      if (previous.hp > 0 && rate > previous.limit + 1e-6) quality.yawLimitViolations++;
      if (previous.hp > 0 && !hullPassageClear(game.map, ship, previous.pose, pose(ship))) quality.discontinuousSteps++;
      if (ship.hp <= 0) continue;
      if (!hullFits(game.map, ship)) quality.coastViolations++;
      if (!shipBodyClearAtPose(game.map, ship, pose(ship), [...game.units, ...game.buildings, ...game.obstacles ?? []])) quality.bodyViolations++;
      for (const item of installedWeapons(game, ship)) if (item.cooldownRemaining > (guns.get(item.id) ?? Infinity)) {
        state.shots++; state.firstShot ??= game.tick / SIM_TICKS_PER_SECOND;
        const mount = item.mountId!; state.shotsByMount[mount] = (state.shotsByMount[mount] ?? 0) + 1;
        events.push({ second: game.tick / SIM_TICKS_PER_SECOND, type: 'shot', shipId: ship.id, mountId: mount, pose: pose(ship) });
      }
    }
    for (const defender of sheltered) if (defender.hp > 0 && !unprotected.has(defender.id) && !isCabinProtected(game, defender)) {
      unprotected.add(defender.id);
      events.push({ second: game.tick / SIM_TICKS_PER_SECOND, type: 'cabin-unprotected', crewId: defender.id,
        ...(defender.deck ? { shipId: defender.deck.shipId } : {}), protected: false, owner: defender.owner });
    }
    const living = ships.filter(ship => ship.hp > 0);
    for (let a = 0; a < living.length; a++) for (let b = a + 1; b < living.length; b++) {
      const first = living[a]!, second = living[b]!, overlap = hullContact(first, second)?.overlap ?? 0;
      quality.maxHullOverlap = Math.max(quality.maxHullOverlap, overlap);
      if (hullGap(first, second) < .1) { const key = `${first.id}/${second.id}`; nextTouching.add(key); if (!touching.has(key)) quality.contactEpisodes++; }
    }
    touching = nextTouching;
    if (game.tick % SIM_TICKS_PER_SECOND === 0) frames.push(frame());
    if (tick + 1 === Math.floor(seconds(duration) / 2)) checkpoints.push({ tick: game.tick, nextId: game.nextId, snapshot: snapshotGame(game), completedActions: [...completed] });
  }
  for (const ship of ships) { const goal = fixture.goals[ship.id]; if (goal) metrics.get(ship.id)!.finalGoalGap = Math.hypot(goal.x - ship.x, goal.y - ship.y); }
  timings.sort((a, b) => a - b);
  const result: HistoricalResult = { id: scene.id, title: scene.title, seed, duration, scope: scene.scope, sourceIds: scene.sources, limits: [...GLOBAL_LIMITS, ...scene.limits],
    groups: fixture.groups, goals: fixture.goals, lineX: fixture.lineX ?? null, initialForwardArc: fixture.initialForwardArc ?? null, initial,
    quality: { ...quality, normalHp, captures: [...metrics.values()].filter(ship => ship.captureAt !== null).length, sunk: ships.filter(ship => ship.hp <= 0).map(ship => ship.id), ships: [...metrics.values()] },
    timing: { count: timings.length, meanMs: timings.reduce((sum, value) => sum + value, 0) / Math.max(1, timings.length), p95Ms: timings[Math.floor(timings.length * .95)] ?? 0, maxMs: timings.at(-1) ?? 0 },
    frames, events, checkpoints, checksum: checksumGame(game), replay: null, criteria: [] };
  result.criteria = [{ id: 'full-hull-safety', basis: 'engine invariant', statement: 'Initial and live hulls stay clear of land and physical bodies, with continuous motion and real yaw limits.', sources: [],
    passed: quality.coastViolations === 0 && quality.bodyViolations === 0 && quality.discontinuousSteps === 0 && quality.yawLimitViolations === 0 && quality.maxHullOverlap < .1, actual: quality },
    { id: 'ordinary-hp', basis: 'engine invariant', statement: 'The scenario starts with ordinary full HP and enables deaths.', sources: [], passed: normalHp, actual: { normalHp, sunk: result.quality.sunk } }, ...scene.evaluate(result)];
  if (options.replay !== false) {
    const checkpoint = checkpoints.at(-1)!, checksum = replayHistoricalCheckpoint(scene, seed, checkpoint, game.tick);
    result.replay = { matched: checksum === result.checksum, checksum, checkpointTick: checkpoint.tick };
    result.criteria.push({ id: 'save-replay', basis: 'engine invariant', statement: 'A mid-scenario save and continuation reproduce the final deterministic game state.', sources: [], passed: result.replay.matched, actual: result.replay });
  }
  return result;
}

export function renderHistoricalTracks(results: HistoricalResult[], output: string) {
  const width = 1500, panelHeight = 420, canvas = createCanvas(width, results.length * panelHeight + 64), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f2e8'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#243b43'; ctx.font = '21px sans-serif';
  ctx.fillText('Historical naval mechanisms — actual game trajectories, normal HP; no metres or winner mapping', 28, 35);
  for (const [index, result] of results.entries()) {
    const top = 70 + index * panelHeight, points = result.frames.flatMap(frame => frame.ships), left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x));
    const low = Math.min(...points.map(point => point.y)), high = Math.max(...points.map(point => point.y)), plot = { x: 30, y: top + 30, w: 980, h: 300 };
    const scale = Math.min(plot.w / (right - left + 500), plot.h / (high - low + 500)), x = (v: number) => plot.x + plot.w / 2 + (v - (left + right) / 2) * scale, y = (v: number) => plot.y + plot.h / 2 + (v - (low + high) / 2) * scale;
    ctx.fillStyle = '#243b43'; ctx.font = '19px sans-serif'; ctx.fillText(result.title, plot.x, top + 10); ctx.fillStyle = '#dfebed'; ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
    if (result.lineX !== null) { ctx.strokeStyle = '#94a1a3'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(x(result.lineX), plot.y); ctx.lineTo(x(result.lineX), plot.y + plot.h); ctx.stroke(); ctx.setLineDash([]); }
    for (const [shipIndex, initial] of result.initial.entries()) {
      const poses = result.frames.map(frame => frame.ships.find(ship => ship.id === initial.id)!), color = initial.owner === 'enemy' ? '#b84a45' : '#216f94';
      ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.beginPath();
      for (const [n, point] of poses.entries()) { if (n) ctx.lineTo(x(point.x), y(point.y)); else ctx.moveTo(x(point.x), y(point.y)); } ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(initial.x), y(initial.y), 3, 0, Math.PI * 2); ctx.fill(); ctx.font = '12px sans-serif'; ctx.fillText(String(shipIndex + 1), x(initial.x) + 5, y(initial.y) - 5);
      for (let n = 0; n < poses.length; n += Math.max(1, Math.floor(poses.length / 5))) {
        const at = poses[n]!, c = Math.cos(at.heading), s = Math.sin(at.heading); ctx.beginPath();
        for (const [j, p] of initial.hull.entries()) { const xx = x(at.x + p.x * c - p.y * s), yy = y(at.y + p.x * s + p.y * c); if (j) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
        ctx.closePath(); ctx.globalAlpha = at.hp > 0 ? .15 : .07; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      }
      const end = poses.at(-1)!; ctx.beginPath(); ctx.moveTo(x(end.x) - 4, y(end.y) - 4); ctx.lineTo(x(end.x) + 4, y(end.y) + 4); ctx.moveTo(x(end.x) - 4, y(end.y) + 4); ctx.lineTo(x(end.x) + 4, y(end.y) - 4); ctx.stroke();
    }
    const passage = result.events.find(event => event.type === 'gangway-phase' && event.phase === 'ready' && event.sourceEndpoint && event.targetEndpoint);
    if (passage) {
      const a = passage.sourceEndpoint!, b = passage.targetEndpoint!;
      ctx.strokeStyle = '#8c7042'; ctx.globalAlpha = .4; ctx.lineWidth = passage.width! * scale;
      ctx.beginPath(); ctx.moveTo(x(a.x), y(a.y)); ctx.lineTo(x(b.x), y(b.y)); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const initialCrew of result.frames[0]!.crew) {
      const points = result.frames.flatMap(frame => frame.crew.filter(crew => crew.id === initialCrew.id));
      ctx.strokeStyle = initialCrew.owner === 'enemy' ? '#8e302e' : '#164e79'; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]); ctx.beginPath();
      for (const [i, point] of points.entries()) { if (i) ctx.lineTo(x(point.x), y(point.y)); else ctx.moveTo(x(point.x), y(point.y)); }
      ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle;
      const end = points.at(-1)!; ctx.beginPath(); ctx.arc(x(end.x), y(end.y), 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#243b43'; ctx.font = '14px sans-serif'; ctx.fillText(`${result.duration}s · shots ${result.quality.ships.reduce((sum, ship) => sum + ship.shots, 0)} · impacts ${result.quality.impactCount} · sunk ${result.quality.sunk.length} · max step ${result.timing.maxMs.toFixed(2)}ms`, plot.x, plot.y + plot.h + 23);
    ctx.fillText(`Sources: ${result.sourceIds.join(', ')}`, plot.x, plot.y + plot.h + 43);
    ctx.font = '14px sans-serif'; let textY = plot.y + 15;
    for (const check of result.criteria) { ctx.fillStyle = check.passed ? '#27754b' : '#b54138'; ctx.fillText(`${check.passed ? 'PASS' : 'FAIL'} ${check.id}`, 1030, textY); textY += 24; }
    ctx.fillStyle = '#53656a'; ctx.font = '12px sans-serif'; ctx.fillText('Blue/red: initial sides. Dot: start. Cross: final.', 1030, plot.y + 230); ctx.fillText('Dashed: crew tracks. Brown: deployed passage.', 1030, plot.y + 250); ctx.fillText('Read JSON for scope and unmodeled mechanisms.', 1030, plot.y + 270);
  }
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, canvas.toBuffer('image/png'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argument = (key: string) => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
  const only = argument('--case')?.split(','), seed = argument('--seed') ?? 'historical-review-v1', output = resolve(argument('--out') ?? 'work/historical-naval-review.json');
  const selected = historicalNavalScenarios.filter(scene => !only || only.includes(scene.id));
  if (!selected.length || only?.some(id => !selected.some(scene => scene.id === id))) throw new Error('Unknown --case; choose an exact scenario ID');
  const savedFile = argument('--replay');
  if (savedFile) {
    const saved = JSON.parse(readFileSync(resolve(savedFile), 'utf8')) as { checksumVersion: number; scenes: HistoricalResult[] };
    if (saved.checksumVersion !== CHECKSUM_VERSION) throw new Error('Saved checksum version differs from the current engine');
    const replays = saved.scenes.filter(result => !only || only.includes(result.id)).map(result => {
      const scene = selected.find(scene => scene.id === result.id); if (!scene) throw new Error(`Unknown saved scene ${result.id}`);
      const checkpoint = result.checkpoints.at(-1); if (!checkpoint) throw new Error(`No saved checkpoint for ${result.id}`);
      const checksum = replayHistoricalCheckpoint(scene, result.seed, checkpoint, seconds(result.duration));
      return { id: result.id, checkpointTick: checkpoint.tick, checksum, savedChecksum: result.checksum, matched: checksum === result.checksum };
    });
    if (!replays.length) throw new Error('No saved scenes match --case');
    process.stdout.write(`${JSON.stringify({ checksumVersion: CHECKSUM_VERSION, replays }, null, 2)}\n`);
    if (process.argv.includes('--validate') && replays.some(replay => !replay.matched)) process.exitCode = 1;
  } else {
  const requestedDuration = argument('--duration'), duration = requestedDuration === undefined ? undefined : Number(requestedDuration);
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) throw new Error('--duration must be positive seconds');
  const results = selected.map(scene => {
    const result = runHistoricalScenario(scene, { seed, ...(duration === undefined ? {} : { duration }), replay: !process.argv.includes('--no-replay') });
    process.stdout.write(`${scene.id} ${JSON.stringify({ checks: result.criteria.map(check => ({ id: check.id, passed: check.passed })), timing: result.timing, checksum: result.checksum })}\n`); return result;
  });
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify({ schema: 1, ticksPerSecond: SIM_TICKS_PER_SECOND, trajectoryHz: 1, checksumVersion: CHECKSUM_VERSION, sources: historicalNavalSources, scenes: results }));
  const png = resolve(argument('--png') ?? output.replace(/\.json$/i, '') + '.png'); renderHistoricalTracks(results, png);
  process.stdout.write(`Wrote ${output} and ${png}\n`);
  if (process.argv.includes('--validate') && results.some(result => result.criteria.some(check => !check.passed))) process.exitCode = 1;
  }
}
