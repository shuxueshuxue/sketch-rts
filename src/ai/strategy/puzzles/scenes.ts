import { BUILDING_DEFS, TIER_SUPPLY_CAP, UNIT_DEFS } from '../../../shared/catalog';
import { seconds } from '../../../shared/time';
import { boardUnit } from '../../../shared/decks';
import { stepGame } from '../../../shared/sim';
import { HOME, ISLAND, MAINLAND, PUZZLE_OWNER, PUZZLE_OPPONENT, TARGET_MINE, camp, findMine, finishWorld, homeEconomy,
  cliffCoast, neutralGroup, puzzleBuilder, soldiers, targetMine, terrainWorld, type PuzzleWorld } from './world';

export type PuzzleKey = 'ship-away' | 'supply-tier' | 'navy-zero' | 'defense-window' | 'guarded-shore' | 'negative-return' | 'evacuate';
export type PuzzleVariant = 'far' | 'near' | 'knight' | 'footmen' | 'default' | 'urgent' | 'later' | 'strong' | 'weak';
export type PublicPuzzleCase = { key: PuzzleKey; variant: PuzzleVariant; title: string; maxTicks: number; create: () => PuzzleWorld };
const WEAK_GUARD = ['murlocPeon', 'murlocPeon'] as const;
const TARGET_GUARD = { x: TARGET_MINE.x + 160, y: TARGET_MINE.y + 64 };

