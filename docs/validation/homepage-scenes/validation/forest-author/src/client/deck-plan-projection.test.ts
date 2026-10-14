import { describe, expect, it } from 'vitest';
import { createUnit } from '../shared/map';
import { SHIP_KINDS, shipProfile } from '../shared/ship-geometry';
import { shipMounts } from '../shared/ship-equipment';
import { deckPlanProjection } from './deck-plan-projection';

describe('deck diagram coordinates',()=>{
  it.each(SHIP_KINDS)('keeps %s hull, fittings and pointer destinations in one frame at every size',kind=>{
    const ship=createUnit('ship','player',kind,900,800);
    for(const scale of [.8,1.1,1.6]) {
      ship.deckScale=scale;
      const p=deckPlanProjection(ship),profile=shipProfile(ship)!;
      for(const point of [...profile.hull,...shipMounts(ship)]) {
        const svg=p.project(point),percent=p.percent(point),back=p.unproject(svg);
        expect(percent.x/100*p.width).toBeCloseTo(svg.x,8);
        expect(percent.y/100*p.height).toBeCloseTo(svg.y,8);
        expect(back.x).toBeCloseTo(point.x,8);expect(back.y).toBeCloseTo(point.y,8);
        expect(svg.x).toBeGreaterThan(0);expect(svg.x).toBeLessThan(p.width);
        expect(svg.y).toBeGreaterThan(0);expect(svg.y).toBeLessThan(p.height);
      }
    }
  });
});
