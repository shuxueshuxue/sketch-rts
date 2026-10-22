import { BUILDING_DEFS, UNIT_DEFS } from '../../../../shared/catalog';
import { campMembers } from '../../../../shared/camps';
import { seconds } from '../../../../shared/time';
import { HOME, ISLAND, MAINLAND, PUZZLE_OWNER, PUZZLE_OPPONENT, TARGET_MINE,
  camp, finishWorld, homeEconomy, puzzleBuilder, soldiers, targetMine, terrainWorld, type PuzzleWorld } from '../world';

export type DisruptionKey = 'transport-sunk' | 'worker-ambush' | 'small-harassment';
export type DisruptionVariant = 'loaded' | 'poor' | 'empty' | 'stay' | 'hit-run' | 'small' | 'large';
export type DisruptionWorld = PuzzleWorld & {
  interceptors: string[]; localDefenders: string[]; mainForce: string[];
  road: { x: number; y: number } | null; retreat: { x: number; y: number };
};
export type DisruptionCase = {
  key: DisruptionKey; variant: DisruptionVariant; title: string; maxTicks: number;
  triggerRule: string; responseRule: string; create(): DisruptionWorld;
};

function shipScene(variant: 'loaded' | 'poor' | 'empty'): DisruptionWorld {
  const b = puzzleBuilder(BUILDING_DEFS.townHall.cost + (variant === 'poor' ? 0 : UNIT_DEFS.transport.cost));
  homeEconomy(b); targetMine(b, TARGET_MINE, variant === 'poor' ? UNIT_DEFS.footman.cost : 100 * BUILDING_DEFS.townHall.cost);
  soldiers(b, 'footman', 4, { x: 1184, y: 704 });
  camp(b, ['murlocPeon', 'murlocPeon'], { x: TARGET_MINE.x + 160, y: TARGET_MINE.y + 64 });
  // Existing genuine producers make replacement possible without inventing a spawn/output.
  b.building(PUZZLE_OWNER, 'barracks', 1056, 1120).building(PUZZLE_OWNER, 'shipyard', 1536, 1344);
  b.unit(PUZZLE_OPPONENT, 'warship', 2016, variant === 'empty' ? 1760 : 1088,
    { order: { type: 'hold', x: 2016, y: variant === 'empty' ? 1760 : 1088 } });
  const world = finishWorld(terrainWorld(b, [MAINLAND, ISLAND]), TARGET_MINE,
    { x: TARGET_MINE.x + 160, y: TARGET_MINE.y + 64 }, { x: 1664, y: variant === 'empty' ? 2432 : 768 });
  return { ...world, interceptors: world.game.units.filter(u => u.owner === world.opponent).map(u => u.id),
    mainForce: world.army.map(u => u.id), localDefenders: [], road: null, retreat: { x: 2048, y: 1536 } };
}
function workerScene(): DisruptionWorld {
  const b = puzzleBuilder(BUILDING_DEFS.townHall.cost);
  b.townHall(PUZZLE_OWNER, HOME.x, HOME.y).farms(PUZZLE_OWNER, 2, 256, 256)
    .goldMine('resource-0', HOME.x, HOME.y + 224, 4 * UNIT_DEFS.worker.cost);
  soldiers(b, 'worker', 3, { x: HOME.x - 96, y: HOME.y + 64 });
  soldiers(b, 'footman', 4, { x: 1024, y: 864 });
  b.building(PUZZLE_OWNER, 'barracks', 896, 1120);
  const mine = { x: 4256, y: 800 }, road = { x: 2432, y: 800 };
  targetMine(b, mine);
  soldiers(b, 'footman', 2, { x: road.x - 48, y: 512 }, PUZZLE_OPPONENT);
  const lands = [
    { left: 128, top: 128, right: 1280, bottom: 1792 },
    { left: 1152, top: 704, right: 3840, bottom: 896 },
    { left: 3712, top: 128, right: 4992, bottom: 1920 },
    { left: 2272, top: 384, right: 2560, bottom: 736 },
    { left: 2272, top: 864, right: 2560, bottom: 1920 },
  ];
  const world = finishWorld(terrainWorld(b, lands, 5120, 2048), mine, { x: 4800, y: 1600 });
  for (const u of world.game.units.filter(u => u.owner === world.opponent)) u.order = { type: 'hold', x: u.x, y: u.y };
  return { ...world, interceptors: world.game.units.filter(u => u.owner === world.opponent).map(u => u.id),
    mainForce: world.army.map(u => u.id), localDefenders: [], road, retreat: { x: 2432, y: 1792 } };
}
function harassmentScene(large: boolean): DisruptionWorld {
  const b = puzzleBuilder(BUILDING_DEFS.townHall.cost);
  homeEconomy(b); targetMine(b);
  soldiers(b, 'footman', 2, { x: 704, y: 704 });
  soldiers(b, 'footman', 4, { x: 3024, y: 704 });
  for (const m of campMembers(['murlocPeon', 'murlocPeon'], { x: 3136, y: 960 }))
    b.unit('neutral', m.kind, m.x, m.y, { hpRatio: .5 });
  soldiers(b, large ? 'knight' : 'footman', large ? 10 : 1, { x: 960, y: 1056 }, PUZZLE_OPPONENT);
  const world = finishWorld(terrainWorld(b, [MAINLAND, ISLAND]), TARGET_MINE, { x: 3136, y: 960 }, { x: 2176, y: 768 });
  const mainForce = world.army.filter(u => u.x > 2304), defenders = world.army.filter(u => u.x < 1536);
  // The cold frame is an already-started clear; ordinary native attack orders,
  // not a goal/lease/reward injected into either AI, carry this physical prefix.
  for (const u of mainForce) u.order = { type: 'attack', targetId: world.guards[0]!.id };
  for (const u of world.game.units.filter(u => u.owner === world.opponent)) u.order = { type: 'hold', x: u.x, y: u.y };
  return { ...world, interceptors: world.game.units.filter(u => u.owner === world.opponent).map(u => u.id),
    mainForce: mainForce.map(u => u.id), localDefenders: defenders.map(u => u.id), road: null,
    retreat: { x: 1344, y: 1536 } };
}
export const DISRUPTION_CASES: readonly DisruptionCase[] = [
  ...(['loaded', 'poor', 'empty'] as const).map(variant => ({ key: 'transport-sunk' as const, variant,
    title: variant === 'poor' ? '沉船后穷矿不划算' : variant === 'empty' ? '空船去装船点被击沉' : '载兵运输船被击沉',
    maxTicks: seconds(480), triggerRule: variant === 'empty'
      ? 'First original empty transport moves at least128 toward the original embark shore while carrying no unit.'
      : 'Original transport carries an original soldier and has moved at least128 from its original near-embark pose.',
    responseRule: 'One initial enemy warship attacks that real hull, then holds at its observed sinking position; no spawn/delete/teleport or tick trigger.',
    create: () => shipScene(variant) })),
  ...(['stay', 'hit-run'] as const).map(variant => ({ key: 'worker-ambush' as const, variant,
    title: variant === 'stay' ? '游击兵守路截杀工人' : '游击兵反复往返截杀', maxTicks: seconds(480),
    triggerRule: 'First living owner worker reaches the unique land corridor midpoint band (within160 of its x, in the corridor).',
    responseRule: variant === 'stay' ? 'Two initial footmen attack that worker, then hold at the actual death position.'
      : 'After each actual ambush, both surviving initial footmen retreat to the fixed far point; a different worker starting the corridor triggers the next return. Repeat at least3 unless the owner clears the attackers; no tick trigger.',
    create: workerScene })),
  ...(['small', 'large'] as const).map(variant => ({ key: 'small-harassment' as const, variant,
    title: variant === 'small' ? '小股骚扰保主力清营' : '大军骚扰允许比较后中止', maxTicks: seconds(420),
    triggerRule: 'First actual positive damage from an original island main-force unit to a member of the original camp.',
    responseRule: 'Initial enemy force attacks a living worker at the home mine; local defense and island clear remain real AI decisions.',
    create: () => harassmentScene(variant === 'large') })),
];
