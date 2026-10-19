import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { sameGround, walkableGoal, type Terrain } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, ResourceNode } from '../../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import type { AiPolicyContext } from './types';

type Point = { x: number; y: number };
type Result = { mine: ResourceNode; landing: Point }[];
type ShoreCall = { x: number; y: number; despiteGuns: boolean };
type PrivateApi = {
  runIslandPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, eligible: (mine: ResourceNode) => boolean): Result;
  shoreCalls: ShoreCall[];
};
const sourcePath = new URL('./naval.ts', import.meta.url).pathname;
const require = createRequire(import.meta.url);
let current: PrivateApi, productionSource: string;

// Test-only exports and counting are inserted into ephemeral bundles. The game module stays private and unchanged.
// All candidate, eligibility and connectivity decisions execute production code.
async function privateBundle(source: string): Promise<PrivateApi> {
  const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: { start: number; end: number; text: string }[] = [];
  let islandFound = false, shoreFound = false;
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) continue;
    if (node.name.text === 'islandPlans') islandFound = true;
    if (node.name.text === 'shoreSpot') {
      shoreFound = true;
      edits.push({ start: node.body.getStart(ast) + 1, end: node.body.getStart(ast) + 1,
        text: '\n__islandShoreCalls.push({ x: water.x, y: water.y, despiteGuns });\n' });
    }
  }
  if (!islandFound || !shoreFound) throw new Error('Island/shore test boundaries changed');
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  source += '\nconst __islandShoreCalls: {x:number;y:number;despiteGuns:boolean}[] = [];\nexport { islandPlans as runIslandPlan, __islandShoreCalls as shoreCalls };\n';
  const built = await build({ entryPoints: [sourcePath], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22',
    plugins: [{ name: 'private-island-test-boundary', setup(builder) {
      builder.onLoad({ filter: /\/src\/ai\/policy\/naval\.ts$/ }, args =>
        args.path === sourcePath ? { contents: source, loader: 'ts' } : undefined);
    } }] });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0]!.text)(module, module.exports, require);
  return module.exports as PrivateApi;
}

function fixture(split: boolean, secondHall = false): GameSnapshot {
  const cols = 64, rows = 48, cell = 32;
  const at = (col: number, row: number) => ({ x: (col + .5) * cell, y: (row + .5) * cell });
  const hall = at(5, 24), other = at(57, 24);
  const scene = sketchScene('island-coast-reference').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', hall.x, hall.y, { id: 'home-hall' })
    .worker('us', hall.x + 32, hall.y, { id: 'home-worker' })
    .goldMine('home-gold', hall.x + 64, hall.y, 100)
    .playerState('us', { gold: 1000 });
  if (secondHall) scene.townHall('us', other.x, other.y, { id: 'second-hall' });
  for (const [index, [col, row]] of [[24, 8], [24, 9], [24, 10], [24, 32], [24, 33], [24, 34],
    [42, 11], [42, 12], [42, 13], [42, 30], [42, 31], [42, 32]].entries()) {
    const mine = at(col!, row!);
    scene.goldMine(`remote-${index}`, mine.x, mine.y, 6000);
  }
  const game = scene.build().createGame();
  const cells = Array.from({ length: cols * rows }, (_, index) => {
    const col = index % cols, row = Math.floor(index / cols);
    const island = col >= 22 && col <= 25 && (row >= 6 && row <= 13 || row >= 30 && row <= 37)
      || col >= 39 && col <= 44 && (row >= 9 && row <= 16 || row >= 28 && row <= 35);
    return col < 18 || col >= 53 || split && col === 31 || island ? '.' : '~';
  }).join('');
  game.map.width = cols * cell; game.map.height = rows * cell;
  game.map.terrain = { cell, cols, rows, cells };
  return snapshotGame(game);
}

function invoke(api: PrivateApi, snapshot: GameSnapshot, memory: AiPolicyMemory, permitted: (mine: ResourceNode) => boolean = () => true,
  owner: PlayerId = 'us', teams: AiPolicyContext['teams'] = { us: 'a', foe: 'b' }) {
  api.shoreCalls.length = 0;
  const callbacks: string[] = [];
  const options: AiPolicyContext = { memory, ...(teams ? { teams } : {}) };
  const snapshotBytes = JSON.stringify(snapshot), teamBytes = JSON.stringify(options.teams);
  const result = api.runIslandPlan(snapshot, owner, options, mine => { callbacks.push(mine.id); return permitted(mine); });
  expect(JSON.stringify(snapshot)).toBe(snapshotBytes);
  expect(JSON.stringify(options.teams)).toBe(teamBytes);
  return { result, resultBytes: JSON.stringify(result), memoryBytes: JSON.stringify(memory), callbacks,
    calls: api.shoreCalls.map(call => ({ ...call })) };
}

function compare(snapshot: GameSnapshot, memory: AiPolicyMemory = createAiPolicyMemory(), permitted: (mine: ResourceNode) => boolean = () => true,
  owner: PlayerId = 'us', teams: AiPolicyContext['teams'] = { us: 'a', foe: 'b' }) {
  const result = invoke(current, structuredClone(snapshot), structuredClone(memory), permitted, owner, teams);
  expect(result.calls.every(call => call.despiteGuns)).toBe(true);
  return { result };
}

