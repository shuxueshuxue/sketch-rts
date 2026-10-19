import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { runGameLoop } from '../../sdk/game-runner';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { createSubjectGauntletInput } from '../benchmark/subject-gauntlet';
import { roomGauntlet } from '../benchmark/room-gauntlet';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';
import { mainArmyIntel, miningRally, planBootstrapGeneral } from './mine-defense';
import { bootstrapPolicyContext } from './policy';
import { v6ExpansionPoint } from '../policy/v6/economy';
import { expansionMissionCommands, expansionMissionUnitIds } from './expansion-mission';
import { expansionOwnsDefender } from './mining-leash';
import { recordUnitTaskClaim } from '../policy/claims';

function expansionScene(invaded = false) {
  let draft = sketchScene('finish-one-expansion').map('openClaims').replaceDefaults()
    .player('us', { team: 'a', ai: true }).player('foe', { team: 'b', ai: true })
    .townHall('us', 500, 500).goldMine('main', 788, 500, 6000)
    .goldMine('natural', 1600, 1100, 6000).townHall('foe', 3500, 3500)
    .worker('us', 800, 650, { id: 'builder' }).farms('us', 5, 500, 3000)
    .unit('neutral', 'ogreWarrior', 1600, 1250, { id: 'mine-guard' })
    .unit('neutral', 'ogreLord', 2700, 700, { id: 'unrelated-guard' });
  for (let i = 0; i < 6; i++) draft = draft.unit('us', 'knight', 900 + i % 3 * 45, 800 + Math.floor(i / 3) * 45, { id: `screen-${i}` });
  if (invaded) for (let i = 0; i < 4; i++) draft = draft.unit('foe', 'knight', 700 + i * 35, 500, { id: i === 0 ? 'invader' : `invader-${i}` });
  const game = draft.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  memory.v6 = { phase: 0, creep: { center: { x: 2700, y: 700 }, reach: 0, staging: { x: 2300, y: 700 },
    group: game.units.filter(unit => unit.id.startsWith('screen-')).map(unit => unit.id), stage: 'gather', since: 0 } };
  const context = () => {
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
    options.doctrines = [{ id: 'complete-expansion', race: 'grove', weight: 1, standIn: 'knight', raids: [],
      phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }];
    options.armyWants = [];
    return { snapshot, options };
  };
  return { game, memory, context };
}

it('finishes the requested mine, escort and hall instead of continuing an unrelated camp', () => {
  const { game, memory, context } = expansionScene();
  const stages = new Set<string>();
  for (let tick = 0; tick < 2400 && memory.landExpansion?.stage !== 'complete'; tick++) {
    if (tick % 15 === 0) {
      const { snapshot, options } = context();
      const commands = planBootstrapGeneral(snapshot, 'us', options);
      if (tick === 0) expect(memory.landExpansion!.combat!.creep!.center.x).toBe(1600);
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [bootstrapEconomy, miningAssignments], options);
      issueCommandFrame(game, [...entries.map(entry => ({ ...entry, playerId: 'us' })),
        ...commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command }))]);
      if (memory.landExpansion) stages.add(memory.landExpansion.stage);
    }
    stepGame(game);
  }
  expect([...stages]).toEqual(['clear', 'escort', 'build', 'complete']);
  expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall'
    && building.complete && Math.hypot(building.x - 1600, building.y - 1100) < 320)).toBe(true);
  const unrelated = game.units.find(unit => unit.id === 'unrelated-guard')!;
  expect(unrelated.hp).toBe(unrelated.maxHp);
});

it('records a real home threat, yields to defense and resumes the same mine afterwards', () => {
  const { game, memory, context } = expansionScene(true);
  for (const unit of game.units.filter(unit => unit.id.startsWith('screen-'))) unit.hp = 1;
  let { snapshot, options } = context();
  planBootstrapGeneral(snapshot, 'us', options);
  expect(memory.landExpansion).toMatchObject({ mineId: 'natural', paused: true,
    interruptions: [{ tick: 0, reason: 'home-threat', targetId: 'invader' }] });
  expect(['defend', 'guard']).toContain(memory.v6!.general!.mode);
  const paused = bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_knight', { memory, teams: game.teams });
  expect(paused.armyWants!.some(want => want.priority === 80)).toBe(false);
  game.units = game.units.filter(unit => !unit.id.startsWith('invader'));
  for (const unit of game.units.filter(unit => unit.id.startsWith('screen-'))) unit.hp = unit.maxHp;
  ({ snapshot, options } = context());
  planBootstrapGeneral(snapshot, 'us', options);
  expect(memory.landExpansion!.mineId).toBe('natural');
  expect(memory.landExpansion!.paused).toBeUndefined();
  expect(memory.landExpansion!.stage).toBe('clear');
});

