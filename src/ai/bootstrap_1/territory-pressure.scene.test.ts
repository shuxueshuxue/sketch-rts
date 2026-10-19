import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { runGameLoop } from '../../sdk/game-runner';
import type { AiPolicyMemory } from '../memory';
import type { AiGameAgent } from '../game-runner';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { AI_SCRIPT_VERSIONS } from '../policy';
import { bootstrapScripts } from './policy';

type Saved = { snapshot: GameSnapshot; nextId: number; activePlayers: string[];
  memories: Record<string, AiPolicyMemory>; agents: Record<string, AiGameAgent>; thinkInterval: number };
const savedScene = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Saved;

it('accumulates the real summoner holds across defenses and physically sets out again before tick 15000', () => {
  const saved = savedScene('summoner-safe-hold-9m10');
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  const first = new Map<string, { x: number; y: number }>();
  let postTick: number | undefined, attackTick: number | undefined, advanced = false;
  const commanded = new Set<string>();
  let debtBeforeDefense: number | undefined, preserved = false;
  runGameLoop({ name: 'summoner-hold-to-pressure', game, agents: saved.agents, maxTicks: 15000,
    thinkInterval: saved.thinkInterval, commandPlanner: navalObservedPlanner(memories),
  }, { onCommand({ owner, scriptId, command }) {
    const point = memories.v9_summoner!.territory?.objective?.point;
    if (owner === 'v9_summoner' && scriptId === 'v6General' && command.type === 'attackMove'
      && point && Math.hypot(command.x - point.x, command.y - point.y) < 200)
      for (const id of command.unitIds) commanded.add(id);
  }, onStep({ game }) {
    const memory = memories.v9_summoner!, territory = memory.territory, general = memory.v6?.general;
    if (general?.mode === 'defend') {
      if (debtBeforeDefense === undefined && territory && territory.idleTicks > 0) debtBeforeDefense = territory.idleTicks;
      if (territory?.objective) expect(general.target).not.toEqual(territory.objective.point);
    } else if (debtBeforeDefense !== undefined && territory) {
      if (territory.idleTicks >= debtBeforeDefense) preserved = true;
    }
    if (territory?.lastAction?.kind === 'post' && postTick === undefined) {
      postTick = territory.lastAction.tick;
      for (const unit of game.units.filter(unit => unit.owner === 'v9_summoner' && unit.kind !== 'worker'))
        first.set(unit.id, { x: unit.x, y: unit.y });
    }
    if (territory?.lastAction?.kind === 'attack') attackTick ??= territory.lastAction.tick;
    if (postTick !== undefined && game.tick < 13267) {
      const moved = game.units.filter(unit => commanded.has(unit.id) && first.has(unit.id)
        && Math.hypot(unit.x - first.get(unit.id)!.x, unit.y - first.get(unit.id)!.y) > 200);
      if (moved.length >= 3) advanced = true;
    }
  } });
  expect(preserved).toBe(true);
  expect(postTick).toBeDefined();
  expect(attackTick).toBeDefined();
  expect(attackTick!).toBeLessThan(15000);
  expect(advanced).toBe(true);
});

it('keeps the historic knight ground pressure by the enemy mine when neither navy borrows the land front', () => {
  const saved = savedScene('knight-territory-10m');
  // Isolate the land-pressure contract. A working ferry can now borrow troops
  // from this old mixed naval/land frame and change the opponent's next raid.
  // Keep the original physical post and occupation-duration assertions below.
  saved.agents.p1!.scripts = AI_SCRIPT_VERSIONS.v9.filter(script => script.id !== 'naval');
  saved.agents.v9_knight!.scripts = bootstrapScripts('v9_knight').filter(script => script.id !== 'naval');
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  let firstPost: number | undefined, reached: number | undefined;
  let closeTicks = 0, peakFront = 0;
  runGameLoop({ name: 'knight-hold-to-territory', game, agents: saved.agents, maxTicks: 17400,
    thinkInterval: saved.thinkInterval, commandPlanner: navalObservedPlanner(memories),
  }, { onStep({ game }) {
    const territory = memories.v9_knight!.territory;
    if (territory?.lastAction?.kind === 'post') firstPost ??= territory.lastAction.tick;
    if (territory?.objective?.reachedTick !== undefined) reached ??= territory.objective.reachedTick;
    // Measure the mining area itself: this fixture's hall stands 213 units
    // away from its gold seam, on the far side of the approaching army.
    const target = game.resources.find(mine => mine.id === 'gold-gen-5');
    const close = target && game.units.filter(unit => unit.owner === 'v9_knight' && unit.attackDamage > 0 && unit.kind !== 'worker'
      && Math.hypot(unit.x - target.x, unit.y - target.y) <= 1200).length;
    peakFront = Math.max(peakFront, close ?? 0);
    if (close && close >= 2) closeTicks++;
  } });
  expect(firstPost).toBeDefined();
  expect(firstPost!).toBeLessThan(15000);
  expect(reached).toBeDefined();
  expect(peakFront).toBeGreaterThanOrEqual(3);
  expect(closeTicks).toBeGreaterThan(45 * 20);
});

it('still occupies the real knight post with both navies active, yielding to an actual home raid', () => {
  const saved = savedScene('knight-territory-10m');
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  let reached = false, peakFront = 0, closeTicks = 0, defendedRaid = false;
  runGameLoop({ name: 'knight-pressure-with-live-navies', game, agents: saved.agents, maxTicks: 17400,
    thinkInterval: saved.thinkInterval, commandPlanner: navalObservedPlanner(memories),
  }, { onStep({ game }) {
    const memory = memories.v9_knight!;
    reached ||= memory.territory?.objective?.reachedTick !== undefined;
    const mine = game.resources.find(mine => mine.id === 'gold-gen-5')!;
    const close = game.units.filter(unit => unit.owner === 'v9_knight' && unit.kind !== 'worker' && unit.attackDamage > 0
      && Math.hypot(unit.x - mine.x, unit.y - mine.y) <= 1200).length;
    peakFront = Math.max(peakFront, close);
    if (close >= 2) closeTicks++;
    const defense = memory.v6?.general;
    const hall = defense?.mode === 'defend' && game.buildings.find(building => building.id === defense.targetHallId);
    if (hall && game.units.some(unit => unit.owner === 'p1' && !unit.deck && unit.attackDamage > 0
      && Math.hypot(unit.x - hall.x, unit.y - hall.y) < 1000)) defendedRaid = true;
  } });
  expect(reached).toBe(true);
  expect(peakFront).toBeGreaterThanOrEqual(3);
  // A physically present raid may recall the post. Without one, the same
  // sustained occupation required by the isolated ground scene still applies.
  if (!defendedRaid) expect(closeTicks).toBeGreaterThan(45 * 20);
  else expect(closeTicks).toBeGreaterThan(0);
});
