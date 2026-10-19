import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRoomHost } from '../src/server/room-host';
import { createInlineAiThinkExecutor } from '../src/ai/runtime';
import { MAP_POOL } from '../src/shared/map-pool';
import { extractReplayFrameSave, replayTraceToTick } from '../src/shared/replay';
import { checksumGame } from '../src/shared/sim/checksum';
import { isShipKind } from '../src/shared/ship-geometry';
import type { GameSnapshot, RoomAiVersion } from '../src/shared/types';
import { flag, requiredFlag } from './benchmark-cli';

// One native room. No commands, units, equipment or money are injected.
const args = process.argv.slice(2), mapId = requiredFlag(args, 'map');
const map = MAP_POOL.find(map => map.id === mapId);
if (!map) throw new Error(`Unknown map ${mapId}`);
const version = (flag(args, 'version') ?? 'v9_archer') as RoomAiVersion;
if (!['v9_archer', 'v9_summoner', 'v9_knight'].includes(version)) throw new Error('Unknown room AI');
const limit = Number(flag(args, 'limit') ?? 1200), out = resolve(requiredFlag(args, 'out-dir'));
const coastMode = args.includes('--coast-fire');
if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid time limit');
mkdirSync(out, { recursive: true });
const host = createRoomHost({ autoTick: false, aiThinkExecutor: createInlineAiThinkExecutor });
const id = `fleet-fire-${map.id}-${version}`;
const room = host.createRoom({ id, host: { id: 'fleet-observer', name: 'Fleet observer' }, mapId: map.id,
  humanCount: 1, aiCount: map.players - 1,
  seatSetup: Array.from({ length: map.players }, (_, index) => ({ controller: 'ai', race: 'ember',
    team: `team-${index % 2 + 1}`, aiVersion: version })) });
host.startRoom(id);
host.resetRoom(id, map.id, { aiPlayers: room.slots.map(slot => slot.playerId),
  aiVersions: Object.fromEntries(room.slots.map(slot => [slot.playerId, slot.team === 'team-1' ? version : 'v9'])) });
host.enableDebugReplay(id, { id: `${id}-initial`, label: `${map.name}: actual fleet fire` });
const owners = new Set(room.slots.filter(slot => slot.team === 'team-1').map(slot => slot.playerId));
type Engagement = { targetId: string; kind: string; owner: string; firstTick: number; shots: Record<string, number>; lastShots: Record<string, number>; hits: number; damage: number; lowestHp: number; maxHp: number;
  pairTick?: number; pairShipIds?: string[]; pairStartHp?: number; pairHits: number; pairDamage: number; deadTick?: number };
