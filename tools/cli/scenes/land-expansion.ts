import type { Scene } from '../drivers/browser';
import { pathToFileURL } from 'node:url';
export default async function(s: Scene) {
  const load=(p:string)=>import(pathToFileURL(`${process.cwd()}/${p}`).href);
  const {createSubjectGauntletInput}=await load('src/ai/benchmark/subject-gauntlet.ts');
  const {roomGauntlet}=await load('src/ai/benchmark/room-gauntlet.ts');
  const {runGameLoop}=await load('src/sdk/game-runner.ts');
  const {navalObservedPlanner}=await load('src/ai/benchmark/naval-room-worker.ts');
  const {input}=createSubjectGauntletInput(roomGauntlet('v9_archer',['v9']),{seed:'v5-final-1',mapCount:20});
  const match=input.evaluations[0].matches[28];
  // The room API uses its public player IDs. Replay a genuine room-AI-versus-v9 game with these IDs on the same map.
  match.agents={player:match.agents.v9_archer,enemy:match.agents.p1};
  const frames=new Map<number,any[]>(),expected=new Map<number,any>(),targets=[4800,8200];
  runGameLoop({...match,maxTicks:8200,commandPlanner:navalObservedPlanner({})},{
    onCommand(e:any){if(!frames.has(e.tick))frames.set(e.tick,[]);frames.get(e.tick)!.push({playerId:e.owner,command:e.command});},
    onStep({game}:any){if(targets.includes(game.tick))expected.set(game.tick,structuredClone({tick:game.tick,units:game.units,buildings:game.buildings,resources:game.resources,players:game.players}));}
  });
  const fingerprint=(w:any)=>JSON.stringify({tick:w.tick,units:w.units.map((u:any)=>[u.id,u.kind,u.owner,u.x,u.y,u.hp]).sort(),buildings:w.buildings.map((b:any)=>[b.id,b.owner,b.kind,b.x,b.y,b.hp,b.complete]).sort(),resources:w.resources.map((r:any)=>[r.id,r.amount]).sort(),gold:Object.fromEntries(Object.entries(w.players).map(([id,p]:any)=>[id,p.gold]))});
  const host=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('sketch-rts-user')!));
  const created:any=await s.api('/api/rooms',{host,mapId:'ladder',layoutSeed:match.options.layout.seed,visibility:'private',humanCount:1,aiCount:1,seatSetup:[{controller:'human',team:'team-1',race:'grove'},{controller:'ai',team:'team-2',race:'ember',aiVersion:'v9_knight'}]});
  const roomId=created.id;
  await s.api(`/api/rooms/${roomId}/start`,{userId:host.id});
  await s.api(`/api/rooms/${roomId}/pause`,{});
  const roomUrl=new URL(`?room=${roomId}`,s.page.url()).href;
  const reload=async(target:number)=>{await s.page.goto(roomUrl,{waitUntil:'load'});await s.page.waitForFunction((t:number)=>((window as any).__sketchRtsView?.tick??-1)>=t,target,{timeout:120000});await s.page.waitForFunction(()=>!!(window as any).__sketchRtsDebug?.ready(),null,{timeout:120000});
    // Match the CLI driver's normal settle(): its pointer-lock guide must not cover the replay's mining site.
    await s.page.addStyleTag({content:'[data-pointer-lock-gate]{display:none!important}'});
  };
  await s.api(`/api/rooms/${roomId}/reset`,{mapId:'ladder',options:{...match.options,players:['player','enemy'],aiPlayers:[],teams:{player:'v9_archer-side',enemy:'rivals'},races:{player:'grove',enemy:'ember'}}});
  await reload(0);
  const samples:any[]=[];
  let current=0;
  for(const target of targets){
    for(const [tick,commands]of frames){
      if(tick<current||tick>=target)continue;
      if(tick>current)await s.api(`/api/rooms/${roomId}/tick`,{ticks:tick-current});
      await s.api(`/api/rooms/${roomId}/command-tick`,{commands,ticks:1});current=tick+1;
    }
    if(current<target)await s.api(`/api/rooms/${roomId}/tick`,{ticks:target-current});current=target;
    await reload(target);
    const world:any=await s.api(`/api/rooms/${roomId}/snapshot`);
    s.must(fingerprint(world)===fingerprint(expected.get(target)),`browser room differs from real SDK match at ${target}`);
    const halls=world.buildings.filter((b:any)=>b.owner==='player'&&b.kind==='townHall');
    samples.push({tick:target,halls:halls.map((b:any)=>({id:b.id,x:b.x,y:b.y,complete:b.complete,hp:b.hp}))});
    await s.camera(target===4800?3620:2920,target===4800?1950:3400,.7);await s.wait(5000);
    const focus=halls.find((b:any)=>Math.hypot(b.x-(target===4800?3696:2960),b.y-(target===4800?2000:3600))<100);if(focus)await s.select([focus.id]);
    const name=target===4800?'natural-at-four-minutes':'third-at-six-fifty';
    await s.shot(name);
    // Native browser JPEG previews fit the PR's file limit; retain the original PNGs in the evidence archive.
    const output=JSON.parse(process.argv[2]!).out;
    await s.page.screenshot({path:`${output}/${name}.jpg`,type:'jpeg',quality:82});
  }
  s.record('real-match-expansion',{seed:'v5-final-1',slot:'ladder-16',subject:'v9_archer grove',rival:'v9 ember',owners:'public room IDs player/enemy; exact SDK replay checked',samples});
}
