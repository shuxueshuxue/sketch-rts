import { describe, expect, it } from 'vitest';
import { snapshotGame, stepGame } from '../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { MENU_BATTLES } from './menu-battles';
import { createPirateBoarding } from './menu-pirate-boarding';
import { battleDecided } from './menu-scene-world';

describe('the pirate boarding home battle', () => {
  it('opens with the pirates closing from astern: two ships of the line with their crews on deck, the pirate helm ordered to board and the marines at their posts', () => {
    const run = createPirateBoarding(), game = run.game;
    expect('battle' in run && run.battle).toEqual({ scene: 'fleet', seed: 1 });
    const [pirates, admiralty] = game.activePlayers.map(owner => game.units.find(unit => unit.owner === owner && unit.kind === 'shipOfTheLine')!);
    expect(pirates!.order.type).toBe('boardShip');
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

  it('is fought by the simulation: broadsides both ways as the pirates come up, the bridge goes out, the boarders win the deck and the pirates take the ship', () => {
    const game = createPirateBoarding().game;
    const [pirates, admiralty] = game.activePlayers.map(owner => game.units.find(unit => unit.owner === owner && unit.kind === 'shipOfTheLine')!);
    let bridge = 0, decided = 0, captured = 0, hullsHitBeforeBridge = new Set<string>();
    const hp = new Map([pirates!, admiralty!].map(ship => [ship.id, ship.hp]));
    for (let tick = 1; tick <= 60 * SIM_TICKS_PER_SECOND && !captured; tick++) {
      stepGame(game);
      if (!bridge) for (const ship of [pirates!, admiralty!]) if (ship.hp < hp.get(ship.id)!) hullsHitBeforeBridge.add(ship.id);
      if (!bridge && pirates!.sailing?.gangway?.phase === 'ready') bridge = tick;
      if (!decided && battleDecided(game)) decided = tick;
      // Taken by the pirates, not the pirates' own hull taken by the marines.
      if (admiralty!.owner === 'corsairs') captured = tick;
    }
    // The chase is short enough for the home screen, and each side's guns find the other hull on the way in.
    expect(bridge).toBeGreaterThan(0); expect(bridge).toBeLessThan(20 * SIM_TICKS_PER_SECOND); expect(decided).toBeGreaterThan(bridge);
    expect(hullsHitBeforeBridge.size).toBe(2);
    // The prize is taken within the aftermath the home screen shows after the fight is decided.
    expect(captured).toBeGreaterThanOrEqual(decided); expect(captured - decided).toBeLessThan(4 * SIM_TICKS_PER_SECOND);
    expect(pirates!.owner).toBe('corsairs');
    // The prize's deck is cleared; a marine who crossed the other way may still stand on the pirates' deck.
    expect(game.units.filter(unit => unit.owner === 'admiralty' && unit.deck?.shipId === admiralty!.id && unit.hp > 0)).toHaveLength(0);
  }, 60_000);
});
