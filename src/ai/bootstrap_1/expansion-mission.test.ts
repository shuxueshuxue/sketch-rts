import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { runGameLoop } from '../../sdk/game-runner';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { createSubjectGauntletInput } from '../benchmark/subject-gauntlet';
import { roomGauntlet } from '../benchmark/room-gauntlet';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';
import { planBootstrapGeneral } from './mine-defense';
import { bootstrapPolicyContext } from './policy';

function expansionScene(invaded = false) {
  let draft = sketchScene('finish-one-expansion').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
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
      if (tick === 0) expect(memory.v6!.creep!.center.x).toBe(1600);
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

it('starts the archer ladder-16 grove natural before 4:00 and third before 6:30 against the real v9', () => {
  // v5-final-1, slot 16, grove: main starts this hall at tick 6870 (5:43.5).
  const { input } = createSubjectGauntletInput(roomGauntlet('v9_archer', ['v9']), { seed: 'v5-final-1', mapCount: 20 });
  const match = input.evaluations[0]!.matches[28]!;
  let foundationTick: number | undefined;
  let thirdTick: number | undefined;
  runGameLoop({ ...match, maxTicks: 7800, commandPlanner: navalObservedPlanner({}) }, {
    onStep({ game }) {
      const halls = game.buildings.filter(building => building.owner === 'v9_archer' && building.kind === 'townHall');
      if (foundationTick === undefined && halls.length > 1) foundationTick = game.tick;
      if (thirdTick === undefined && halls.length > 2) thirdTick = game.tick;
    },
  });
  expect(foundationTick).toBeDefined();
  expect(foundationTick!).toBeLessThan(4800);
  expect(thirdTick).toBeDefined();
  expect(thirdTick!).toBeLessThan(7800);
}, 30000);
