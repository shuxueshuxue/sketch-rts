import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url))), results: any[] = [];
const output = mkdtempSync(join(tmpdir(), 'bootstrap_1-assault-work-'));
for (const label of ['parent', 'next']) {
  const paths = ['src/ai/bootstrap_1/mine-defense.ts', 'src/ai/bootstrap_1/assault-camp-roads.ts'];
  const files = new Map(paths.map(path => [root + '/' + path, label === 'parent' ? execFileSync('git', ['show', '3fc462aa4c1813a212c6b01c1760b1ea4b2ac29e:' + path], { cwd: root, encoding: 'utf8' }) : readFileSync(root + '/' + path, 'utf8')]));
  const routePath = root + '/src/ai/bootstrap_1/assault-camp-roads.ts';
  files.set(routePath, files.get(routePath)!.replace('const road = route(unit);', 'routeEvaluations++; const road = route(unit);') + '\nexport let routeEvaluations=0; export function resetRouteEvaluations(){routeEvaluations=0;}\n');
  const out = join(output, `${label}.mjs`);
  await build({ stdin: { contents: "export {sketchScene} from './src/sdk/scene';export {planAiOwnerCommandEntries} from './src/ai/planner-context';export {snapshotGame} from './src/shared/sim';export {setBuildingBodies,snapToFootprint} from './src/shared/terrain';export {createAiPolicyMemory} from './src/ai/memory';export {routeEvaluations,resetRouteEvaluations} from './src/ai/bootstrap_1/assault-camp-roads';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: out, plugins: [{ name: 'diagnostic-route-counter', setup(api) { api.onLoad({ filter: /\.ts$/ }, args => files.has(args.path) ? { contents: files.get(args.path), loader: 'ts', resolveDir: args.path.slice(0, args.path.lastIndexOf('/')) } : undefined); } }] });
  const sdk = await import(pathToFileURL(out).href);
  for (const version of ['v9_archer', 'v9_summoner', 'v9_knight']) for (const race of ['grove', 'ember']) for (const mirror of [false, true]) {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sdk.sketchScene('assault-caster-ownership-cost').map('bareDuel').replaceDefaults().player('us', { race, team: 'a' }).player('foe', { team: 'b' }).townHall('us', x(500), 500).townHall('foe', x(3100), 1000, { id: 'target' }).worker('foe', x(3400), 1100);
    for (let index = 0; index < 8; index++) scene = scene.unit('us', race === 'grove' ? 'knight' : 'ashChieftain', x(1400 + index * 24), 1200, { id: `front-${index}` });
    for (let index = 0; index < 3; index++) scene = scene.unit('us', 'priest', x(1300 + index * 24), 1100, { id: `healer-${index}`, order: { type: 'move', x: x(1500), y: 1100 } });
    const game = scene.build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, sdk.snapToFootprint(game.map, building.radius, building));
    sdk.setBuildingBodies(game.map, game.buildings);
    const memory = sdk.createAiPolicyMemory();
    memory.v6 = { phase: 1, general: { mode: 'attack', targetHallId: 'target', target: { x: x(3100), y: 1000 }, group: game.units.filter((unit: any) => unit.owner === 'us').map((unit: any) => unit.id), groupStart: 16 } };
    sdk.resetRouteEvaluations();
    const commands = sdk.planAiOwnerCommandEntries(sdk.snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
    results.push({ label, version, race, mirror, evaluations: sdk.routeEvaluations, commands, memory, digest: createHash('sha256').update(JSON.stringify({ commands, memory })).digest('hex') });
  }
}
const comparisons = results.filter(result => result.label === 'parent').map(before => {
  const after = results.find(result => result.label === 'next' && result.version === before.version && result.race === before.race && result.mirror === before.mirror);
  if (before.digest !== after.digest) throw new Error(`Command or memory difference in ${before.version}/${before.race}/${before.mirror}`);
  return { version: before.version, race: before.race, mirror: before.mirror, before: before.evaluations, after: after.evaluations, identicalCommandsAndMemory: true };
});
writeFileSync(join(output, 'result.json'), JSON.stringify({ mode: 'Diagnostic-only counter injection, 12 controlled complete planner frames. No gameplay source counter, no performance benchmark.', comparisons, results }) + '\n');
console.log(JSON.stringify({ report: join(output, 'result.json'), comparisons }));
