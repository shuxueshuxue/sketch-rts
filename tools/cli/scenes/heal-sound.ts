// Prepared for the reviewer to run on mac1. Uses disposable CC0-backed pack
// fixtures: it verifies real casts and Web Audio starts, without choosing or
// publishing the owner's eventual healing recording.
import type { Scene } from "../drivers/browser";
import { ABILITY_DEFS, UNIT_DEFS } from "../../../src/shared/catalog";
import type { UnitKind } from "../../../src/shared/types";

const healers = (Object.keys(UNIT_DEFS) as UnitKind[]).filter(kind => UNIT_DEFS[kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === "heal"));

export default async function (s: Scene) {
  // Access the dev module's real class; production intentionally has no such hook.
  await s.page.evaluate(`(async () => {
    const { Soundboard, readSoundPack } = await import('/src/client/sound.ts');
    const { SOUND_PACKS } = await import('/src/client/sound-packs.ts');
    const cc0 = SOUND_PACKS.find(pack => pack.id === 'cc0');
    const shared = cc0.sounds.click.clip, spell = cc0.sounds.melee.clip, priest = cc0.sounds.built.clip;
    const urls = Object.fromEntries([shared, spell, priest].map(clip => [clip.file, clip.url]));
    const fixtures = ['old', 'shared'].map(mode => readSoundPack('heal-check-' + mode, { name: mode, sounds: {
      ...(mode === 'shared' ? { heal: { file: shared.file, volume: .6, kinds: { priest: { file: priest.file } } } } : {}),
      spell: { file: spell.file, volume: .65, kinds: { priest: { file: priest.file, volume: .6 } } },
      melee: { file: priest.file },
    } }, urls));
    const evidence = window.__healSoundCheck = { fixtures, expected: { shared: shared.url, spell: spell.url, priest: priest.url }, calls: [], started: [] };
    const prepare = Soundboard.prototype.prepareMatch;
    Soundboard.prototype.prepareMatch = function (...args) { evidence.board = this; return prepare.apply(this, args); };
    const play = Soundboard.prototype.play;
    Soundboard.prototype.play = function (event, place, kind) {
      this.__healCheckKind = kind;
      evidence.calls.push({ event, kind, pack: this.pack?.id });
      return play.call(this, event, place, kind);
    };
    const playClip = Soundboard.prototype.playClip;
    Soundboard.prototype.playClip = function (event, sound, clip, buffer, place) {
      const before = this.voices, result = playClip.call(this, event, sound, clip, buffer, place);
      if (this.voices > before) evidence.started.push({ event, kind: this.__healCheckKind, url: clip.url, volume: clip.volume, state: this.ctx.state, pack: this.pack.id });
      return result;
    };
  })()`);
  await s.room("bareDuel");
  await s.key("Shift");
  const results: unknown[] = [];
  for (const mode of ["old", "shared"] as const) {
    await s.page.evaluate(`(async () => {
      const check = window.__healSoundCheck, board = check.board;
      if (!board) throw new Error('No real game Soundboard was captured');
      board.stopEffects(); board.addPacks(check.fixtures); board.update({ pack: 'heal-check-${mode}', muted: false, effects: 1 });
      await board.prepareMatch(); check.calls = []; check.started = [];
    })()`);
    const cast = healers.map((kind, index) => ({ id: `healer-${kind}`, kind, owner: "player", x: 1000 + index * 160, y: 1000, order: { type: "move", x: 1000 + index * 160, y: 1500 } }));
    const patients = cast.map(unit => ({ id: `patient-${unit.kind}`, kind: "footman", owner: "player", x: unit.x, y: 1080, hp: 10, order: { type: "hold", x: unit.x, y: 1080 } }));
    await s.scenario({ aiPlayers: [], scenario: { replaceDefaultUnits: true, addUnits: [...cast, ...patients,
      { id: "control-summoner", kind: "summoner", owner: "player", x: 1400, y: 900, order: { type: "move", x: 1400, y: 1400 } },
    ] } });
    await s.camera(1240, 1020);
    for (const kind of healers) {
      await s.page.evaluate("window.__healSoundCheck.board.stopEffects()");
      await s.order("player", { type: "cast", unitId: `healer-${kind}`, ability: "heal", targetId: `patient-${kind}` });
      await s.tick(3); await s.wait(250);
      const observed = await s.page.evaluate(`(() => {
        const check = window.__healSoundCheck, played = check.started.filter(row => row.event === 'heal' && row.kind === ${JSON.stringify(kind)}).at(-1);
        const expected = ${JSON.stringify(mode)} === 'shared' ? check.expected.shared : ${JSON.stringify(kind)} === 'priest' ? check.expected.priest : check.expected.spell;
        return { mode: ${JSON.stringify(mode)}, kind: ${JSON.stringify(kind)}, expected, played };
      })()`);
      s.must(observed.played?.url === observed.expected && observed.played?.state === "running", `${mode}: ${kind} did not start its expected healing clip: ${JSON.stringify(observed)}`);
      results.push(observed);
    }
    await s.page.evaluate("window.__healSoundCheck.board.stopEffects()");
    await s.order("player", { type: "cast", unitId: "control-summoner", ability: "summon", x: 1420, y: 940 });
    await s.tick(3); await s.wait(200);
    const control = await s.page.evaluate("window.__healSoundCheck.started.filter(row => row.kind === 'summoner').at(-1)");
    s.must(control?.event === "spell", `${mode}: summoning must remain a spell: ${JSON.stringify(control)}`);
    results.push({ mode, control });
    await s.shot(`healing-${mode}`);
  }
  s.record("heal-sound", { fixturesOnly: true, healers, results });
}
