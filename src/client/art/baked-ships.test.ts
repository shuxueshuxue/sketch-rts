import { describe,expect,it,vi } from 'vitest';
import { shipSpriteYaw,drawBakedShip } from './baked-ships';
import { installBakedImage } from './baked-assets';
import { createUnit } from '../../shared/map';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import { headingDifference } from '../../shared/ship-navigation';
describe('continuous ship sprite yaw',()=>{
  it('keeps residual rotation bounded and reconstructs heading across frame boundaries and angle wrap',()=>{
    for(let i=-720;i<=720;i++){
      const angle=i*Math.PI/360,yaw=shipSpriteYaw(angle);
      expect(yaw.direction).toBeGreaterThanOrEqual(0);expect(yaw.direction).toBeLessThan(SHIP_CAMERA.directions);
      expect(Math.abs(yaw.rotation)).toBeLessThanOrEqual(Math.PI/SHIP_CAMERA.directions+1e-7);
      expect(Math.abs(headingDifference(yaw.direction*2*Math.PI/SHIP_CAMERA.directions+yaw.rotation,angle))).toBeLessThan(1e-7);
    }
  });
  it('actually rotates both hull layers between baked directions',()=>{
    const ship=createUnit('ship','player','transport',800,800),ctx={save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),drawImage:vi.fn()} as unknown as CanvasRenderingContext2D;
    installBakedImage('ships/transport-base',{} as CanvasImageSource);installBakedImage('ships/transport-upper',{} as CanvasImageSource);
    ship.sailing={heading:.025,speed:0,load:0,balance:0};
    expect(drawBakedShip(ctx,ship,{x:100,y:100},'base')).toBe(true);drawBakedShip(ctx,ship,{x:100,y:100},'upper');
    expect(ctx.rotate).toHaveBeenNthCalledWith(1,expect.closeTo(.025,8));expect(ctx.rotate).toHaveBeenNthCalledWith(2,expect.closeTo(.025,8));
  });
});
