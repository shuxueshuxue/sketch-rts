import {createCanvas} from '@napi-rs/canvas';
import {renderWorldEffects} from './effect-renderer';
import {drawArrow} from './art/canvas-effects';
import {arrowFrame} from './art/effect-presentation';
import {describe,it,expect} from 'vitest';
import {createGame,snapshotGame,issuePlayerCommand} from '../shared/sim';
import {ProjectileOriginTracker} from './projectile-origins';
import {flightPose} from './world3d/flight-pose';
import type {WorldEffect} from '../shared/types';
import {releasePoseForEffect} from './unit-animation';
import {resolveReleaseSocket} from './art/release-socket';
import {projectActionFrame} from './art/action-direction';
import {SHIP_CAMERA} from '../shared/ship-geometry';
function setup(){
 const game=createGame('bareDuel',{aiPlayers:[]});const archer=game.spawnUnit('player','archer',500,500);
 const shot:WorldEffect={id:'locked-shot',type:'projectile',sourceId:archer.id,sourceKind:'archer',actionMode:'attack',actionTick:0,attackKind:'arrow',x:700,y:440,fromX:500,fromY:500,toX:700,toY:440,fromHeight:0,toHeight:0,duration:20,remaining:20};
 game.effects=[shot];return{game,archer,shot,tracker:new ProjectileOriginTracker()};
}
describe('locked visual projectile sockets',()=>{
 it('uses the solved bow release in both renderer coordinate systems without moving the event',()=>{
  const {game,archer,shot,tracker}=setup();const before=JSON.stringify(shot);tracker.update(snapshotGame(game));
  const socket=resolveReleaseSocket({kind:'archer',pose:projectActionFrame(releasePoseForEffect(shot)!,1),radius:archer.radius})!;
  const gpu=tracker.origin(shot)!,canvas=tracker.origin(shot,'canvas')!,tilt=Math.tan(SHIP_CAMERA.tilt);
  expect(gpu.x).toBeCloseTo(500+socket.x);expect(gpu.height).toBeCloseTo((socket.ground-socket.y)/tilt);expect(canvas.height).toBeCloseTo(-socket.y/tilt);expect(JSON.stringify(shot)).toBe(before);
  expect(flightPose(shot,0,gpu)).toMatchObject({x:gpu.x,y:gpu.y,height:gpu.height,p:0});
  expect(flightPose({...shot,remaining:0},0,gpu)).toMatchObject({x:700,y:440,height:0,p:1});
 });
 it('feeds the same locked socket into Canvas without applying the old radius offset twice',()=>{
  const {game,shot,tracker}=setup();shot.fromX=80;shot.fromY=120;shot.toX=260;shot.toY=100;shot.remaining=10;tracker.update(snapshotGame(game));
  const origin=tracker.origin(shot,'canvas')!,a=createCanvas(320,180),b=createCanvas(320,180);
  const ctx=a.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderWorldEffects({ctx,effects:[shot],worldToScreen:p=>p,nearScreen:()=>true,projectileOrigin:effect=>tracker.origin(effect,'canvas')});
  drawArrow(b.getContext('2d') as unknown as CanvasRenderingContext2D,arrowFrame({x:origin.x,y:origin.y-origin.height*Math.tan(SHIP_CAMERA.tilt)},{x:260,y:100},.5));
  expect(a.getContext('2d').getImageData(0,0,320,180).data).toEqual(b.getContext('2d').getImageData(0,0,320,180).data);
 });
 it('holds a launch point across movement, facing and equipment changes then retires inactive ids',()=>{
  const {game,archer,shot,tracker}=setup();tracker.update(snapshotGame(game));const origin=tracker.origin(shot);
  const sword={id:'released-sword',kind:'greatSword' as const,x:archer.x,y:archer.y,cooldownRemaining:0};game.items.push(sword);
  issuePlayerCommand(game,'player',{type:'pickupItem',unitId:archer.id,itemId:sword.id});issuePlayerCommand(game,'player',{type:'wieldItem',unitId:archer.id,itemId:sword.id,hand:'right'});
  archer.x=900;archer.y=900;archer.radius=30;game.tick++;shot.remaining--;tracker.update(snapshotGame(game),undefined,()=>-1);
  expect(tracker.origin(shot)).toBe(origin);game.effects=[];game.tick++;tracker.update(snapshotGame(game));expect(tracker.size).toBe(0);
  tracker.reset();expect(tracker.size).toBe(0);
 });
 it('keeps near-vertical release sockets on the held facing side',()=>{
  const {game,archer,shot,tracker}=setup();shot.toX=499;shot.toY=300;
  tracker.update(snapshotGame(game),undefined,()=>1);
  const socket=resolveReleaseSocket({kind:'archer',pose:projectActionFrame(releasePoseForEffect(shot)!,1),radius:archer.radius})!;
  expect(tracker.origin(shot)!.x).toBeCloseTo(500+socket.x);
 });
 it('preserves elevated hardpoints when a shooter is absent at first observation',()=>{
  const {game,archer,shot,tracker}=setup();shot.fromHeight=62;game.units=game.units.filter(unit=>unit.id!==archer.id);
  tracker.update(snapshotGame(game));expect(tracker.origin(shot)).toBeUndefined();
 });
 it('preserves native engineering hardpoints and does not guess poses from old incomplete events',()=>{
  const {game,shot,tracker}=setup();const incomplete={...shot,id:'incomplete'};delete incomplete.actionTick;game.effects=[incomplete,{...shot,id:'native',type:'shellFlight',sourceKind:'warship'}];
  tracker.update(snapshotGame(game));expect(tracker.origin(game.effects[0]!)).toBeUndefined();expect(tracker.origin(game.effects[1]!)).toBeUndefined();
 });
});
