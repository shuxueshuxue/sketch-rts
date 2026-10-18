import { describe, expect, it, vi } from "vitest";
import { Soundboard } from "./sound";
import { servedSoundPacks } from "./sound-packs";

// A server's files by path, answered as fetch would (404 for the rest).
function server(files: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = String(input);
    return path in files ? new Response(JSON.stringify(files[path]), { status: 200 }) : new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("served sound packs", () => {
  it("loads the packs a server lists, its files fetched from the pack's folder, and its default", async () => {
    const served = await servedSoundPacks(
      "/game/",
      server({
        "/game/audio-packs/served.json": { packs: ["hall"], default: "hall" },
        "/game/audio-packs/hall/pack.json": { name: "Hall", sounds: { click: { file: "click.ogg" }, melee: { file: "hit.ogg", kinds: { footman: { file: "sword hit.ogg" } } } } },
      }),
    );
    expect(served.fallback).toBe("hall");
    expect(served.packs.map((pack) => pack.name)).toEqual(["Hall"]);
    const melee = served.packs[0]!.sounds.melee!;
    expect(melee.clip?.url).toBe("/game/audio-packs/hall/hit.ogg");
    expect(melee.kinds.footman?.url).toBe("/game/audio-packs/hall/sword%20hit.ogg");
  });

  it("offers nothing without a list, and leaves out a listed pack that does not read", async () => {
    expect(await servedSoundPacks("/", server({}))).toEqual({ packs: [] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const served = await servedSoundPacks("/", server({ "/audio-packs/served.json": { packs: ["gone", "../up"] } }));
    expect(served).toEqual({ packs: [] });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("adds voices and variants without changing the older core manifest", async () => {
    const served = await servedSoundPacks("/", server({
      "/audio-packs/served.json": { packs: ["war3"] },
      "/audio-packs/war3/pack.json": { name: "War3", sounds: { click: { file: "click.ogg" } } },
      "/audio-packs/war3/extras.json": { sounds: { order: { kinds: { warship: { file: "yes1.ogg", variants: ["yes2.ogg"] } } } } },
    }));
    expect(served.packs[0]!.sounds.order!.kinds.warship!.variants?.[0]?.url).toBe("/audio-packs/war3/yes2.ogg");
    expect(served.packs[0]!.sounds.click!.clip?.file).toBe("click.ogg");
  });

  it("keeps the core pack available when an optional supplement is invalid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const served = await servedSoundPacks("/", server({
      "/audio-packs/served.json": { packs: ["war3"] },
      "/audio-packs/war3/pack.json": { name: "War3", sounds: { click: { file: "click.ogg" } } },
      "/audio-packs/war3/extras.json": { sounds: { misspelledEvent: { file: "other.ogg" } } },
    }));
    expect(served.packs.map(pack => pack.id)).toEqual(["war3"]);
    expect(Object.keys(served.packs[0]!.sounds)).toEqual(["click"]);
    expect(error).toHaveBeenCalledWith("Sound pack war3: rejected extras.json; keeping pack.json", expect.any(Error));
    expect((error.mock.calls[0]![1] as Error).message).toContain("Sound pack war3: no event misspelledEvent");
    error.mockRestore();
  });

  it("loads naval launches alongside an older unit name in the same extras", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const served = await servedSoundPacks("/", server({
      "/audio-packs/served.json": { packs: ["war3"], default: "war3" },
      "/audio-packs/war3/pack.json": { name: "Warcraft III", sounds: { click: { file: "click.ogg" } } },
      "/audio-packs/war3/extras.json": { sounds: {
        spell: { kinds: { pyreCaller: { file: "summon.ogg" } } },
        cannonShot: { file: "cannon.ogg", volume: .8 },
        mortarShot: { file: "mortar.ogg", volume: .8 },
        grapeshotShot: { file: "cannon.ogg", volume: .7 },
      } },
    }));
    const sounds = served.packs[0]!.sounds;
    expect(sounds.spell!.kinds.summoner!.url).toBe("/audio-packs/war3/summon.ogg");
    expect(sounds.cannonShot!.clip!.volume).toBe(.8);
    expect(sounds.mortarShot!.clip!.url).toBe("/audio-packs/war3/mortar.ogg");
    expect(sounds.grapeshotShot!.clip!.volume).toBe(.7);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it.each([
    [{ sounds: { spell: { kinds: { unknownCaster: { file: "spell.ogg" } } } } }, "spell.kinds.unknownCaster names no unit kind unknownCaster"],
    [{ sounds: [] }, "extras.json.sounds must map events to sounds"],
  ])("reports a rejected supplement's pack, field and reason", async (extras, reason) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const served = await servedSoundPacks("/", server({
      "/audio-packs/served.json": { packs: ["war3"] },
      "/audio-packs/war3/pack.json": { name: "Warcraft III", sounds: { click: { file: "click.ogg" } } },
      "/audio-packs/war3/extras.json": extras,
    }));
    expect(Object.keys(served.packs[0]!.sounds)).toEqual(["click"]);
    expect(error).toHaveBeenCalledWith("Sound pack war3: rejected extras.json; keeping pack.json", expect.any(Error));
    expect((error.mock.calls[0]![1] as Error).message).toContain(`Sound pack war3: ${reason}`);
    error.mockRestore();
  });

  it("reports malformed extras JSON while keeping the core pack", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = server({
      "/audio-packs/served.json": { packs: ["war3"] },
      "/audio-packs/war3/pack.json": { name: "Warcraft III", sounds: { click: { file: "click.ogg" } } },
    });
    const served = await servedSoundPacks("/", ((input: string | URL | Request) => String(input).endsWith("extras.json") ? Promise.resolve(new Response("{")) : load(input)) as typeof fetch);
    expect(Object.keys(served.packs[0]!.sounds)).toEqual(["click"]);
    expect(error).toHaveBeenCalledWith("Sound pack war3: could not read extras.json; keeping pack.json", expect.any(SyntaxError));
    error.mockRestore();
  });

  it("plays the server's default only while neither the build nor the player has named one", async () => {
    const pack = (id: string) => ({ id, name: id, sounds: {} });
    const plain = new Soundboard([]);
    plain.settings = { effects: 1, ui: 1, muted: false };
    plain.addPacks([pack("hall")], "hall");
    expect(plain.pack?.id).toBe("hall");

    const built = new Soundboard([pack("cc0")], "cc0");
    built.settings = { effects: 1, ui: 1, muted: false };
    built.addPacks([pack("hall")], "hall");
    expect(built.pack?.id).toBe("cc0");

    const chosen = new Soundboard([]);
    chosen.settings = { effects: 1, ui: 1, muted: false, pack: "none" };
    chosen.addPacks([pack("hall")], "hall");
    expect(chosen.pack).toBeUndefined();
  });
});
