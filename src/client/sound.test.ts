import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSoundPack, SOUND_EVENTS } from "./sound";

const packDir = join(process.cwd(), "audio-packs", "cc0");
const urls = (files: string[]) => Object.fromEntries(files.map((file) => [file, `/packs/${file}`]));

describe("sound packs", () => {
  it("reads a pack: each event's file, volume, pitch play and how many at once, with defaults", () => {
    const pack = readSoundPack("test", { name: "Test", sounds: { melee: { file: "hit.ogg", volume: 0.5, pitch: 0.1, max: 2 }, click: { file: "click.ogg" } } }, urls(["hit.ogg", "click.ogg"]));
    expect(pack).toEqual({
      id: "test",
      name: "Test",
      sounds: {
        melee: { file: "hit.ogg", volume: 0.5, pitch: 0.1, max: 2, url: "/packs/hit.ogg" },
        click: { file: "click.ogg", volume: 1, pitch: 0, max: 4, url: "/packs/click.ogg" },
      },
    });
  });

  it("turns away a pack that does not hold, saying what is wrong", () => {
    const files = urls(["hit.ogg"]);
    expect(() => readSoundPack("p", { sounds: {} }, files)).toThrow("Sound pack p: pack.json needs a name and sounds");
    expect(() => readSoundPack("p", { name: "P", sounds: { roar: { file: "hit.ogg" } } }, files)).toThrow("no event roar");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "gone.ogg" } } }, files)).toThrow("melee plays gone.ogg, which is not in the pack");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "hit.ogg", volume: 0 } } }, files)).toThrow("melee volume");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "hit.ogg", pitch: 0.9 } } }, files)).toThrow("melee pitch");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "hit.ogg", max: 1.5 } } }, files)).toThrow("melee max");
  });

  it("carries a cc0 pack with a sound for every event, holding exactly the files it plays", () => {
    const files = readdirSync(packDir).filter((file) => file !== "pack.json");
    const pack = readSoundPack("cc0", JSON.parse(readFileSync(join(packDir, "pack.json"), "utf8")), urls(files));
    expect(Object.keys(pack.sounds).sort()).toEqual([...SOUND_EVENTS].sort());
    expect(Object.values(pack.sounds).map((sound) => sound.file).sort()).toEqual(files.sort());
  });
});
