import {describe,it,expect,vi} from 'vitest';
import {ResourceLoader} from './resources';

describe('staged byte loading',()=>{
  it('reports unknown totals while streaming, then exact bytes; a shared asset is fetched once across phases',async()=>{
    let stream!:ReadableStreamDefaultController<Uint8Array>;
    const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(controller){stream=controller;}})));
    const loader=new ResourceLoader('/game/',fetcher);
    const home=loader.bytes('/game/ship.glb','ship','home');
    const match=loader.bytes('/game/ship.glb','ship','match');
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    expect(loader.summary('home').unknown).toBe(true);
    stream.enqueue(new Uint8Array([1,2,3]));await vi.waitFor(()=>expect(loader.summary('home').loaded).toBe(3));
    stream.enqueue(new Uint8Array([4,5]));stream.close();
    expect(new Uint8Array(await home)).toEqual(new Uint8Array([1,2,3,4,5]));expect(await match).toBe(await home);
    expect(loader.summary('match')).toMatchObject({loaded:5,total:5,unknown:false,reused:5,ready:1});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses manifest sizes for decompressed bytes, versions models, and always revalidates the manifest',async()=>{
    const fetcher=vi.fn(async(url:RequestInfo|URL,_options?:RequestInit)=>String(url).endsWith('json')?new Response(JSON.stringify({assets:[{url:'art/ship.glb',bytes:6,kind:'model',stage:'lazy',revision:'abc'}]})):new Response(new Uint8Array(6),{headers:{'content-length':'2','content-encoding':'gzip'}}));
    const loader=new ResourceLoader('/game/',fetcher);await loader.initialize();
    expect(fetcher.mock.calls[0]?.[1]).toEqual({cache:'no-cache'});
    expect(loader.url('art/ship.glb')).toBe('/game/art/ship.glb?v=abc');
    await loader.bytes(loader.url('art/ship.glb'),'model','home');
    expect(loader.summary('home')).toMatchObject({loaded:6,total:6,unknown:false});
    await loader.warm('startup','startup');expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('bounds concurrent requests and releases failed slots so queued work and retry both complete',async()=>{
    const answers=new Map<string,(response:Response)=>void>();
    const fetcher=vi.fn((url:RequestInfo|URL)=>new Promise<Response>(resolve=>answers.set(String(url),resolve)));
    const loader=new ResourceLoader('/',fetcher);
    const work=Array.from({length:7},(_,i)=>loader.bytes(`/asset-${i}`,'asset','match').then(()=>true,()=>false));
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(4));
    answers.get('/asset-0')!(new Response('missing',{status:404}));
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(5));
    for(let i=1;i<4;i++)answers.get(`/asset-${i}`)!(new Response('ok'));
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(7));
    for(let i=4;i<7;i++)answers.get(`/asset-${i}`)!(new Response('ok'));
    expect(await Promise.all(work)).toEqual([false,true,true,true,true,true,true]);
    const retry=loader.bytes('/asset-0','asset','match');await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(8));answers.get('/asset-0')!(new Response('fixed'));await retry;
    expect(loader.summary('match').failed).toBe(0);
  });
});
