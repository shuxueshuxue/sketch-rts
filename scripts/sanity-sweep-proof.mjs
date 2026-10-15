/** Differential oracle: original complete module vs candidate complete module.
 * Run after timing: node scripts/sanity-sweep-proof.mjs [control-root] [candidate-root]
 * No production source is rewritten. Internal exports exist only in esbuild input.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const candidateRoot = path.resolve(process.argv[3] ?? fileURLToPath(new URL('..', import.meta.url)));
const controlRoot = path.resolve(process.argv[2] ?? '/tmp/sanity-control');
const temporary = await mkdtemp(path.join(tmpdir(), 'sanity-sweep-proof-'));
const metadata = {};
async function load(root, label) {
  const collisionPath = path.join(root, 'src/shared/ship-collisions.ts');
  const source = await readFile(collisionPath, 'utf8');
  metadata[label] = { root, collisionSha256: createHash('sha256').update(source).digest('hex') };
  const original = label === 'control';
  assert.match(source, original ? /function sweepShape\(/ : /function prepareSweep\(/);
  const entry = `export * from ${JSON.stringify(collisionPath)};
    export { createUnit } from ${JSON.stringify(path.join(root, 'src/shared/map.ts'))};
    export { SHIP_KINDS, shipProfile } from ${JSON.stringify(path.join(root, 'src/shared/ship-geometry.ts'))};
    export { detSin, detCos } from ${JSON.stringify(path.join(root, 'src/shared/det-math.ts'))};`;
  const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    plugins: [{ name: 'expose-original-private-function', setup(builder) {
      builder.onLoad({ filter: /ship-collisions\.ts$/ }, async args => {
        if (args.path !== collisionPath) return;
        return { contents: source + `\nexport { ${original ? 'sweepShape' : 'prepareSweep'} as oracleSweep, hullOutline as oracleOutline };\n`,
          loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  const file = path.join(temporary, `${label}.mjs`);
  await writeFile(file, result.outputFiles[0].contents);
  return import(pathToFileURL(file).href);
}
let seed = 0x5a17c011;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const square = (x, y, half) => [{ x: x-half, y: y-half }, { x: x+half, y: y-half },
  { x: x+half, y: y+half }, { x: x-half, y: y+half }];
const freezePolygon = points => Object.freeze(points.map(point => Object.freeze(point)));
let privateChecks = 0, privateContacts = 0, publicChecks = 0, publicContacts = 0;
function compare(actual, expected, context) {
  try { assert.deepStrictEqual(actual, expected); }
  catch (error) {
    console.error('DIFFERENTIAL FAILURE', JSON.stringify(context));
    console.error('expected:', expected, 'actual:', actual);
    throw error;
  }
}
function outcome(call) {
  try { return { returned: call() }; }
  catch (error) { return { threw: { name: error.name, message: error.message } }; }
}
try {
  // Sequential build; keep the two dependency graphs and weak caches isolated.
  const control = await load(controlRoot, 'control');
  const candidate = await load(candidateRoot, 'candidate');
  assert.deepStrictEqual(candidate.SHIP_KINDS, control.SHIP_KINDS);
  const scenarios = [
    { name: 'still', from: { x: 512, y: 512, heading: 0 }, to: { x: 512, y: 512, heading: 0 } },
    { name: 'translation', from: { x: 512, y: 512, heading: 0 }, to: { x: 620, y: 512, heading: 0 } },
    { name: 'rotation', from: { x: 512, y: 512, heading: 0 }, to: { x: 512, y: 512, heading: 1.3 } },
    { name: 'rotate-translate', from: { x: 512, y: 512, heading: -1 }, to: { x: 580, y: 540, heading: 1 } },
    { name: 'wrap', from: { x: 512, y: 512, heading: Math.PI-1e-9 }, to: { x: 511, y: 510, heading: -Math.PI+1e-9 } },
    { name: 'epsilon-turn', from: { x: 512, y: 512, heading: 0 }, to: { x: 512.0000001, y: 512, heading: 1e-9 } },
    { name: 'world-edge', from: { x: 4, y: 4, heading: -.2 }, to: { x: -16, y: 20, heading: .3 } },
    { name: 'signed-zero', from: { x: -0, y: 0, heading: -0 }, to: { x: 0, y: -0, heading: 0 } },
    { name: 'large-world', from: { x: 1e9, y: -1e9, heading: .12 }, to: { x: 1e9+120, y: -1e9+10, heading: .3 } },
    { name: 'tiny-hull', from: { x: 1e-9, y: -1e-9, heading: .12 }, to: { x: 2e-9, y: 0, heading: .3 } },
    { name: 'large-hull', from: { x: 1e12, y: 1e12, heading: .12 }, to: { x: 1e12+120, y: 1e12+10, heading: .12 } },
    { name: 'pivot', from: { x: 512, y: 512, heading: 0 }, to: { x: 480+32*control.detCos(.7), y: 512+32*control.detSin(.7), heading: .7, pivot: { x: 480, y: 512 } } },
    { name: 'copied-pivot', from: { x: 512, y: 512, heading: .3 }, to: { x: 520, y: 520, heading: .8, pivot: { x: 490, y: 500 } } },
    { name: 'curve', from: { x: 512, y: 512, heading: 0 }, to: { x: 512+control.detSin(.6)/.01, y: 512-(control.detCos(.6)-1)/.01, heading: .6, curvature: .01 } },
    { name: 'copied-curve', from: { x: 512, y: 512, heading: .2 }, to: { x: 580, y: 500, heading: -.2, curvature: .01 } },
  ];
  const randomCount = Number(process.env.SANITY_SWEEP_RANDOM ?? 80);
  assert.ok(Number.isSafeInteger(randomCount) && randomCount >= 0);
  for (let i=0; i<randomCount; i++) {
    const from = { x: 256+random()*512, y: 256+random()*512, heading: (random()-.5)*Math.PI*4 };
    scenarios.push({ name: `seeded-${i}`, from, to: { x: from.x+(random()-.5)*240,
      y: from.y+(random()-.5)*240, heading: from.heading+(random()-.5)*2 } });
  }
  for (const kind of control.SHIP_KINDS) for (const scenario of scenarios) {
    const own = control.createUnit('own', 'player', kind, scenario.from.x, scenario.from.y);
    if (scenario.name === 'large-world') own.deckScale = 12;
    if (scenario.name === 'tiny-hull') own.deckScale = 1e-8;
    if (scenario.name === 'large-hull') own.deckScale = 1e4;
    own.sailing = { heading: scenario.from.heading, speed: 30, load: 0, balance: 0 };
    const clone = structuredClone(own);
    const from = Object.freeze(structuredClone(scenario.from));
    const to = Object.freeze(structuredClone(scenario.to));
    const initialOwn = structuredClone(own), initialClone = structuredClone(clone);
    const prepared = candidate.oracleSweep(clone, from, to);
    const hull = control.oracleOutline(own, from);
    const right = Math.max(...hull.map(p => p.x));
    const bodies = [square(from.x, from.y, 2), square(from.x+32, from.y, 16),
      square(from.x+10000, from.y+10000, 32), square(to.x, to.y, 4),
      ...[-1e-6, -1e-8, 0, 1e-8, 1e-6].map(epsilon => square(right+8+epsilon, from.y, 8))];
    for (let i=0; i<8; i++) bodies.push(square(from.x+(random()-.5)*400, from.y+(random()-.5)*400, 1+random()*40));
    for (const otherKind of control.SHIP_KINDS) {
      const other = control.createUnit('other', 'enemy', otherKind, from.x+60, from.y+20);
      bodies.push(control.oracleOutline(other, { x: other.x, y: other.y, heading: .7 }));
    }
    if (scenario.name === 'still') {
      const p = { x: from.x, y: from.y };
      bodies.push([], [p], [p, p, p], [p, { x: p.x+1e-12, y: p.y }, p],
        [{ x: NaN, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }],
        [{ x: Infinity, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }],
        [{ x: -Infinity, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }]);
    }
    const frozen = bodies.map(freezePolygon);
    // The same prepared closure sees all bodies, reverse order, then originals again.
    // Early hits and misses therefore exercise lazy prefixes and reused before hulls.
    for (const [index, body] of [...frozen, ...frozen.toReversed(), ...frozen].entries()) {
      const expected = outcome(() => control.oracleSweep(own, from, to, body));
      const actual = outcome(() => prepared(body));
      compare(actual, expected, { kind, scenario: scenario.name, index, from, to, body });
      privateChecks++; if (expected.returned) privateContacts++;
    }
    compare(own, initialOwn, { kind, scenario: scenario.name, mutation: 'control ship' });
    compare(clone, initialClone, { kind, scenario: scenario.name, mutation: 'candidate ship' });
    // Public path includes frame construction, body ordering, terrain and tie resolution.
    if (!scenario.name.startsWith('seeded-') && !['large-world', 'large-hull', 'tiny-hull'].includes(scenario.name)) {
      for (const coast of [false, true]) {
        const cells = Array.from({ length: 64*64 }, (_, i) => coast && i%64 >= 18 ? '.' : '~').join('');
        const map = { width: 2048, height: 2048, terrain: { cell: 32, cols: 64, rows: 64, cells } };
        const bodyUnits = control.SHIP_KINDS.map((otherKind, i) => {
          const other = control.createUnit(`other-${i}`, 'enemy', otherKind, from.x+45+i*23, from.y+(i%2)*30);
          other.sailing = { heading: .3*i, speed: 0, load: 0, balance: 0 }; return other;
        });
        bodyUnits.push(control.createUnit('crew', 'enemy', 'footman', from.x+10, from.y+30));
        const units = [structuredClone(own), ...bodyUnits], units2 = structuredClone(units), map2 = structuredClone(map);
        control.beginShipCollisionFrame(units, map);
        candidate.beginShipCollisionFrame(units2, map2);
        const expected = control.sweepShipCollision(map, units[0], units, from, to);
        const actual = candidate.sweepShipCollision(map2, units2[0], units2, from, to);
        compare(actual, expected, { kind, scenario: scenario.name, coast, public: true });
        publicChecks++; if (expected) publicContacts++;
      }
    }
  }
  assert.ok(privateContacts > 0 && publicContacts > 0, 'suite must actually exercise contacts');
  console.log(JSON.stringify({ status: 'PASS', comparison: 'node assert.deepStrictEqual (Object.is numbers, including signed zero)',
    initialSeed: '0x5a17c011', randomCount, privateChecks, privateContacts, publicChecks, publicContacts, ...metadata }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
