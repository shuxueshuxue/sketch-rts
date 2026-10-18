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
    const kinds = (owner: string, kind: string) => crew(owner).filter(unit => unit.kind === kind).length;
    expect(kinds(pirates!.owner, 'footman')).toBeGreaterThanOrEqual(4); expect(kinds(admiralty!.owner, 'footman')).toBe(4);
    // Two carpenters and a priest on each deck, and gold to pay for the mending.
    for (const ship of [pirates!, admiralty!]) {
      expect([kinds(ship.owner, 'worker'), kinds(ship.owner, 'priest')]).toEqual([2, 1]);
      expect(game.players[ship.owner]!.gold).toBeGreaterThan(0);
    }
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
  it('is fought by the simulation: a gun duel on the way up, both hulls mended under it and the crews healed, no gun on a crew once boarding, and the pirates take the ship before the fade', () => {
    const game = createPirateBoarding().game;
    const [pirates, admiralty] = game.activePlayers.map(owner => game.units.find(unit => unit.owner === owner && unit.kind === 'shipOfTheLine')!);
    let bridge = 0, decided = 0, captured = 0, crewShotBoarding = 0;
    const duel = new Map([[pirates!.id, 0], [admiralty!.id, 0]]);
    game.observer = { hit(attacker, target) {
      if (attacker !== pirates && attacker !== admiralty) return;
      if (!bridge) duel.set(attacker.id, duel.get(attacker.id)! + 1);
      else if ('order' in target && target.deck) crewShotBoarding++;
    } };
    const mended = new Map([[pirates!.id, 0], [admiralty!.id, 0]]);
    let healed = 0;
    for (let tick = 1; tick <= 146 * SIM_TICKS_PER_SECOND && !captured; tick++) {
      const hp = new Map(game.units.map(unit => [unit.id, unit.hp])), maxHp = new Map(game.units.map(unit => [unit.id, unit.maxHp]));
      stepGame(game);
      for (const ship of [pirates!, admiralty!]) if (!bridge && ship.hp > hp.get(ship.id)!) mended.set(ship.id, mended.get(ship.id)! + 1);
      // A priest's heal lands at once (55), unlike a veteran's trickle of regeneration or a promotion's larger frame.
      healed += game.units.filter(unit => unit.kind === 'footman' && unit.hp > 0 && unit.maxHp === maxHp.get(unit.id)
        && unit.hp - hp.get(unit.id)! >= 20).length;
      if (!bridge && pirates!.sailing?.gangway && pirates!.sailing.gangway.phase !== 'approach') bridge = tick;
      if (!decided && battleDecided(game)) decided = tick;
      // Taken by the pirates, not the pirates' own hull taken by the marines.
      if (admiralty!.owner === 'corsairs') captured = tick;
    }
    // Both broadsides strike before the bridge goes out, and none strikes a crewman after.
    expect(duel.get(pirates!.id)).toBeGreaterThan(0); expect(duel.get(admiralty!.id)).toBeGreaterThan(0);
    // The carpenters mend both hulls through the duel, and the priests heal the swordsmen.
    expect(mended.get(pirates!.id)).toBeGreaterThan(0); expect(mended.get(admiralty!.id)).toBeGreaterThan(0);
    expect(healed).toBeGreaterThan(0);
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
