import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, openSync, writeSync, closeSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';
import { runAiGameLoop } from '../../src/ai/game-runner';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../../src/ai/planner-context';
import type { AiPolicyMemory } from '../../src/ai/memory';
import { loadRoomBaseline, ROOM_BASELINE_MANIFEST } from '../../src/ai/frozen/room-baseline';
import { projectDeathThinkContext } from '../../src/ai/death-ledger-context';
import { projectRoomBaseline646cContext } from '../../src/ai/benchmark/room-baseline-646c-context';
import { AiDeathLedger } from '../../src/ai/death-ledger';
import { RoomAbMetrics } from '../../src/ai/benchmark/room-ab-metrics';
import { canonicalRoomAbClearings } from '../../src/ai/benchmark/room-ab-clearings';
import { roomAbRanks, type RoomAbCase } from '../../src/ai/benchmark/room-ab';
import { createRoom, roomToGameSetup } from '../../src/shared/rooms';
import { MAP_POOL } from '../../src/shared/map-pool';
import { snapshotGame, type CreateGameOptions } from '../../src/shared/sim';
import { checksumGame, canonicalGameState } from '../../src/shared/sim/checksum';
import type { GameSnapshot } from '../../src/shared/types';
import type { CommandFrameEntry } from '../../src/sdk/commands/frame';

export const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type RoomAbThink = { snapshot: GameSnapshot; owner: string; family: RoomAbCase['seats'][number]['family'];
  entries: CommandFrameEntry[]; memory: unknown; baseline: boolean };

