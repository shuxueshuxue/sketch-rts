import { describe, expect, it } from 'vitest';
import { sketchScene } from '../src/sdk/scene';
import { issueCommandFrame } from '../src/sdk/commands/frame';
import { snapshotGame } from '../src/shared/sim';
import { UNIT_DEFS } from '../src/shared/catalog';
import { xpStarThresholds } from '../src/shared/unit-value';
import { createAiMemoryProvider } from '../src/ai/planner-context';
import { createBootstrapCommandPlanner } from './bootstrap_1-planner';
import { bootstrapMatches } from '../src/ai/bootstrap_1/benchmark';
import { runBenchmarkParallelMatch } from '../src/ai/bootstrap_1/worker';

describe('bootstrap_1 historical opponents on the current engine', () => {
  it('runs the actual match worker with two independently frozen opponents on the current SDK', async () => {
    const match = bootstrapMatches('worker-command-smoke', ['pineshade'], 30).find(match => match.subject === 'v9_summoner'
      && match.agents.p1!.version === 'v7' && match.agents.p2?.version === 'v7')!;
    const report = await runBenchmarkParallelMatch(match);
    expect(report.result.tick).toBe(30);
    expect(report.setup.players.p0!.aiVersion).toBe('v9_summoner');
    expect(report.setup.players.p1!.aiVersion).toBe('v7');
    expect(report.setup.players.p2!.aiVersion).toBe('v7');
    expect(report.result.winner).toBeNull();
  }, 15000);
  it.each([['v5', 'v9_archer'], ['v7', 'v9_summoner'], ['v8', 'v9_knight']] as const)('keeps %s at its original policy while %s learns a newly offered veteran skill', async (version, candidateVersion) => {
    const game = sketchScene('historical-policy-and-current-engine').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
      .townHall('us', 400, 600).townHall('foe', 2600, 600)
      .unit('us', 'archer', 900, 600, { id: 'veteran', xp: xpStarThresholds(UNIT_DEFS.archer)[2]! })
      .build().createGame();
    const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
    const planner = await createBootstrapCommandPlanner(createAiMemoryProvider());
    const old = planner({ game, snapshot, owner: 'us', agent: { version, controller: 'external-agent', team: 'a' },
      source: 'external-agent', plannerOrigin: 'local-command-planner', teams: game.teams });
    expect(old.some(entry => entry.command.type === 'learnVeteranSkill')).toBe(false);
    const candidate = planner({ game, snapshot, owner: 'us', agent: { version: candidateVersion, controller: 'external-agent', team: 'a' },
      source: 'external-agent', plannerOrigin: 'local-command-planner', teams: game.teams });
    const learns = candidate.filter(entry => entry.command.type === 'learnVeteranSkill');
    expect(learns).toHaveLength(1);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(() => issueCommandFrame(game, old)).not.toThrow();
    expect(() => issueCommandFrame(game, learns)).not.toThrow();
    expect(game.units.find(unit => unit.id === 'veteran')!.veteranSkill).toBeDefined();
  });
});
