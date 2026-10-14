import {afterEach,describe,it,expect,vi} from 'vitest';
import {ResourceLoader} from './resources';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

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
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({cache:'no-cache',signal:expect.any(AbortSignal)});
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
  it('refreshes version and size indices and does not retain manifest or browser-owned warm buffers',async()=>{
    let revision='first';
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('.json')?new Response(JSON.stringify({assets:[
      {url:'art/ship.glb',bytes:revision==='first'?6:9,kind:'model',stage:'lazy',revision},
      {url:'assets/world.js',bytes:4,kind:'code',stage:'renderer'},
    ]})):new Response(new Uint8Array(4)));
    const loader=new ResourceLoader('/game/',fetcher);await loader.initialize();
    expect(loader.size('/game/art/ship.glb?v=first')).toBe(6);
    expect(loader.cacheStats().retainedBytes).toBe(0);
    await loader.warm('renderer','home');await loader.warm('renderer','match');
    expect(fetcher).toHaveBeenCalledTimes(2);expect(loader.cacheStats().retainedBytes).toBe(0);
    expect(loader.summary('match')).toMatchObject({ready:1,loaded:4,reused:4});
    revision='second';await loader.initialize();
    expect(fetcher).toHaveBeenCalledTimes(3);expect(loader.url('art/ship.glb')).toBe('/game/art/ship.glb?v=second');
    expect(loader.size('/game/art/ship.glb?v=second')).toBe(9);expect(loader.size('/game/art/ship.glb?v=first')).toBeUndefined();
  });
  it('retains a warmed image only until decoding and shares the decoded result across phases',async()=>{
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('.json')?new Response(JSON.stringify({assets:[{url:'art/ship.png',bytes:6,kind:'texture',stage:'lazy',revision:'a'}]})):new Response(new Uint8Array(6)));
    const bitmap={close:vi.fn()} as unknown as ImageBitmap,decode=vi.fn(async()=>bitmap);vi.stubGlobal('createImageBitmap',decode);
    const loader=new ResourceLoader('/game/',fetcher);await loader.initialize();await loader.warm('lazy','home');
    expect(loader.cacheStats().retainedBytes).toBe(6);
    const url=loader.url('art/ship.png'),home=loader.image(url,'ship','home'),match=loader.image(url,'ship','match');
    expect(await home).toBe(bitmap);expect(await match).toBe(bitmap);
    expect(await loader.image(url,'ship','startup')).toBe(bitmap);
    expect(fetcher).toHaveBeenCalledTimes(2);expect(decode).toHaveBeenCalledTimes(1);
    expect(loader.cacheStats()).toMatchObject({retainedBytes:0,requests:0,images:1});
    expect(loader.summary('match')).toMatchObject({ready:1,loaded:6,total:6,reused:6});
    loader.dispose();loader.dispose();expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
  it('scopes released bytes to their original request and keeps pending consumers shared',async()=>{
    let answer!:(response:Response)=>void;
    const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{answer=resolve;})),loader=new ResourceLoader('/',fetcher);
    const first=loader.bytes('/ship','ship','home');loader.releaseBytes('/ship',first);
    expect(loader.bytes('/ship','ship','match')).toBe(first);
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));answer(new Response(new Uint8Array(3)));await first;
    loader.releaseBytes('/ship',first);expect(loader.cacheStats().retainedBytes).toBe(0);
    const next=loader.bytes('/ship');await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));answer(new Response(new Uint8Array(4)));await next;
    loader.releaseBytes('/ship',first);expect(loader.bytes('/ship')).toBe(next);expect(loader.cacheStats().retainedBytes).toBe(4);
    loader.dispose();
  });
  it('aborts active streams and drains queued slots without fetching canceled work on teardown',async()=>{
    const signals:AbortSignal[]=[],fetcher=vi.fn(async(_url:RequestInfo|URL,options?:RequestInit)=>{
      signals.push(options!.signal!);return new Response(new ReadableStream<Uint8Array>({start(){}}));
    });
    const loader=new ResourceLoader('/',fetcher),work=Array.from({length:8},(_,i)=>loader.bytes(`/ship-${i}`).then(()=>true,()=>false));
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(4));loader.dispose();
    expect(signals.every(signal=>signal.aborted)).toBe(true);
    expect(await Promise.all(work)).toEqual(Array(8).fill(false));expect(fetcher).toHaveBeenCalledTimes(4);
    expect(loader.cacheStats()).toEqual({requests:0,images:0,retainedBytes:0,active:0,queued:0});expect(loader.entries.size).toBe(0);
  });
  it('closes a bitmap that finishes decoding after disposal and permits a fresh generation',async()=>{
    const stale={close:vi.fn()} as unknown as ImageBitmap,fresh={close:vi.fn()} as unknown as ImageBitmap;
    let finish!:(bitmap:ImageBitmap)=>void;
    const decode=vi.fn().mockImplementationOnce(()=>new Promise<ImageBitmap>(resolve=>{finish=resolve;})).mockResolvedValueOnce(fresh);
    vi.stubGlobal('createImageBitmap',decode);
    const loader=new ResourceLoader('/',vi.fn(async()=>new Response(new Uint8Array(3))));
    const old=loader.image('/ship').catch(error=>error);await vi.waitFor(()=>expect(decode).toHaveBeenCalledTimes(1));loader.dispose();
    const current=loader.image('/ship');expect(await current).toBe(fresh);finish(stale);
    expect(await old).toMatchObject({message:'Resource loader was disposed'});expect(stale.close).toHaveBeenCalledTimes(1);
    expect(await loader.image('/ship')).toBe(fresh);expect(loader.cacheStats()).toMatchObject({images:1,retainedBytes:0});
    loader.dispose();expect(fresh.close).toHaveBeenCalledTimes(1);
  });
  it('coalesces streaming notifications, records new phases once, and cancels pending progress notifications',async()=>{
    vi.useFakeTimers();let stream!:ReadableStreamDefaultController<Uint8Array>;
    const loader=new ResourceLoader('/',vi.fn(async()=>new Response(new ReadableStream({start(controller){stream=controller;}})))),changed=vi.fn();loader.subscribe(changed);
    const request=loader.bytes('/ship','ship','home');
    await vi.waitFor(()=>expect(stream).toBeDefined());expect(changed).toHaveBeenCalledTimes(1);
    for(let i=0;i<200;i++)stream.enqueue(new Uint8Array(1));
    await vi.waitFor(()=>expect(loader.summary('home').loaded).toBe(200));
    // Progress flushes at most once per 32 ms; final state is a microtask.
    expect(changed.mock.calls.length).toBeLessThan(5);stream.close();await request;
    const finished=changed.mock.calls.length;
    loader.bytes('/ship','ship','home');await Promise.resolve();expect(changed).toHaveBeenCalledTimes(finished);
    loader.bytes('/ship','ship','match');await Promise.resolve();expect(changed).toHaveBeenCalledTimes(finished+1);
    const previous=stream,pending=loader.bytes('/next').catch(()=>{});await vi.waitFor(()=>expect(stream).not.toBe(previous));stream.enqueue(new Uint8Array(1));
    await Promise.resolve();loader.dispose();const disposed=changed.mock.calls.length;await pending;await vi.advanceTimersByTimeAsync(100);
    expect(changed).toHaveBeenCalledTimes(disposed);
  });
});
