import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { runGameLoop } from '../../sdk/game-runner';
import type { AiGameAgent } from '../game-runner';
import type { AiPolicyMemory } from '../memory';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { expansionMissionUnitIds } from './expansion-mission';
import * as attackObjective from './attack-objective';
import { availableV6Army } from '../policy/v6/general';
import { marchStrength } from '../policy/v6/strength';
import { v6Doctrine } from '../policy/v6/select';

type Saved = {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[];
  memories: Record<string, AiPolicyMemory>; agents: Record<string, AiGameAgent>; thinkInterval: number;
};
const saved = JSON.parse(readFileSync(new URL('./fixtures/summoner-safe-hold-9m10.json', import.meta.url), 'utf8')) as Saved;

it('defends the real raid, waits for its idle budget, and records the next sortie withdrawal', () => {
  // f074681a, v5-final-1, summoner ladder-12 grove vs v9, tick 11000.
  // The first sortie has already withdrawn. This pose isolates the new idle
  // debt from earlier expansion/creep trajectory changes, and checks the next
  // sortie with every room AI policy enabled. The scripted case owns demolition.
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  let first: { targetId: string; sinceTick: number } | undefined;
  let parallel = false;
  let defended: { tick: number; attackers: string[] } | undefined;
  let blocked: { tick: number; marching: number; defended: number; need: number; admitted: boolean } | undefined;
  const choose = attackObjective.chooseRoomAttack;
  const selection = vi.spyOn(attackObjective, 'chooseRoomAttack').mockImplementation((snapshot, options, intel, choices, eligible) => {
    // Observe the real admission callback and its real choice; do not duplicate
    // its defender, reinforcement or idle-time formulas in the test.
    if (snapshot.tick === 12262) {
      const choice = choices.find(choice => choice.base.hall.id === 'building-p1-townHall-1216')!;
      blocked = { tick: snapshot.tick, marching: marchStrength(availableV6Army(snapshot, options, intel))
        * (1 + v6Doctrine(snapshot, 'v9_summoner', options).profile.aggression),
        defended: choice.defended, need: choice.need, admitted: eligible(choice) };
    }
    return choose(snapshot, options, intel, choices, eligible);
  });
  const results: NonNullable<AiPolicyMemory['landAttackResult']>[] = [];
  try { runGameLoop({ name: 'summoner-12-attack-results', game, agents: saved.agents,
    maxTicks: 15000, thinkInterval: saved.thinkInterval, commandPlanner: navalObservedPlanner(memories),
  }, { onStep({ game }) {
    const memory = memories.v9_summoner!, task = memory.landAttack;
    if (!defended && memory.v6?.general?.mode === 'defend') {
      const hall = game.buildings.find(building => building.id === memory.v6!.general!.targetHallId)!;
      defended = { tick: game.tick - 1, attackers: game.units.filter(unit => unit.owner === 'p1' && unit.attackDamage > 0
        && Math.hypot(unit.x - hall.x, unit.y - hall.y) < 1000).map(unit => unit.kind).sort() };
    }
    if (task) {
      first ??= { targetId: task.targetId, sinceTick: task.sinceTick };
      if (task.sinceTick === first.sinceTick) {
        expect(task.targetId).toBe(first.targetId);
      }
      if (!task.paused && memory.v6?.general?.mode === 'attack') {
        expect(memory.v6.general.targetHallId).toBe(task.targetId);
        const reserved = expansionMissionUnitIds(memory);
        if (reserved.length && !memory.landExpansion?.paused && memory.landExpansion?.stage !== 'complete') {
          expect(task.general.group?.some(id => reserved.includes(id))).toBe(false);
          parallel = true;
        }
      }
    }
    const result = memory.landAttackResult;
    if (result && result.tick >= saved.snapshot.tick && results.at(-1)?.tick !== result.tick) {
      if (result.result === 'destroyed') expect(game.buildings.some(building => building.id === result.targetId)).toBe(false);
      if (result.result === 'withdrew') expect(result.reason).toMatch(/^general:retreat/);
      results.push({ ...result });
    }
  } }); } finally { selection.mockRestore(); }
  expect(first?.targetId).toBe('building-p1-townHall-1216');
  expect(defended?.tick).toBe(11137);
  expect(defended!.attackers.length).toBeGreaterThan(0);
  expect(defended!.tick).toBeLessThan(first!.sinceTick);
  expect(parallel).toBe(true);
  expect(results[0]).toMatchObject({ targetId: first!.targetId, result: 'withdrew' });
  expect(blocked).toMatchObject({ tick: 12262, admitted: false });
  expect(blocked!.marching).toBeGreaterThan(blocked!.defended);
  expect(blocked!.marching).toBeLessThan(blocked!.need);
  expect(blocked!.marching).toBeCloseTo(14.43, 2);
  expect(blocked!.defended).toBeCloseTo(13.90, 2);
  expect(blocked!.need).toBeCloseTo(20.07, 2);
  expect(game.buildings.find(building => building.id === 'building-p1-townhall')?.hp).toBeGreaterThan(0);
}, 60000);

