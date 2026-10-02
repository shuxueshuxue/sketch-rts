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
        melee: { clip: { file: "hit.ogg", url: "/packs/hit.ogg", volume: 0.5, pitch: 0.1 }, kinds: {}, max: 2 },
        click: { clip: { file: "click.ogg", url: "/packs/click.ogg", volume: 1, pitch: 0 }, kinds: {}, max: 4 },
      },
    });
  });

  it("reads an event sounded per unit kind, each kind's clip taking the event's volume and pitch unless it gives its own", () => {
    const pack = readSoundPack(
      "test",
      { name: "Test", sounds: { melee: { volume: 0.8, pitch: 0.05, max: 3, kinds: { footman: { file: "sword.ogg" }, golem: { file: "rock.ogg", volume: 1.2 } } } } },
      urls(["sword.ogg", "rock.ogg"]),
    );
    expect(pack.sounds.melee).toEqual({
      kinds: {
        footman: { file: "sword.ogg", url: "/packs/sword.ogg", volume: 0.8, pitch: 0.05 },
        golem: { file: "rock.ogg", url: "/packs/rock.ogg", volume: 1.2, pitch: 0.05 },
      },
      max: 3,
    });
  });

  it("turns away a pack that does not hold, saying what is wrong", () => {
    const files = urls(["hit.ogg"]);
    expect(() => readSoundPack("p", { sounds: {} }, files)).toThrow("Sound pack p: pack.json needs a name and sounds");
    expect(() => readSoundPack("p", { name: "P", sounds: { roar: { file: "hit.ogg" } } }, files)).toThrow("no event roar");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: {} } }, files)).toThrow("melee needs a file or kinds");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "gone.ogg" } } }, files)).toThrow("melee plays gone.ogg, which is not in the pack");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { kinds: { footmen: { file: "hit.ogg" } } } } }, files)).toThrow("melee names no unit kind footmen");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { kinds: { footman: { file: "gone.ogg" } } } } }, files)).toThrow("melee.footman plays gone.ogg");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "hit.ogg", volume: 0 } } }, files)).toThrow("melee volume");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "hit.ogg", pitch: 0.9 } } }, files)).toThrow("melee pitch");
    expect(() => readSoundPack("p", { name: "P", sounds: { melee: { file: "hit.ogg", max: 1.5 } } }, files)).toThrow("melee max");
  });

  it("carries a cc0 pack whose sounds are all events, holding exactly the files it plays", () => {
    const files = readdirSync(packDir).filter((file) => file !== "pack.json");
    const pack = readSoundPack("cc0", JSON.parse(readFileSync(join(packDir, "pack.json"), "utf8")), urls(files));
    expect(Object.keys(pack.sounds).every((event) => SOUND_EVENTS.includes(event as never))).toBe(true);
    expect(Object.values(pack.sounds).map((sound) => sound.clip?.file).sort()).toEqual(files.sort());
  });
});
