import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const loaderUrl = new URL('./bootstrap_1-planner.ts', import.meta.url).href;
const loaderChildPrelude = `
  import assert from 'node:assert/strict';
  import childProcess from 'node:child_process';
  import fs from 'node:fs';
  import { createHash } from 'node:crypto';
  import { syncBuiltinESMExports } from 'node:module';
  import { join } from 'node:path';
  import { fileURLToPath } from 'node:url';
  const loader = await import(${JSON.stringify(loaderUrl)});
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  async function verify() {
    const directory = loader.frozenPolicyRoot();
    const first = loader.frozenPolicyModules();
    assert.equal(loader.frozenPolicyModules(), first);
    const exported = await first;
    assert.equal(await loader.frozenPolicyModules(), exported);
    const names = Object.keys(exported).sort();
    assert.deepEqual(names, ['checksumGame', 'isOpenGround', 'planAiOwnerCommandEntries', 'runAiGameLoop', 'setBuildingBodies']);
    const hashes = Object.fromEntries(Object.entries(loader.frozenPolicyManifest.files).map(([name, hash]) => {
      assert.equal(sha(fs.readFileSync(join(directory, name))), hash);
      return [name, hash];
    }));
    assert.equal(Object.keys(hashes).length, 184);
    assert.equal(loader.frozenPolicyManifest.rulesVersion, 2);
    assert.equal(loader.frozenPolicyManifest.revision, 'd1ae110f2edd99f9c7d899ed61557891ab587639');
    return { files: hashes, exports: Object.fromEntries(names.map(name => {
      assert.equal(typeof exported[name], 'function');
      return [name, sha(exported[name].toString())];
    })) };
  }
`;

function loaderChild(code: string, cwd: string) {
  return JSON.parse(execFileSync(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'),
    '--input-type=module', '--eval', loaderChildPrelude + code], { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
}

describe('bootstrap_1 frozen loader initialization', () => {
  it('exports identical frozen code from the repository and an unrelated non-Git working directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bootstrap_1-loader-cwd-'));
    try {
      const code = 'await loader.createBootstrapCommandPlanner(); console.log(JSON.stringify(await verify()));';
      const external = loaderChild(`
        assert.notEqual(childProcess.spawnSync('git', ['rev-parse', '--show-toplevel']).status, 0);
        ${code}`, directory);
      expect(external).toEqual(loaderChild(code, fileURLToPath(new URL('../', import.meta.url))));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 15000);

  it.each(['git', 'tar', 'cleanup'])('retries the public planner after %s failure without caching an incomplete tree or masking the error', stage => {
    const directory = mkdtempSync(join(tmpdir(), 'bootstrap_1-loader-retry-'));
    try {
      expect(loaderChild(`
        const stage = ${JSON.stringify(stage)}, original = new Error('injected archive/extraction failure');
        const exec = childProcess.execFileSync, make = fs.mkdtempSync, remove = fs.rmSync;
        const directories = []; let fail = true;
        fs.mkdtempSync = (...args) => { const path = make(...args); directories.push(path); return path; };
        childProcess.execFileSync = (command, args, options) => {
          if (command === 'git') assert.equal(fileURLToPath(options.cwd), fileURLToPath(new URL('../', ${JSON.stringify(loaderUrl)})));
          if (fail && command === (stage === 'tar' ? 'tar' : 'git')) {
            fail = false;
            if (stage === 'tar') fs.writeFileSync(join(directories[0], 'partial'), 'incomplete extraction');
            throw original;
          }
          return exec(command, args, options);
        };
        fs.rmSync = (...args) => {
          if (stage === 'cleanup') throw new Error('injected cleanup failure');
          return remove(...args);
        };
        syncBuiltinESMExports();
        try {
          const attempts = await Promise.allSettled([loader.createBootstrapCommandPlanner(), loader.createBootstrapCommandPlanner()]);
          for (const attempt of attempts) { assert.equal(attempt.status, 'rejected'); assert.equal(attempt.reason, original); }
          assert.equal(directories.length, 1);
          assert.equal(fs.existsSync(directories[0]), stage === 'cleanup');
          fs.rmSync = remove; syncBuiltinESMExports();
          if (stage === 'cleanup') remove(directories[0], { recursive: true, force: true });
          await loader.createBootstrapCommandPlanner();
          assert.equal(directories.length, 2);
          assert.notEqual(loader.frozenPolicyRoot(), directories[0]);
          await verify();
          console.log(JSON.stringify({ retries: 1, originalErrorPreserved: true, files: 184 }));
        } finally {
          childProcess.execFileSync = exec; fs.mkdtempSync = make; fs.rmSync = remove; syncBuiltinESMExports();
          for (const path of directories) remove(path, { recursive: true, force: true });
        }
      `, directory)).toEqual({ retries: 1, originalErrorPreserved: true, files: 184 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 15000);

  it('retries a failed esbuild while reusing a successfully extracted frozen tree', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bootstrap_1-loader-build-retry-'));
    try {
      expect(loaderChild(`
        const root = loader.frozenPolicyRoot(), output = join(root, 'planner.mjs');
        fs.mkdirSync(output);
        const attempts = await Promise.allSettled([loader.createBootstrapCommandPlanner(), loader.createBootstrapCommandPlanner()]);
        assert.equal(attempts[0].status, 'rejected'); assert.equal(attempts[1].status, 'rejected');
        assert.equal(attempts[0].reason, attempts[1].reason);
        assert.match(attempts[0].reason.message, /planner\\.mjs/);
        assert.equal(loader.frozenPolicyRoot(), root);
        fs.rmSync(output, { recursive: true });
        await loader.createBootstrapCommandPlanner();
        assert.equal(loader.frozenPolicyRoot(), root);
        await verify();
        console.log(JSON.stringify({ reusedRoot: true, files: 184 }));
      `, directory)).toEqual({ reusedRoot: true, files: 184 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 15000);
});

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
