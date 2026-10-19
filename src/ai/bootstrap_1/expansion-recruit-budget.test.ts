import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame } from '../../shared/sim';
import { createShop } from '../../shared/shop';
import { createAiPolicyMemory } from '../memory';
import { BOOTSTRAP_DOCTRINES, bootstrapPolicyContext } from './policy';
import { planBootstrapEconomy } from './economy';

function waitingScreen(mirror: boolean, gold: number, extraRange = false) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('fund-committed-camp-party').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
    .townHall('foe', x(3500), 3500).goldMine('natural', x(1500), 1400, 10000)
    .farms('us', extraRange ? 4 : 3, x(300), 3000).building('us', 'barracks', x(750), 450)
    .building('us', 'archeryRange', x(800), 700, { id: 'range' })
    .unit('us', 'footman', x(1400), 1050, { id: 'screen-melee' })
    .unit('neutral', 'ogreMage', x(1535), 1615).unit('neutral', 'ogreMage', x(1442), 1636)
    .unit('neutral', 'ogreWarrior', x(1470), 1545)
    .mercenaryCamp('hire-medic', x(2400), 700, { hireKind: 'fieldMedic', cost: 155 })
    .unit('us', 'footman', x(2400), 700, { id: 'courier', order: { type: 'hold', x: x(2400), y: 700 } });
  for (let n = 0; n < 4; n++) scene = scene.unit('us', 'archer', x(1350 + n * 30), 1100, { id: `screen-${n}` });
  if (extraRange) scene = scene.building('us', 'archeryRange', x(1000), 700, { id: 'extra-range' });
  for (let n = 0; n < 6; n++) scene = scene.worker('us', x(550 + n * 25), 500);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.tick = 3870;
  const strategy = BOOTSTRAP_DOCTRINES.v9_archer.find(strategy => strategy.race === 'grove')!;
  memory.v6 = { phase: 1, doctrine: { profileId: 'steady', strategyId: strategy.id, decidedTick: 0 },
    goalAges: { 'hire:fieldMedic': { since: 0, seen: 3855 }, 'unit:archer': { since: 3510, seen: 3855 } } };
  memory.landExpansion = { mineId: 'natural', sinceTick: 2475, stage: 'assemble', interruptions: [] };
  memory.mercenaryCourier = { unitId: 'courier', campId: 'hire-medic' };
  const plan = () => {
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
    return planBootstrapEconomy(snapshot, 'us', options);
  };
  const issue = (commands: ReturnType<typeof plan>) => issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6Economy', command })));
  return { game, memory, plan, issue };
}

it.each([false, true])('funds the missing camp recruit before an aged optional medic (mirror=%s)', mirror => {
  // ladder-16 grove under rule 7: five full-health idle soldiers rate 4.082,
  // below the guard's unchanged 4.318 requirement. An aged 155-gold hire used
  // to hold 124 gold and delay the necessary 115-gold archer by 450 ticks.
  const { game, memory, plan, issue } = waitingScreen(mirror, 124);
  const commands = plan();
  expect(memory.landExpansion?.stage).toBe('assemble');
  expect(commands).toContainEqual({ type: 'train', buildingId: 'range', unitKind: 'archer' });
  expect(commands.some(command => command.type === 'hire')).toBe(false);
  issue(commands);
  expect(game.players.us!.gold).toBe(9);
  expect(game.buildings.find(building => building.id === 'range')!.queue).toHaveLength(1);
});

it.each([false, true])('allows the optional hire when both ordinary purchases are funded (mirror=%s)', mirror => {
  const { game, plan, issue } = waitingScreen(mirror, 279);
  const commands = plan();
  expect(commands).toContainEqual({ type: 'train', buildingId: 'range', unitKind: 'archer' });
  expect(commands).toContainEqual({ type: 'hire', campId: 'hire-medic' });
  issue(commands);
  expect(game.players.us!.gold).toBe(9);
  expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'fieldMedic')).toHaveLength(1);
});

it.each([false, true].flatMap(mirror => [false, true].map(extraRange => ({ mirror, extraRange }))))(
  'releases paid recruit funding even with an idle extra range (mirror=$mirror, extra=$extraRange)', ({ mirror, extraRange }) => {
  const { game, plan, issue } = waitingScreen(mirror, 279, extraRange);
  issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'range', unitKind: 'archer' });
  const commands = plan();
  expect(commands).toContainEqual({ type: 'hire', campId: 'hire-medic' });
  expect(commands.some(command => command.type === 'train' && command.unitKind === 'archer')).toBe(false);
  issue(commands);
  expect(game.players.us!.gold).toBe(9);
  expect(game.buildings.find(building => building.id === 'range')!.queue).toHaveLength(1);
});


it.each([false, true].flatMap(mirror => [124, 324].map(gold => ({ mirror, gold }))))(
  'funds the camp recruit before an aged shop errand, then buys only with the remainder (mirror=$mirror, gold=$gold)', ({ mirror, gold }) => {
  const { game, memory, plan, issue } = waitingScreen(mirror, gold);
  const buyer = game.units.find(unit => unit.id === 'courier')!;
  game.mercenaryCamps = [];
  delete memory.mercenaryCourier;
  game.shops = [createShop('shop', buyer.x, buyer.y)];
  memory.shopping = { unitId: buyer.id, shopId: 'shop', kind: 'guardianScroll',
    homeId: game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!.id, returning: false };
  memory.v6!.goalAges!.shopping = { since: 0, seen: 3855 };
  const commands = plan();
  expect(commands).toContainEqual({ type: 'train', buildingId: 'range', unitKind: 'archer' });
  expect(commands.some(command => command.type === 'buy')).toBe(gold === 324);
  issue(commands);
  expect(game.players.us!.gold).toBe(9);
  expect(game.items.some(item => item.kind === 'guardianScroll' && item.carrierId === buyer.id)).toBe(gold === 324);
});
