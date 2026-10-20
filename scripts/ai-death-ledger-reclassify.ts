/** Reclassify immutable v1 evidence without constructing or stepping a game.
 * tsx scripts/ai-death-ledger-reclassify.ts <source-tree> <v1-root> <new-output> <classification-sha> <source-evidence-sha>
 */
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { createGunzip, createGzip } from 'node:zlib';
import type { ObservedSource } from '../src/shared/sim/observation';
import type { AiDeathClassificationV1, AiUnitDeathRecord } from '../src/ai/death-ledger-types';

const [tree, root, out, classificationSource, sourceEvidenceSha256] = process.argv.slice(2);
if (!tree || !root || !out || !classificationSource || !sourceEvidenceSha256) throw new Error('Expected source-tree v1-root new-output classification-sha source-evidence-sha');
if (existsSync(out)) throw new Error(`Refusing to overwrite ${out}`);
const { classifyAiDeath } = await import(`${tree}/src/ai/death-ledger-classification.ts`) as typeof import('../src/ai/death-ledger-classification');
const { inferAiDeathEngagement } = await import(`${tree}/src/ai/death-ledger-engagement.ts`) as typeof import('../src/ai/death-ledger-engagement');
const { summarizeAiDeaths } = await import(`${tree}/src/ai/death-ledger-summary.ts`) as typeof import('../src/ai/death-ledger-summary');
type PreviousRow = Omit<AiUnitDeathRecord, 'classification'> & { classification: AiDeathClassificationV1 };
async function* lines(path: string) {
  if (!existsSync(path)) return;
  for await (const line of createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity })) if (line) yield JSON.parse(line);
}
async function writer(path: string) {
  const zip = createGzip({ level: 6 }), file = createWriteStream(path), finished = once(file, 'finish'); zip.pipe(file);
  return { async row(value: unknown) { if (!zip.write(JSON.stringify(value) + '\n')) await once(zip, 'drain'); },
    async close() { zip.end(); await finished; } };
}
function json(path: string) { return JSON.parse(readFileSync(path, 'utf8')); }
const input = json(`${root}/analysis/summary.json`), all: AiUnitDeathRecord[] = [], mapped: { map: string; record: AiUnitDeathRecord }[] = [], reports: unknown[] = [];
mkdirSync(out, { recursive: true });
async function reclassify(source: string, dest: string, map: string) {
  mkdirSync(dest, { recursive: true });
  const initial = json(`${source}/initial.json`), receipt = json(`${source}/summary.json`);
  const identities = new Map<string, Pick<ObservedSource, 'owner' | 'kind' | 'entityType'>>();
  const remember = (world: typeof initial.snapshot) => {
    for (const unit of world.units) identities.set(unit.id, { owner: unit.owner, kind: unit.kind, entityType: 'unit' });
    for (const building of world.buildings) identities.set(building.id, { owner: building.owner, kind: building.kind, entityType: 'building' });
  };
  remember(initial.snapshot);
  // Later worlds contribute identity only. Native fatal-hit IDs establish presence, never future positions.
  for await (const world of lines(`${source}/worlds.jsonl.gz`)) remember(world);
  const previous: PreviousRow[] = [];
  for await (const row of lines(`${source}/deaths.jsonl.gz`)) previous.push(row);
  for (const row of previous) {
    identities.set(row.unit.id, { owner: row.unit.owner, kind: row.unit.kind, entityType: 'unit' });
    for (const candidate of [row.killer, ...row.damageWindow.sources.map(hit => hit.source)])
      if (candidate && (candidate.present || candidate === row.killer && row.killerKindAttribution === 'previously-observed-entity')) identities.set(candidate.id, candidate);
  }
  const oldByUnit = new Map(previous.map(row => [row.unit.id, row])), byId = new Map<string, AiUnitDeathRecord>();
  const oldFacts = createHash('sha256'), newFacts = createHash('sha256'), deaths = await writer(`${dest}/deaths.jsonl.gz`);
  for (const row of previous) {
    const carrier = row.cause === 'sinking' && row.location.carrierId ? oldByUnit.get(row.location.carrierId) : undefined;
    if (carrier && carrier.tick !== row.tick) throw new Error('Carrier/passenger death ticks differ');
    const engagement = inferAiDeathEngagement(row, { identities, teams: initial.snapshot.teams,
      dealtDamage: null, ...(carrier ? { carrier } : {}), provenance: 'reclassified-native-records' });
    const next = { ...row, classification: classifyAiDeath(row, engagement, row.classification) };
    const { classification: oldClass, ...oldObservation } = row, { classification: newClass, ...newObservation } = next;
    oldFacts.update(JSON.stringify(oldObservation) + '\n'); newFacts.update(JSON.stringify(newObservation) + '\n');
    if (JSON.stringify(oldClass) !== JSON.stringify(newClass.v1) || oldClass.tags.some(tag => !newClass.tags.includes(tag))) throw new Error('v1 classification changed');
    if (byId.has(next.id)) throw new Error('Duplicate death ID');
    byId.set(next.id, next); await deaths.row(next);
  }
  await deaths.close();
  const factsBefore = oldFacts.digest('hex'), factsAfter = newFacts.digest('hex');
  if (factsBefore !== factsAfter) throw new Error('Raw observations changed');
  const rows = [...byId.values()], traceOutput = await writer(`${dest}/traces.jsonl.gz`), published = new Set<string>(), terminal: Record<string, unknown> = {};
  let traceCount = 0;
  for await (const trace of lines(`${source}/traces.jsonl.gz`)) {
    const old = trace.deathLedger;
    const records = old.records.map((row: PreviousRow) => {
      if (published.has(row.id)) throw new Error('Death published twice'); published.add(row.id);
      const next = byId.get(row.id); if (!next) throw new Error('Trace references missing death'); return next;
    });
    const summary = summarizeAiDeaths(rows, trace.owner, old.throughTick);
    terminal[trace.owner] = summary;
    await traceOutput.row({ ...trace, deathLedger: { ...old, schemaVersion: 2, records, summary } }); traceCount++;
  }
  await traceOutput.close();
  if (published.size !== rows.length) throw new Error('Death missing from traces');
  const summaries = Object.fromEntries(receipt.owners.map((owner: string) => [owner, summarizeAiDeaths(rows, owner)]));
  if (receipt.owners.some((owner: string) => JSON.stringify(summaries[owner]) !== JSON.stringify(terminal[owner]))) throw new Error('Terminal summaries differ');
  const summary = summarizeAiDeaths(rows);
  if (summary.nativeLosses !== Object.values(receipt.summaries).reduce((sum: number, value: any) => sum + value.nativeLosses, 0)) throw new Error('Native counts changed');
  const nextReceipt = { ...receipt, source: receipt.source, simulationSource: receipt.source, classificationSource,
    classificationVersion: 2, classificationInput: source, summaries,
    rawObservationSha256: factsAfter, rawObservationHashesMatch: true, traceCount };
  writeFileSync(`${dest}/summary.json`, JSON.stringify(nextReceipt, null, 2));
  const report = { map, input: source, output: dest, simulationSource: receipt.source, classificationSource,
    traceCount, summary, observationsSha256: factsAfter, observationsUnchanged: true, v1LabelsUnchanged: true,
    unknownEngagements: rows.filter(row => row.actualDeath && row.classification.engagement.status === 'unknown').map(row => row.id) };
  writeFileSync(`${dest}/reclassification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ map, summary, traceCount }));
  return { rows, report };
}
for (const entry of input.maps) {
  const result = await reclassify(entry.finalDir, `${out}/${entry.map}`, entry.map);
  reports.push(result.report); all.push(...result.rows); mapped.push(...result.rows.map(record => ({ map: entry.map, record })));
}
const uiSource = `${root}/ui-twoShores`, uiDest = `${out}/ui-twoShores`;
await reclassify(uiSource, uiDest, 'ui-twoShores');
for (const file of ['initial.json', 'final.json', 'worlds.jsonl.gz', 'building-losses.jsonl.gz']) if (existsSync(`${uiSource}/${file}`)) copyFileSync(`${uiSource}/${file}`, `${uiDest}/${file}`);
const summary = summarizeAiDeaths(all), tiers = ['normal', 'suspicious', 'abnormal', 'unattributed'] as const;
const examples = Object.fromEntries(tiers.map(tier => [tier, mapped.filter(item => item.record.classification.disposition === tier)
  .sort((a, b) => a.record.tick - b.record.tick || a.map.localeCompare(b.map)).slice(0, 3)]));
const transitions: Record<string, number> = {};
for (const row of all) { const key = `${row.classification.v1.disposition}→${row.classification.disposition}`; transitions[key] = (transitions[key] ?? 0) + 1; }
writeFileSync(`${out}/summary.json`, JSON.stringify({ classificationSource, classificationVersion: 2, inputRoot: root,
  summary, maps: reports, transitions, examples }, null, 2));
const detail = await writer(`${out}/classified-deaths.jsonl.gz`);
for (const item of mapped) await detail.row(item); await detail.close();
writeFileSync(`${out}/provenance.json`, JSON.stringify({ classificationSource, classificationVersion: 2,
  mode: 'offline-reclassification-no-simulation', sourceEvidenceSha256,
  inputRoot: root, sourceFieldMeaning: 'original-simulation-source-preserved',
  missingOutgoingDamage: 'v1 did not record outgoing damage; null retained, incoming damage or hull evidence suffices where present' }, null, 2));
