import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,stepGame } from './sim';
import { headingDifference,hullFits } from './ship-navigation';
import { SHIP_WEAPONS,bestFiringHeading,shipGunCanAim } from './ship-equipment';
import { seconds } from './time';
function scene(){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;game.map.width=2400;game.map.height=2000;game.map.terrain={cell:40,cols:60,rows:50,cells:'~'.repeat(3000)};return game;}
describe('predictable ship steering',()=>{
  for(const degrees of [-175,-120,-45,45,120,175])it(`takes the shortest forward turn for a distant ${degrees} degree destination`,()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1200,1000),angle=degrees*Math.PI/180;
    const goal={x:1200+450*Math.cos(angle),y:1000+450*Math.sin(angle)};
    ship.sailing!.heading=0;
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    let totalYaw=0,astern=0;
    for(let i=0;i<seconds(25)&&ship.order.type==='move';i++){
      const before={x:ship.x,y:ship.y,heading:ship.sailing!.heading};stepGame(game);
      const yaw=headingDifference(before.heading,ship.sailing!.heading);totalYaw+=Math.abs(yaw);
      expect(yaw*angle).toBeGreaterThanOrEqual(-1e-7);
      if((ship.x-before.x)*Math.cos(ship.sailing!.heading)+(ship.y-before.y)*Math.sin(ship.sailing!.heading)<-1e-7)astern++;
      expect(hullFits(game.map,ship)).toBe(true);
    }
    expect(astern).toBe(0);expect(totalYaw).toBeCloseTo(Math.abs(angle),5);
    expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(5);
  });
  it('does not let automatic gun orientation override an explicit journey',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',700,800),enemy=game.spawnUnit('enemy','warship',500,800);
    ship.sailing!.heading=0;enemy.order={type:'attack',targetId:ship.id};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:1500,y:800});
    for(let i=0;i<seconds(4);i++){stepGame(game);expect(Math.abs(headingDifference(0,ship.sailing!.heading))).toBeLessThan(1e-7);}
    expect(ship.x).toBeGreaterThan(800);
  });
  it('chooses the near side and only the rotation needed to enter its firing arc',()=>{
    const game=scene(),ship=game.spawnUnit('player','carrier',1000,1000),target={x:1240,y:1000};
    ship.sailing!.heading=.8;
    for(const [i,mountId] of ['port0','starboard0','starboard1','starboard2'].entries())game.items.push({id:`gun-${i}`,kind:'shipCannon',shipId:ship.id,mountId,durability:SHIP_WEAPONS.shipCannon.hp,x:ship.x,y:ship.y,cooldownRemaining:0});
    const originalItems=[...game.items];
    const near=game.items.find(item=>item.mountId==='port0')!,desired=bestFiringHeading(game,ship,target);
    expect(headingDifference(ship.sailing!.heading,desired)).toBeGreaterThan(0);
    expect(Math.abs(headingDifference(ship.sailing!.heading,desired))).toBeLessThan(.5);
    game.items.reverse();expect(bestFiringHeading(game,ship,target)).toBe(desired);game.items=originalItems;
    const pose={...ship,sailing:{...ship.sailing!,heading:desired}};
    expect(shipGunCanAim(pose,near,target)).toBe(true);
    expect(bestFiringHeading(game,pose,target)).toBe(desired);
  });
});