it('resumes the same real attack after a scripted raid and actually demolishes the outpost on a later sortie', () => {
  // The task is already active in this captured pose. Its establishment is
  // covered separately; this scene isolates its defense/resume/result contract.
  const saved = JSON.parse(readFileSync(new URL('./fixtures/summoner-active-sortie-9m26.json', import.meta.url), 'utf8')) as Saved;
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories), planner = navalObservedPlanner(memories);
  const second = memories.v9_summoner!.landAttack!.sinceTick;
  let raidAt: number | undefined;
  let pausedAt: number | undefined, resumedAt: number | undefined, destroyedAt: number | undefined;
  const raiders: string[] = [];
  const results: NonNullable<AiPolicyMemory['landAttackResult']>[] = [];
  // Restore the real post-withdrawal pose. The opponent then follows
  // explicit scene orders: pull its army away, raid our third during our next
  // sortie, then retreat. Our economy, movement, combat and objective logic all
  // remain live. No target HP, unit stats or admission rule is changed.
  runGameLoop({ name: 'summoner-12-scripted-attack-lifecycle', game, agents: saved.agents,
    maxTicks: 16500, thinkInterval: saved.thinkInterval,
    commandPlanner: context => context.owner === 'p1' ? [] : planner(context),
  }, { beforeStep({ game }) {
    const memory = memories.v9_summoner!, task = memory.landAttack;
    if (!game.buildings.some(building => building.id === 'building-p1-townHall-1216')) destroyedAt ??= game.tick;
    if (second !== undefined && raidAt === undefined && game.tick >= second + 45) {
      raidAt = game.tick;
      const halls = game.buildings.filter(building => building.owner === 'v9_summoner' && building.kind === 'townHall');
      const hall = halls.find(building => building.y < 2000) ?? halls[0]!;
      for (let i = 0; i < 5; i++) raiders.push(game.spawnUnit('p1', 'emberRavager', hall.x + 200 + i * 32, hall.y + 100).id);
      issuePlayerCommand(game, 'p1', { type: 'attack', unitIds: raiders, targetId: hall.id });
    }
    if (raidAt !== undefined && task && task.sinceTick === second && task.paused === 'defense') {
      pausedAt ??= game.tick;
      expect(task.targetId).toBe('building-p1-townHall-1216');
      expect(memory.landAttackResult?.result).not.toBe('destroyed');
      expect(memory.v6?.general?.mode).toBe('defend');
    }
    if (pausedAt !== undefined && game.tick === pausedAt + 60) {
      const living = raiders.filter(id => game.units.some(unit => unit.id === id));
      if (living.length) issuePlayerCommand(game, 'p1', { type: 'move', unitIds: living, x: 3800, y: 350, avoidCombat: true });
    }
    if (pausedAt !== undefined && task && task.sinceTick === second && !task.paused) {
      resumedAt ??= game.tick;
      expect(task.targetId).toBe('building-p1-townHall-1216');
      expect(memory.v6?.general?.mode).toBe('attack');
    }
    const result = memory.landAttackResult;
    if (result && result.tick >= saved.snapshot.tick && results.at(-1)?.tick !== result.tick) {
      if (result.result === 'destroyed') expect(game.buildings.some(building => building.id === result.targetId)).toBe(false);
      results.push({ ...result });
    }
  } });
  expect(second).toBeDefined();
  expect(second!).toBeLessThan(15000);
  expect(pausedAt).toBeDefined();
  expect(resumedAt).toBeDefined();
  expect(resumedAt!).toBeGreaterThan(pausedAt!);
  expect(pausedAt).toBeGreaterThan(second!);
  expect(results.some(result => result.result === 'destroyed' && result.targetId === 'building-p1-townHall-1216')).toBe(true);
  expect(destroyedAt).toBeDefined();
  expect(destroyedAt!).toBeGreaterThan(second!);
  expect(game.buildings.some(building => building.id === 'building-p1-townHall-1216')).toBe(false);
  expect(game.buildings.find(building => building.id === 'building-p1-townhall')!.hp).toBe(1080);
}, 60000);