const engagements = new Map<string, Engagement>(), seen = new Set<string>(), origins = new Map<string, string>();
const events: unknown[] = [];
let selected: Engagement | undefined, selectedTick: number | undefined, end = 0;
for (let tick = 0; tick < limit * 20; tick++) {
  const { snapshot } = host.tickRoom(id, 1);
  end = snapshot.tick;
  const byId = new Map(snapshot.units.map(unit => [unit.id, unit]));
  for (const effect of snapshot.effects) {
    if (seen.has(effect.id)) continue;
    seen.add(effect.id);
    const source = effect.sourceId && byId.get(effect.sourceId);
    const origin = `${effect.fromX}:${effect.fromY}`;
    if (effect.type === 'muzzleFlash' && source && owners.has(source.owner) && isShipKind(source.kind)) {
      origins.set(origin, source.id);
      const targetId = (source.order.type === 'attack' || source.order.type === 'attackMove') ? source.order.targetId : undefined;
      const target = targetId && (byId.get(targetId) ?? snapshot.buildings.find(building => building.id === targetId));
      events.push({ tick: end, ...effect, orderedTarget: targetId });
      if (target) {
        let record = engagements.get(target.id);
        if (!record) { record = { targetId: target.id, kind: target.kind, owner: target.owner, firstTick: end, shots: {}, lastShots: {}, hits: 0, damage: 0, lowestHp: target.hp, maxHp: target.maxHp, pairHits: 0, pairDamage: 0 }; engagements.set(target.id, record); }
        record.shots[source.id] = (record.shots[source.id] ?? 0) + 1;
        record.lastShots[source.id] = end;
        const live = Object.keys(record.lastShots).filter(id => {
          const ship = byId.get(id);
          return ship && ship.hp > 0 && end - record!.lastShots[id]! <= 160
            && (ship.order.type === 'attack' || ship.order.type === 'attackMove') && ship.order.targetId === target.id;
        });
        if (record.pairTick === undefined && live.length >= 2) {
          record.pairTick = end; record.pairShipIds = live; record.pairStartHp = target.hp;
        }
      }
    }
    if (effect.type === 'hit' && origins.has(origin) && effect.unitId && (effect.damage ?? 0) > 0) {
      events.push({ tick: end, ...effect });
      const record = engagements.get(effect.unitId);
      if (record) {
        record.hits++; record.damage += effect.damage!;
        record.lowestHp = Math.min(record.lowestHp, effect.targetHpAfter ?? record.lowestHp);
        if (record.lowestHp <= 0) record.deadTick ??= end;
        if (record.pairShipIds?.includes(origins.get(origin)!)) { record.pairHits++; record.pairDamage += effect.damage!; }
      }
    }
  }
  if (!selected) {
    selected = [...engagements.values()].find(record => coastMode
      ? record.owner === 'neutral' && record.deadTick !== undefined && record.hits >= 3 && record.damage >= 50
      : record.pairTick !== undefined && record.pairHits >= 2 && record.pairDamage >= 50);
    if (selected) { selectedTick = end; console.log(JSON.stringify({ selectedTick, selected })); }
  }
  if (end % 600 === 0) {
    writeFileSync(join(out, `${end / 20}.json`), JSON.stringify(snapshot));
    console.log(JSON.stringify({ second: end / 20, engagements: [...engagements.values()] }));
  }
  if (selectedTick !== undefined && end >= selectedTick + 200 || snapshot.match.winner) break;
}
const trace = host.readDebugReplay(id), cold = replayTraceToTick({ ...trace, checkpoints: [] }, end);
const liveChecksum = host.checksumRoom(id), replayChecksum = checksumGame(cold);
if (liveChecksum !== replayChecksum) throw new Error(`Replay diverged: ${liveChecksum} / ${replayChecksum}`);
writeFileSync(join(out, 'replay.json'), JSON.stringify(trace));
if (selected) {
  const start = Math.max(0, selected.firstTick - 200);
  const clip = { ...trace, id: `${id}-gunnery`, initialSave: extractReplayFrameSave(trace, start, { id: `${id}-clip-start` }),
    frames: trace.frames.filter(frame => frame.tick >= start && frame.tick < end), checkpoints: [] };
  if (checksumGame(replayTraceToTick(clip, end)) !== liveChecksum) throw new Error('Clip diverged');
  writeFileSync(join(out, 'gunnery.replay.json'), JSON.stringify(clip));
  for (const [label, tick] of [[coastMode ? 'firing' : 'both-guns', selected.pairTick ?? selected.firstTick],
    ['damage', coastMode ? selected.deadTick! - 1 : selectedTick!], ['end', end]] as const)
    writeFileSync(join(out, `${label}.save.json`), JSON.stringify(extractReplayFrameSave(trace, tick, { id: `${id}-${label}`, label })));
}
const summary = { map: map.id, version, mode: coastMode ? 'coast-fire' : 'live-pair', machine: { platform: process.platform, arch: process.arch, node: process.version },
  endTick: end, liveChecksum, replayChecksum, selectedTick, selected, engagements: [...engagements.values()] };
writeFileSync(join(out, 'events.json'), JSON.stringify(events));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (!selected) throw new Error('Requested firing behavior was not demonstrated within the observation window');
