import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,stepGame} from './sim';
import {BOARDING_GAP,clearBoardingBerth} from './naval';
import {distanceToHull} from './ship-geometry';
import {hullFits} from './ship-navigation';
import {shipBodyClearanceAtHeading} from './ship-collisions';

it('finds a full-hull-clear pickup berth beside the waiting army and starts the actual voyage',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('../ai/bootstrap_1/fixtures/archer-waiting-berth.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const boat=game.units.find(u=>u.id==='unit-p0-carrier-3777')!;
 const crew=game.units.find(u=>u.id==='unit-p0-archer-2081')!;
 if(crew.order.type!=='board'||!crew.order.berth)throw new Error('Missing recorded pickup');
 const berth=crew.order.berth,clear=clearBoardingBerth(game.map,crew,boat,berth,game.units);
 expect(clear).toBeDefined();if(!clear)return;
 expect(Math.max(Math.abs(clear.x-berth.x),Math.abs(clear.y-berth.y))).toBeGreaterThan(BOARDING_GAP*2);
 const heading=clear.heading!;
 expect(hullFits(game.map,boat,{...clear,heading})).toBe(true);
 expect(shipBodyClearanceAtHeading(game.map,boat,heading,game.units)(clear)).toBe(true);
 expect(distanceToHull({...boat,...clear,sailing:{...boat.sailing!,heading}},berth.shore!)).toBeLessThanOrEqual(crew.radius+BOARDING_GAP);
 const before=Math.hypot(boat.x-clear.x,boat.y-clear.y);
 for(let i=0;i<300;i++)stepGame(game);
 expect(Math.hypot(boat.x-clear.x,boat.y-clear.y)).toBeLessThan(before-100);
},60000);

it('continues a distant partial pickup voyage while the army shifts at its destination',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('../ai/bootstrap_1/fixtures/archer-partial-pickup.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const boat=game.units.find(u=>u.id==='unit-p0-carrier-3777')!,before={x:boat.x,y:boat.y};
 expect(boat.sailing?.route?.partial).toBe(true);
 for(let i=0;i<300;i++)stepGame(game);
 expect(Math.hypot(boat.x-before.x,boat.y-before.y)).toBeGreaterThan(50);
},60000);
