import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { avoidanceCourse, reservationTraffic, shipTraffic } from './ship-avoidance';
import { headingDifference } from './ship-navigation';
import { SIM_TICKS_PER_SECOND } from './time';

function boat(id:string,x:number,y:number,heading:number,speed=50){
  const ship=createUnit(id,'player','cutter',x,y);
  ship.sailing={heading,speed,load:0,balance:0,velocityX:speed*Math.cos(heading),velocityY:speed*Math.sin(heading),
    route:{goalX:x+1500*Math.cos(heading),goalY:y+1500*Math.sin(heading),points:[],end:{x:0,y:0}}};
  return ship;
}

describe('early course alterations for vessel encounters',()=>{
  it('gives both head-on vessels a starboard course before their hulls touch',()=>{
    const a=boat('a',1000,1000,0),b=boat('b',1500,1000,Math.PI),units=[a,b];
    const left=avoidanceCourse(a,units,0,50),right=avoidanceCourse(b,units,Math.PI,50);
    expect(left.active).toBe(true);expect(right.active).toBe(true);
    expect(headingDifference(0,left.heading)).toBeGreaterThan(0);
    expect(headingDifference(Math.PI,right.heading)).toBeGreaterThan(0);
    expect(left.speedScale).toBeGreaterThan(0);
    expect(Math.sin(left.heading)).toBeGreaterThan(0);
    expect(Math.sin(right.heading)).toBeLessThan(0);
  });

  it('leaves safe parallel, receding and distant traffic alone',()=>{
    const a=boat('a',1000,1000,0);
    for(const b of [boat('parallel',1010,1080,0),boat('away',1400,1000,0,80),boat('distant',4000,1000,Math.PI),boat('clear-crossing',1200,1600,-Math.PI/2)]){
      expect(avoidanceCourse(a,[a,b],0,50)).toEqual({heading:0,speedScale:1,active:false});
    }
  });

  it('slows for crossing traffic from starboard while keeping a clear passing side',()=>{
    const a=boat('a',1000,1000,0),b=boat('b',1250,1250,-Math.PI/2);
    const giveWay=avoidanceCourse(a,[a,b],0,50),standOn=avoidanceCourse(b,[a,b],-Math.PI/2,50);
    expect(giveWay.active).toBe(true);expect(standOn.active).toBe(true);
    expect(giveWay.speedScale).toBeLessThan(standOn.speedScale);
    expect(headingDifference(0,giveWay.heading)).toBeGreaterThan(0);
    expect(headingDifference(-Math.PI/2,standOn.heading)).toBeGreaterThan(0);
  });

  it('keeps its chosen side after the first turn clears CPA and releases smoothly',()=>{
    const a=boat('a',1000,1000,0),b=boat('b',1500,1000,Math.PI);
    avoidanceCourse(a,[a,b],0,50);
    let previous=Math.PI,last=0;
    for(let tick=0;tick<SIM_TICKS_PER_SECOND*7;tick++){
      const course=avoidanceCourse(a,[a],0,50);
      expect(course.heading).toBeGreaterThanOrEqual(0);
      expect(course.heading).toBeLessThanOrEqual(previous);
      if(tick<SIM_TICKS_PER_SECOND*.5)expect(course.active).toBe(true);
      previous=course.heading;last=course.heading;
    }
    expect(last).toBe(0);
    expect(a.sailing!.route!.avoidTicks).toBeUndefined();
  });

  it('holds a world heading against path recentering and waits for the whole encounter to pass',()=>{
    const a=boat('a',1000,1000,0),b=boat('b',1500,1000,Math.PI);
    const committed=avoidanceCourse(a,[a,b],0,50);
    a.sailing!.heading=committed.heading;a.sailing!.velocityX=35;a.sailing!.velocityY=35;
    for(let tick=0;tick<SIM_TICKS_PER_SECOND*4;tick++){
      const course=avoidanceCourse(a,[a,b],-.4,50);
      expect(course.heading).toBe(committed.heading);
      expect(course.active).toBe(true);
    }
    b.x=700;
    for(let tick=0;tick<=SIM_TICKS_PER_SECOND;tick++)avoidanceCourse(a,[a,b],0,50);
    expect(a.sailing!.route!.avoidTargetId).toBeUndefined();
    expect(avoidanceCourse(a,[a,b],0,50).active).toBe(false);
  });

  it('retains the exact passing decision when serialized route scalars are restored',()=>{
    const a=boat('a',1000,1000,0),b=boat('b',1500,1000,Math.PI);
    avoidanceCourse(a,[a,b],0,50);
    const restored=structuredClone(a);
    for(let tick=0;tick<SIM_TICKS_PER_SECOND*7;tick++){
      expect(avoidanceCourse(a,[a],.05,50)).toEqual(avoidanceCourse(restored,[restored],.05,50));
      expect(a.sailing!.route!.avoidTicks).toBe(restored.sailing!.route!.avoidTicks);
    }
  });

  it('does not make the overtaken vessel dodge a faster ship approaching its stern',()=>{
    const a=boat('a',1300,1000,0,30),b=boat('b',1000,1000,0,70);
    expect(avoidanceCourse(a,[a,b],0,30).active).toBe(false);
    expect(avoidanceCourse(b,[a,b],0,70).active).toBe(true);
  });

  it('does not extrapolate a safe commanded stop through its stationary destination',()=>{
    const a=boat('a',1000,1000,0,20),b=boat('b',1300,1000,0,0);
    a.sailing!.route!.targetSpeed=0;
    expect(avoidanceCourse(a,[a,b],0,20)).toEqual({heading:0,speedScale:1,active:false});
  });

  it('releases a nearby clear final approach even if extending its velocity would create a later CPA',()=>{
    const a=boat('a',1000,1000,0),b=boat('b',1500,1000,Math.PI);
    avoidanceCourse(a,[a,b],0,50);
    a.x=1350;a.y=1130;
    a.sailing!.route!.points=[{x:1400,y:1140,heading:0}];
    expect(avoidanceCourse(a,[a,b],.1,50)).toEqual({heading:.1,speedScale:1,active:false});
    expect(a.sailing!.route!.avoidTargetId).toBeUndefined();
  });

  it('reserves reciprocal boarding poses only for planning while live hull sweeps remain blocked',()=>{
    const source=createUnit('source','player','warship',900,900),target=createUnit('target','player','warship',1160,900),crew=createUnit('crew','player','worker',900,900);
    source.sailing={heading:0,speed:0,load:0,balance:0};target.sailing={heading:0,speed:0,load:0,balance:0};
    source.order={type:'move',x:1030,y:860.375,heading:0,rendezvousFor:crew.id};
    target.order={type:'move',x:1030,y:939.625,heading:0,rendezvousFor:crew.id};
    crew.order={type:'board',transportId:target.id,rendezvous:{sourceId:source.id,sourceX:1030,sourceY:860.375,heading:0,targetX:1030,targetY:939.625,reciprocal:true}};
    const goal={x:1030,y:860.375,heading:0},units=[source,target,crew];
    expect(shipTraffic(source,units)(goal,goal)).toBe(false);
    expect(reservationTraffic(source,units)(goal,goal)).toBe(true);
    expect(target).toMatchObject({x:1160,y:900,sailing:{heading:0}});
    target.order={type:'move',x:1300,y:1100};
    expect(reservationTraffic(source,units)(goal,goal)).toBe(false);
  });
  it('updates live traffic after movement, yaw, death and launch in the same unit list',()=>{
    const a=boat('a',1000,1000,0,0),b=boat('b',1230,1000,Math.PI/2,0),units=[a,b];
    const from={x:a.x,y:a.y,heading:0},to={x:1200,y:1000,heading:0};
    expect(shipTraffic(a,units)(from,to)).toBe(false);
    b.y=1300;expect(shipTraffic(a,units)(from,to)).toBe(true);
    b.y=1080;expect(shipTraffic(a,units)(from,to)).toBe(false);
    b.sailing!.heading=0;expect(shipTraffic(a,units)(from,to)).toBe(true);
    b.y=1000;b.hp=0;expect(shipTraffic(a,units)(from,to)).toBe(true);
    const launched=boat('launched',1150,1000,0,0);units.push(launched);
    expect(shipTraffic(a,units)(from,to)).toBe(false);
  });
  it('invalidates hull-radius caches for changed scale and freezes an existing route search',()=>{
    const a=boat('a',1000,1000,0,0),b=boat('b',1200,1000,0,0),units=[a,b],at={x:a.x,y:a.y,heading:0};
    const original=shipTraffic(a,units);
    expect(original(at,at)).toBe(true);
    a.deckScale=3;
    expect(shipTraffic(a,units)(at,at)).toBe(false);
    expect(original(at,at)).toBe(true);
    a.deckScale=1.1;
    b.x=1120;b.sailing!.heading=Math.PI/2;
    const frozen=shipTraffic(a,units);
    expect(frozen(at,at)).toBe(true);
    b.sailing!.heading=0;
    expect(frozen(at,at)).toBe(true);
    expect(shipTraffic(a,units)(at,at)).toBe(false);
  });
});
