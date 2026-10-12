/** Shared unit production and artwork through the actual local server and browser.
 * Run with: node scripts/art-gameplay-proof.mjs --suite shared-units --out docs/art/refactor/units/gameplay
 * The parent harness owns Chromium, real room UI entry, screenshots, cleanup and the report.
 */
import { createHash } from 'node:crypto';

export async function runSharedUnitProof(h) {
 const {api,origin,roomId,read,command,sessionId,click,clickAt,screenshot,until,delay,must,evidence,reload}=h;
 const kinds=['priest','summoner'],keys={priest:'P',summoner:'U'},names={priest:/Priest|牧师/,summoner:/Summoner|召唤师/};
 const oldKinds=['emberAcolyte','pyreCaller'];
 const catalog=await api('/api/catalog');
 must(oldKinds.every(kind=>!catalog.units.includes(kind)),'removed unit still exposed by real server catalog');
 evidence.sharedUnits={catalog:catalog.units,byRace:{},artworkHashes:{}};
 evidence.harnessAdjustments.push('Shared-unit suite seeds ordinary complete buildings and 10 farms on legal open ground; initial gold is the server default with the existing reset API; training runs at the normal simulation tick rate.');
 const snap=()=>api(`/api/rooms/${roomId}/snapshot`);
 async function focus(id) {
  const state=await snap(),entity=[...state.units,...state.buildings].find(unit=>unit.id===id);
  must(entity,`missing focus entity ${id}`);
  const at=await read(`(()=>{const frame=document.querySelector('[data-minimap-frame]'),canvas=document.querySelector('.game-canvas'),t=new DOMMatrixReadOnly(getComputedStyle(frame).transform),r=canvas.getBoundingClientRect();return{map:{x:r.x+t.m41+parseFloat(frame.style.width)*${entity.x/state.map.width},y:r.y+t.m42+parseFloat(frame.style.height)*${entity.y/state.map.height}},center:{x:r.x+r.width/2,y:r.y+r.height/2}}})()`);
  await clickAt(at.map.x,at.map.y);await delay(350);await clickAt(at.center.x,at.center.y);
  await until(()=>read(`window.__sketchRtsView?.focusedSelectionId===${JSON.stringify(id)}`),`select ${id}`);
 }
 const trainSelector=kind=>`[data-command-dock] [data-hotkey="${keys[kind]}"]:not([hidden]):not([data-training-progress])`;
 async function portraitHash(selector) {
  const data=await until(()=>read(`(()=>{const canvas=document.querySelector(${JSON.stringify(selector)});if(!canvas||!canvas.width||!canvas.height)return;const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;return pixels.some((value,i)=>i%4===3&&value>0)?canvas.toDataURL():undefined})()`),`paint ${selector}`);
  return createHash('sha256').update(data).digest('hex');
 }
 for(const race of ['grove','ember']) {
  console.log(`Shared unit gameplay: ${race}`);
  const producer=race==='grove'?'sanctum':'cinderSpire',foreign=race==='grove'?'cinderSpire':'sanctum';
  await api(`/api/rooms/${roomId}/pause`,{});
  const baseOptions={aiPlayers:[],races:{player:race},scenario:{replaceDefaultUnits:true,replaceDefaultResources:true,replaceDefaultMercenaryCamps:true}};
  await api(`/api/rooms/${roomId}/reset`,{mapId:'bareDuel',options:baseOptions});
  const placement=await read(`(async()=>{
   const [{isBuildPlacementClear},{snapToFootprint,isFootprintBuildable},{BUILDING_DEFS},state]=await Promise.all([
    import('/src/shared/build-placement.ts'),import('/src/shared/terrain.ts'),import('/src/shared/catalog.ts'),fetch('/api/rooms/'+${JSON.stringify(roomId)}+'/snapshot').then(r=>r.json())]);
   const home=state.buildings.find(b=>b.owner==='player'&&b.kind==='townHall'),points=[];
   for(let y=200;y<state.map.height-200;y+=64)for(let x=200;x<state.map.width-200;x+=64)points.push({x,y});
   points.sort((a,b)=>Math.hypot(a.x-home.x,a.y-home.y)-Math.hypot(b.x-home.x,b.y-home.y));
   const result=[],chosen=[],plan=[${JSON.stringify(producer)},${JSON.stringify(producer)},${JSON.stringify(foreign)},...Array(10).fill('farm')];
   for(let i=0;i<plan.length;i++){
    const kind=plan[i],radius=BUILDING_DEFS[kind].radius;
    const point=points.map(p=>snapToFootprint(state.map,radius,p)).find(p=>isBuildPlacementClear(state,kind,p)&&chosen.every(c=>Math.hypot(c.x-p.x,c.y-p.y)>260)&&(i>=3||isFootprintBuildable(state.map,p.x,p.y,190)));
    if(!point)throw new Error('No legal open proof site for '+kind);
    chosen.push(point);result.push({...point,kind});state.buildings.push({...point,kind,radius,id:'proof-planned-'+i,owner:'player'});
   }
   return result;
  })()`);
  const buildings=placement.map((point,i)=>({...point,id:i<2?`${race}-${kinds[i]}-producer`:i===2?`${race}-foreign`:`${race}-farm-${i-3}`,owner:'player',complete:true}));
  const units=kinds.map((kind,i)=>({id:`${race}-${kind}-display`,owner:'player',kind,x:placement[0].x-70+i*140,y:placement[0].y+170}));
  await api(`/api/rooms/${roomId}/reset`,{mapId:'bareDuel',options:{...baseOptions,scenario:{...baseOptions.scenario,addUnits:units,addBuildings:buildings}}});
  await api(`/api/rooms/${roomId}/resume`,{});
  await reload();
  await until(()=>read(`window.__sketchRtsView?.unitIds.includes(${JSON.stringify(units[0].id)})&&document.querySelector('[data-main-menu]')?.classList.contains('hidden')&&!!document.querySelector('[data-minimap-frame]')`),`${race} client synchronization`);
  await read(`(()=>{const gate=document.querySelector('[data-pointer-lock-gate]');if(gate){gate.classList.add('hidden');gate.style.pointerEvents='none';}})()`);
  const start=await snap();must(start.players.player.race===race,`server did not apply ${race}`);
  const proof={race,producer,initialGold:start.players.player.gold,placement,startedTick:start.tick,menu:[],training:[],rejections:[],portraits:{}};
  evidence.sharedUnits.byRace[race]=proof;
  for(const kind of kinds) {
   await focus(`${race}-${kind}-producer`);
   const menu=await read(`[...document.querySelectorAll('[data-command-dock] .command-button:not([hidden]):not([data-training-progress])')].map(el=>({label:el.dataset.commandLabel,hotkey:el.dataset.hotkey,disabled:el.getAttribute('aria-disabled')}))`);
   for(const shared of kinds)must(menu.some(row=>row.hotkey===keys[shared]&&names[shared].test(row.label)),`${race} missing shared ${shared} training command`);
   proof.menu.push({buildingId:`${race}-${kind}-producer`,commands:menu});
   proof.portraits[`${kind}-command`]=await portraitHash(`${trainSelector(kind)} canvas.command-portrait`);
   await screenshot(`${race}-${kind}-menu`);
   await click(trainSelector(kind));
   const queued=await until(async()=>{const state=await snap(),building=state.buildings.find(b=>b.id===`${race}-${kind}-producer`);return building.queue.find(job=>job.unitKind===kind);},`${race} authoritative ${kind} queue`);
   await until(()=>read(`!!document.querySelector('[data-training-progress="${kind}"]')`),`${race} visible ${kind} queue`);
   proof.portraits[`${kind}-queue`]=await portraitHash(`[data-training-progress="${kind}"] canvas.command-portrait`);
   must(proof.portraits[`${kind}-queue`]===proof.portraits[`${kind}-command`],`${race} ${kind} menu/queue portrait mismatch`);
   proof.training.push({kind,job:queued});await screenshot(`${race}-${kind}-queue`);
  }
  const trained=await until(async()=>{const state=await snap();return kinds.every(kind=>state.units.some(unit=>unit.owner==='player'&&unit.kind===kind&&!units.some(seed=>seed.id===unit.id)))?state:undefined;},`${race} normal-time shared unit training`,60000);
  must(trained.players.player.gold===start.players.player.gold-135-180,`${race} training price mismatch`);
  proof.completedTick=trained.tick;proof.goldAfterTraining=trained.players.player.gold;
  proof.spawned=trained.units.filter(unit=>unit.owner==='player'&&!units.some(seed=>seed.id===unit.id)).map(unit=>({id:unit.id,kind:unit.kind,maxHp:unit.maxHp,attackDamage:unit.attackDamage}));
  must(proof.spawned.length===2&&proof.spawned.every(unit=>kinds.includes(unit.kind)),`${race} unexpected trained unit kinds`);
  must(kinds.every(kind=>evidence.commands.some(message=>message.command?.type==='train'&&message.command.unitKind===kind&&message.command.buildingId===`${race}-${kind}-producer`)),`${race} training was not captured on browser websocket`);
  for(const kind of kinds) {
   await focus(`${race}-${kind}-display`);
   proof.portraits[`${kind}-selection`]=await portraitHash('.hud-subject-art');
   await screenshot(`${race}-${kind}-world-selection`);
  }
  await focus(`${race}-foreign`);
  const visible=await read(`[...document.querySelectorAll('[data-command-dock] .command-button:not([hidden])')].map(el=>el.dataset.commandLabel)`);
  must(!visible.some(label=>/^(Train |训练 )/.test(label)),`${race} foreign building exposes training commands`);
  await screenshot(`${race}-foreign-building`);
  for(const kind of [...kinds,...oldKinds]) {
   const before=await snap();
   const response=await fetch(`${origin}/api/rooms/${roomId}/command`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId:'player',command:{type:'train',buildingId:`${race}-foreign`,unitKind:kind}})});
   const result=await response.json(),after=await snap();
   must(response.status===400,`${race} server accepted invalid training ${kind}`);
   must(after.players.player.gold===before.players.player.gold&&after.buildings.find(b=>b.id===`${race}-foreign`).queue.length===0,`${race} rejected command changed economy or queue`);
   proof.rejections.push({kind,status:response.status,error:result.error});
  }
  evidence.steps.push({step:`shared-units-${race}`,producer,spawned:proof.spawned,completedTick:proof.completedTick});
 }
 for(const kind of kinds)for(const surface of ['command','queue','selection']) {
  const key=`${kind}-${surface}`,grove=evidence.sharedUnits.byRace.grove.portraits[key],ember=evidence.sharedUnits.byRace.ember.portraits[key];
  must(grove!==ember,`${kind} ${surface} did not repaint its faction attire`);
  evidence.sharedUnits.artworkHashes[key]={grove,ember,different:true};
 }
 evidence.sharedUnits.visualReview='Screenshots require human review for faction attire, silhouette and world/portrait consistency; differing pixel hashes prove repainting only.';
 evidence.finalView=await read('window.__sketchRtsView');
 evidence.passed=evidence.errors.length===0;must(evidence.passed,'browser errors during shared unit gameplay');
}
