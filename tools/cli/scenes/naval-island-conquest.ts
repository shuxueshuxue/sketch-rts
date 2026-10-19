import type { Scene } from '../drivers/browser';
export default async function(s: Scene) {
  const host={id:'afk-human',name:'AFK human'};
  await s.page.evaluate(host=>localStorage.setItem('sketch-rts-user',JSON.stringify(host)),host);
  const room:any=await s.api('/api/rooms',{id:'corner-intent-ringwater',host,mapId:'ringwater',visibility:'private',humanCount:1,aiCount:3});
  await s.api(`/api/rooms/${room.id}/start`,{userId:host.id});
  await s.api(`/api/rooms/${room.id}/pause`,{});
  const url=new URL(`?room=${room.id}`,s.page.url()).href;
  const samples:any[]=[];
  for(const second of [600,750,900]){
    const target=second*20;
    let world:any=await s.api(`/api/rooms/${room.id}/snapshot`);
    while(world.tick<target){await s.api(`/api/rooms/${room.id}/tick`,{ticks:Math.min(600,target-world.tick)});world=await s.api(`/api/rooms/${room.id}/snapshot`);}
    await s.page.goto(url,{waitUntil:'load'});
    await s.page.waitForFunction((t:number)=>((window as any).__sketchRtsView?.tick??-1)>=t,target,{timeout:180000});
    await s.page.waitForFunction(()=>!!(window as any).__sketchRtsDebug?.ready(),null,{timeout:120000});
    await s.page.addStyleTag({content:'[data-pointer-lock-gate]{display:none!important}'});
    const mine=world.resources.find((m:any)=>m.id==='gold-gen-8');
    await s.camera(mine.x,mine.y,.8);await s.wait(3000);
    const hall=world.buildings.find((b:any)=>b.owner==='player-4'&&b.kind==='townHall'&&Math.hypot(b.x-mine.x,b.y-mine.y)<320);
    if(hall)await s.select([hall.id]);
    await s.shot(`native-island-${second}s`);
    const output=JSON.parse(process.argv[2]!).out;
    await s.page.screenshot({path:`${output}/native-island-${second}s.jpg`,type:'jpeg',quality:85});
    samples.push({second,snapshot:world,hall});
  }
  const final=samples.at(-1),hall=final.hall;
  s.must(hall?.complete,'native ringwater player-4 did not complete its island hall by 15 minutes');
  s.record('native-island-completion',{method:'One AFK human and three default room AIs; no commands, spawns, edits or resets.',samples});
}
