import { afterEach, describe, expect, it, vi } from "vitest";
import { readSoundPack, Soundboard } from "./sound";
import { resources } from './resources';

afterEach(() => {resources.dispose();vi.unstubAllGlobals();vi.restoreAllMocks();});

function audioContext(){
  const nodes:{disconnect:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;buffer:AudioBuffer|null;onended:(()=>void)|null}[]=[],sources:typeof nodes=[];
  const node=()=>{
    const result={gain:{value:1},pan:{value:0},threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0},playbackRate:{value:1},buffer:null as AudioBuffer|null,onended:null as (()=>void)|null,
      connect(){return this;},disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};nodes.push(result);return result;
  };
  const context={currentTime:0,state:'running',destination:node(),createGain:node,createStereoPanner:node,createDynamicsCompressor:node,
    createBufferSource:()=>{const source=node();sources.push(source);return source;},decodeAudioData:vi.fn(async()=>({duration:.2}) as AudioBuffer),close:vi.fn(async()=>{}),resume:vi.fn(async()=>{})};
  const construct=vi.fn(function(){return context;});vi.stubGlobal('window',{AudioContext:construct});return{context,nodes,sources,construct};
}
function effectPack(){return readSoundPack('demo',{name:'Demo',sounds:{melee:{file:'hit.ogg'}}},{'hit.ogg':'/hit.ogg'});}

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
    expect(resources.cacheStats().retainedBytes).toBe(0);
  });
  it('keeps UI voices on stopEffects and releases every source, graph and decoded buffer on disposal',async()=>{
    const audio=audioContext(),fetcher=vi.fn(async()=>new Response(new Uint8Array(3)));vi.stubGlobal('fetch',fetcher);
    const pack=readSoundPack('demo',{name:'Demo',sounds:{click:{file:'click.ogg'},melee:{file:'hit.ogg'}}},{'click.ogg':'/click.ogg','hit.ogg':'/hit.ogg'}),board=new Soundboard([pack],'demo');
    board.unlock();await board.prepareMatch();board.play('click');board.play('melee');
    expect(audio.sources).toHaveLength(2);board.stopEffects();
    expect(audio.sources[0]!.stop).not.toHaveBeenCalled();expect(audio.sources[1]!.stop).toHaveBeenCalledTimes(1);
    expect(audio.sources[1]!.disconnect).toHaveBeenCalledTimes(1);expect(audio.sources[1]!.buffer).toBeNull();
    board.dispose();board.dispose();board.unlock();board.play('click');board.addPacks([pack]);
    expect(audio.sources[0]!.stop).toHaveBeenCalledTimes(1);expect(audio.sources[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.context.close).toHaveBeenCalledTimes(1);expect(audio.construct).toHaveBeenCalledTimes(1);
    expect(audio.sources.every(source=>source.buffer===null&&source.onended===null)).toBe(true);
    expect(resources.cacheStats().retainedBytes).toBe(0);expect(audio.sources).toHaveLength(2);
  });
  it('discards pending decode results after disposal without playing or reopening audio',async()=>{
    const audio=audioContext();let finish!:(buffer:AudioBuffer)=>void;
    audio.context.decodeAudioData.mockImplementation(()=>new Promise<AudioBuffer>(resolve=>{finish=resolve;}));
    const fetcher=vi.fn(async()=>new Response(new Uint8Array(3)));vi.stubGlobal('fetch',fetcher);
    const board=new Soundboard([effectPack()],'demo');board.unlock();board.play('melee');
    await vi.waitFor(()=>expect(audio.context.decodeAudioData).toHaveBeenCalledTimes(1));board.dispose();finish({duration:1} as AudioBuffer);
    await vi.waitFor(()=>expect(resources.cacheStats().retainedBytes).toBe(0));
    board.unlock();board.play('melee');await board.prepareMatch();
    expect(audio.sources).toHaveLength(0);expect(audio.construct).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not start a late shared download decode after its board is disposed',async()=>{
    const audio=audioContext();let finish!:(response:Response)=>void;
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
    const board=new Soundboard([effectPack()],'demo');board.unlock();board.play('melee');await vi.waitFor(()=>expect(finish).toBeDefined());
    board.dispose();finish(new Response(new Uint8Array(3)));await vi.waitFor(()=>expect(resources.cacheStats().requests).toBe(0));
    expect(audio.context.decodeAudioData).not.toHaveBeenCalled();expect(audio.sources).toHaveLength(0);
  });
  it('backs off a failed optional clip and retries it on match preparation',async()=>{
    const audio=audioContext(),fetcher=vi.fn().mockResolvedValueOnce(new Response('missing',{status:503})).mockResolvedValueOnce(new Response(new Uint8Array(3)));vi.stubGlobal('fetch',fetcher);
    const board=new Soundboard([effectPack()],'demo');board.unlock();board.play('melee');
    await vi.waitFor(()=>expect(resources.summary('match').failed).toBe(1));
    for(let i=0;i<20;i++)board.play('melee');expect(fetcher).toHaveBeenCalledTimes(1);
    await board.prepareMatch();expect(fetcher).toHaveBeenCalledTimes(2);board.play('melee');expect(audio.sources).toHaveLength(1);
    expect(resources.cacheStats().retainedBytes).toBe(0);board.dispose();
  });
});
