import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, walkableGoal } from '../../shared/terrain';
import { seconds } from '../../shared/time';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapNaval } from './expedition-recovery';
import { planNavalTactics } from '../policy/naval';
import { planFirstCombatCrossing } from './combat-delivery';

// Unedited native rooms: one AFK human and all remaining seats at room defaults,
// captured on 93da2479. Positions, orders, teams and AI memory are the actual frame.
function scene(file: string, owner: string) {
  const saved: { snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>; versions: Record<string, BootstrapAiVersion> } =
    JSON.parse(readFileSync(new URL(`./fixtures/${file}.json`, import.meta.url), 'utf8'));
  const game = createGame('bareDuel', { aiPlayers: [] });
  restoreSnapshotIntoGame(game, saved.snapshot, 2_000_000);
  game.scriptedVictory = true;
  const memory = saved.memories[owner]!, version = saved.versions[owner]!;
  const [boatId, mission] = Object.entries(memory.naval!.ferries!).find(([, task]) => task.purpose === 'advance')!;
  const commands = () => {
    const snapshot = snapshotGame(game);
    return planBootstrapNaval(snapshot, owner, bootstrapPolicyContext(snapshot, owner, version, { memory, teams: game.teams }));
  };
  return { game, memory, boatId, mission, commands };
}

const seats = [
  ...['enemy', 'enemy2'].map(owner => ({ file: 'temple-loading-600', owner })),
  { file: 'ring-loading-600', owner: 'player-4' },
];
it.each(seats)('boards and physically unloads the blocked native seat: $file / $owner', ({ file, owner }) => {
  const { game, memory, boatId, mission, commands } = scene(file, owner);
  expect(memory.naval!.ferryDecisions![boatId]!.reason).toBe('no-combat-crew');
  const first = commands();
  expect(first.some(command => command.type === 'board' && command.transportId === boatId
    && command.unitIds.some(id => game.units.find(unit => unit.id === id)?.kind !== 'worker'))).toBe(true);
  issueCommandFrame(game, first.map(command => ({ playerId: owner, scriptId: 'naval', command })));
  const boarded = new Set<string>(), target = walkableGoal(game.map, mission.to.x, mission.to.y);
  let delivered = false;
  for (let tick = 0; tick < 6000 && !delivered; tick++) {
    if (tick && tick % 15 === 0)
      issueCommandFrame(game, commands().map(command => ({ playerId: owner, scriptId: 'naval', command })));
    stepGame(game);
    for (const unit of game.units) if (unit.owner === owner && unit.kind !== 'worker'
      && unit.expiresTick === undefined && unit.deck?.shipId === boatId) boarded.add(unit.id);
    delivered = game.units.some(unit => boarded.has(unit.id) && unit.hp > 0 && !unit.deck && sameGround(game.map, unit, target));
  }
  expect(delivered, JSON.stringify({ boatId, boarded: [...boarded], naval: memory.naval })).toBe(true);
}, 30000);

it('does not turn the native no-combat-crew refusal into progress without physical loading or motion', () => {
  const { game, memory, boatId, mission } = scene('temple-loading-600', 'enemy');
  // Preserve the native crew and all opposing units. Reserve its soldiers for
  // defense to isolate a repeated refusal rather than a successful new order.
  for (const unit of game.units.filter(unit => unit.owner === 'enemy' && unit.kind !== 'worker' && !unit.deck))
    memory.unitClaims[unit.id] = { kind: 'mineGuard', targetId: 'home', x: unit.x, y: unit.y,
      sinceTick: game.tick, expiresTick: game.tick + seconds(120) };
  const previous = structuredClone(mission.progress!);
  const snapshot = snapshotGame(game);
  const options = { memory, teams: game.teams };
  planNavalTactics(snapshot, 'enemy', { ...options, memory });
  expect(mission.progress).toEqual(previous);
  snapshot.tick = previous.tick + seconds(40) + 1;
  planNavalTactics(snapshot, 'enemy', { ...options, memory });
  expect(mission.phase).toBe('return');
  expect(memory.naval!.ferryFailures?.[boatId]?.[mission.targetId]).toMatchObject({ attempts: 1, reason: 'no-combat-crew' });
  expect(memory.naval!.ferryDecisions![boatId]!.reason).toBe('stalled:no-combat-crew');
});

it('releases an empty stalled boat, preserves the refusal, and tries another island after three failed loadings', () => {
  const { game, memory, boatId, mission } = scene('ring-loading-600', 'player-4');
  // Exercise cancellation with the native hull/shore/army geometry but no cargo:
  // a returning worker is not part of the empty-hull release case.
  game.units = game.units.filter(unit => unit.deck?.shipId !== boatId);
  for (const unit of game.units.filter(unit => unit.owner === 'player-4' && unit.kind !== 'worker'))
    memory.unitClaims[unit.id] = { kind: 'mineGuard', targetId: 'home', x: unit.x, y: unit.y,
      sinceTick: game.tick, expiresTick: game.tick + seconds(600) };
  const targetId = mission.targetId;
  const options = { memory, teams: game.teams };
  for (let attempt = 0; attempt < 3; attempt++) {
    let snapshot = snapshotGame(game);
    if (attempt) planFirstCombatCrossing(snapshot, 'player-4', options);
    expect(memory.naval!.ferries![boatId]!.targetId).toBe(targetId);
    planNavalTactics(snapshot, 'player-4', options);
    game.tick += seconds(41);
    snapshot = snapshotGame(game);
    const cancelled = planNavalTactics(snapshot, 'player-4', options);
    expect(memory.naval!.ferries![boatId]).toBeUndefined();
    expect(cancelled.some(command => command.type === 'stop' && command.unitIds.includes(boatId))).toBe(true);
    expect(memory.naval!.ferryFailures![boatId]![targetId]).toMatchObject({ attempts: attempt + 1, reason: 'no-combat-crew' });
    game.tick += seconds(21);
  }
  planFirstCombatCrossing(snapshotGame(game), 'player-4', options);
  expect(memory.naval!.ferries![boatId]).toBeDefined();
  expect(memory.naval!.ferries![boatId]!.targetId).not.toBe(targetId);
});

it('does not count a passenger casualty as physical ferry progress', () => {
  const { game, memory, mission, boatId } = scene('temple-loading-600', 'enemy');
  const prior = structuredClone(mission.progress!);
  game.units = game.units.filter(unit => unit.deck?.shipId !== boatId);
  for (const unit of game.units.filter(unit => unit.owner === 'enemy' && unit.kind !== 'worker'))
    memory.unitClaims[unit.id] = { kind: 'mineGuard', targetId: 'home', x: unit.x, y: unit.y,
      sinceTick: game.tick, expiresTick: game.tick + seconds(120) };
  planNavalTactics(snapshotGame(game), 'enemy', { memory, teams: game.teams });
  expect(mission.progress).toEqual(prior);
});

it.each([
  { file: 'temple-loading-600', owner: 'player-4' },
  { file: 'ring-loading-600', owner: 'enemy' },
  { file: 'ring-loading-900', owner: 'enemy2' },
])('retains actual incoming-raid cover in the other native seat: $file / $owner', ({ file, owner }) => {
  const { game, boatId, commands } = scene(file, owner);
  expect(commands().some(command => command.type === 'board' && command.transportId === boatId
    && command.unitIds.some(id => game.units.find(unit => unit.id === id)?.kind !== 'worker'))).toBe(false);
});
