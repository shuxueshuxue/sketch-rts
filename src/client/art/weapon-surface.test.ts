import {it,expect} from 'vitest';
import {figureWeaponSurface,creatureWeaponSurface} from './weapon-surface';
import {figureReleaseSocket} from './release-socket';
import {storyFigure,storyCreature} from './story-rig';
import {creatureGround} from './painted-creatures';
it('places the spear contact surface on the painted point including mounted transforms and carry',()=>{
 for(const kind of ['lancer','knight'] as const)for(const pose of [{mode:'attack',frame:0,aim:-4},{mode:'idle',frame:2,carry:6,carryAim:4},{mode:'walk',frame:3,carry:3,carryAim:4}] as const){
  const surface=figureWeaponSurface(kind,pose)!,tip=surface.segments[1]!.b,release=figureReleaseSocket(kind,pose)!;
  // The paint socket is at the extreme 48px tip, the solid segment ends at 47.
  expect(Math.hypot(tip[0]-release.x,tip[1]-(release.y-release.ground))).toBeLessThanOrEqual(1.001);
 }
});
it('scales story equipment about the feet and omits a thrown javelin',()=>{
 const pose={mode:'idle',frame:0,carry:6,carryAim:-4} as const;
 const base=figureWeaponSurface('lancer',pose)!,story=storyFigure('lancer',{},.85).weaponSurface!(pose)!;
 expect(story.segments[0]!.a[0]).toBeCloseTo(base.segments[0]!.a[0]*.85);
 expect(story.segments[0]!.a[1]).toBeCloseTo(base.segments[0]!.a[1]*.85);
 const ogre=creatureWeaponSurface('ogreWarrior',pose)!;
 expect(storyCreature('ogreWarrior',{}).weaponSurface!(pose)).toEqual(ogre);
 expect(creatureGround('ogreWarrior')).toBe(18);
 expect(figureWeaponSurface('footman',{mode:'attack',frame:0},{weapon:'javelin'})).toBeUndefined();
 expect(creatureWeaponSurface('murlocHunter',{mode:'attack',frame:0})).toBeUndefined();
});
