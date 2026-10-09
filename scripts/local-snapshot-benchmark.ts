import { createGame } from '../src/shared/sim';
import { LocalGameAdapter } from '../src/client/net/local-adapter';

// Exercises render-time reads through the real local adapter. Each read consumes
// snapshot contents; warmup, game setup and the command validation are untimed.
const arg = (key: string) => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const count = Number(arg('--units') ?? 1000), reads = Number(arg('--reads') ?? 1000);
if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(reads) || reads <= 0) throw new Error('Units and reads must be positive integers');
const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; game.items = []; game.resources = []; game.scriptedVictory = true;
for (let i = 0; i < count; i++) game.spawnUnit('player', 'worker', 500 + i % 25 * 35, 500 + Math.floor(i / 25) * 35);
const adapter = new LocalGameAdapter(game, 'player', { now: () => 0 });
for (let i = 0; i < 20; i++) adapter.currentSnapshot();
const first = adapter.currentSnapshot(); let previous = first, reused = 0, consumedHp = 0;
const started = performance.now();
for (let i = 0; i < reads; i++) {
  const snapshot = adapter.currentSnapshot(); if (snapshot === previous) reused++;
  consumedHp += snapshot.units[i % count]!.hp; previous = snapshot;
}
const elapsedMs = performance.now() - started;
adapter.sendCommand({ type: 'move', unitIds: [game.units[0]!.id], x: 700, y: 500, avoidCombat: true });
const afterCommand = adapter.currentSnapshot();
if (afterCommand === first || afterCommand.tick <= first.tick || first.tick !== 0) throw new Error('A command did not replace the immutable render snapshot');
adapter.close();
process.stdout.write(JSON.stringify({ units: count, reads, elapsedMs, perReadMs: elapsedMs / reads, reused, consumedHp, commandInvalidates: afterCommand !== first, oldSnapshotTick: first.tick, newSnapshotTick: afterCommand.tick }) + '\n');
