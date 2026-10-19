import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { runGameLoop } from '../../sdk/game-runner';
import type { AiPolicyMemory } from '../memory';
import type { AiGameAgent } from '../game-runner';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { AI_SCRIPT_VERSIONS } from '../policy';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';
import { incomingLandArmy } from '../policy/land-arrivals';
import { groundFrontThreat } from '../policy/ground-threat';
import { availableV6Army } from '../policy/v6/general';
import { strengthOf } from '../policy/v6/strength';
import { isBacklineKind } from '../policy/v6/backline';
import { expansionMissionUnitIds } from './expansion-mission';
import { mainArmyIntel, planBootstrapGeneral } from './mine-defense';
import { territoryPostCommands } from './territory-pressure';
import { planBootstrapNaval } from './expedition-recovery';

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
    const close = target && game.units.filter(unit => unit.owner === 'v9_knight' && !unit.deck && unit.attackDamage > 0 && unit.kind !== 'worker'
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

it('keeps the real knight post with both navies active until a reachable threat outmatches its available army', () => {
  const saved = savedScene('knight-territory-10m');
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  let reached = false, peakFront = 0, closeTicks = 0, occupying = false, justifiedWithdrawal = false;
  const returned = new Set<string>();
  runGameLoop({ name: 'knight-pressure-with-live-navies', game, agents: saved.agents, maxTicks: 17400,
    thinkInterval: saved.thinkInterval, commandPlanner: navalObservedPlanner(memories),
  }, { onStep({ game }) {
    const memory = memories.v9_knight!;
    reached ||= memory.territory?.objective?.reachedTick !== undefined;
    const mine = game.resources.find(mine => mine.id === 'gold-gen-5')!;
    const close = game.units.filter(unit => unit.owner === 'v9_knight' && !unit.deck && unit.kind !== 'worker' && unit.attackDamage > 0
      && Math.hypot(unit.x - mine.x, unit.y - mine.y) <= 1200).length;
    peakFront = Math.max(peakFront, close);
    if (close >= 2) closeTicks++;
    if (occupying && close < 2 && closeTicks < 45 * 20) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'v9_knight', 'v9_knight',
        { memory: structuredClone(memory), teams: game.teams });
      const whole = mainArmyIntel(snapshot, 'v9_knight', options), reserved = new Set(expansionMissionUnitIds(options.memory));
      const army = whole.army.filter(unit => !reserved.has(unit.id)), intel = { ...whole, army, power: strengthOf(army) };
      const available = availableV6Army(snapshot, options, intel);
      const front = available.filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0 && unit.hp >= unit.maxHp * .35);
      const hall = snapshot.buildings.find(building => building.id === 'building-v9_knight-townHall-1300')!;
      // Check the cause at the actual exit, not an unrelated raid later in the game.
      justifiedWithdrawal = incomingLandArmy(snapshot, 'v9_knight', options, hall).length > 0
        && groundFrontThreat(snapshot, intel, front) > strengthOf(available);
      expect(justifiedWithdrawal).toBe(true);
    }
    occupying = close >= 2;
    const defense = memory.v6?.general;
    const hall = defense?.mode === 'defend' && game.buildings.find(building => building.id === defense.targetHallId);
    if (hall) for (const id of ['unit-v9_knight-emberRavager-1049', 'unit-v9_knight-emberRavager-1076', 'unit-v9_knight-emberRavager-1403']) {
      const unit = game.units.find(unit => unit.id === id);
      if (unit && !unit.deck && Math.hypot(unit.x - hall.x, unit.y - hall.y) < defense!.leash!) returned.add(id);
    }
  } });
  expect(reached).toBe(true);
  expect(peakFront).toBeGreaterThanOrEqual(3);
  // The 45-second guarantee has one measured exception: the forward army is
  // outmatched and the same enemy can reach our working mine within 45 seconds.
  if (closeTicks <= 45 * 20) {
    expect(justifiedWithdrawal).toBe(true);
    expect(returned.size).toBe(3);
  }
});

it.each(['safe', 'withdraw', 'defend'] as const)('preserves the actual knight mine-defense decision at the %s frame', frame => {
  const frames = JSON.parse(readFileSync(new URL('./fixtures/knight-territory-review-frames.json', import.meta.url), 'utf8'));
  const saved = frames[frame] as Saved, owner = 'v9_knight';
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game), memory = structuredClone(saved.memories[owner]!);
  const options = bootstrapPolicyContext(snapshot, owner, owner, { memory, teams: game.teams });
  const whole = mainArmyIntel(snapshot, owner, options), reserved = new Set(expansionMissionUnitIds(memory));
  const army = whole.army.filter(unit => !reserved.has(unit.id)), intel = { ...whole, army, power: strengthOf(army) };
  const available = availableV6Army(snapshot, options, intel);
  const front = available.filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0 && unit.hp >= unit.maxHp * .35);
  const threat = groundFrontThreat(snapshot, intel, front), power = strengthOf(available);
  const hall = snapshot.buildings.find(building => building.id === 'building-v9_knight-townHall-1300')!;
  const arrivals = incomingLandArmy(snapshot, owner, options, hall);
  expect(arrivals.length).toBeGreaterThan(0);
  const pressure = territoryPostCommands(snapshot, owner, options, intel, !intel.intrusion);
  if (frame === 'safe') {
    expect(threat).toBeLessThan(power);
    expect(pressure?.unitIds).toEqual(expect.arrayContaining(['unit-v9_knight-emberRavager-1049', 'unit-v9_knight-emberRavager-1076', 'unit-v9_knight-emberRavager-1403']));
  } else {
    expect(pressure).toBeUndefined();
    if (frame === 'withdraw') {
      expect(arrivals[0]!.ticks).toBe(455);
      expect(threat).toBeGreaterThan(power);
    }
    const boarding = planBootstrapNaval(snapshot, owner, options).flatMap(command => command.type === 'board' ? command.unitIds : []);
    for (const id of ['unit-v9_knight-emberRavager-1049', 'unit-v9_knight-emberRavager-1076', 'unit-v9_knight-emberRavager-1403']) {
      expect(boarding).not.toContain(id);
      const unit = snapshot.units.find(unit => unit.id === id)!;
      expect(unit.deck).toBeUndefined();
      if (frame === 'defend') {
        expect(Math.hypot(unit.x - hall.x, unit.y - hall.y)).toBeLessThan(memory.v6!.general!.leash!);
        expect(unit.order.type === 'attack' || unit.order.type === 'attackMove').toBe(true);
        expect(intel.intrusion!.attackers.map(foe => foe.id)).toContain('targetId' in unit.order && unit.order.targetId);
      }
    }
    planBootstrapGeneral(snapshot, owner, options);
    if (frame === 'defend') expect(memory.v6?.general).toMatchObject({ mode: 'defend', targetHallId: hall.id });
  }
});
