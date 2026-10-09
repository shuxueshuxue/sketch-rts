import { describe, expect, it } from 'vitest';
import { combatScenes, runCombatScene } from '../../scripts/ship-combat-review';

/** End-to-end measurements share the review fixtures, but these assertions
 * describe player-visible outcomes, not planner states or target internals. */
function review(id: string, duration?: number) {
  const scene = combatScenes.find(scene => scene.id === id);
  if (!scene) throw new Error(`Missing ship review scenario: ${id}`);
  return runCombatScene(duration === undefined ? scene : { ...scene, duration }, false).metrics;
}
function safe(metrics: ReturnType<typeof review>) {
  expect(metrics.coastViolations).toBe(0);
  expect(metrics.maxHullOverlap).toBeLessThan(.1);
}

describe('real naval engagement quality', () => {
  it('two approaching bow ships begin exchanging damaging fire without circling', () => {
    const metrics = review('bow-mutual-far');
    safe(metrics);
    expect(metrics.firstShot).not.toBeNull();
    expect(metrics.firstShot!).toBeLessThan(35);
    expect(metrics.teamDamage).toBeGreaterThan(0);
    expect(metrics.totalYawDegrees).toBeLessThan(180);
    expect(metrics.stopEpisodes).toBeLessThanOrEqual(8);
  });

  it('an initially close bow duel does not repeatedly toggle propulsion while aiming', () => {
    const metrics = review('bow-mutual-close');
    safe(metrics);
    expect(metrics.firstShot).not.toBeNull();
    expect(metrics.firstShot!).toBeLessThan(5);
    expect(metrics.teamDamage).toBeGreaterThan(0);
    expect(metrics.stopEpisodes).toBeLessThanOrEqual(8);
    expect(metrics.rapidTurnReversals).toBeLessThanOrEqual(3);
  });

  for (const id of ['crossing', 'battery-crossing']) it(`${id} keeps its guns useful when real damage slows the target`, () => {
    const metrics = review(id);
    safe(metrics);
    expect(metrics.firstShot).not.toBeNull();
    expect(metrics.teamDamage).toBeGreaterThanOrEqual(270);
    expect(metrics.stopEpisodes).toBeLessThanOrEqual(10);
    expect(metrics.inRangeOutOfArcSeconds).toBeLessThan(25);
    expect(metrics.rapidTurnReversals).toBeLessThanOrEqual(4);
  });

  it('fires the available broadside battery without turning an already good station', () => {
    const metrics = review('battery-beam');
    safe(metrics);
    expect(metrics.firstShot).not.toBeNull();
    expect(metrics.firstShot!).toBeLessThan(2);
    expect(metrics.shotsByMount.starboard0).toBeGreaterThan(0);
    expect(metrics.shotsByMount.starboard1).toBeGreaterThan(0);
    expect(metrics.totalYawDegrees).toBeLessThan(15);
  });

  it('aims a ready mortar during a moving interception and deals damage', () => {
    const metrics = review('mortar-crossing');
    safe(metrics);
    expect(metrics.firstShot).not.toBeNull();
    expect(metrics.teamDamage).toBeGreaterThan(0);
    // A continuous valid firing opportunity may include normal aiming time,
    // but must not be discarded repeatedly because the hull is moving.
    expect(metrics.longestReadyInArcNoShotSeconds).toBeLessThan(4);
  });

  it('backs a mortar out of its dead zone without a complete hull rotation', () => {
    const metrics = review('mortar-close');
    safe(metrics);
    expect(metrics.firstShot).not.toBeNull();
    expect(metrics.firstShot!).toBeLessThan(20);
    expect(metrics.totalYawDegrees).toBeLessThan(180);
    expect(metrics.teamDamage).toBeGreaterThan(0);
  });

  it('a fire ship intercepts a crossing transport and uses its projector', () => {
    const metrics = review('flame-crossing');
    safe(metrics);
    expect(metrics.firstShot).not.toBeNull();
    expect(metrics.teamDamage).toBeGreaterThan(0);
    expect(metrics.totalYawDegrees).toBeLessThan(360);
    expect(metrics.stopEpisodes).toBeLessThanOrEqual(6);
  });

  it('three ships in a sea lane establish combat instead of individually orbiting', () => {
    const metrics = review('channel-three-v-three');
    safe(metrics);
    expect(metrics.teamShots).toBeGreaterThanOrEqual(6);
    expect(metrics.teamDamage).toBeGreaterThan(150);
    expect(metrics.totalYawDegrees).toBeLessThan(360);
    expect(metrics.stopEpisodes).toBeLessThanOrEqual(10);
  });
});

describe('course shape and useful wind progress', () => {
  it('establishes useful sailing early when pursuing a moving target upwind', () => {
    const metrics = review('upwind', 45);
    safe(metrics);
    // The transport is faster. Progress and uninterrupted handling matter;
    // catching it is not a requirement of this scenario.
    expect(metrics.early20CruiseSeconds).toBeGreaterThanOrEqual(3);
    expect(metrics.early45UpwindAdvance).toBeGreaterThan(600);
    expect(metrics.early45LongestPendingStopSeconds).toBeLessThan(2);
  });

  it('rounds queued long-distance corners before reaching the vertices without idle handoffs', () => {
    const metrics = review('long-queued-corners');
    safe(metrics);
    expect(metrics.arrived).toBe(true);
    expect(metrics.queuedIdleTicks).toBe(0);
    expect(metrics.queuedPendingStopSeconds).toBe(0);
    expect(metrics.cornerTurnLeadLengths).toHaveLength(2);
    for (const lead of metrics.cornerTurnLeadLengths) {
      expect(lead).not.toBeNull();
      expect(lead!).toBeGreaterThan(.75);
    }
  });

  for (const running of [false, true]) for (const degrees of [90, 180]) for (const distance of [700, 2200]) {
    const id = `${running ? 'cruise' : 'rest'}-${degrees}-${distance}`;
    it(`${id} establishes its new direction early in the voyage`, () => {
      const metrics = review(id);
      safe(metrics);
      expect(metrics.arrived).toBe(true);
      expect(metrics.totalYawDegrees).toBeLessThan(degrees + 45);
      expect(metrics.rapidTurnReversals).toBeLessThanOrEqual(1);
      // No last-moment correction: most of the turn is completed before half
      // the straight-line distance has been closed, with <15° in the last fifth.
      expect(metrics.turnByProgress.slice(0, 5).reduce((a, b) => a + b, 0)).toBeGreaterThan(metrics.totalYawDegrees * .8);
      expect(metrics.turnByProgress.slice(8).reduce((a, b) => a + b, 0)).toBeLessThan(15);
    });
  }

  for (const kind of ['cutter', 'transport', 'warship']) for (const distance of [700, 1500]) {
    it(`${kind} makes useful progress on a ${distance}-unit upwind order`, () => {
      const metrics = review(`upwind-${kind}-${distance}`);
      safe(metrics);
      expect(metrics.arrived).toBe(true);
      // This is the RTS handling target: a medium upwind trip should retain
      // useful progress, even though its path necessarily has two angled legs.
      expect(metrics.usefulVMG).toBeGreaterThan(15);
      expect(metrics.pathRatio).toBeLessThan(2.5);
      expect(metrics.stopEpisodes).toBeLessThanOrEqual(2);
      expect(metrics.rapidTurnReversals).toBeLessThanOrEqual(2);
    });
  }
});
