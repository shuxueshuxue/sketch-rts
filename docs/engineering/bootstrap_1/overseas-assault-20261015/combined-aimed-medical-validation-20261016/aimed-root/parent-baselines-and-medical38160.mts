import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const D = '/workspace/.playtest/root-aimed-owner-integration-20261016';
const oldRoot = '/workspace/sketch-rts-root-medical-8da5-fixed-control';
const currentRoot = '/workspace/sketch-rts-root-aimed-c64d-fixed-control';
const oldHead = '8da5b0e4d65c0a5d355ecd9bdcbdb9c4ae23051d';
const currentHead = 'c64d70c91a1ba8027a5b64c1af651537f41563ed';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const load = (root: string, path: string) => import(pathToFileURL(root + '/' + path).href);

async function plan(root: string, input: any) {
  const saved = structuredClone(input);
  const before = structuredClone(saved.snapshot);
  const { setBuildingBodies } = await load(root, 'src/shared/terrain.ts');
  setBuildingBodies(saved.snapshot.map, [...saved.snapshot.buildings, ...(saved.snapshot.obstacles ?? [])]);
  const { createAiMemoryProvider, planAiOwnerCommandEntries } = await load(root, 'src/ai/planner-context.ts');
  const memories = structuredClone(saved.memories);
  const entries = planAiOwnerCommandEntries(saved.snapshot,
    { playerId: 'p0', version: 'v9_knight', source: 'external-agent' },
    { teams: saved.snapshot.teams, memoryProvider: createAiMemoryProvider(memories) });
  if (!isDeepStrictEqual(saved.snapshot, before)) throw Error('Planner mutated original world');
  if (!isDeepStrictEqual(memories.p1, saved.memories.p1) || !isDeepStrictEqual(memories.p2, saved.memories.p2)) throw Error('Other owner memory changed');
  return { entries, memories };
}

const gunId = 'unit-p0-ballista-27366';
function withoutGun(entries: any[]) {
  return entries.flatMap(entry => {
    const c = entry.command;
    if (c.unitId === gunId) return [];
    if (c.unitIds?.includes(gunId)) {
      const unitIds = c.unitIds.filter((id: string) => id !== gunId);
      return unitIds.length ? [{ ...entry, command: { ...c, unitIds } }] : [];
    }
    return [entry];
  });
}

const summaries = [];
for (const tick of [37410, 37455]) {
  const path = currentRoot + '/src/ai/policy/fixtures/aimed-weapon-knight-' + tick + '.json.gz';
  const bytes = readFileSync(path);
  const saved = JSON.parse(gunzipSync(bytes).toString());
  const original = structuredClone(saved);
  const old = await plan(oldRoot, saved);
  const current = await plan(currentRoot, saved);
  if (!isDeepStrictEqual(saved, original) || !isDeepStrictEqual(withoutGun(old.entries), withoutGun(current.entries))) {
    throw Error('Unrelated current commands changed at actual ' + tick);
  }
  const baseline = { classification: 'Pure same-input parent8da P0 reference for the integrated ownership contract. Original1905 public trace is preserved separately. No Game, native step or command issue.',
    referenceSource: oldHead, originalInputSHA256: sha(bytes), tick,
    entries: old.entries, all3PostMemories: old.memories };
  writeFileSync(D + '/' + tick + '-8da-parent-p0.json', JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(D + '/' + tick + '-c64-current-p0.json', JSON.stringify({ currentHead, tick, ...current }, null, 2) + '\n', { flag: 'wx' });
  summaries.push({ tick, inputSHA256: sha(bytes), parentEntries: old.entries.length, currentEntries: current.entries.length,
    nonGunEntriesStrictlyEqual: true, originalWorldAndAllInputMemoriesUnchanged: true });
}

const medicalPath = '/tmp/bootstrap-aimed-cast-owner-1905-20261016/natural-from37560/frames/38160-after-step-before-next-think.json.gz';
const medicalBytes = readFileSync(medicalPath);
if (sha(medicalBytes) !== '3c73bc0fc0a43a7ccd944fdf507300f4f08c51f8670380dbb5c4840da8b748cf') throw Error('Wrong actual38160');
const medicalInput = JSON.parse(gunzipSync(medicalBytes).toString());
const medical = await plan(currentRoot, medicalInput);
const doctorId = 'unit-p0-fieldMedic-34930';
const actor = (entry: any) => entry.command.unitId === doctorId || entry.command.unitIds?.includes(doctorId);
writeFileSync(D + '/38160-c64-medical-p0.json', JSON.stringify({ classification: 'One pure full-P0 counterfactual using c64 combined medical policy against actual d93/1905 inherited-medical state. No Game/step/command issue; does not prove survival.', currentHead,
  input: { path: medicalPath, sha256: sha(medicalBytes), tick: medicalInput.snapshot.tick, nextId: medicalInput.nextId },
  doctor: medicalInput.snapshot.units.find((unit: any) => unit.id === doctorId), doctorCommands: medical.entries.filter(actor), ...medical }, null, 2) + '\n', { flag: 'wx' });
writeFileSync(D + '/PURE-P0-CLOSURE.json', JSON.stringify({ currentHead, oldHead, cases: summaries,
  medical38160: { originalInputSHA256: sha(medicalBytes), doctorCommands: medical.entries.filter(actor) },
  noCreateGameRestoreStepIssueOrOpponentPlanning: true }, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ cases: summaries, doctorCommands38160: medical.entries.filter(actor) }) + '\n');