/** Each match owns planner memory; the verified bundle owns a separate module/cache graph. */
export async function runRoomAbMatch(input: { item: RoomAbCase; cache: string; out: string; observed?: boolean;
  probeInputs?: boolean; onThink?: (row: RoomAbThink) => void; maxTicks?: number }) {
  const { item, cache, out } = input;
  mkdirSync(out, { recursive: true });
  const fds = new Map<string, number>();
  const log = (name: string, row: unknown) => {
    let fd = fds.get(name); if (fd === undefined) { fd = openSync(join(out, `${name}.jsonl`), 'wx'); fds.set(name, fd); }
    writeSync(fd, JSON.stringify(row) + '\n');
  };
  const baseline = (await loadRoomBaseline(cache)).createRoomPlanner();
  const memories: Record<string, AiPolicyMemory> = {}, provider = createAiMemoryProvider(memories);
  const map = MAP_POOL.find(map => map.id === item.mapId)!;
  let options: CreateGameOptions;
  if (item.mode === 'ffa') {
    const room = createRoom({ id: `ab-${item.pair}`, host: { id: 'ab-host', name: 'A/B' }, mapId: map.id,
      layoutSeed: item.layoutSeed, humanCount: 1, aiCount: map.players - 1,
      seatSetup: item.seats.map(seat => ({ controller: 'ai', race: seat.race, team: 'ffa', aiVersion: seat.family })) });
    const setup = roomToGameSetup(room);
    if (JSON.stringify(setup.playerSlots.map(s => s.playerId)) !== JSON.stringify(item.seats.map(s => s.owner)))
      throw new Error('Room seat IDs changed; update version-neutral matrix explicitly');
    options = setup.options;
  } else options = { layout: { ...map.layout, seed: item.layoutSeed } };
  const agents = Object.fromEntries(item.seats.map(seat => [seat.owner, { controller: 'internal-ai' as const,
    version: seat.family, race: seat.race, team: seat.owner }]));
  let ledger: AiDeathLedger | undefined, metrics: RoomAbMetrics | undefined, thinks = 0, commands = 0, inputChecks = 0;
  const plannedHash = createHash('sha256'), commandHash = createHash('sha256');
  const observed = input.observed !== false;
  let initialHash = '', initialSnapshot: GameSnapshot | undefined;
  const loop = runAiGameLoop({ name: item.name, mapId: map.id, agents, options, maxTicks: input.maxTicks ?? item.maxTicks,
    thinkInterval: 15, commandPlanner({ snapshot, owner, agent, source, teams }) {
      const seat = item.seats.find(s => s.owner === owner)!, frozen = seat.brain === 'room-baseline-646c';
      const before = frozen && input.probeInputs ? { snapshot: sha(snapshot), map: sha(snapshot.map) } : null;
      const entries = frozen ? baseline.plan(snapshot, { playerId: owner, version: seat.family, source })
        : planAiOwnerCommandEntries(snapshot, { playerId: owner, version: seat.brain === 'room-current' || seat.brain === 'room-baseline-646c' ? seat.family : seat.brain, source }, { memoryProvider: provider, teams });
      if (before) {
        if (sha(snapshot) !== before.snapshot || sha(snapshot.map) !== before.map) throw new Error(`Frozen planner mutated input: ${snapshot.tick}/${owner}`);
        inputChecks++;
      }
      const memory = frozen ? baseline.memory(owner) : memories[owner]!;
      const row = { tick: snapshot.tick, owner, entries };
      plannedHash.update(JSON.stringify(row) + '\n'); thinks++; log('planned', row);
      if (observed) {
        const facts = frozen ? projectRoomBaseline646cContext(snapshot, owner, memory) : projectDeathThinkContext(snapshot, owner, memory as AiPolicyMemory);
        ledger!.recordThinkContext(facts); metrics!.recordThink(facts); log('facts', facts);
      }
      input.onThink?.({ snapshot, owner, family: seat.family, entries, memory, baseline: frozen });
      return entries as CommandFrameEntry<'internal-ai'>[];
    } }, {
    beforeLoop({ game }) {
      const initial = snapshotGame(game); initialHash = sha(initial); initialSnapshot = initial;
      writeFileSync(join(out, 'initial.json'), JSON.stringify({ snapshot: initial, nextId: game.nextId, activePlayers: game.activePlayers }), { flag: 'wx' });
      if (observed) { ledger = new AiDeathLedger(game, { owners: item.seats.map(s => s.owner) }); metrics = new RoomAbMetrics(game, item.seats.map(s => s.owner)); }
    },
    onCommand({ tick, owner, source, scriptId, command }) {
      const row = { tick, owner, source, scriptId, command };
      commandHash.update(JSON.stringify(row) + '\n'); commands++; log('commands', row);
      ledger?.recordIssuedCommand(tick, owner, command, scriptId, source); metrics?.recordCommand(tick, owner, command);
    },
    onStep() { metrics?.step(); },
  });
  const rawMetrics = metrics?.finish();
  const metricsReport = rawMetrics ? canonicalRoomAbClearings(rawMetrics, initialSnapshot!) : null;
  const deaths = ledger?.records() ?? [];
  for (const row of deaths) log('deaths', row);
  const deathSummaries = Object.fromEntries(item.seats.map(s => [s.owner, ledger?.summary(s.owner) ?? null]));
  const reconciled = item.seats.every(s => !ledger || deathSummaries[s.owner]!.nativeLosses === (loop.game.match.stats.unitsLost[s.owner] ?? 0));
  const errors = [...(ledger?.errors ?? []), ...(metricsReport?.errors ?? [])];
  const ranks = metricsReport ? roomAbRanks(Object.entries(metricsReport.seats).map(([owner, m]) => ({ owner, ...m }))) : null;
  const finalMemory = Object.fromEntries(item.seats.map(s => [s.owner, s.brain === 'room-baseline-646c' ? baseline.memory(s.owner) : memories[s.owner]]));
  const report = { item, artifactSha256: ROOM_BASELINE_MANIFEST.artifact.sha256, tick: loop.game.tick,
    winner: loop.game.match.winner, timeout: !loop.game.match.winner, initialSha256: initialHash,
    plannedSha256: plannedHash.digest('hex'), commandSha256: commandHash.digest('hex'), snapshotSha256: sha(loop.snapshot),
    canonicalSha256: sha(canonicalGameState(loop.game)), checksum: checksumGame(loop.game), memorySha256: sha(finalMemory),
    thinks, commands, inputChecks, observed, ranks, metrics: metricsReport, deathSummaries, reconciled, errors,
    nativeStats: loop.game.match.stats, elapsedMs: loop.elapsedMs, cpuMs: loop.cpuMs, maxRssKiB: process.resourceUsage().maxRSS };
  ledger?.dispose();
  for (const [name, fd] of fds) {
    closeSync(fd); const path = join(out, `${name}.jsonl`);
    await pipeline(createReadStream(path), createGzip({ level: 3 }), createWriteStream(`${path}.gz`, { flags: 'wx' })); unlinkSync(path);
  }
  writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (!reconciled || errors.length) throw new Error(`Observer failed: ${JSON.stringify({ reconciled, errors })}`);
  return report;
}
export type RoomAbReport = Awaited<ReturnType<typeof runRoomAbMatch>>;
