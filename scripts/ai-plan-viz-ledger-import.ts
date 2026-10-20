import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIT_CARDS } from '../src/client/content/units';
import { BUILDING_CARDS } from '../src/client/content/buildings';
import { MAP_POOL } from '../src/shared/map-pool';

// No policy imports or simulation. Convert one immutable baseline's actual ledger and replay observations.
export type Row = Record<string, any>;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function ledgerEvent(record: Row, traces: Row[]) {
  if (record.classification.diagnosticVersion !== 2) throw new Error(`Expected death-ledger v2 classification: ${record.id}`);
  if (!record.actualDeath || record.classification.disposition === 'lifecycle') return null; // Alive exits and administrative forfeits are not combat casualties.
  if (!['normal', 'suspicious', 'abnormal', 'unattributed'].includes(record.classification.disposition)) throw new Error(`Missing ledger classification: ${record.id}`);
  const task = record.assignment.task;
  const trace = traces.filter(t => t.owner === record.owner && t.tick <= record.assignment.observedTick).at(-1);
  // Link only an explicit ledger task to the same observed attempt. Never guess from proximity or last command.
  const candidates = trace?.nodes.filter((n: Row) => n.selected && (
    n.id === task?.id || task && n.id.startsWith(task.id + ':') && n.target.entityId === task.targetId)) ?? [];
  const rootIds = candidates.filter((n: Row) => trace?.roots.includes(n.id)).map((n: Row) => n.id);
  return { id: record.id, type: 'death', tick: record.tick, removedTick: record.removedTick, owner: record.owner,
    unitId: record.unit.id, kind: record.unit.kind, x: record.unit.x, y: record.unit.y, killer: record.killer,
    attribution: { source: 'death-ledger', recordId: record.id, disposition: record.classification.disposition,
      category: record.classification.primary, rootIds }, ledger: record };
}
export function createWorldPacker() {
  const units: Row[] = [], buildings: Row[] = [], ui = new Map<string, number>(), bi = new Map<string, number>();
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    units, buildings,
    frame(world: Row) {
      for (const unit of world.units) {
        const key = unit.id + '|' + unit.kind;
        if (!ui.has(key)) { ui.set(key, units.length); units.push({ id: unit.id, owner: unit.owner, kind: unit.kind, maxHp: unit.maxHp }); }
      }
      const byId = new Map(world.units.map((u: Row) => [u.id, ui.get(u.id + '|' + u.kind)]));
      return { tick: world.tick, units: world.units.filter((u: Row) => u.hp > 0).map((u: Row) => [ui.get(u.id + '|' + u.kind), round(u.x), round(u.y), round(u.hp),
        ...(u.deck ? [byId.get(u.deck.shipId) ?? -1] : [])]),
      buildings: world.buildings.filter((b: Row) => b.hp > 0).map((b: Row) => {
        const key = b.id + '|' + b.kind;
        if (!bi.has(key)) { bi.set(key, buildings.length); buildings.push({ id: b.id, owner: b.owner, kind: b.kind, x: round(b.x), y: round(b.y) }); }
        return [bi.get(key), b.complete ? 1 : 0, round(b.hp)];
      }) };
    },
  };
}
async function* rows(file: string): AsyncGenerator<Row> {
  const source = createReadStream(file);
  const lines = createInterface({ input: file.endsWith('.gz') ? source.pipe(createGunzip()) : source, crlfDelay: Infinity });
  for await (const line of lines) if (line) yield JSON.parse(line);
}
async function list(file: string) { const out: Row[] = []; for await (const row of rows(file)) out.push(row); return out; }
export async function importBaseline(directory: string, output: string, sourceCommit: string) {
  const initialBytes = readFileSync(directory + '/initial.json'), summaryBytes = readFileSync(directory + '/summary.json');
  const initial = JSON.parse(initialBytes.toString()), receipt = JSON.parse(summaryBytes.toString());
  const final = JSON.parse(readFileSync(directory + '/final.json', 'utf8'));
  if (initial.source !== sourceCommit || receipt.source !== sourceCommit) throw new Error('Baseline source does not match the supplied commit.');
  if (receipt.simulationSource !== sourceCommit || receipt.classificationVersion !== 2 || !/^[a-f0-9]{40}$/.test(receipt.classificationSource))
    throw new Error('Expected the original simulation source and a separate v2 classification source.');
  if (initial.snapshot.tick !== 0 || receipt.tick < 18000) throw new Error('Choose a complete 0–15 minute baseline.');
  if (final.snapshot.tick !== receipt.tick) throw new Error('Final snapshot and receipt disagree about the recording end.');
  if (!receipt.reconciled || receipt.errors.length) throw new Error('Death baseline failed reconciliation.');
  const traces = await list(directory + '/traces.jsonl.gz');
  const deaths = await list(directory + '/deaths.jsonl.gz');
  if (traces.some(t => t.deathLedger?.schemaVersion !== 2)) throw new Error('Expected only death-ledger schema v2 frames.');
  const observations = createHash('sha256');
  for (const { classification: _classification, ...facts } of deaths) observations.update(JSON.stringify(facts) + '\n');
  if (!receipt.rawObservationHashesMatch || observations.digest('hex') !== receipt.rawObservationSha256)
    throw new Error('Reclassified raw observation hash does not match its receipt.');
  const lossFile = directory + '/building-losses.jsonl.gz';
  if (!existsSync(lossFile)) throw new Error('Precise building-loss observations are required; disappearance is not a destruction event.');
  const buildingLosses = await list(lossFile);
  const events: Row[] = [...deaths.flatMap(d => { const event = ledgerEvent(d, traces); return event ? [event] : []; }), ...buildingLosses.map(b => ({ ...b,
    id: b.id?.startsWith('building:') ? b.id : 'building:' + (b.id || b.entityId) + ':' + b.tick,
    entityId: b.entityId || b.id, type: 'building-loss', killer: b.killer ?? null }))].sort((a: any, b: any) => a.tick - b.tick);
  if (!events.some(e => e.type === 'death') || !buildingLosses.length)
    throw new Error('Choose a baseline with actual casualties and a real building loss.');
  const packer = createWorldPacker(), frames: Row[] = [], keepTicks = new Set(traces.filter(t => t.changes.some((c: Row) => ['added','removed','status','reason'].includes(c.kind))).map(t => t.tick));
  let next = 0;
  for await (const world of rows(directory + '/worlds.jsonl.gz')) {
    if (world.tick < next && !keepTicks.has(world.tick)) continue;
    const packed = packer.frame(world);
    if (frames.at(-1)?.tick === packed.tick) frames.pop();
    frames.push(packed);
    if (world.tick >= next) next = world.tick + 20;
  }
  if (!frames.length || frames[0]!.tick !== 0) frames.unshift(packer.frame(initial.snapshot));
  if (frames.at(-1)!.tick < final.snapshot.tick) frames.push(packer.frame(final.snapshot));
  const owners = [...new Set(traces.map(t => t.owner))];
  const players = Object.fromEntries(Object.keys(initial.config.agents).filter(owner => initial.snapshot.players[owner]).map(owner => [owner, { version: initial.config.agents[owner].version,
    race: initial.snapshot.players[owner].race, team: initial.snapshot.teams[owner], recordedPlans: owners.includes(owner) }]));
  const data = { provenance: { sourceCommit, simulationSourceCommit: receipt.simulationSource,
    classificationSourceCommit: receipt.classificationSource, classificationVersion: receipt.classificationVersion,
    classificationInput: receipt.classificationInput, classificationMode: 'offline-reclassification-no-simulation',
    rawObservationSha256: receipt.rawObservationSha256, rawObservationHashesMatch: true,
    baselineDirectory: directory, initialSha256: hash(initialBytes), summarySha256: hash(summaryBytes),
    startTick: 0, endTick: receipt.tick, thinkInterval: initial.config.thinkInterval, secondsPerTick: .05, frameInterval: '1s plus task changes',
    commandCount: receipt.commandCount, commandSha256: receipt.commandSha256, plannedSha256: receipt.plannedSha256,
    finalWorldSha256: receipt.snapshotSha256, description: '同局 0–15 分钟死亡账本、计划 trace 和世界位置的只读投影。' },
    ledgerSource: { module: 'src/ai/death-ledger.ts', sourceCommit: receipt.classificationSource, simulationSourceCommit: sourceCommit,
      schemaVersion: 2, summary: receipt.summaries, reconciled: receipt.reconciled,
      excludedLifecycleEvents: deaths.filter(d => !d.actualDeath || d.classification.disposition === 'lifecycle').length },
    kindLabels: Object.fromEntries(Object.entries({ ...UNIT_CARDS, ...BUILDING_CARDS }).map(([kind, card]) => [kind, card.name.zh])),
    map: { id: initial.snapshot.map.id, name: initial.snapshot.map.name, label: MAP_POOL.find(m => m.id === receipt.mapId)?.name.zh || initial.snapshot.map.name, width: initial.snapshot.map.width, height: initial.snapshot.map.height,
      terrain: initial.snapshot.map.terrain, resources: initial.snapshot.resources.map((r: Row) => ({ id: r.id, x: r.x, y: r.y, amount: r.amount })) },
    players, ownOwner: owners[0], unitCatalog: packer.units, buildingCatalog: packer.buildings, frames, events,
    thinks: traces.map(trace => ({ trace, claims: [] })) };
  writeFileSync(output, JSON.stringify(data));
  console.log(JSON.stringify({ output, frames: frames.length, traces: traces.length, events: events.length, commandCount: receipt.commandCount }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output, sourceCommit] = process.argv.slice(2);
  if (!directory || !output || !sourceCommit) throw new Error('Expected baseline-directory output.json source-commit');
  await importBaseline(directory, output, sourceCommit);
}