it('sends only a small escort along the traveling builder’s road and releases the rest to the general', () => {
  const { game, memory, context } = expansionScene();
  game.units = game.units.filter(unit => unit.owner !== 'neutral');
  delete memory.v6!.creep;
  const mine = game.resources.find(resource => resource.id === 'natural')!;
  for (const unit of game.units.filter(unit => unit.id.startsWith('screen-'))) Object.assign(unit, { x: 1560, y: 1100 });
  const site = v6ExpansionPoint(snapshotGame(game), 'us', mine);
  issuePlayerCommand(game, 'us', { type: 'build', unitId: 'builder', buildingKind: 'townHall', ...site });
  const { snapshot, options } = context(), builder = game.units.find(unit => unit.id === 'builder')!;
  const commands = planBootstrapGeneral(snapshot, 'us', options);
  const escort = commands.filter(command => command.type === 'attackMove' && Math.hypot(command.x - builder.x, command.y - builder.y) <= 250);
  expect(escort.flatMap(command => 'unitIds' in command ? command.unitIds : [])).toHaveLength(3);
  expect(memory.landExpansion!.stage).toBe('escort');
  issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
  for (let tick = 0; tick < 60; tick++) stepGame(game);
  const escorted = new Set(escort.flatMap(command => 'unitIds' in command ? command.unitIds : []));
  expect(expansionMissionUnitIds(memory)).toHaveLength(3);
  expect(game.units.filter(unit => escorted.has(unit.id) && Math.hypot(unit.x - mine.x, unit.y - mine.y) > 180)).toHaveLength(3);
});

it('yields both arrived and traveling escorts to a mine rally, then fills the escort from the remaining nearby soldiers', () => {
  const { game, memory, context } = expansionScene();
  game.units = game.units.filter(unit => unit.owner !== 'neutral');
  delete memory.v6!.creep;
  const mine = game.resources.find(resource => resource.id === 'natural')!;
  const site = v6ExpansionPoint(snapshotGame(game), 'us', mine);
  issuePlayerCommand(game, 'us', { type: 'build', unitId: 'builder', buildingKind: 'townHall', ...site });
  const builder = game.units.find(unit => unit.id === 'builder')!;
  const soldiers = game.units.filter(unit => unit.id.startsWith('screen-'));
  soldiers.forEach((unit, index) => Object.assign(unit, { x: 1560, y: 1100 + index * 20 }));
  let { snapshot, options } = context();
  const first = expansionMissionCommands(snapshot, 'us', options, mainArmyIntel(snapshot, 'us', options))!;
  const escortIds = first.filter(command => command.type === 'attackMove'
    && Math.hypot(command.x - builder.x, command.y - builder.y) <= 250)
    .flatMap(command => 'unitIds' in command ? command.unitIds : []);
  expect(escortIds).toHaveLength(3);
  const hall = game.buildings.find(building => building.owner === 'us')!;
  memory.miningDefense = { hallId: hall.id, point: { x: hall.x + 150, y: hall.y },
    attackerIds: [],
    protectedHp: { [hall.id]: hall.hp }, phase: 'fight' };
  for (const [index, id] of escortIds.entries()) recordUnitTaskClaim(snapshot, memory, id, {
    kind: 'mineRally', targetId: hall.id, x: memory.miningDefense.point.x, y: memory.miningDefense.point.y, arrived: index < 2,
  });
  // No current intrusion: the original raid left, but the last defender has not reached the rally yet.
  for (const id of escortIds.slice(0, 2)) Object.assign(soldiers.find(unit => unit.id === id)!, memory.miningDefense.point);
  ({ snapshot, options } = context());
  expect(mainArmyIntel(snapshot, 'us', options).intrusion).toBeUndefined();
  expect(memory.landExpansion!.paused).toBe(true);
  expect(memory.landExpansion!.interruptions.at(-1)?.reason).toBe('mining-threat');
  expect(expansionMissionUnitIds(memory).some(id => escortIds.includes(id))).toBe(false);
  expect(escortIds.some(id => memory.unitClaims[id]?.kind === 'expansion')).toBe(false);
  expect(expansionMissionCommands(snapshot, 'us', options, mainArmyIntel(snapshot, 'us', options))).toBeUndefined();
  // The rally releases its members only after its final reinforcement arrives.
  Object.assign(soldiers.find(unit => unit.id === escortIds[2])!, memory.miningDefense.point);
  snapshot = snapshotGame(game);
  miningRally.run(snapshot, 'us', options);
  expect(memory.miningDefense).toBeUndefined();
  for (const unit of soldiers.filter(unit => !escortIds.includes(unit.id))) Object.assign(unit, { x: builder.x, y: builder.y });
  ({ snapshot, options } = context());
  const resumed = expansionMissionCommands(snapshot, 'us', options, mainArmyIntel(snapshot, 'us', options))!;
  const replacement = resumed.filter(command => command.type === 'attackMove'
    && Math.hypot(command.x - builder.x, command.y - builder.y) <= 250)
    .flatMap(command => 'unitIds' in command ? command.unitIds : []);
  expect(memory.landExpansion!.paused).toBeUndefined();
  expect(replacement).toHaveLength(3);
  expect(replacement.some(id => escortIds.includes(id))).toBe(false);
});

