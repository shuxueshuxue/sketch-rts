import { afterEach, describe, expect, it, vi } from "vitest";
import { readSoundPack, Soundboard } from "./sound";

afterEach(() => vi.unstubAllGlobals());

describe("on-demand audio", () => {
  it("does not preload per-unit voices and shares overlapping downloads and decodes", async () => {
    const starts = vi.fn();
    const node = () => ({
      gain: { value: 1 }, pan: { value: 0 }, threshold: { value: 0 }, knee: { value: 0 },
      ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, playbackRate: { value: 1 },
      connect() { return this; }, disconnect() {}, start: starts, stop() {},
    });
    const context = {
      currentTime: 0, state: "running", destination: node(),
      createGain: node, createStereoPanner: node, createBufferSource: node, createDynamicsCompressor: node,
      decodeAudioData: vi.fn(async () => ({ duration: .2 })),
    };
    class Context { constructor() { return context as unknown as Context; } }
    vi.stubGlobal("window", { AudioContext: Context });
    let answer!: (response: Response) => void;
    const request = vi.fn(() => new Promise<Response>(resolve => { answer = resolve; }));
    vi.stubGlobal("fetch", request);
    const pack = readSoundPack("demo", { name: "Demo", sounds: { melee: { kinds: { footman: { file: "hit.ogg" } } } } }, { "hit.ogg": "/hit.ogg" });
    const board = new Soundboard([pack], "demo");
    board.unlock();
    expect(request).not.toHaveBeenCalled();
    board.play("melee", undefined, "footman"); board.play("melee", undefined, "footman");
    await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
    answer(new Response(new Uint8Array([1,2,3])));
    await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(2));
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
  });
});
