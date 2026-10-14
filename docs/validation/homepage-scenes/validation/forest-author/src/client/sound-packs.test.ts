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
    const served = await servedSoundPacks("/", server({
      "/audio-packs/served.json": { packs: ["war3"] },
      "/audio-packs/war3/pack.json": { name: "War3", sounds: { click: { file: "click.ogg" } } },
      "/audio-packs/war3/extras.json": { sounds: { misspelledEvent: { file: "other.ogg" } } },
    }));
    expect(served.packs.map(pack => pack.id)).toEqual(["war3"]);
    expect(Object.keys(served.packs[0]!.sounds)).toEqual(["click"]);
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
