import { describe, expect, it } from 'vitest';
import { snapshotGame, stepGame } from '../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { MENU_BATTLES } from './menu-battles';
import { createPirateBoarding } from './menu-pirate-boarding';
import { battleDecided } from './menu-scene-world';

describe('the pirate boarding home battle', () => {
  it('opens grappled alongside: two ships of the line with their crews on deck, the pirate helm ordered to board', () => {
    const run = createPirateBoarding(), game = run.game;
    expect('battle' in run && run.battle).toEqual({ scene: 'fleet', seed: 1 });
    const [pirates, admiralty] = game.activePlayers.map(owner => game.units.find(unit => unit.owner === owner && unit.kind === 'shipOfTheLine')!);
    expect(pirates!.order.type).toBe('boardShip');
    const crew = (owner: string) => game.units.filter(unit => unit.owner === owner && unit.deck);
    expect(crew(pirates!.owner).length).toBeGreaterThanOrEqual(4); expect(crew(admiralty!.owner)).toHaveLength(4);
    // The admiralty ship's guns on the boarders' side are not run out (the scene's opening).
    expect(game.items.filter(item => item.shipId === admiralty!.id).map(item => item.mountId).sort()).toEqual(['port0', 'port2']);
    expect(run.warmCorpses!.map(corpse => corpse.variant).sort()).toEqual(['menu/marine', 'menu/pirate', 'menu/pirate-captain']);
  });

  it('builds the same opening from the same seed, so the thread fights what the page drew', () => {
    expect(JSON.stringify(snapshotGame(MENU_BATTLES.fleet(5)))).toBe(JSON.stringify(snapshotGame(createPirateBoarding(5).game)));
  });

  it('is fought by the simulation: the bridge goes out, the pirates cross, the deck is fought for and the ship taken', () => {
    const game = createPirateBoarding().game;
    const [pirates, admiralty] = game.activePlayers.map(owner => game.units.find(unit => unit.owner === owner && unit.kind === 'shipOfTheLine')!);
    let bridge = 0, across = 0, decided = 0;
    for (let tick = 1; tick <= 60 * SIM_TICKS_PER_SECOND && !decided; tick++) {
      stepGame(game);
      if (!bridge && pirates!.sailing?.gangway?.phase === 'ready') bridge = tick;
      if (!across && game.units.some(unit => unit.owner === pirates!.owner && unit.deck?.shipId === admiralty!.id)) across = tick;
      if (battleDecided(game)) decided = tick;
    }
    expect(bridge).toBeGreaterThan(0); expect(across).toBeGreaterThan(bridge);
    expect(decided).toBeGreaterThan(across);
    expect(game.effects.length + (game.corpses?.length ?? 0)).toBeGreaterThan(0);
    expect(game.corpses!.length).toBeGreaterThan(0);
  }, 60_000);
});