describe('one island-plan scan reuses only identical water coasts', () => {
  beforeAll(async () => {
    productionSource = await readFile(sourcePath, 'utf8');
    current = await privateBundle(productionSource);
    expect(await readFile(sourcePath, 'utf8')).toBe(productionSource);
  }, 120_000);

  it('retains all twelve targets while same-sea candidates share one shore search', () => {
    const { result } = compare(fixture(false));
    expect(result.calls).toHaveLength(1);
    expect(result.result).toHaveLength(12);
    expect(new Set(result.result.map(plan => plan.mine.id)).size).toBe(12);
  });

  it.each([false, true])('separates two waters and retains a failed component lookup (second hall=%s)', secondHall => {
    const snapshot = fixture(true, secondHall);
    const { result } = compare(snapshot);
    expect(result.calls).toHaveLength(2);
    expect(sameGround(snapshot.map, result.calls[0]!, result.calls[1]!, 'sea')).toBe(false);
    expect(result.result.length).toBe(secondHall ? 12 : 6);
  });

  it('retains undefined results when all admitted shores are blocked', () => {
    const snapshot = fixture(false), hall = snapshot.buildings[0]!;
    snapshot.buildings.push({ ...hall, id: 'shore-blocker', owner: 'neutral', kind: 'farm', radius: 100_000 });
    const { result } = compare(snapshot);
    expect(result.calls).toHaveLength(1);
    expect(result.result).toEqual([]);
    expect(JSON.parse(result.memoryBytes).naval.island).toEqual({ tick: snapshot.tick });
  });

  it('keeps the per-candidate walkability guard when no sea cell is available', () => {
    const snapshot = fixture(false), terrain = snapshot.map.terrain!;
    snapshot.map.terrain = { ...terrain, cells: terrain.cells.replaceAll('~', 'T') };
    const { result } = compare(snapshot);
    expect(result.calls).toHaveLength(0);
    expect(result.result).toEqual([]);
  });

  it.each(['recent', 'expired', 'empty-recent', 'empty-expired', 'depleted', 'ineligible'] as const)
    ('keeps all-target retry timing and immediately drops invalid targets (%s)', mode => {
      const snapshot = fixture(false);
      snapshot.tick = 900;
      const mine = snapshot.resources.find(candidate => candidate.id === 'remote-0')!;
      const memory = createAiPolicyMemory();
      memory.naval = { islands: { tick: mode === 'expired' || mode === 'empty-expired' ? 0 : 899,
        plans: mode.startsWith('empty') ? [] : [{ mineId: mine.id, landing: walkableGoal(snapshot.map, mine.x, mine.y, 'sea') }] } };
      if (mode === 'depleted') mine.amount = 0;
      const { result } = compare(snapshot, memory, candidate => mode !== 'ineligible' || candidate.id !== mine.id);
      const refresh = mode === 'expired' || mode === 'empty-expired';
      expect(result.calls).toHaveLength(refresh ? 1 : 0);
      expect(result.result).toHaveLength(refresh ? 12 : mode === 'recent' ? 1 : 0);
    });

  it('does not admit an unpaid sea expedition while a clear land expansion is available', () => {
    const snapshot = fixture(false);
    snapshot.resources.push({ ...snapshot.resources[0]!, id: 'reachable-local-mine', x: 400, y: 400, amount: 6000 });
    const { result } = compare(snapshot);
    expect(result.result).toEqual([]);
    expect(result.calls).toHaveLength(0);
    expect(JSON.parse(result.memoryBytes).naval.expeditions).toBeUndefined();
  });

  it('discards coast answers between invocations, owners, context and new terrain identities', async () => {
    const snapshot = fixture(false);
    const first = compare(snapshot);
    expect(first.result.calls).toHaveLength(1);
    const changed = structuredClone(snapshot);
    const terrain: Terrain = { ...changed.map.terrain! };
    changed.map.terrain = terrain;
    const hall = changed.buildings[0]!;
    changed.buildings.push({ ...hall, id: 'later-blocker', owner: 'neutral', kind: 'farm', radius: 100_000 });
    const second = compare(changed);
    expect(second.result.calls).toHaveLength(1);
    expect(second.result.result).toEqual([]);
    expect(compare(snapshot).result.resultBytes).toBe(first.result.resultBytes);

    const memory = createAiPolicyMemory();
    memory.naval = { islands: { tick: -1000, plans: [] } };
    const control = invoke(current, structuredClone(snapshot), memory, mine => !mine.id.endsWith('-0'));
    const reentered = invoke(current, structuredClone(snapshot), createAiPolicyMemory(), mine => !mine.id.endsWith('-0'));
    expect(reentered.callbacks).toEqual(control.callbacks);
    expect(reentered.resultBytes).toBe(control.resultBytes);
    expect(reentered.memoryBytes).toBe(control.memoryBytes);
    expect(reentered.result.some(plan => plan.mine.id === 'remote-0')).toBe(false);
    const otherOwner = structuredClone(snapshot);
    for (const building of otherOwner.buildings) building.owner = 'foe';
    for (const unit of otherOwner.units) unit.owner = 'foe';
    expect(compare(otherOwner, createAiPolicyMemory(), () => true, 'foe', { us: 'c', foe: 'd' }).result.calls).toHaveLength(1);
    expect(await readFile(sourcePath, 'utf8')).toBe(productionSource);
  });
});
