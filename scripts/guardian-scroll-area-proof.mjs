import { createCanvas } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Actual simulation, snapshot and Canvas world renderer, identical scene in
// each source checkout. Annotation labels report simulated recipient status.
const [beforeSource, afterSource, destination] = process.argv.slice(2);
if (!beforeSource || !afterSource || !destination) throw new Error('Expected BEFORE_SOURCE AFTER_SOURCE OUTPUT_DIRECTORY');
const output = resolve(destination); mkdirSync(output, { recursive: true });
const fixture = [
  { id: 'north-inner', x: 1500, y: 1340, distance: 160 },
  { id: 'north-outer', x: 1500, y: 1280, distance: 220 },
  { id: 'south-inner', x: 1500, y: 1660, distance: 160 },
  { id: 'south-outer', x: 1500, y: 1720, distance: 220 },
  { id: 'east-inner', x: 1660, y: 1500, distance: 160 },
  { id: 'east-outer', x: 1720, y: 1500, distance: 220 },
  { id: 'west-inner', x: 1340, y: 1500, distance: 160 },
  { id: 'west-outer', x: 1280, y: 1500, distance: 220 },
];
const sourceFiles = ['src/shared/sim.ts', 'src/shared/item-rules.ts', 'src/shared/rules-version.ts',
  'src/client/world-renderer.ts', 'src/client/effect-renderer.ts', 'src/client/art/canvas-effects.ts', 'src/client/world3d/projection.ts',
  'src/ai/policy/item-tactics.ts', 'src/ai/policy-v2prod/item-tactics.ts'];
const report = { fixture, view: { x: 1100, y: 1100, width: 800, height: 800, zoom: 1 },
  method: 'Actual shared simulation and drawWorld Canvas fallback; not a WebGL screenshot.', samples: [] };
for (const [name, source] of [['before', beforeSource], ['after', afterSource]]) {
  const directory = resolve(source);
  const load = file => import(pathToFileURL(resolve(directory, file)).href);
  const [{ sketchScene }, sim, recorder, world, { UnitFacingTracker }, { createI18n }, { GUARDIAN_SCROLL }, { RULES_VERSION }] = await Promise.all([
    load('src/sdk/scene.ts'), load('src/shared/sim.ts'), load('src/recorder/record.ts'), load('src/client/world-renderer.ts'),
    load('src/client/unit-facing.ts'), load('src/client/i18n.ts'), load('src/shared/item-rules.ts'), load('src/shared/rules-version.ts'),
  ]);
  recorder.installHeadlessCanvas();
  let scene = sketchScene('guardian-scroll-area-visual').map('bareDuel').replaceDefaults().player('player')
    .unit('player', 'worker', 1500, 1500, { id: 'carrier' })
    .item('scroll', 'guardianScroll', 0, 0, { carrierId: 'carrier' });
  for (const actor of fixture) scene = scene.unit('player', 'footman', actor.x, actor.y, { id: actor.id });
  const game = scene.build().createGame();
  sim.issueCommand(game, { type: 'useItem', unitId: 'carrier', itemId: 'scroll' });
  const snapshot = sim.snapshotGame(game), field = snapshot.effects.find(effect => effect.type === 'guardianField');
  const canvas = createCanvas(800, 860), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8e2ce'; ctx.fillRect(0, 0, 800, 860);
  ctx.save(); ctx.translate(0, 60);
  world.drawWorld({ ctx, snapshot, view: report.view, now: 0, facing: new UnitFacingTracker(),
    labels: world.worldLabelsFor(createI18n('en')), viewer: 'player', selectedIds: new Set(), reducedMotion: true });
  // Tiny crosses locate the centers used by the simulation. Body drawings
  // include authored height/foot offsets and are not the selection test.
  for (const actor of fixture) {
    const unit = snapshot.units.find(unit => unit.id === actor.id), guarded = unit.effects.some(effect => effect.type === 'guardian');
    const x = unit.x - report.view.x, y = unit.y - report.view.y;
    ctx.strokeStyle = '#735431'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke();
    ctx.fillStyle = guarded ? '#335d40' : '#993d38'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${actor.distance}: ${guarded ? 'PROTECTED' : 'OUTSIDE'}`, x, y + (actor.id.endsWith('inner') ? 72 : 48));
  }
  ctx.restore(); ctx.fillStyle = '#2e3730'; ctx.font = '19px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`${name.toUpperCase()} | rules ${RULES_VERSION} | radius ${GUARDIAN_SCROLL.radius} | duration 7s | price 200`, 18, 29);
  ctx.font = '12px sans-serif'; ctx.fillText('Same positions, cast-time snapshot and camera. Crosses mark simulation selection centers.', 18, 49);
  const image = canvas.toBuffer('image/png'); writeFileSync(resolve(output, `${name}.png`), image);
  const raw = JSON.stringify(snapshot); writeFileSync(resolve(output, `${name}-snapshot.json`), raw);
  const { planItemCommands } = await load('src/ai/policy/item-tactics.ts');
  const diagnostic = sketchScene('guardian-unchanged-ai-heuristic').map('bareDuel').replaceDefaults()
    .player('player').player('enemy')
    .unit('player', 'archer', 1500, 1500, { id: 'ai-carrier' })
    .unit('player', 'archer', 1255, 1500, { id: 'ai-245' })
    .unit('player', 'archer', 1500, 1750, { id: 'ai-250' })
    .unit('player', 'archer', 1500, 1245, { id: 'ai-255' })
    .unit('enemy', 'archer', 1735, 1430).unit('enemy', 'archer', 1735, 1500).unit('enemy', 'archer', 1735, 1570)
    .item('ai-scroll', 'guardianScroll', 0, 0, { carrierId: 'ai-carrier' }).build().createGame();
  const diagnosticBefore = sim.snapshotGame(diagnostic);
  const aiCommands = planItemCommands(diagnosticBefore, 'player', { version: 'v9_archer', teams: diagnostic.teams });
  for (const command of aiCommands) sim.issueCommand(diagnostic, command);
  const diagnosticAfter = sim.snapshotGame(diagnostic);
  const aiRecipients = diagnosticAfter.units.filter(unit => unit.effects.some(effect => effect.type === 'guardian')).map(unit => unit.id).sort();
  writeFileSync(resolve(output, `${name}-ai-diagnostic.json`), `${JSON.stringify({
    before: diagnosticBefore, commands: aiCommands, after: diagnosticAfter,
    protected: aiRecipients, estimatedNearbyAlliesAt260: 4,
  }, null, 2)}\n`);
  report.samples.push({ name, source: directory, headCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
    trackedSourceDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'src'], { cwd: directory })).digest('hex'),
    rulesVersion: RULES_VERSION, radius: GUARDIAN_SCROLL.radius, field,
    sourceSha256: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(resolve(directory, file))).digest('hex')])),
    snapshotSha256: createHash('sha256').update(raw).digest('hex'), pngSha256: createHash('sha256').update(image).digest('hex'),
    recipients: snapshot.units.filter(unit => unit.effects.some(effect => effect.type === 'guardian')).map(unit => unit.id).sort(),
    unchangedAiDiagnostic: { commands: aiCommands, estimatedNearbyAlliesAt260: 4, actualRecipients: aiRecipients } });
}
writeFileSync(resolve(output, 'visual-proof.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.samples.map(({ name, rulesVersion, radius, recipients }) => ({ name, rulesVersion, radius, recipients })), null, 2));
