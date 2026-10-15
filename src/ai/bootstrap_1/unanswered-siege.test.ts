import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { planBootstrapGeneral } from './mine-defense';
import { bootstrapPolicyContext } from './policy';
import { mobileCare } from './mobile-care';
import { bootstrapGame, bootstrapMatches } from './benchmark';
import { createAiMemoryProvider } from '../planner-context';
import { createBootstrapCommandPlanner } from '../../../scripts/bootstrap_1-planner';
import { runAiGameLoop } from '../game-runner';

function field() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-siege-unanswered-towers.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, saved };
}

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)(
  '%s uses the existing field edge against the actual catapults that its waiting towers cannot shoot', version => {
    const { game, saved } = field(), snapshot = snapshotGame(game);
    const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: saved.memories.p0, teams: game.teams });
    const care = mobileCare.claimsUnits!(snapshot, 'p0', options);
    const commands = planBootstrapGeneral(snapshot, 'p0', options);
    expect(options.memory.v6?.general?.mode).toBe('defend');
    expect(commands.some(command => command.type === 'attackMove' && command.unitIds.includes('unit-p0-ashChieftain-6238'))).toBe(true);
    expect(commands.some(command => (command.type === 'attackMove' || command.type === 'attack')
      && command.unitIds.some(id => care.has(id)))).toBe(false);
  });

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)(
  '%s retains tower waiting for distant shooters still approaching their actual target', version => {
    const { game, saved } = field();
    // Explicit order-only control: these shooters are approaching the main,
    // rather than already firing on the natural in the recorded world.
    for (const id of ['unit-p2-catapult-9831', 'unit-p2-catapult-13290']) {
      game.units.find(unit => unit.id === id)!.order = { type: 'attack', targetId: 'building-p0-townhall' };
    }
    const snapshot = snapshotGame(game);
    const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: saved.memories.p0, teams: game.teams });
    const commands = planBootstrapGeneral(snapshot, 'p0', options);
    expect(options.memory.v6?.general?.mode).toBe('guard');
    expect(commands.some(command => command.type === 'attackMove' || command.type === 'attack')).toBe(false);
  });

it('answers the real siege with both frozen opponents active, preserves the natural and restores the complete AI window', async () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-siege-before-wait.json.gz', import.meta.url))).toString());
  const match = bootstrapMatches(saved.setup.seed, ['greystonePass'], 22800, true).find(match => match.subject === 'v9_knight'
    && match.side === 1 && match.agents.p0!.race === 'ember'
    && Object.values(match.agents).slice(1).map(agent => agent.version).join('+') === 'v8+v8')!;
  const game = bootstrapGame(match); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const memory = createAiMemoryProvider(structuredClone(saved.memories)), planner = await createBootstrapCommandPlanner(memory);
  runAiGameLoop({ ...match, game, commandPlanner: planner, maxTicks: 21900 });
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId,
    memories: Object.fromEntries(Object.keys(match.agents).map(owner => [owner, memory.get(owner)])) }));
  const restored = bootstrapGame(match); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId);
  const restoredMemory = createAiMemoryProvider(checkpoint.memories), restoredPlanner = await createBootstrapCommandPlanner(restoredMemory);
  runAiGameLoop({ ...match, game, commandPlanner: planner });
  runAiGameLoop({ ...match, game: restored, commandPlanner: restoredPlanner });
  expect(game.buildings.find(building => building.id === 'building-p0-townHall-1529')?.hp).toBeGreaterThan(0);
  expect(game.units.filter(unit => ['unit-p2-catapult-9831', 'unit-p2-catapult-13290'].includes(unit.id))).toHaveLength(0);
  expect(game.units.some(unit => unit.id === 'unit-p0-ashChieftain-6238')).toBe(true);
  expect(game.match.winner).toBeNull();
  expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
  for (const owner of Object.keys(match.agents)) expect(restoredMemory.get(owner)).toEqual(memory.get(owner));
}, 60000);