it('releases an existing unfunded task after the last income is lost instead of reserving its army forever', () => {
  const { game, memory, context } = expansionScene();
  game.units = game.units.filter(unit => unit.owner !== 'neutral');
  for (const mine of game.resources) if (mine.id === 'main') mine.amount = 0;
  delete memory.v6!.creep;
  const home = game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!;
  issuePlayerCommand(game, 'us', { type: 'train', buildingId: home.id, unitKind: 'worker' });
  issuePlayerCommand(game, 'us', { type: 'train', buildingId: home.id, unitKind: 'worker' });
  expect(game.players.us!.gold).toBeLessThan(400);
  const screen = game.units.filter(unit => unit.id.startsWith('screen-'));
  memory.landExpansion = { mineId: 'natural', sinceTick: 0, stage: 'escort', interruptions: [] };
  for (const unit of screen) memory.unitClaims[unit.id] = { kind: 'expansion', targetId: 'natural', x: 1600, y: 1100,
    sinceTick: 0, expiresTick: 30, expansionMineId: 'natural' };
  const { snapshot, options } = context();
  planBootstrapGeneral(snapshot, 'us', options);
  expect(memory.landExpansion!.stage).toBe('fund');
  expect(memory.v6!.general!.mode).toBe('attack');
  expect(screen.some(unit => expansionOwnsDefender(snapshot, 'us', options, unit))).toBe(false);
});

it('starts the archer ladder-16 natural before 4:00 and finishes the third before 7:30 against the real v9', () => {
  // v5-final-1, slot 16, grove: main starts this hall at tick 6870 (5:43.5).
  const { input } = createSubjectGauntletInput(roomGauntlet('v9_archer', ['v9']), { seed: 'v5-final-1', mapCount: 20 });
  const match = input.evaluations[0]!.matches[28]!;
  let foundationTick: number | undefined;
  let thirdTick: number | undefined;
  let thirdCompleteTick: number | undefined;
  runGameLoop({ ...match, maxTicks: 9000, commandPlanner: navalObservedPlanner({}) }, {
    onStep({ game }) {
      const halls = game.buildings.filter(building => building.owner === 'v9_archer' && building.kind === 'townHall');
      if (foundationTick === undefined && halls.length > 1) foundationTick = game.tick;
      if (thirdTick === undefined && halls.length > 2) thirdTick = game.tick;
      if (thirdCompleteTick === undefined && halls.filter(hall => hall.complete).length > 2) thirdCompleteTick = game.tick;
    },
  });
  expect(foundationTick).toBeDefined();
  expect(foundationTick!).toBeLessThan(4800);
  expect(thirdTick).toBeDefined();
  expect(thirdTick!).toBeLessThan(7800);
  // This fresh opening owns the expansion deadline. The old handoff snapshot
  // separately verifies a real enemy approach, avoidance and the same-mine retry.
  expect(thirdCompleteTick).toBeDefined();
  expect(thirdCompleteTick!).toBeLessThanOrEqual(9000);
}, 30000);
