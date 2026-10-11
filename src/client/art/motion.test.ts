import { describe, expect, it } from 'vitest';
import { sampleMotion, type MotionFamily } from './motion';

describe('shared motion library', () => {
  it.each<MotionFamily>(['slash', 'thrust', 'bow', 'staff', 'work', 'creature', 'siege'])('%s releases on the event and recovers to exact rest', family => {
    for (let variant = 0; variant < 3; variant++) {
      const frames = Array.from({ length: 6 }, (_, frame) => sampleMotion({ mode: 'attack', frame, variant }, family));
      expect(frames[0]!.reach).toBeGreaterThan(0);
      expect(frames.every(frame=>Number.isFinite(frame.reach))).toBe(true);
      if(family==='slash'||family==='work'||family==='thrust')expect(frames.some(frame=>frame.reach<0)).toBe(true);
      else for (let i = 1; i < frames.length; i++) expect(frames[i]!.reach).toBeLessThanOrEqual(frames[i - 1]!.reach);
      expect(frames[5]).toEqual(sampleMotion({ mode: 'idle', frame: 0 }, family));
    }
  });
  it('separates spell release from physical swings and supports alternate compatible motions', () => {
    const attack = { mode: 'attack', frame: 0 } as const;
    expect(sampleMotion(attack, 'slash')).not.toEqual(sampleMotion(attack, 'thrust'));
    expect(sampleMotion(attack, 'staff').castGlow).toBe(0);
    expect(sampleMotion({ mode: 'cast', frame: 0 }, 'staff').castGlow).toBe(1);
    expect(sampleMotion({ mode: 'cast', frame: 5 }, 'staff')).toEqual(sampleMotion({ mode: 'idle', frame: 0 }));
  });
  it('provides three distinct attack contacts without moving planted feet', () => {
    const clips = [0, 1, 2].map(variant => sampleMotion({ mode: 'attack', frame: 0, variant }));
    expect(new Set(clips.map(clip => clip.weaponAngle)).size).toBe(3);
    for (const clip of clips) expect(clip.stride).toBe(0);
  });
  it('breathes without foot translation and reuses immutable samples', () => {
    const pose = { mode: 'idle', frame: 2 } as const;
    expect(sampleMotion(pose).breathe).toBeGreaterThan(0);
    expect(sampleMotion(pose).lift).toBe(0);
    expect(sampleMotion(pose)).toBe(sampleMotion(pose));
    expect(Object.isFrozen(sampleMotion(pose))).toBe(true);
  });
});
