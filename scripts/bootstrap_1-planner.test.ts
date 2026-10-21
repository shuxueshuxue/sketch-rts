import { describe, expect, it } from 'vitest';
import { sketchScene } from '../src/sdk/scene';
import { issueCommandFrame } from '../src/sdk/commands/frame';
import { snapshotGame, stepGame } from '../src/shared/sim';
import { UNIT_DEFS } from '../src/shared/catalog';
import { xpStarThresholds } from '../src/shared/unit-value';
import { createAiPolicyMemory } from '../src/ai/memory';
import { createAiMemoryProvider } from '../src/ai/planner-context';
import { createBootstrapCommandPlanner, frozenPolicyModules } from './bootstrap_1-planner';
import { createGame } from '../src/shared/sim';
import { legalBuildPointNear } from '../src/ai/policy/build-layout';
import { bootstrapMatches } from '../src/ai/bootstrap_1/benchmark';
import { runBenchmarkParallelMatch } from '../src/ai/bootstrap_1/worker';

describe('bootstrap_1 historical opponents on the current engine', () => {
  it('gives the archived planner the same building obstruction field and updates it after native construction', async () => {
    const game = createGame('pineshade', { players: ['us', 'foe'], aiPlayers: [] });
    const historical = await frozenPolicyModules();
    const hall = game.buildings.find(building => building.owner === 'us')!;
    expect(historical.isOpenGround(game.map, hall.x, hall.y)).toBe(true);
    const planner = await createBootstrapCommandPlanner(createAiMemoryProvider());
    const plan = () => planner({ game, snapshot: { ...snapshotGame(game), map: game.map }, owner: 'us',
      agent: { version: 'v5', controller: 'external-agent', team: 'us' }, source: 'external-agent',
      plannerOrigin: 'local-command-planner', teams: game.teams });
    plan();
    expect(historical.isOpenGround(game.map, hall.x, hall.y)).toBe(false);
    const worker = game.units.find(unit => unit.owner === 'us' && unit.kind === 'worker')!;
    const point = legalBuildPointNear(snapshotGame(game), 'farm', { x: hall.x + 200, y: hall.y + 100 });
    issueCommandFrame(game, [{ playerId: 'us', command: { type: 'build', unitId: worker.id, buildingKind: 'farm', ...point } }]);
    for (let tick = 0; tick < 1200; tick++) stepGame(game);
    const farm = game.buildings.find(building => building.kind === 'farm')!;
    expect(farm.complete).toBe(true);
    plan();
    expect(historical.isOpenGround(game.map, farm.x, farm.y)).toBe(false);
  }, 15000);

  it.each(['v5', 'v7', 'v8'] as const)('%s heals biological fighters through the real SDK in both races', async version => {
    for (const race of ['grove', 'ember'] as const) {
      const game = sketchScene('frozen-medical-targets').replaceDefaults()
        .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
        .townHall('us', 400, 400).townHall('foe', 2600, 2500).farms('us', 5, 400, 1600)
        .unit('us', 'priest', 900, 800, { id: 'healer' })
        .unit('us', race === 'grove' ? 'ballista' : 'catapult', 1020, 800, { id: 'mechanical', hp: 10 })
        .unit('us', race === 'grove' ? 'footman' : 'emberRavager', 1000, 850, { id: 'fighter', hp: 40 })
        .build().createGame();
      const planner = await createBootstrapCommandPlanner(createAiMemoryProvider()), snapshot = snapshotGame(game);
      const commands = planner({ game, snapshot, owner: 'us', agent: { version, controller: 'external-agent', team: 'a' },
        source: 'external-agent', plannerOrigin: 'local-command-planner', teams: game.teams })
        .filter(entry => entry.command.type === 'cast' && entry.command.unitId === 'healer');
      expect(commands).toHaveLength(1);
      issueCommandFrame(game, commands);
      stepGame(game);
      expect(game.units.find(unit => unit.id === 'fighter')!.hp).toBeGreaterThan(40);
      expect(game.units.find(unit => unit.id === 'mechanical')!.hp).toBe(10);
    }
  }, 15000);
  it.each((['v5', 'v7', 'v8'] as const).flatMap(version =>
    (['grove', 'ember'] as const).map(race => ({ version, race }))))(
    '$version trains its archived caster needs through the rules 2 $race producer', async ({ version, race }) => {
      let scene = sketchScene('frozen-rules2-production').map('bareDuel').replaceDefaults()
        .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
        .townHall('us', 600, 600).townHall('foe', 3500, 3500).goldMine('home', 900, 600, 12000)
        .building('us', race === 'grove' ? 'barracks' : 'emberForge', 800, 1000)
        .building('us', race === 'grove' ? 'archeryRange' : 'cinderSpire', 600, 1000)
        .building('us', race === 'grove' ? 'sanctum' : 'ashenHall', 1000, 1200)
        .farms('us', 7, 400, 1800);
      for (let index = 0; index < 3; index++) scene = scene.worker('us', 850 + index * 20, 650,
        { order: { type: 'mine', resourceId: 'home', phase: 'toMine', timer: 0 } });
      for (let index = 0; index < 4; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'ashWarden', 1100 + index * 50, 800);
      for (let index = 0; index < 6; index++) scene = scene.unit('us', race === 'grove' ? 'archer' : 'sparkArcher', 1200 + index * 50, 900);
      const game = scene.build().createGame(), memory = createAiPolicyMemory();
      memory.v6 = { phase: 1, doctrine: { profileId: 'steady',
        strategyId: version === 'v8' ? (race === 'grove' ? 'grove-cavalry-line' : 'ember-ravager-line')
          : (race === 'grove' ? 'grove-spirit-host' : 'ember-pyre-host'), decidedTick: 0 } };
      const historical = await frozenPolicyModules();
      const entries = historical.planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version, scriptIds: [version === 'v5' ? 'training' : 'v6Economy'], memory }, { teams: game.teams });
      const caster = entries.filter(entry => entry.command.type === 'train'
        && (entry.command.unitKind === 'priest' || entry.command.unitKind === 'summoner'));
      expect(caster).toHaveLength(1);
      issueCommandFrame(game, entries);
      const producer = game.buildings.find(building => building.id === (caster[0]!.command as { buildingId: string }).buildingId)!;
      expect(producer.kind).toBe(race === 'grove' ? 'sanctum' : 'cinderSpire');
      expect(producer.queue).toHaveLength(1);
      stepGame(game);
    });

  it.each((['v5', 'v7', 'v8'] as const).flatMap(version =>
    (['grove', 'ember'] as const).map(race => ({ version, race }))))(
    '$version executes the shared $race summoning ability through the real SDK', async ({ version, race }) => {
      const game = sketchScene('frozen-rules2-summon').map('bareDuel').replaceDefaults()
        .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
        .townHall('us', 400, 400).townHall('foe', 2600, 2500)
        .unit('us', 'summoner', 900, 800, { id: 'caster' })
        .unit('foe', 'footman', 1050, 800).build().createGame();
      const historical = await frozenPolicyModules();
      const commands = historical.planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version, scriptIds: ['abilities'], memory: createAiPolicyMemory() }, { teams: game.teams });
      expect(commands.some(entry => entry.command.type === 'cast' && entry.command.ability === 'summon')).toBe(true);
      issueCommandFrame(game, commands);
      stepGame(game);
      expect(game.units.some(unit => unit.owner === 'us' && unit.kind === 'spirit')).toBe(true);
    });

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
