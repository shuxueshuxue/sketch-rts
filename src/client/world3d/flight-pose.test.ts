import {describe,it,expect} from 'vitest';
import {flightPose} from './flight-pose';
import type {WorldEffect} from '../../shared/types';
const effect={id:'shot',type:'siegeBolt',x:200,y:100,fromX:0,fromY:0,toX:200,toY:100,fromHeight:20,toHeight:10,duration:20,remaining:10} satisfies WorldEffect;
describe('physical shot presentation',()=>{
  it('keeps weapon identity independent of the carrying hull',()=>{
    expect(flightPose({...effect,sourceKind:'warship',attackKind:'bolt'},0).look).toBe('arrow');
    expect(flightPose({...effect,sourceKind:'transport',attackKind:'cannon'},0).look).toBe('shell');
    expect(flightPose({...effect,attackKind:'magic'},0).look).toBe('orb');
    expect(flightPose({...effect,attackKind:'fire'},0).look).toBe('fire');
  });
  it('holds the shot before impact when simulation packets stop, rather than advancing it by wall time',()=>{
    const shot={...effect,remaining:1};expect(flightPose(shot,1000).p).toBeLessThan(1);expect(flightPose(shot,60_000)).toEqual(flightPose(shot,1000));
    expect(flightPose(effect,0)).toMatchObject({x:100,y:50,height:15});
  });
});
