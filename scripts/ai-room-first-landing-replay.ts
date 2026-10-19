import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRoomHost } from '../src/server/room-host';
import { createInlineAiThinkExecutor, type AiRuntimeState } from '../src/ai/runtime';
import { MAP_POOL } from '../src/shared/map-pool';
import { ROOM_AI_VERSIONS } from '../src/shared/rooms';
import { replayTraceToTick, extractReplayFrameSave } from '../src/shared/replay';
import { checksumGame } from '../src/shared/sim/checksum';
import type { RoomAiVersion } from '../src/shared/types';
import { flag, requiredFlag } from './benchmark-cli';

// A single native room, with no injected commands or outcome aggregation.
const args = process.argv.slice(2), mapId = requiredFlag(args, 'map');
const map = MAP_POOL.find(map => map.id === mapId);
if (!map) throw new Error(`Unknown map ${mapId}`);
const version = (flag(args, 'version') ?? 'v9_archer') as RoomAiVersion;
if (!ROOM_AI_VERSIONS.includes(version)) throw new Error(`Unknown version ${version}`);
const side = Number(flag(args, 'side') ?? 1), limit = Number(flag(args, 'limit') ?? 600);
const reinforcementMode = args.includes('--reinforcements');
if (![1, 2].includes(side) || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid side or limit');
const out = resolve(requiredFlag(args, 'out-dir'));
mkdirSync(out, { recursive: true });
let runtime: AiRuntimeState | undefined;
const host = createRoomHost({ autoTick: false, aiThinkExecutor: value => {
  runtime = value;
  return createInlineAiThinkExecutor(value);
} });
const id = `first-landing-${map.id}-${version}-${side}`;
const room = host.createRoom({ id, host: { id: 'landing-observer', name: 'Landing observer' }, mapId: map.id,
  humanCount: 1, aiCount: map.players - 1,
  seatSetup: Array.from({ length: map.players }, (_, index) => ({ controller: 'ai', race: 'ember',
    team: `team-${index % 2 + 1}`, aiVersion: version })) });
host.startRoom(id);
// The room roster is real. Opposing seats use the historical v9 policy, which
// remains a supported runtime version rather than a room picker option.
host.resetRoom(id, map.id, { aiPlayers: room.slots.map(slot => slot.playerId),
  aiVersions: Object.fromEntries(room.slots.map(slot => [slot.playerId, slot.team === `team-${side}` ? version : 'v9'])) });
host.enableDebugReplay(id, { id: `${id}-initial`, label: `${map.name}: first combat crossing` });
const seats = room.slots.filter(slot => slot.team === `team-${side}`).map(slot => slot.playerId);
const observed = new Map<string, string>();
const transfers: Record<string, { tick: number; unitIds: string[]; shipId: string }[]> = {};
const returns: Record<string, number> = {};
let end = 0, firstAll: number | undefined;
for (let second = 1; second <= limit; second++) {
  const { snapshot } = host.tickRoom(id, 20);
  end = snapshot.tick;
  if (!runtime) throw new Error('Native AI runtime was not observed');
  for (const owner of seats) {
    const memory = runtime.memories[owner]?.naval;
    const record = memory?.firstCombatDelivery;
    const delivered = transfers[owner] ??= [];
    for (const [shipId, mission] of Object.entries(memory?.ferries ?? {})) {
      if (mission.purpose !== 'reinforce') continue;
      returns[owner] = Math.max(returns[owner] ?? 0, mission.returnTrips ?? 0);
      for (const delivery of mission.deliveries ?? []) if (!delivered.some(row => row.shipId === shipId && row.tick === delivery.tick)) {
        delivered.push({ ...delivery, shipId });
      }
    }
    const stage = JSON.stringify({ boats: record && Object.keys(record.attempts), delivered: record?.deliveredTick, transfers: delivered.length, returns: returns[owner],
      decisions: memory?.ferryDecisions && Object.fromEntries(Object.entries(memory.ferryDecisions).map(([id, decision]) => [id, decision.reason])) });
    if (stage !== observed.get(owner)) {
      observed.set(owner, stage);
      console.log(JSON.stringify({ second, owner, record, ferries: memory?.ferries }));
    }
  }
  const reached = reinforcementMode ? seats.some(owner => (transfers[owner]?.length ?? 0) >= 2 && (returns[owner] ?? 0) >= 1)
    : seats.every(owner => runtime!.memories[owner]?.naval?.firstCombatDelivery?.deliveredTick !== undefined);
  if (reached) firstAll ??= second;
  if (second % 30 === 0 || firstAll === second) {
    writeFileSync(join(out, `${second}.json`), JSON.stringify({ snapshot, memories: runtime.memories }));
  }
  if (firstAll !== undefined && second >= firstAll + 10) break;
}
if (!runtime) throw new Error('No AI runtime');
const trace = host.readDebugReplay(id);
// Check the entire fixed command stream from its initial save; do not allow
// an end checkpoint to stand in for actually executing the replay.
const cold = replayTraceToTick({ ...trace, checkpoints: [] }, end);
const liveChecksum = host.checksumRoom(id), replayChecksum = checksumGame(cold);
if (liveChecksum !== replayChecksum) throw new Error(`Replay diverged: ${liveChecksum} / ${replayChecksum}`);
writeFileSync(join(out, 'replay.json'), JSON.stringify(trace));
const results = seats.map(owner => ({ owner, record: runtime!.memories[owner]?.naval?.firstCombatDelivery,
  decisions: runtime!.memories[owner]?.naval?.ferryDecisions, transfers: transfers[owner] ?? [], returnTrips: returns[owner] ?? 0 }));
for (const result of results) {
  const deliveredTick = reinforcementMode ? result.transfers.at(-1)?.tick : result.record?.deliveredTick;
  if (deliveredTick === undefined) continue;
  const firstTick = reinforcementMode ? result.transfers[0]!.tick : deliveredTick;
  const start = Math.max(0, firstTick - 45 * 20), finish = Math.min(end, deliveredTick + 10 * 20);
  const clip = { ...trace, id: `${id}-${result.owner}-landing`,
    initialSave: extractReplayFrameSave(trace, start, { id: `${id}-${result.owner}-clip-start` }),
    frames: trace.frames.filter(frame => frame.tick >= start && frame.tick < finish), checkpoints: [] };
  const checksum = checksumGame(replayTraceToTick(clip, finish));
  if (checksum !== checksumGame(replayTraceToTick(trace, finish))) throw new Error(`Clip diverged for ${result.owner}`);
  writeFileSync(join(out, `${result.owner}-landing.replay.json`), JSON.stringify(clip));
  writeFileSync(join(out, `${result.owner}-landed.save.json`), JSON.stringify(extractReplayFrameSave(trace, deliveredTick,
    { id: `${id}-${result.owner}-landed`, label: `${result.owner}: first combat landing` })));
}
const summary = { map: map.id, version, side, machine: { platform: process.platform, arch: process.arch, node: process.version },
  endTick: end, liveChecksum, replayChecksum, results };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (reinforcementMode ? !results.some(result => result.transfers.length >= 2 && result.returnTrips >= 1)
  : results.some(result => result.record?.deliveredTick === undefined)) process.exitCode = 1;
