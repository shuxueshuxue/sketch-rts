import { describe, expect, it } from 'vitest';
import { snapshotGame, stepGame } from '../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { MENU_BATTLES } from './menu-battles';
import { createPirateBoarding } from './menu-pirate-boarding';
import { battleDecided } from './menu-scene-world';

describe('the pirate boarding home battle', () => {
  it('opens with the pirates a leg astern in gun range: two ships of the line with their crews on deck, the pirate helm ordered to sail the leg and then board, and the marines at their posts', () => {
    const run = createPirateBoarding(), game = run.game;
    expect('battle' in run && run.battle).toEqual({ scene: 'fleet', seed: 1 });
    const [pirates, admiralty] = game.activePlayers.map(owner => game.units.find(unit => unit.owner === owner && unit.kind === 'shipOfTheLine')!);
    expect(pirates!.order.type).toBe('move');
    expect(pirates!.orderQueue?.map(order => order.type)).toEqual(['boardShip']);
    const crew = (owner: string) => game.units.filter(unit => unit.owner === owner && unit.deck);
    expect(crew(admiralty!.owner).every(unit => unit.order.type === 'hold')).toBe(true);
    expect(crew(pirates!.owner).length).toBeGreaterThanOrEqual(4); expect(crew(admiralty!.owner)).toHaveLength(4);
    // Both carry a ship of the line's four guns, and the pirates start well off the berth, not grappled.
    for (const ship of [pirates!, admiralty!]) expect(game.items.filter(item => item.shipId === ship.id).map(item => item.mountId).sort()).toEqual(['port0', 'port2', 'starboard0', 'starboard2']);
    expect(Math.hypot(pirates!.x - admiralty!.x, pirates!.y - admiralty!.y)).toBeGreaterThan(400);
    expect(run.warmCorpses!.map(corpse => corpse.variant).sort()).toEqual(['menu/marine', 'menu/pirate', 'menu/pirate-captain']);
  });

  it('builds the same opening from the same seed, so the thread fights what the page drew', () => {
    expect(JSON.stringify(snapshotGame(MENU_BATTLES.fleet(5)))).toBe(JSON.stringify(snapshotGame(createPirateBoarding(5).game)));
  });

  // @@@hull-reach: the pirates sail a leg alongside in the broadsides' band, and both trade fire; then they close to the
  // berth, under every gun's dead zone, so once the bridge is going out no gun strikes a crewman and the fight is the
  // crews' own, with the sword.
  it('is fought by the simulation: a gun duel on the way up, no gun on a crew once boarding, and the pirates take the ship before the fade', () => {
    const game = createPirateBoarding().game;
    const [pirates, admiralty] = game.activePlayers.map(owner => game.units.find(unit => unit.owner === owner && unit.kind === 'shipOfTheLine')!);
    let bridge = 0, decided = 0, captured = 0, crewShotBoarding = 0;
    const duel = new Map([[pirates!.id, 0], [admiralty!.id, 0]]);
    game.observer = { hit(attacker, target) {
      if (attacker !== pirates && attacker !== admiralty) return;
      if (!bridge) duel.set(attacker.id, duel.get(attacker.id)! + 1);
      else if ('order' in target && target.deck) crewShotBoarding++;
    } };
    for (let tick = 1; tick <= 146 * SIM_TICKS_PER_SECOND && !captured; tick++) {
      stepGame(game);
      if (!bridge && pirates!.sailing?.gangway && pirates!.sailing.gangway.phase !== 'approach') bridge = tick;
      if (!decided && battleDecided(game)) decided = tick;
      // Taken by the pirates, not the pirates' own hull taken by the marines.
      if (admiralty!.owner === 'corsairs') captured = tick;
    }
    // Both broadsides strike before the bridge goes out, and none strikes a crewman after.
    expect(duel.get(pirates!.id)).toBeGreaterThan(0); expect(duel.get(admiralty!.id)).toBeGreaterThan(0);
    expect(bridge).toBeGreaterThan(0); expect(decided).toBeGreaterThan(bridge);
    expect(crewShotBoarding).toBe(0);
    // The prize is taken before the home screen fades (LONGEST_BATTLE less the fade), within the aftermath it shows
    // after the fight is decided.
    expect(captured).toBeGreaterThan(0);
    expect(captured).toBeGreaterThanOrEqual(decided); expect(captured - decided).toBeLessThan(4 * SIM_TICKS_PER_SECOND);
    expect(pirates!.owner).toBe('corsairs');
    // The prize's deck is cleared; a marine who crossed the other way may still stand on the pirates' deck.
    expect(game.units.filter(unit => unit.owner === 'admiralty' && unit.deck?.shipId === admiralty!.id && unit.hp > 0)).toHaveLength(0);
  }, 120_000);
});
