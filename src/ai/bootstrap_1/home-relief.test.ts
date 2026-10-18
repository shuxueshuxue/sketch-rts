import { planAiOwnerCommandEntries } from '../planner-context';
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {expect,it} from 'vitest';
import {homeRelief} from './home-relief';
import {createGame,restoreSnapshotIntoGame,snapshotGame,issuePlayerCommand} from '../../shared/sim';
function saved(tick=54600,rename=false){let raw=gunzipSync(readFileSync(new URL(`./fixtures/home-relief-${tick===54600?'54600':'guard-60000'}.json.gz`,import.meta.url))).toString();if(rename)raw=raw.replaceAll('unit-p0-warship-4662','another-hull').replaceAll('building-p0-townhall','another-home');const f=JSON.parse(raw),game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);return {s:snapshotGame(game),options:{memory:f.memories.p0,teams:f.snapshot.teams}};}
it('selects real adequate embarked defenders and a clear landing, independent of historical IDs',()=>{
 const {s,options}=saved(54600,true),r=homeRelief(s,'p0',options);expect(r.selection).toBeTruthy();expect(options.memory.homeRelief.shipId).toBe('another-hull');expect(options.memory.homeRelief.hallId).toBe('another-home');expect(r.commands.some(c=>c.type==='unload'&&c.unitIds.includes('another-hull'))).toBe(true);expect(r.claimed.size).toBe(3);
});
it.each(['local-defenders','overwhelming-raid','reserved-ships','covered-coasts'] as const)('does not launch an unjustified or unsafe relief: %s',reason=>{
 const {s,options}=saved();
 if(reason==='local-defenders'){for(const id of ['unit-p0-archer-1627','unit-p0-lancer-2239']){const u=s.units.find(u=>u.id===id)!;delete u.deck;u.x=4496;u.y=6400;}}
 if(reason==='overwhelming-raid')s.units.find(u=>u.id==='unit-p2-lancer-1263')!.attackDamage=10000;
 if(reason==='reserved-ships')for(const u of s.units.filter(u=>u.owner==='p0'&&u.sailing))options.memory.naval.ferries[u.id]={purpose:'evacuate',phase:'sailing',targetId:'other-hall',from:{x:0,y:0},to:{x:0,y:0},crewIds:[],sinceTick:s.tick};
 if(reason==='covered-coasts'){const b=s.buildings.find(b=>b.owner==='p2'&&b.kind==='defenseTower')!;b.x=4496;b.y=6512;b.attackRange=2200;}
 expect(homeRelief(s,'p0',options).selection).toBeUndefined();
});
it('keeps the actually unloaded ship in its home-water guard task',()=>{
 const {s,options}=saved(60000),job=options.memory.homeRelief,r=homeRelief(s,'p0',options);expect(job.phase).toBe('guard');expect(r.claimed.has(job.shipId)).toBe(true);expect(r.commands.some(c=>c.type==='attackMove')).toBe(false);
});
it('does not erase emergency helm or medical walking orders',()=>{
 const {s,options}=saved(60000),job=options.memory.homeRelief;options.memory.naval.coastalRetreat[job.shipId]={x:5300,y:5900};
 const r=homeRelief(s,'p0',options,[{type:'move',unitIds:[job.crewIds[0]],x:4400,y:6500,avoidCombat:true}]);
 expect(r.claimed.has(job.shipId)).toBe(false);expect(r.claimed.has(job.crewIds[0])).toBe(false);
});

function wave(tick=68400){const f=JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/home-relief-${tick===68400?'wave-68400':'recovered-69000'}.json.gz`,import.meta.url))).toString());const game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);return {s:snapshotGame(game),options:{memory:f.memories.p0,teams:f.snapshot.teams}};}
it('uses witnessed native sea and land routes to recover the actual outmatched guards',()=>{
 const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/home-relief-trigger-68610.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);const s=snapshotGame(game),options={memory:f.memory,teams:f.teams},before=s.units.map(u=>({id:u.id,x:u.x,y:u.y,hp:u.hp}));const r=homeRelief(s,'p0',options,f.planned.map((e:any)=>e.command));
 expect(options.memory.homeRelief.phase).toBe('evacuate');expect(r.commands.find(c=>c.type==='board')).toMatchObject({transportId:options.memory.homeRelief.shipId,unitIds:options.memory.homeRelief.crewIds});
 expect(s.units.map(u=>({id:u.id,x:u.x,y:u.y,hp:u.hp}))).toEqual(before);
});
it('does not send recovered crew ashore again or dispatch its ship to the enemy',()=>{
 const {s,options}=wave(69000),r=homeRelief(s,'p0',options);expect(options.memory.homeRelief.phase).toBe('recover');
 expect(r.commands.some(c=>c.type==='unload'||c.type==='attackMove')).toBe(false);expect(s.units.filter(u=>options.memory.homeRelief.crewIds.includes(u.id)).every(u=>u.deck?.shipId===options.memory.homeRelief.shipId)).toBe(true);
});
it('refuses boarding when the escape shore becomes covered',()=>{
 const {s,options}=wave(),tower=s.buildings.find(b=>b.owner==='p1'&&b.kind==='defenseTower')!;tower.x=4900;tower.y=6100;tower.attackRange=2200;
 const r=homeRelief(s,'p0',options);expect(options.memory.homeRelief.phase).toBe('guard');expect(r.commands.some(c=>c.type==='board')).toBe(false);
});

it('does not count the 68400 embarked convoy as already landed infantry',()=>{const {s,options}=wave(),r=homeRelief(s,'p0',options);expect(options.memory.homeRelief.phase).toBe('guard');expect(r.commands.some(c=>c.type==='board')).toBe(false);});

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s integrates relief through the ordinary planner',version=>{
 const {s,options}=saved();const entries=planAiOwnerCommandEntries(s,{playerId:'p0',version,memory:options.memory},{teams:options.teams});
 expect(options.memory.homeRelief).toBeTruthy();expect(entries.some(e=>e.scriptId==='homeRelief'&&e.command.type==='unload'&&e.command.unitIds.includes(options.memory.homeRelief.shipId))).toBe(true);
});

it('lands only the selected relief fighters through native commands and retains a civilian passenger',()=>{
 const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/home-relief-selective-26625.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);
 const memory=f.memories.p0,job=memory.homeRelief;
 const entries=planAiOwnerCommandEntries(snapshotGame(game),{playerId:'p0',version:'v9_archer',memory},{teams:f.snapshot.teams});
 const commands=entries.filter(e=>e.scriptId==='homeRelief').map(e=>e.command);
 expect(commands.filter(c=>c.type==='unloadPassenger').map(c=>c.passengerId).sort()).toEqual([...job.crewIds].sort());
 expect(commands.some(c=>c.type==='unload')).toBe(false);
 const beforeGold=game.players.p0!.gold;
 for(const command of commands)issuePlayerCommand(game,'p0',command);
 for(const id of job.crewIds)expect(game.units.find(u=>u.id===id)?.deck).toBeUndefined();
 expect(game.units.find(u=>u.id==='unit-p0-worker-3')).toMatchObject({hp:70,deck:{shipId:job.shipId}});
 expect(game.players.p0!.gold).toBe(beforeGold);
});
