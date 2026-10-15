import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { unitControlsMercenaryCamp } from '../../shared/mercenary-camp';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { mercenaryControl } from './mercenary-control';
import { bootstrapPolicyContext, BOOTSTRAP_VERSIONS } from './policy';

const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-mercenary-camp-entry-6270.json.gz', import.meta.url))).toString());
const courierId = 'unit-p0-archer-1347', ogreId = 'creep-gen-7-1';
const load = (checkpoint = saved) => {
  const copy = structuredClone(checkpoint), game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, copy.snapshot, copy.nextId);
  return { game, memories: copy.memories };
};

it.each(BOOTSTRAP_VERSIONS)('%s keeps the real safe buying walk through the hire-circle edge', version => {
  const { game, memories } = load(), snapshot = snapshotGame(game);
  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(saved.snapshot);
  const unit = snapshot.units.find(unit => unit.id === courierId)!, camp = snapshot.mercenaryCamps.find(camp => camp.id === memories.p0.mercenaryCourier.campId)!;
  expect(unitControlsMercenaryCamp(unit, camp)).toBe(true);
  expect(Math.hypot(unit.x - camp.x, unit.y - camp.y)).toBeGreaterThan(270);
  const ogre = snapshot.units.find(unit => unit.id === ogreId)!;
  expect(Math.hypot(unit.x - ogre.x, unit.y - ogre.y)).toBeLessThan(unit.attackRange);
  const before = JSON.stringify(snapshot), options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: memories.p0, teams: game.teams });
  expect(mercenaryControl.claimsUnits!(snapshot, 'p0', options).has(courierId)).toBe(true);
  expect(mercenaryControl.run(snapshot, 'p0', options).some(command => 'unitIds' in command && command.unitIds.includes(courierId))).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(memories.p1).toEqual(saved.memories.p1);
  expect(memories.p2).toEqual(saved.memories.p2);
});

// This isolates the real courier owner's native execution. The separate
// all-policy continuation records its effect in the ordinary match state.
it('keeps walking out of automatic fire range without pulling the ogre and restores the complete JSON component state', () => {
  const outputs = [];
  for (const resume of [false, true]) {
    let branch = load();
    const hits: string[] = [];
    const observe = () => { branch.game.observer = { hit(source, target) {
      if (source.id === courierId || target.id === courierId) hits.push(`${source.id}:${target.id}`);
    } }; };
    observe();
    while (branch.game.tick < 6510) {
      const { game, memories } = branch;
      if (game.tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory: memories.p0, teams: game.teams });
        issueCommandFrame(game, mercenaryControl.run(snapshot, 'p0', options)
          .map(command => ({ playerId: 'p0', scriptId: 'mercenaryControl', command })));
      }
      stepGame(game);
      if (resume && game.tick === 6330) {
        const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId, memories }));
        branch = load(checkpoint); observe();
        expect(JSON.parse(JSON.stringify(snapshotGame(branch.game)))).toEqual(checkpoint.snapshot);
        expect(branch.game.nextId).toBe(checkpoint.nextId);
        expect(branch.memories).toEqual(checkpoint.memories);
      }
    }
    const unit = branch.game.units.find(unit => unit.id === courierId)!;
    expect(unit).toBeDefined(); expect(unit.hp).toBe(83);
    expect(unitControlsMercenaryCamp(unit, branch.game.mercenaryCamps.find(camp => camp.id === 'merc-gen-2')!)).toBe(true);
    const ogre = branch.game.units.find(unit => unit.id === ogreId)!;
    expect(Math.hypot(unit.x - ogre.x, unit.y - ogre.y)).toBeGreaterThan(unit.attackRange);
    expect(hits).toEqual([]);
    expect(ogre.hp).toBe(178);
    outputs.push(JSON.parse(JSON.stringify({ snapshot: snapshotGame(branch.game), nextId: branch.game.nextId, memories: branch.memories })));
  }
  expect(outputs[1]).toEqual(outputs[0]);
});