export function shipAwayScene(near = false) {
  const b = puzzleBuilder(BUILDING_DEFS.townHall.cost);
  homeEconomy(b); targetMine(b); soldiers(b, 'footman', 4, { x: 1184, y: 704 }); camp(b, WEAK_GUARD, TARGET_GUARD);
  return finishWorld(terrainWorld(b, [MAINLAND, ISLAND]), TARGET_MINE, TARGET_GUARD,
    { x: 1664, y: near ? 768 : 2432 });
}
export function supplyTierScene(footmen = false) {
  const b = puzzleBuilder(BUILDING_DEFS.farm.cost + UNIT_DEFS.knight.cost);
  homeEconomy(b, Math.floor((TIER_SUPPLY_CAP[3] - BUILDING_DEFS.townHall.supplyProvided) / BUILDING_DEFS.farm.supplyProvided));
  b.building(PUZZLE_OWNER, 'stables', 1056, 704);
  // The one-number variant adds an already available basic production lane.
  if (footmen) b.building(PUZZLE_OWNER, 'barracks', 1088, 1056);
  const mine = { x: 1984, y: 832 }, guard = { x: 2144, y: 896 };
  targetMine(b, mine); camp(b, ['murlocHunter', 'murlocHunter'], guard);
  return finishWorld(terrainWorld(b, [{ left: 128, top: 128, right: 3712, bottom: 2816 }]), mine, guard);
}
export function navyZeroScene() {
  const gold = BUILDING_DEFS.shipyard.cost + UNIT_DEFS.transport.cost + BUILDING_DEFS.townHall.cost;
  const b = puzzleBuilder(gold);
  homeEconomy(b); targetMine(b); soldiers(b, 'footman', 4, { x: 1184, y: 704 }); camp(b, WEAK_GUARD, TARGET_GUARD);
  return finishWorld(terrainWorld(b, [MAINLAND, ISLAND]), TARGET_MINE, TARGET_GUARD);
}
export function defenseWindowScene(later = false) {
  const arrivalSeconds = later ? 360 : 90;
  const mine = { x: 2304, y: 2240 }, guard = { x: 2464, y: 2304 };
  const b = puzzleBuilder(BUILDING_DEFS.townHall.cost);
  homeEconomy(b); targetMine(b, mine); soldiers(b, 'footman', 6, { x: 800, y: 704 }); camp(b, WEAK_GUARD, guard);
  soldiers(b, 'footman', 4, { x: HOME.x + arrivalSeconds * UNIT_DEFS.footman.speed, y: HOME.y }, PUZZLE_OPPONENT);
  const width = Math.ceil((HOME.x + arrivalSeconds * UNIT_DEFS.footman.speed + 1024) / 32) * 32;
  const world = finishWorld(terrainWorld(b, [{ left: 128, top: 128, right: width - 128, bottom: 1536 },
    { left: 1792, top: 1984, right: 3200, bottom: 2816 }], width, 3328),
    mine, guard, { x: 1664, y: 1800 });
  world.departure = { x: 1408, y: 1472 }; world.landing = { x: 1856, y: 2048 };
  world.attackers = world.game.units.filter(u => u.owner === PUZZLE_OPPONENT);
  return world;
}
export function guardedShoreScene(strong = true) {
  const b = puzzleBuilder(BUILDING_DEFS.townHall.cost);
  homeEconomy(b); const mine = { x: 3104, y: 1824 }, guard = { x: 3264, y: 1888 };
  targetMine(b, mine); camp(b, WEAK_GUARD, guard);
  const beach = { x: 2400, y: 768 };
  camp(b, ['ogreLord', 'ogreMage', 'ogreWarrior'], beach);
  // One-number variant: only the count changes, not weapon, upgrades or camp.
  soldiers(b, 'footman', strong ? 8 : 3, { x: 1184, y: 704 });
  const island = { ...ISLAND, bottom: 3264 };
  const game = terrainWorld(b, [MAINLAND, island], 4096, 3584);
  cliffCoast(game, island, [
    { left: island.left - 64, right: island.left + 96, top: 704, bottom: 832 },
    { left: 3040, right: 3168, top: island.bottom - 96, bottom: island.bottom + 64 },
  ]);
  const world = finishWorld(game, mine, guard, { x: 1664, y: 768 });
  world.beachGuards = neutralGroup(world.game, beach);
  world.landing = strong ? { x: 2368, y: 768 } : { x: 3104, y: 3200 };
  return world;
}
export function negativeReturnScene() {
  const b = puzzleBuilder(BUILDING_DEFS.townHall.cost);
  homeEconomy(b); targetMine(b, TARGET_MINE, UNIT_DEFS.footman.cost);
  camp(b, ['ogreLord', 'ogreMage', 'ogreWarrior', 'ogreWarrior'], TARGET_GUARD);
  soldiers(b, 'footman', 6, { x: 960, y: 1728 });
  const localMine = { x: 960, y: 2112 }, localGuard = { x: 1120, y: 2176 };
  b.goldMine(`resource-${2}`, localMine.x, localMine.y, 100 * BUILDING_DEFS.townHall.cost);
  camp(b, WEAK_GUARD, localGuard);
  const world = finishWorld(terrainWorld(b, [MAINLAND, ISLAND]), TARGET_MINE, TARGET_GUARD, { x: 1664, y: 1728 });
  world.localMine = findMine(world.game, localMine); world.localGuards = neutralGroup(world.game, localGuard);
  return world;
}
export function evacuateScene() {
  const b = puzzleBuilder(0); homeEconomy(b); targetMine(b);
  b.townHall(PUZZLE_OWNER, TARGET_MINE.x, TARGET_MINE.y - 224);
  soldiers(b, 'worker', 4, { x: 2624, y: 704 }); soldiers(b, 'footman', 2, { x: 1184, y: 704 });
  soldiers(b, 'knight', 10, { x: 3392, y: 704 }, PUZZLE_OPPONENT);
  const world = finishWorld(terrainWorld(b, [MAINLAND, ISLAND]), TARGET_MINE, TARGET_GUARD, { x: 2176, y: 768 });
  world.islandHall = world.game.buildings.find(h => h.owner === PUZZLE_OWNER && h.kind === 'townHall' && h !== world.home)!;
  world.islandWorkers = world.workers.filter(u => u.x > 2304); world.attackers = world.game.units.filter(u => u.owner === PUZZLE_OPPONENT);
  // A real invasion already has a first wave ashore; the last rider is still on
  // its incoming hull. The runner orders an ordinary unload, never a timed spawn.
  const invasion = world.game.spawnUnit(PUZZLE_OPPONENT, 'transport', 3840, 896);
  if (!boardUnit(invasion, world.attackers.at(-1)!, world.game.units)) throw new Error('Invasion rider does not fit its real deck');
  stepGame(world.game);
  return world;
}
export const PUBLIC_PUZZLES: readonly PublicPuzzleCase[] = [
  { key: 'ship-away', variant: 'far', title: '船在别处', maxTicks: seconds(420), create: () => shipAwayScene() },
  { key: 'ship-away', variant: 'near', title: '船在装船点旁边', maxTicks: seconds(420), create: () => shipAwayScene(true) },
  { key: 'supply-tier', variant: 'knight', title: '人口档位卡住骑士', maxTicks: seconds(180), create: () => supplyTierScene() },
  { key: 'supply-tier', variant: 'footmen', title: '已有步兵生产线更快', maxTicks: seconds(180), create: () => supplyTierScene(true) },
  { key: 'navy-zero', variant: 'default', title: '从零造海军', maxTicks: seconds(480), create: navyZeroScene },
  { key: 'defense-window', variant: 'urgent', title: '90 秒后矿厅遇袭', maxTicks: seconds(480), create: () => defenseWindowScene() },
  { key: 'defense-window', variant: 'later', title: '6 分钟后遇袭可先夺岛', maxTicks: seconds(480), create: () => defenseWindowScene(true) },
  { key: 'guarded-shore', variant: 'strong', title: '有能力清近滩头', maxTicks: seconds(420), create: () => guardedShoreScene() },
  { key: 'guarded-shore', variant: 'weak', title: '绕行安全滩头', maxTicks: seconds(480), create: () => guardedShoreScene(false) },
  { key: 'negative-return', variant: 'default', title: '穷矿强营不划算', maxTicks: seconds(420), create: negativeReturnScene },
  { key: 'evacuate', variant: 'default', title: '守不住就撤工人', maxTicks: seconds(180), create: evacuateScene },
];
