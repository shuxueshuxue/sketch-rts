// External diagnostic only: one identical setup imports each revision's own
// simulation and measurement code. It adds no new physics to the old revision.
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argument = (key: string) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? undefined : process.argv[index + 1];
};
const root = argument('--root'), output = argument('--out');
if (!root || !output) throw new Error('Provide --root and --out');
const source = (path: string) => import(pathToFileURL(resolve(root, path)).href);
const [{ createGame, issuePlayerCommand }, { runNavalStress }, { seedHash }] = await Promise.all([
  source('src/shared/sim.ts'), source('scripts/naval-runtime-stress.ts'), source('src/shared/environment/noise.ts'),
]);
const scene = {
  id: 'trafalgar-two-columns-7',
  label: 'Seven ordinary-HP line ships: two attacking columns under light wind',
  duration: 110,
  setup() {
    const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], teams: { player: 'blue', enemy: 'red' } });
    game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = [];
    game.obstacles = []; game.effects = []; game.projectiles = []; game.scriptedVictory = true;
    game.map = { ...game.map, width: 6144, height: 6144, wind: { direction: 0, speed: 20 },
      terrain: { cell: 32, cols: 192, rows: 192, cells: '~'.repeat(192 * 192) } };
    const hash = seedHash('historical-review-v1'), offset = { x: (hash % 17) - 8, y: (Math.floor(hash / 17) % 17) - 8 };
    const attackers: any[] = [], defenders: any[] = [], goals = new Map();
    const boat = (x: number, y: number, owner = 'player', heading = 0) => {
      const unit = game.spawnUnit(owner, 'shipOfTheLine', x + offset.x, y + offset.y);
      unit.sailing.heading = heading;
      return unit;
    };
    for (const y of [2800, 3500]) for (const x of [2400, 1900]) attackers.push(boat(x, y));
    for (const y of [2450, 3150, 3850]) defenders.push(boat(4000, y, 'enemy', -Math.PI / 2));
    for (const unit of defenders) issuePlayerCommand(game, 'enemy', { type: 'holdPosition', unitIds: [unit.id] });
    for (const unit of attackers) {
      const goal = { x: 5200 + offset.x, y: unit.y }; goals.set(unit, goal);
      issuePlayerCommand(game, 'player', { type: 'move', unitIds: [unit.id], ...goal, avoidCombat: false });
    }
    return { game, ships: [...attackers, ...defenders], goals };
  },
};
const result = runNavalStress(scene, process.argv.includes('--record'));
writeFileSync(resolve(output), JSON.stringify({ schema: 1, environment: { node: process.version, arch: process.arch, platform: process.platform, cpu: cpus()[0]?.model },
  ticksPerSecond: 20, qualitySampleHz: 10, scenes: [result] }, null, 2));
process.stdout.write(JSON.stringify({ id: result.id, step: result.step, quality: result.quality, checksum: result.checksum }) + '\n');
